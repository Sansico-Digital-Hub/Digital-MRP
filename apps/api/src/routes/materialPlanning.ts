import { FastifyInstance, FastifyRequest } from 'fastify';
import prisma from '../lib/prisma';
import { config } from '../config';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES } from '../lib/permissions';
import { computePeriodSignature, compareSignature } from '../lib/periodScope';
import { runMaterialCalculation, type MaterialCalcSource } from '../lib/materialCalcEngine';
import { analyzeNpofCoverage } from '../lib/npofCoverage';

// Material Planning HANYA membaca data milik modul MATERIAL.
// MRP & WIP Production Planning disimpan terpisah (kolom `moduleType`).
const MATERIAL = 'MATERIAL' as const;

/**
 * Route Material Planning berbasis PERIODE (PlanningCycle).
 *
 * Prinsip isolasi:
 *  - Tabel MASTER DATA (weekly_schedules, wips, hotlists, stock_raw_materials,
 *    outstanding_pos) punya `periodId` NOT NULL dan semua unique diawali periodId.
 *  - SETIAP query wajib memfilter periodId. Tidak ada deleteMany tanpa filter.
 *  - NPOF adalah pengecualian: sumber global yang dipakai bersama semua periode.
 *
 * Sejak 2026-09-28 tabel snapshot Cycle* DIHAPUS — data periode dibaca langsung
 * dari tabel Master Data (lihat migrasi 20260928000000_master_data_period).
 */

const SOURCE_TYPES = ['MRP', 'HOTLIST', 'STOCK_RM', 'OUTSTANDING_PO', 'WIP'] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

const RETENTION_MONTHS = 18;
const RETENTION_EXTENSIONS = [3, 6, 9, 12];

const MONTH_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/** "2026-09" -> "September 2026" */
function labelFromUploadMonth(uploadMonth: string): string {
  const [year, month] = uploadMonth.split('-');
  const idx = Number(month) - 1;
  const name = MONTH_NAMES_ID[idx] ?? uploadMonth;
  return `${name} ${year}`;
}

function uploadMonthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Jumlah baris per sumber untuk SATU periode. Dipakai kartu kelengkapan data di
 * Material Calculation. Selalu difilter `periodId` supaya periode lain tidak
 * pernah ikut terhitung.
 */
async function countPeriodRows(periodId: string): Promise<Record<SourceType, number>> {
  const [mrp, hotlist, stock, po, wip] = await Promise.all([
    prisma.weeklySchedule.count({ where: { periodId, moduleType: MATERIAL } }),
    prisma.hotlist.count({ where: { periodId } }),
    prisma.stockRawMaterial.count({ where: { periodId } }),
    prisma.outstandingPO.count({ where: { periodId } }),
    prisma.wIP.count({ where: { periodId, moduleType: MATERIAL } }),
  ]);
  return { MRP: mrp, HOTLIST: hotlist, STOCK_RM: stock, OUTSTANDING_PO: po, WIP: wip };
}

/**
 * Jumlah baris MRP & WIP TERPISAH per modul. Dipakai halaman Master Data
 * (26-Week Demand & WIP) supaya angka yang ditampilkan sesuai modul yang
 * sedang dibuka, bukan gabungan kedua modul.
 */
async function countModuleRows(periodId: string) {
  const [prodMrp, matMrp, prodWip, matWip] = await Promise.all([
    prisma.weeklySchedule.count({ where: { periodId, moduleType: 'PRODUCTION' } }),
    prisma.weeklySchedule.count({ where: { periodId, moduleType: 'MATERIAL' } }),
    prisma.wIP.count({ where: { periodId, moduleType: 'PRODUCTION' } }),
    prisma.wIP.count({ where: { periodId, moduleType: 'MATERIAL' } }),
  ]);
  return {
    PRODUCTION: { MRP: prodMrp, WIP: prodWip },
    MATERIAL: { MRP: matMrp, WIP: matWip },
  };
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Ambil periode atau kirim 404. Dipakai semua endpoint ber-:id. */
async function requireCycle(id: string) {
  const cycle = await prisma.planningCycle.findUnique({ where: { id } });
  return cycle;
}

/** Status turunan (rancangan §4.1.1) — tidak disimpan di database. */
function deriveStatus(
  cycle: { status: string; isLocked: boolean; lastDataChangeAt: Date },
  currentResult: { dataVersionAt: Date } | null,
) {
  let base: 'NOT_CALCULATED' | 'CALCULATED' | 'STALE';
  if (!currentResult) base = 'NOT_CALCULATED';
  else if (cycle.lastDataChangeAt.getTime() > currentResult.dataVersionAt.getTime()) base = 'STALE';
  else base = 'CALCULATED';
  return { base, isStale: base === 'STALE', isLocked: cycle.isLocked };
}

function displayText(firstUploadedAt: Date, calculatedAt: Date | null): string {
  const fmt = (d: Date) =>
    `${d.getUTCDate()} ${MONTH_NAMES_ID[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()} ${String(
      d.getUTCHours(),
    ).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return calculatedAt
    ? `Diupload pada ${fmt(firstUploadedAt)} · Dihitung pada ${fmt(calculatedAt)}`
    : `Diupload pada ${fmt(firstUploadedAt)} · Belum dihitung`;
}

/** Satu entri audit ringkas per aksi (bukan per baris data). */
async function writeAudit(params: {
  cycleId: string;
  userId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  sourceType?: string;
  entityType: string;
  entityId?: string;
  notes?: string;
  dataBefore?: unknown;
  dataAfter?: unknown;
}) {
  await prisma.cycleAuditLog.create({
    data: {
      cycleId: params.cycleId,
      userId: params.userId,
      action: params.action,
      sourceType: params.sourceType,
      entityType: params.entityType,
      entityId: params.entityId,
      notes: params.notes,
      dataBefore: (params.dataBefore ?? undefined) as any,
      dataAfter: (params.dataAfter ?? undefined) as any,
    },
  });
}

// CATATAN (2026-09-28): fungsi `copyLiveIntoCycle` dan endpoint `import` /
// `import-live` SUDAH DIHAPUS. Sejak periode pindah ke Master Data (`periodId`),
// data periode BUKAN lagi salinan: halaman Master Data menulis LANGSUNG ke tabel
// periode. Perhitungan cukup membaca tabel Master Data dengan filter `periodId`.

export default async function materialPlanningRoutes(server: FastifyInstance) {
  // Editor Material Planning: Admin, Super Admin, dan Material Planner.
  // Production Planner TIDAK boleh mengubah data material.
  const editor = [authenticate, requireRole(EDIT_ROLES.material)];
  const superOnly = [authenticate, requireRole(['SUPER_ADMIN'])];

  // ══════════════════════════════════════════════════════════════════════
  // DAFTAR & PEMBUATAN PERIODE
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Daftar periode RINGKAS untuk halaman Master Data: hanya identitas periode +
   * jumlah baris tiap sumber. Dipakai untuk folder periode dan validasi
   * "periode ini sudah ada datanya atau belum" sebelum upload.
   */
  server.get('/api/v1/material-planning/periods', { preValidation: [authenticate] }, async (_request, reply) => {
    const cycles = await prisma.planningCycle.findMany({ orderBy: { uploadMonth: 'desc' } });
    const data = await Promise.all(
      cycles.map(async (c) => ({
        id: c.id,
        uploadMonth: c.uploadMonth,
        label: c.label,
        isLocked: c.isLocked,
        mrpStartDate: c.mrpStartDate,
        mrpEndDate: c.mrpEndDate,
        // counts = sumber modul MATERIAL (dipakai Material Calculation)
        counts: await countPeriodRows(c.id),
        // counts terpisah Production vs Material (dipakai halaman Master Data)
        moduleCounts: await countModuleRows(c.id),
      })),
    );
    return reply.send({ data });
  });

  server.get('/api/v1/material-planning/cycles', { preValidation: [authenticate] }, async (_request, reply) => {
    const [cycles, npofAgg] = await Promise.all([
      prisma.planningCycle.findMany({
        orderBy: { uploadMonth: 'desc' },
        include: {
          uploads: { orderBy: { uploadedAt: 'desc' } },
          results: {
            select: {
              id: true,
              runNumber: true,
              calculatedAt: true,
              calculatedBy: true,
              dataVersionAt: true,
              isCurrent: true,
              isSaved: true,
              savedNote: true,
            },
          },
        },
      }),
      prisma.npofMaterial.aggregate({ _count: { _all: true }, _max: { updatedAt: true } }),
    ]);

    const npofLastUpdated = npofAgg._max.updatedAt;

    const data = cycles.map((c) => {
      const current = c.results.find((r) => r.isCurrent) ?? null;
      const { base, isStale, isLocked } = deriveStatus(c, current);
      return {
        id: c.id,
        uploadMonth: c.uploadMonth,
        label: c.label,
        status: c.status,
        derivedStatus: base,
        isStale,
        isLocked,
        displayText: displayText(c.firstUploadedAt, c.calculatedAt),
        firstUploadedAt: c.firstUploadedAt,
        lastUploadedAt: c.lastUploadedAt,
        lastDataChangeAt: c.lastDataChangeAt,
        mrpStartDate: c.mrpStartDate,
        mrpEndDate: c.mrpEndDate,
        weekCount: c.weekCount,
        notes: c.notes,
        currentResult: current
          ? {
              id: current.id,
              runNumber: current.runNumber,
              calculatedAt: current.calculatedAt,
              calculatedBy: current.calculatedBy,
              isSaved: current.isSaved,
              savedNote: current.savedNote,
            }
          : null,
        savedResultCount: c.results.filter((r) => r.isSaved).length,
        sources: c.uploads.map((u) => ({
          sourceType: u.sourceType,
          rowCount: u.rowCount,
          uploadedAt: u.uploadedAt,
          uploadedBy: u.uploadedBy,
          fileName: u.fileName,
        })),
        npofInfo: {
          isShared: true,
          totalRows: npofAgg._count._all,
          lastUpdatedAt: npofLastUpdated,
          changedSinceCalculation:
            Boolean(npofLastUpdated && current) &&
            Boolean(npofLastUpdated && current && npofLastUpdated.getTime() > current.calculatedAt.getTime()),
        },
      };
    });

    return reply.send({ data });
  });

  server.post(
    '/api/v1/material-planning/cycles',
    { preValidation: editor },
    async (request: FastifyRequest, reply) => {
      const body = (request.body || {}) as { label?: string; notes?: string; uploadMonth?: string };
      const now = new Date();
      const uploadMonth = body.uploadMonth && /^\d{4}-\d{2}$/.test(body.uploadMonth)
        ? body.uploadMonth
        : uploadMonthOf(now);

      const existing = await prisma.planningCycle.findUnique({ where: { uploadMonth } });
      if (existing) {
        return reply.code(409).send({
          error: 'Conflict',
          message: `Periode untuk bulan upload ${uploadMonth} sudah ada ("${existing.label}"). Upload data ke periode itu, atau hapus dulu.`,
          data: { id: existing.id, label: existing.label },
        });
      }

      const cycle = await prisma.planningCycle.create({
        data: {
          uploadMonth,
          label: body.label?.trim() || labelFromUploadMonth(uploadMonth),
          // Belum diketahui sampai data MRP diupload ke periode ini.
          mrpStartDate: null,
          mrpEndDate: null,
          weekCount: 26,
          retentionDueAt: addMonths(now, RETENTION_MONTHS),
          notes: body.notes,
          createdBy: request.user!.id,
        },
      });

      await writeAudit({
        cycleId: cycle.id,
        userId: request.user!.id,
        action: 'CREATE',
        entityType: 'PlanningCycle',
        entityId: cycle.id,
        notes: `Periode dibuat: ${cycle.label} (bulan upload ${cycle.uploadMonth})`,
      });

      return reply.code(201).send({ data: cycle });
    },
  );

  server.get('/api/v1/material-planning/cycles/expired', { preValidation: editor }, async (_request, reply) => {
    const due = await prisma.planningCycle.findMany({
      where: { retentionDueAt: { lt: new Date() } },
      include: {
        results: {
          where: { isSaved: true },
          select: { id: true, runNumber: true, calculatedAt: true, savedNote: true },
        },
      },
      orderBy: { retentionDueAt: 'asc' },
    });

    return reply.send({
      data: due.map((c) => ({
        id: c.id,
        label: c.label,
        uploadMonth: c.uploadMonth,
        retentionDueAt: c.retentionDueAt,
        retentionNotifiedAt: c.retentionNotifiedAt,
        hasSavedResults: c.results.length > 0,
        savedResults: c.results,
      })),
      extensions: RETENTION_EXTENSIONS,
    });
  });

  server.get('/api/v1/material-planning/cycles/:id', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const cycle = await prisma.planningCycle.findUnique({
      where: { id },
      include: {
        uploads: { orderBy: { uploadedAt: 'desc' } },
        results: { orderBy: { runNumber: 'desc' } },
      },
    });
    if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });

    const current = cycle.results.find((r) => r.isCurrent) ?? null;
    const rowCounts = await countPeriodRows(id);

    return reply.send({
      data: {
        ...cycle,
        results: cycle.results.map((r) => ({ ...r, resultSnapshot: undefined, summarySnapshot: undefined })),
        derivedStatus: deriveStatus(cycle, current).base,
        rowCounts,
      },
    });
  });

  server.patch('/api/v1/material-planning/cycles/:id', { preValidation: editor }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { label?: string; notes?: string; uploadMonth?: string };
    const cycle = await requireCycle(id);
    if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });

    let newUploadMonth = cycle.uploadMonth;
    let newLabel = body.label?.trim();

    if (body.uploadMonth && body.uploadMonth !== cycle.uploadMonth) {
      if (!/^\d{4}-\d{2}$/.test(body.uploadMonth)) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Format uploadMonth tidak valid (YYYY-MM)' });
      }
      const existing = await prisma.planningCycle.findUnique({ where: { uploadMonth: body.uploadMonth } });
      if (existing) {
        return reply.code(409).send({ error: 'Conflict', message: `Bulan upload ${body.uploadMonth} sudah dipakai.` });
      }
      newUploadMonth = body.uploadMonth;
      if (!newLabel) {
        newLabel = labelFromUploadMonth(newUploadMonth);
      }
    }

    const updated = await prisma.planningCycle.update({
      where: { id },
      data: { 
        uploadMonth: newUploadMonth,
        label: newLabel || cycle.label, 
        notes: body.notes ?? cycle.notes 
      },
    });

    await writeAudit({
      cycleId: id,
      userId: request.user!.id,
      action: 'UPDATE',
      entityType: 'PlanningCycle',
      entityId: id,
      dataBefore: { uploadMonth: cycle.uploadMonth, label: cycle.label, notes: cycle.notes },
      dataAfter: { uploadMonth: updated.uploadMonth, label: updated.label, notes: updated.notes },
      notes: 'Informasi periode diubah',
    });

    return reply.send({ data: updated });
  });

  server.delete('/api/v1/material-planning/cycles/:id', { preValidation: superOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const cycle = await requireCycle(id);
    if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });

    // onDelete: Cascade pada `periodId` menghapus data periode ini di 5 tabel
    // Master Data sekaligus (weekly_schedules, wips, hotlists,
    // stock_raw_materials, outstanding_pos).
    await prisma.planningCycle.delete({ where: { id } });
    return reply.send({ success: true, message: `Periode "${cycle.label}" dihapus beserta seluruh datanya.` });
  });





  server.get('/api/v1/material-planning/cycles/:id/sources', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const cycle = await requireCycle(id);
    if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });

    const uploads = await prisma.cycleSourceUpload.findMany({
      where: { cycleId: id },
      orderBy: { uploadedAt: 'desc' },
    });

    const rowCounts = await countPeriodRows(id);

    return reply.send({
      data: SOURCE_TYPES.map((sourceType) => {
        const latest = uploads.find((u) => u.sourceType === sourceType) ?? null;
        return {
          sourceType,
          rowCount: rowCounts[sourceType],
          uploaded: Boolean(latest),
          uploadedAt: latest?.uploadedAt ?? null,
          uploadedBy: latest?.uploadedBy ?? null,
          fileName: latest?.fileName ?? null,
        };
      }),
      npof: { isShared: true, note: 'NPOF dipakai bersama semua periode, dikelola di Master Data.' },
    });
  });

  /**
   * Validitas hasil perhitungan periode ini terhadap data master SEKARANG.
   * Dipakai halaman Material Calculation untuk menampilkan
   * "Calculation tidak valid karena ada perubahan data. Silakan hitung ulang."
   * beserta sumber mana yang berubah.
   */
  server.get('/api/v1/material-planning/cycles/:id/data-status', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const cycle = await requireCycle(id);
    if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });

    const current = await prisma.cycleResult.findFirst({
      where: { cycleId: id, isCurrent: true },
      select: {
        id: true,
        runNumber: true,
        calculatedAt: true,
        dataVersionAt: true,
        dataSignature: true,
      },
    });

    const currentSignature = await computePeriodSignature(id, MATERIAL);
    const diff = compareSignature(current?.dataSignature ?? null, currentSignature);

    // Cadangan untuk perhitungan lama yang belum punya checksum: bandingkan cap waktu.
    const staleByTimestamp =
      Boolean(current) && cycle.lastDataChangeAt.getTime() > current!.dataVersionAt.getTime();
    const invalid = Boolean(current) && (diff.anyChanged || staleByTimestamp);

    return reply.send({
      data: {
        hasResult: Boolean(current),
        runNumber: current?.runNumber ?? null,
        calculatedAt: current?.calculatedAt ?? null,
        signatureComparable: diff.comparable,
        changedSources: diff.changedSources,
        isValid: Boolean(current) && !invalid,
        isInvalid: invalid,
        invalidReason: invalid ? 'Calculation tidak valid karena ada perubahan data. Silakan hitung ulang.' : null,
        currentSignature,
        calculatedSignature: current?.dataSignature ?? null,
      },
    });
  });

  server.get('/api/v1/material-planning/cycles/:id/npof-check', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = await prisma.cycleResult.findFirst({
      where: { cycleId: id, isCurrent: true },
      select: { calculatedAt: true },
    });
    const npofAgg = await prisma.npofMaterial.aggregate({ _max: { updatedAt: true } });
    const npofLastUpdated = npofAgg._max.updatedAt;

    const changed =
      Boolean(npofLastUpdated && current) &&
      Boolean(npofLastUpdated && current && npofLastUpdated.getTime() > current.calculatedAt.getTime());

    return reply.send({
      data: {
        changedSinceCalculation: changed,
        npofLastUpdatedAt: npofLastUpdated,
        lastCalculatedAt: current?.calculatedAt ?? null,
        message: changed
          ? 'NPOF sudah berubah sejak perhitungan terakhir. Perhitungan akan mengikuti NPOF terbaru.'
          : 'NPOF tidak berubah sejak perhitungan terakhir.',
      },
    });
  });

  /**
   * Cakupan NPOF: part number mana yang ada di MRP periode ini tetapi TIDAK ADA
   * di NPOF, plus part yang ada di NPOF tapi datanya tidak lengkap.
   *
   * NPOF adalah referensi GLOBAL (tidak per periode) — sengaja tidak difilter
   * periodId, sama seperti perhitungan di `/calculate`.
   */
  server.get('/api/v1/material-planning/cycles/:id/npof-coverage', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const cycle = await requireCycle(id);
    if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });

    const [mrpRows, npofs] = await Promise.all([
      prisma.weeklySchedule.findMany({ where: { periodId: id, moduleType: MATERIAL }, include: { item: true } }),
      prisma.npofMaterial.findMany(),
    ]);

    const analysis = analyzeNpofCoverage({
      mrpWeeks: mrpRows.map((r) => ({
        partNumber: r.item.partNumber,
        description: r.item.itemName,
        weekNumber: r.weekNumber,
        quantity: r.quantity,
      })),
      npofs,
    });

    return reply.send({
      data: {
        ...analysis,
        npofTotalRows: npofs.length,
        periodLabel: cycle.label,
      },
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // PERHITUNGAN
  // ══════════════════════════════════════════════════════════════════════

  server.post('/api/v1/material-planning/cycles/:id/calculate', { preValidation: editor }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const cycle = await requireCycle(id);
    if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });
    if (cycle.isLocked) {
      return reply.code(409).send({ error: 'Conflict', message: 'Periode terkunci. Buka kunci dulu.' });
    }

    // Sejak 2026-09-28 data periode dibaca LANGSUNG dari tabel Master Data
    // (difilter periodId) — tidak ada lagi tabel snapshot Cycle*.
    const [mrpRows, hotlists, stocks, pos, wips, npofs] = await Promise.all([
      prisma.weeklySchedule.findMany({ where: { periodId: id, moduleType: MATERIAL }, include: { item: true } }),
      prisma.hotlist.findMany({ where: { periodId: id } }),
      prisma.stockRawMaterial.findMany({ where: { periodId: id }, orderBy: { date: 'desc' } }),
      prisma.outstandingPO.findMany({ where: { periodId: id } }),
      prisma.wIP.findMany({ where: { periodId: id, moduleType: MATERIAL }, include: { item: true } }),
      prisma.npofMaterial.findMany(), // global, dipakai bersama semua periode
    ]);

    if (mrpRows.length === 0) {
      return reply.code(400).send({
        error: 'Bad Request',
        message:
          'Periode ini belum punya data MRP untuk Material Planning. Upload data MRP 26 Weeks di halaman Master Data dengan modul "Material Planning" dipilih.',
      });
    }

    const source: MaterialCalcSource = {
      mrpWeeks: mrpRows.map((r) => ({
        partNumber: r.item.partNumber,
        description: r.item.itemName,
        year: r.year,
        weekNumber: r.weekNumber,
        weekStartDate: r.weekStartDate,
        weekEndDate: r.weekEndDate,
        quantity: r.quantity,
      })),
      hotlists: hotlists.map((h) => ({ partNumber: h.partNumber, biTotal: h.biTotal })),
      stocks: stocks.map((s) => ({ itemDesc: s.itemDesc, supplier: s.supplier, qty: s.qty, unit: s.unit })),
      pos: pos.map((p) => ({
        itemDesc: p.itemDesc,
        supplierName: p.supplierName,
        qtyOrder: p.qtyOrder,
        qtyOrderUnit: p.qtyOrderUnit,
        qtyDelivered: p.qtyDelivered,
        planReceivedDate: p.planReceivedDate,
        poNumber: p.poNumber,
      })),
      wips: wips.map((w) => ({ partNumber: w.item.partNumber, location: w.location, quantity: w.quantity })),
      npofs,
    };

    // Rentang tanggal diambil dari DATA MRP periode ini (sumber kebenaran).
    // Kolom `PlanningCycle.mrpStartDate` hanya cadangan: kalau keduanya berbeda,
    // data yang menang supaya `periodStartDate` (dasar penerjemahan tanggal PO
    // menjadi indeks minggu) tidak pernah memakai nilai basi.
    const periodStartDate =
      mrpRows.reduce<Date | null>(
        (min, r) => (!min || r.weekStartDate < min ? r.weekStartDate : min),
        null,
      ) ??
      cycle.mrpStartDate;
    if (!periodStartDate) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Tanggal mulai MRP periode ini tidak diketahui. Upload ulang data MRP.',
      });
    }

    const result = runMaterialCalculation(source, {
      weekCount: cycle.weekCount,
      periodStartDate,
      timelineBaseDate: periodStartDate,
      toleranceCm: config.materialCalc.sizeToleranceCm,
      sheetsPerRim: config.materialCalc.sheetsPerRim,
      requireSupplierMatch: config.materialCalc.requireSupplierMatch,
    });

    const calculatedAt = new Date();
    const runNumber = cycle.calculatedRunCount + 1;

    // Checksum data master tepat sebelum hasil disimpan — dasar validasi
    // "Calculation tidak valid karena ada perubahan data".
    const signature = await computePeriodSignature(id, MATERIAL);

    const created = await prisma.$transaction(async (tx) => {
      // Siklus hidup hasil (rancangan §4.1.5):
      //  - baris current lama yang isSaved = false -> dihapus
      //  - baris current lama yang isSaved = true  -> tetap disimpan
      const oldCurrent = await tx.cycleResult.findMany({ where: { cycleId: id, isCurrent: true } });
      const toDelete = oldCurrent.filter((r) => !r.isSaved).map((r) => r.id);
      if (toDelete.length > 0) {
        await tx.cycleResult.deleteMany({ where: { id: { in: toDelete }, cycleId: id } });
      }
      if (oldCurrent.length > 0) {
        await tx.cycleResult.updateMany({
          where: { cycleId: id, isCurrent: true },
          data: { isCurrent: false },
        });
      }

      const row = await tx.cycleResult.create({
        data: {
          cycleId: id,
          runNumber,
          periodStartDate: result.periodStartDate,
          periodEndDate: result.periodEndDate,
          periodWeeks: result.periodWeeks,
          calculatedAt,
          calculatedBy: request.user!.id,
          dataVersionAt: cycle.lastDataChangeAt,
          isCurrent: true,
          isSaved: false,
          resultSnapshot: {
            calculatedAt: calculatedAt.toISOString(),
            periodStartDate: result.periodStartDate.toISOString(),
            periodEndDate: result.periodEndDate.toISOString(),
            periodWeeks: result.periodWeeks,
            weekCount: result.weekCount,
            groups: result.groups,
          } as any,
          summarySnapshot: { totals: result.totals, weeks: result.weeks } as any,
          dataSignature: signature as any,
        },
      });

      await tx.planningCycle.update({
        where: { id },
        data: {
          status: 'CALCULATED',
          calculatedAt,
          calculatedBy: request.user!.id,
          calculatedRunCount: runNumber,
        },
      });

      return row;
    });

    await writeAudit({
      cycleId: id,
      userId: request.user!.id,
      action: 'CREATE',
      entityType: 'CycleResult',
      entityId: created.id,
      notes: `Perhitungan run #${runNumber}: ${result.totals.partCount} part, ${result.totals.partsWithStock} part dapat stok.`,
    });

    return reply.code(201).send({
      data: {
        id: created.id,
        runNumber,
        calculatedAt,
        periodStartDate: result.periodStartDate,
        periodEndDate: result.periodEndDate,
        periodWeeks: result.periodWeeks,
        weekCount: result.weekCount,
        weeks: result.weeks,
        totals: result.totals,
        groups: result.groups,
      },
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // HASIL PERHITUNGAN
  // ══════════════════════════════════════════════════════════════════════

  server.get('/api/v1/material-planning/cycles/:id/results', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const results = await prisma.cycleResult.findMany({
      where: { cycleId: id },
      orderBy: { runNumber: 'desc' },
      select: {
        id: true,
        runNumber: true,
        periodStartDate: true,
        periodEndDate: true,
        periodWeeks: true,
        calculatedAt: true,
        calculatedBy: true,
        isCurrent: true,
        isSaved: true,
        savedNote: true,
        summarySnapshot: true,
      },
    });
    return reply.send({ data: results });
  });

  server.get('/api/v1/material-planning/cycles/:id/results/:resultId', { preValidation: [authenticate] }, async (request, reply) => {
    const { id, resultId } = request.params as { id: string; resultId: string };
    // where memakai id + cycleId supaya tidak bisa menembus periode lain.
    const result = await prisma.cycleResult.findFirst({ where: { id: resultId, cycleId: id } });
    if (!result) return reply.code(404).send({ error: 'Not Found', message: 'Hasil tidak ditemukan di periode ini' });
    return reply.send({ data: result });
  });

  server.patch(
    '/api/v1/material-planning/cycles/:id/results/:resultId',
    { preValidation: editor },
    async (request, reply) => {
      const { id, resultId } = request.params as { id: string; resultId: string };
      const body = (request.body || {}) as { isSaved?: boolean; savedNote?: string };
      const existing = await prisma.cycleResult.findFirst({ where: { id: resultId, cycleId: id } });
      if (!existing) return reply.code(404).send({ error: 'Not Found', message: 'Hasil tidak ditemukan di periode ini' });
      if (existing.isCurrent && body.isSaved === false) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Hasil yang sedang aktif tidak bisa dibatalkan penyimpanannya. Hitung ulang dulu.',
        });
      }

      const updated = await prisma.cycleResult.update({
        where: { id: resultId },
        data: {
          isSaved: body.isSaved ?? existing.isSaved,
          savedNote: body.savedNote ?? existing.savedNote,
        },
      });

      await writeAudit({
        cycleId: id,
        userId: request.user!.id,
        action: 'UPDATE',
        entityType: 'CycleResult',
        entityId: resultId,
        dataBefore: { isSaved: existing.isSaved, savedNote: existing.savedNote },
        dataAfter: { isSaved: updated.isSaved, savedNote: updated.savedNote },
        notes: updated.isSaved ? 'Hasil ditandai tersimpan' : 'Tanda tersimpan dibatalkan',
      });

      return reply.send({ data: updated });
    },
  );

  server.delete(
    '/api/v1/material-planning/cycles/:id/results/:resultId',
    { preValidation: editor },
    async (request, reply) => {
      const { id, resultId } = request.params as { id: string; resultId: string };
      const existing = await prisma.cycleResult.findFirst({ where: { id: resultId, cycleId: id } });
      if (!existing) return reply.code(404).send({ error: 'Not Found', message: 'Hasil tidak ditemukan di periode ini' });
      if (existing.isCurrent) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Hasil aktif tidak bisa dihapus langsung.' });
      }
      await prisma.cycleResult.delete({ where: { id: resultId } });
      await writeAudit({
        cycleId: id,
        userId: request.user!.id,
        action: 'DELETE',
        entityType: 'CycleResult',
        entityId: resultId,
        dataBefore: { runNumber: existing.runNumber },
        notes: `Versi tersimpan run #${existing.runNumber} dihapus`,
      });
      return reply.send({ success: true });
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // AUDIT & KUNCI MANUAL
  // ══════════════════════════════════════════════════════════════════════

  server.get('/api/v1/material-planning/cycles/:id/audit', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const logs = await prisma.cycleAuditLog.findMany({
      where: { cycleId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { name: true, email: true } } },
    });
    return reply.send({ data: logs });
  });

  server.post('/api/v1/material-planning/cycles/:id/lock', { preValidation: superOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { note?: string };
    const cycle = await requireCycle(id);
    if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });

    const updated = await prisma.planningCycle.update({
      where: { id },
      data: { isLocked: true, lockedAt: new Date(), lockedBy: request.user!.id, lockNote: body.note },
    });
    await writeAudit({
      cycleId: id,
      userId: request.user!.id,
      action: 'UPDATE',
      entityType: 'PlanningCycle',
      entityId: id,
      notes: `Periode dikunci. ${body.note || ''}`.trim(),
    });
    return reply.send({ data: updated });
  });

  server.post('/api/v1/material-planning/cycles/:id/unlock', { preValidation: superOnly }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const cycle = await requireCycle(id);
    if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });

    const updated = await prisma.planningCycle.update({
      where: { id },
      data: { isLocked: false, lockedAt: null, lockedBy: null, lockNote: null },
    });
    await writeAudit({
      cycleId: id,
      userId: request.user!.id,
      action: 'UPDATE',
      entityType: 'PlanningCycle',
      entityId: id,
      notes: 'Kunci periode dibuka',
    });
    return reply.send({ data: updated });
  });

  // ══════════════════════════════════════════════════════════════════════
  // RETENSI 18 BULAN
  // ══════════════════════════════════════════════════════════════════════

  server.post(
    '/api/v1/material-planning/cycles/:id/confirm-delete',
    { preValidation: editor },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const cycle = await requireCycle(id);
      if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });

      await prisma.planningCycle.delete({ where: { id } });
      return reply.send({ success: true, message: `Periode "${cycle.label}" dihapus permanen.` });
    },
  );

  server.post(
    '/api/v1/material-planning/cycles/:id/extend-retention',
    { preValidation: editor },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body || {}) as { months?: number };
      const months = Number(body.months);
      if (!RETENTION_EXTENSIONS.includes(months)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: `Durasi harus salah satu dari: ${RETENTION_EXTENSIONS.join(', ')} bulan.`,
        });
      }
      const cycle = await requireCycle(id);
      if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });

      const updated = await prisma.planningCycle.update({
        where: { id },
        data: { retentionDueAt: addMonths(new Date(), months), retentionNotifiedAt: null },
      });
      await writeAudit({
        cycleId: id,
        userId: request.user!.id,
        action: 'UPDATE',
        entityType: 'PlanningCycle',
        entityId: id,
        notes: `Retensi diperpanjang ${months} bulan (jatuh tempo ${updated.retentionDueAt?.toISOString().slice(0, 10)}).`,
      });
      return reply.send({ data: updated });
    },
  );
}
