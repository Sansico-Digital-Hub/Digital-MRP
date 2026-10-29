import { FastifyInstance, FastifyRequest } from 'fastify';
import prisma from '../lib/prisma';
import { config } from '../config';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES } from '../lib/permissions';
import { computePeriodSignature, compareSignature } from '../lib/periodScope';
import {
  poolQtyUnit,
  runMaterialCalculation,
  type MaterialCalcSource,
} from '../lib/materialCalcEngine';
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

/** Hasil menjalankan perhitungan: berhasil, atau pesan siap dikirim ke klien. */
type CalculateOutcome =
  | {
      ok: true;
      created: { id: string };
      result: ReturnType<typeof runMaterialCalculation>;
      runNumber: number;
      calculatedAt: Date;
    }
  | { ok: false; status: 400 | 404 | 409; message: string };

/**
 * Jalankan perhitungan untuk SATU periode dan simpan hasilnya sebagai run BARU.
 *
 * Diekstrak dari endpoint `/calculate` supaya ada DUA jalur yang memakai logika
 * yang sama persis:
 *  1. `POST /cycles/:id/calculate` — tombol "Hitung" / "Hitung Ulang".
 *  2. CRUD pengecualian pool (`/cycles/:id/exclusions`) — keputusan user
 *     "material ini tidak ikut untuk ukuran ini" harus LANGSUNG mengubah angka
 *     Stock As Of / Outstanding PO / End Ind, jadi dihitung ulang otomatis.
 */
async function calculateCycleResult(cycleId: string, userId: string): Promise<CalculateOutcome> {
  const cycle = await requireCycle(cycleId);
  if (!cycle) return { ok: false, status: 404, message: 'Periode tidak ditemukan' };
  if (cycle.isLocked) {
    return { ok: false, status: 409, message: 'Periode terkunci. Buka kunci dulu.' };
  }

  // Sejak 2026-09-28 data periode dibaca LANGSUNG dari tabel Master Data
  // (difilter periodId) — tidak ada lagi tabel snapshot Cycle*.
  const [mrpRows, hotlists, stocks, pos, wips, npofs, exclusions] = await Promise.all([
    prisma.weeklySchedule.findMany({ where: { periodId: cycleId, moduleType: MATERIAL }, include: { item: true } }),
    prisma.hotlist.findMany({ where: { periodId: cycleId } }),
    prisma.stockRawMaterial.findMany({ where: { periodId: cycleId }, orderBy: { date: 'desc' } }),
    prisma.outstandingPO.findMany({ where: { periodId: cycleId } }),
    prisma.wIP.findMany({ where: { periodId: cycleId, moduleType: MATERIAL }, include: { item: true } }),
    prisma.npofMaterial.findMany(), // global, dipakai bersama semua periode
    // Penawaran pool yang dikeluarkan user untuk ukuran tertentu (per periode).
    prisma.materialCalcExclusion.findMany({ where: { cycleId } }),
  ]);

  if (mrpRows.length === 0) {
    return {
      ok: false,
      status: 400,
      message:
        'Periode ini belum punya data MRP untuk Material Planning. Upload data MRP 26 Weeks di halaman Master Data dengan modul "Material Planning" dipilih.',
    };
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
      // `id` dipakai sebagai identitas stabil baris PO (pengecualian user).
      id: p.id,
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
    exclusions: exclusions.map((e) => ({
      source: e.kind === 'STOCK' ? ('stock' as const) : ('po' as const),
      groupKey: e.groupKey,
      poolRef: e.poolRef,
      reason: e.reason,
      // Pengecualian SEBAGIAN: `qty` = jumlah yang dikeluarkan dari ukuran ini.
      qty: e.qty,
      unit: e.unit,
    })),
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
    return {
      ok: false,
      status: 400,
      message: 'Tanggal mulai MRP periode ini tidak diketahui. Upload ulang data MRP.',
    };
  }

  const result = runMaterialCalculation(source, {
    weekCount: cycle.weekCount,
    periodStartDate,
    toleranceCm: config.materialCalc.sizeToleranceCm,
    sheetsPerRim: config.materialCalc.sheetsPerRim,
    requireSupplierMatch: config.materialCalc.requireSupplierMatch,
    recommendation: config.materialCalc.recommendation,
  });

  const calculatedAt = new Date();
  const runNumber = cycle.calculatedRunCount + 1;

  // Checksum data master tepat sebelum hasil disimpan — dasar validasi
  // "Calculation tidak valid karena ada perubahan data".
  const signature = await computePeriodSignature(cycleId, MATERIAL);

  const created = await prisma.$transaction(async (tx) => {
    // Siklus hidup hasil (rancangan §4.1.5):
    //  - baris current lama yang isSaved = false -> dihapus
    //  - baris current lama yang isSaved = true  -> tetap disimpan
    const oldCurrent = await tx.cycleResult.findMany({ where: { cycleId, isCurrent: true } });
    const toDelete = oldCurrent.filter((r) => !r.isSaved).map((r) => r.id);
    if (toDelete.length > 0) {
      await tx.cycleResult.deleteMany({ where: { id: { in: toDelete }, cycleId } });
    }
    if (oldCurrent.length > 0) {
      await tx.cycleResult.updateMany({
        where: { cycleId, isCurrent: true },
        data: { isCurrent: false },
      });
    }

    const row = await tx.cycleResult.create({
      data: {
        cycleId,
        runNumber,
        periodStartDate: result.periodStartDate,
        periodEndDate: result.periodEndDate,
        periodWeeks: result.periodWeeks,
        calculatedAt,
        calculatedBy: userId,
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
      where: { id: cycleId },
      data: {
        status: 'CALCULATED',
        calculatedAt,
        calculatedBy: userId,
        calculatedRunCount: runNumber,
      },
    });

    return row;
  });

  await writeAudit({
    cycleId,
    userId,
    action: 'CREATE',
    entityType: 'CycleResult',
    entityId: created.id,
    notes: `Perhitungan run #${runNumber}: ${result.totals.partCount} part, ${result.totals.partsWithStock} part dapat stok.`,
  });

  return { ok: true, created, result, runNumber, calculatedAt };
}

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
    const cycleIds = cycles.map((cycle) => cycle.id);

    // Jejak upload terakhir per periode (siapa + kapan) untuk kartu folder periode.
    const uploads = cycleIds.length
      ? await prisma.cycleSourceUpload.findMany({
          where: { cycleId: { in: cycleIds } },
          orderBy: { uploadedAt: 'desc' },
          select: {
            cycleId: true,
            sourceType: true,
            fileName: true,
            uploadedAt: true,
            uploadedBy: true,
          },
        })
      : [];
    const lastUploadByCycle = new Map<string, (typeof uploads)[number]>();
    for (const upload of uploads) {
      if (!lastUploadByCycle.has(upload.cycleId)) lastUploadByCycle.set(upload.cycleId, upload);
    }

    const userIds = [
      ...new Set([
        ...uploads.map((upload) => upload.uploadedBy),
        ...cycles.map((cycle) => cycle.lastEditedBy).filter((id): id is string => Boolean(id)),
      ]),
    ];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(users.map((user) => [user.id, user.name]));

    const data = await Promise.all(
      cycles.map(async (c) => {
        const lastUpload = lastUploadByCycle.get(c.id) ?? null;
        return {
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
          // Jejak upload terakhir (dari cycle_source_uploads) & edit manual terakhir.
          lastUploadAt: lastUpload?.uploadedAt ?? null,
          lastUploadByName: lastUpload ? (nameById.get(lastUpload.uploadedBy) ?? null) : null,
          lastUploadSource: lastUpload?.sourceType ?? null,
          lastUploadFileName: lastUpload?.fileName ?? null,
          lastEditedAt: c.lastEditedAt ?? null,
          lastEditedByName: c.lastEditedBy ? (nameById.get(c.lastEditedBy) ?? null) : null,
        };
      }),
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
    const outcome = await calculateCycleResult(id, request.user!.id);
    if (!outcome.ok) {
      return reply.code(outcome.status).send({
        error:
          outcome.status === 404 ? 'Not Found' : outcome.status === 409 ? 'Conflict' : 'Bad Request',
        message: outcome.message,
      });
    }
    const { created, result, runNumber, calculatedAt } = outcome;
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
  // PENGECUALIAN POOL PER UKURAN
  // ══════════════════════════════════════════════════════════════════════
  /**
   * Permintaan user (2026-10-14): material yang muncul di rincian `Stock As Of`
   * / `Outstanding PO` harus bisa DIKELUARKAN dari perhitungan satu ukuran saja
   * — misalnya karena lot itu ukurannya hanya kelipatan, atau karena materialnya
   * ternyata sudah dipakai ukuran lain sehingga tidak ikut perhitungan di sini.
   *
   * Pengecualian berlaku PER UKURAN (grup), bukan global: pool item yang
   * dikeluarkan dari satu grup otomatis jadi tersedia bagi grup lain karena
   * alokasi dijalankan ULANG. Menghapus baris = memakai material itu lagi
   * ("kembalikan").
   *
   * Hak akses tulis: Admin, Super Admin, Material Planner (`EDIT_ROLES.material`).
   */

  /**
   * Batas qty baris pool item (= qty pada rincian `Stock As Of` untuk STOCK,
   * atau `PO qty` pada rincian `Outstanding PO`), dibaca dari snapshot hasil
   * perhitungan yang aktif. Dipakai supaya jumlah yang dikeluarkan user tidak
   * pernah melebihi qty barisnya.
   *
   * `null` = batas belum diketahui (periode belum dihitung / snapshot lama
   * tanpa rincian), sehingga validasi dilewati dan engine tetap memakai
   * `Math.min()` sebagai pengaman terakhir.
   */
  async function poolQtyLimit(
    cycleId: string,
    kind: 'STOCK' | 'PO',
    groupKey: string,
    poolRef: string,
    unit: 'kg' | 'sheet',
  ): Promise<number | null> {
    const current = await prisma.cycleResult.findFirst({
      where: { cycleId, isCurrent: true },
      select: { resultSnapshot: true },
    });
    const groups = ((current?.resultSnapshot as any)?.groups ?? []) as Array<Record<string, any>>;
    const group = groups.find(
      (g) => (g.groupKey ?? `${g.ukuran}||${g.gramatur}||${g.supplier}`) === groupKey,
    );
    const summary = group?.weeklyMatrix?.summary as Record<string, any> | undefined;
    if (!summary) return null;

    const valueOf = (row: Record<string, any> | undefined) => {
      if (!row) return null;
      const raw = unit === 'sheet' ? row.totalSheet ?? row.qtySheet : row.totalKg ?? row.qtyKg;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };

    if (kind === 'STOCK') {
      const row = (summary.stockDetails ?? []).find((d: any) => d.poolRef === poolRef);
      return valueOf(row);
    }
    for (const weekRows of summary.outstandingPoDetails ?? []) {
      const row = (weekRows ?? []).find((d: any) => d.poolRef === poolRef);
      if (row) return valueOf(row);
    }
    return null;
  }

  /** Daftar pengecualian periode ini — boleh dilihat semua role. */
  server.get('/api/v1/material-planning/cycles/:id/exclusions', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await prisma.materialCalcExclusion.findMany({
      where: { cycleId: id },
      orderBy: [{ createdAt: 'asc' }],
    });
    return reply.send({ data: rows });
  });

  /** Keluarkan satu pool item dari perhitungan satu ukuran, lalu hitung ulang. */
  server.post('/api/v1/material-planning/cycles/:id/exclusions', { preValidation: editor }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const cycle = await requireCycle(id);
    if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });
    if (cycle.isLocked) {
      return reply.code(409).send({ error: 'Conflict', message: 'Periode terkunci. Buka kunci dulu.' });
    }

    const body = (request.body ?? {}) as {
      kind?: string;
      groupKey?: string;
      poolRef?: string;
      /** Bentuk utama: satu nomor PO bisa berisi beberapa baris item. */
      poolRefs?: string[];
      groupLabel?: string;
      poolLabel?: string;
      reason?: string | null;
      /**
       * Jumlah yang DIKELUARKAN dari ukuran ini — hanya untuk pengecualian
       * SEBAGIAN. Kosong/null = seluruh pool item dikeluarkan (perilaku lama).
       * Hanya boleh diisi untuk SATU `poolRef`, karena angkanya milik satu
       * baris Master Data.
       */
      qty?: number | string | null;
      /** Satuan `qty`: `kg` (bagian bersatuan kg) atau `sheet` (bagian lembar). */
      unit?: string | null;
    };
    const kindRaw = String(body.kind || '').toUpperCase();
    if (kindRaw !== 'STOCK' && kindRaw !== 'PO') {
      return reply.code(400).send({ error: 'Bad Request', message: 'kind wajib "STOCK" atau "PO".' });
    }
    const kind: 'STOCK' | 'PO' = kindRaw;
    const groupKey = String(body.groupKey || '').trim();
    // Nilai kosong / "null" / "undefined" DITOLAK: hasil perhitungan lama belum
    // mengirim `poolRef`, dan kalau diteruskan akan tersimpan sebagai string
    // "null" yang tidak pernah cocok dengan pool item mana pun.
    const poolRefs = [
      ...new Set(
        [...(body.poolRefs ?? []), body.poolRef ?? '']
          .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
          .filter((v) => v.length > 0 && v !== 'null' && v !== 'undefined'),
      ),
    ];
    if (!groupKey || poolRefs.length === 0) {
      return reply.code(400).send({ error: 'Bad Request', message: 'groupKey dan poolRefs wajib diisi.' });
    }
    const reason =
      body.reason === undefined || body.reason === null
        ? null
        : String(body.reason).trim() || null;

    // Pengecualian sebagian: `qty` = jumlah yang dikeluarkan dari ukuran ini.
    const rawQty = body.qty;
    let qty =
      rawQty === undefined || rawQty === null || String(rawQty).trim() === ''
        ? null
        : Number(rawQty);
    if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) {
      return reply
        .code(400)
        .send({ error: 'Bad Request', message: 'qty harus angka lebih besar dari 0 (atau dikosongkan).' });
    }
    if (qty !== null && poolRefs.length > 1) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'qty hanya boleh diisi untuk satu baris pool (satu poolRef).',
      });
    }
    let unit = qty === null ? null : poolQtyUnit(body.unit);
    if (qty !== null && unit !== null) {
      const limit = await poolQtyLimit(id, kind, groupKey, poolRefs[0], unit);
      if (limit !== null) {
        const unitLabel = unit === 'sheet' ? 'lembar' : 'kg';
        if (qty > limit + 1e-9) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: `Jumlah yang dikeluarkan (${qty} ${unitLabel}) melebihi qty baris ini (${limit} ${unitLabel}).`,
          });
        }
        // Sama dengan total baris = keluarkan seluruhnya (perilaku lama).
        if (qty >= limit - 1e-9) {
          qty = null;
          unit = null;
        }
      }
    }

    const groupLabel = String(body.groupLabel || groupKey).slice(0, 191);
    const poolLabel = String(body.poolLabel || poolRefs.join(', ')).slice(0, 191);

    // Idempoten: baris yang sudah ada cukup diperbarui alasannya, yang baru dibuat.
    const existingRows = await prisma.materialCalcExclusion.findMany({
      where: { cycleId: id, kind, groupKey, poolRef: { in: poolRefs } },
    });
    const rows: Array<{ id: string }> = [];
    for (const poolRef of poolRefs) {
      const existing = existingRows.find((r) => r.poolRef === poolRef);
      const row = existing
        ? await prisma.materialCalcExclusion.update({
            where: { id: existing.id },
            data: { reason: reason ?? existing.reason, qty, unit },
          })
        : await prisma.materialCalcExclusion.create({
            data: {
              cycleId: id,
              kind,
              groupKey,
              poolRef,
              groupLabel,
              poolLabel,
              reason,
              qty,
              unit,
              createdBy: request.user!.id,
            },
          });
      rows.push(row);
    }

    await writeAudit({
      cycleId: id,
      userId: request.user!.id,
      action: 'CREATE',
      sourceType: 'CALCULATION',
      entityType: 'MaterialCalcExclusion',
      entityId: rows[0]?.id,
      notes: `Material ${qty === null ? 'dikeluarkan' : `dikeluarkan SEBAGIAN (${qty} ${
        unit === 'sheet' ? 'lembar' : 'kg'
      })`} dari ukuran "${groupLabel}" (${kind}, ${rows.length} baris): ${poolLabel}${
        reason ? ` — alasan: ${reason}` : ''
      }`,
    });

    const outcome = await calculateCycleResult(id, request.user!.id);
    if (!outcome.ok) {
      return reply.code(outcome.status).send({ error: 'Bad Request', message: outcome.message });
    }

    return reply.code(201).send({
      data: { exclusions: rows, runNumber: outcome.runNumber, recalculated: true },
    });
  });

  /**
   * Ubah CATATAN ALASAN dan/atau JUMLAH yang dikeluarkan (pengecualian sebagian).
   *
   * Selama hanya alasan yang berubah, TIDAK ada angka perhitungan yang berubah →
   * tidak dihitung ulang. Begitu `qty`/`unit` ikut dikirim, periode DIHITUNG
   * ULANG karena jatah pemakaian ukuran itu berubah.
   *
   * Identitas baris (kind / groupKey / poolRef) sengaja tidak bisa diubah; untuk
   * memindahkan ke ukuran lain, hapus lalu buat lagi.
   */
  server.patch(
    '/api/v1/material-planning/cycles/:id/exclusions/:exclusionId',
    { preValidation: editor },
    async (request, reply) => {
      const { id, exclusionId } = request.params as { id: string; exclusionId: string };
      const found = await prisma.materialCalcExclusion.findFirst({
        where: { id: exclusionId, cycleId: id },
      });
      if (!found) {
        return reply.code(404).send({ error: 'Not Found', message: 'Pengecualian tidak ditemukan' });
      }

      const body = (request.body ?? {}) as {
        reason?: string | null;
        qty?: number | string | null;
        unit?: string | null;
      };
      const { reason } = body;
      if (reason === undefined && body.qty === undefined) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Isi `reason` (string kosong untuk menghapus alasan) dan/atau `qty` (jumlah yang dikeluarkan).',
        });
      }
      const nextReason = reason === undefined || reason === null ? found.reason : String(reason).trim() || null;

      let nextQty = found.qty;
      let nextUnit = found.unit;
      let qtyChanged = false;
      if (body.qty !== undefined) {
        const raw = body.qty;
        let parsed = raw === null || String(raw).trim() === '' ? null : Number(raw);
        if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
          return reply
            .code(400)
            .send({ error: 'Bad Request', message: 'qty harus angka lebih besar dari 0 (atau dikosongkan).' });
        }
        let parsedUnit = parsed === null ? null : poolQtyUnit(body.unit);
        if (parsed !== null && parsedUnit !== null) {
          // Batas = qty baris Stock As Of / Outstanding PO saat ini, supaya
          // input ulang setelah salah isi tidak bisa melebihi qty barisnya.
          const limit = await poolQtyLimit(
            id,
            found.kind as 'STOCK' | 'PO',
            found.groupKey,
            found.poolRef,
            parsedUnit,
          );
          if (limit !== null) {
            const unitLabel = parsedUnit === 'sheet' ? 'lembar' : 'kg';
            if (parsed > limit + 1e-9) {
              return reply.code(400).send({
                error: 'Bad Request',
                message: `Jumlah yang dikeluarkan (${parsed} ${unitLabel}) melebihi qty baris ini (${limit} ${unitLabel}).`,
              });
            }
            if (parsed >= limit - 1e-9) {
              parsed = null;
              parsedUnit = null;
            }
          }
        }
        qtyChanged = parsed !== found.qty || (parsed !== null && parsedUnit !== found.unit);
        nextQty = parsed;
        nextUnit = parsedUnit;
      }

      const row = await prisma.materialCalcExclusion.update({
        where: { id: found.id },
        data: { reason: nextReason, qty: nextQty, unit: nextUnit },
      });
      await writeAudit({
        cycleId: id,
        userId: request.user!.id,
        action: 'UPDATE',
        sourceType: 'CALCULATION',
        entityType: 'MaterialCalcExclusion',
        entityId: row.id,
        dataBefore: { reason: found.reason, qty: found.qty, unit: found.unit },
        dataAfter: { reason: row.reason, qty: row.qty, unit: row.unit },
        notes: `Pengecualian diperbarui${
          qtyChanged
            ? ` — jumlah dikeluarkan: ${row.qty === null ? 'seluruhnya' : `${row.qty} ${row.unit === 'sheet' ? 'lembar' : 'kg'}`}`
            : ''
        }: ${row.poolLabel}`,
      });

      if (!qtyChanged) return reply.send({ data: row, recalculated: false, runNumber: null });

      const outcome = await calculateCycleResult(id, request.user!.id);
      if (!outcome.ok) {
        return reply.code(outcome.status).send({ error: 'Bad Request', message: outcome.message });
      }
      return reply.send({ data: row, recalculated: true, runNumber: outcome.runNumber });
    },
  );

  /**
   * Kembalikan material ke perhitungan ukuran itu, lalu hitung ulang.
   *
   * Mendukung beberapa id sekaligus lewat `?ids=a,b,c` karena SATU baris rincian
   * PO bisa mewakili beberapa pool item (satu nomor PO berisi banyak item) —
   * semuanya harus dikembalikan dalam SATU kali hitung ulang.
   */
  server.delete(
    '/api/v1/material-planning/cycles/:id/exclusions',
    { preValidation: editor },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { ids?: string };
      const ids = String(query.ids || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Parameter `ids` wajib diisi.' });
      }

      const cycle = await requireCycle(id);
      if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });
      if (cycle.isLocked) {
        return reply.code(409).send({ error: 'Conflict', message: 'Periode terkunci. Buka kunci dulu.' });
      }
      const found = await prisma.materialCalcExclusion.findMany({
        where: { id: { in: ids }, cycleId: id },
      });
      if (found.length === 0) {
        return reply.code(404).send({ error: 'Not Found', message: 'Pengecualian tidak ditemukan' });
      }

      await prisma.materialCalcExclusion.deleteMany({
        where: { id: { in: found.map((f) => f.id) }, cycleId: id },
      });
      for (const f of found) {
        await writeAudit({
          cycleId: id,
          userId: request.user!.id,
          action: 'DELETE',
          sourceType: 'CALCULATION',
          entityType: 'MaterialCalcExclusion',
          entityId: f.id,
          dataBefore: { kind: f.kind, groupKey: f.groupKey, poolRef: f.poolRef, reason: f.reason },
          notes: `Material dikembalikan ke ukuran "${f.groupLabel}": ${f.poolLabel}`,
        });
      }

      const outcome = await calculateCycleResult(id, request.user!.id);
      return reply.send({
        data: {
          ids: found.map((f) => f.id),
          deleted: found.length,
          recalculated: outcome.ok,
          runNumber: outcome.ok ? outcome.runNumber : null,
        },
      });
    },
  );

  /** Kembalikan SATU pengecualian (dipakai skrip uji & pemanggil lama). */
  server.delete(
    '/api/v1/material-planning/cycles/:id/exclusions/:exclusionId',
    { preValidation: editor },
    async (request, reply) => {
      const { id, exclusionId } = request.params as { id: string; exclusionId: string };
      const cycle = await requireCycle(id);
      if (!cycle) return reply.code(404).send({ error: 'Not Found', message: 'Periode tidak ditemukan' });
      if (cycle.isLocked) {
        return reply.code(409).send({ error: 'Conflict', message: 'Periode terkunci. Buka kunci dulu.' });
      }
      const found = await prisma.materialCalcExclusion.findFirst({
        where: { id: exclusionId, cycleId: id },
      });
      if (!found) {
        return reply.code(404).send({ error: 'Not Found', message: 'Pengecualian tidak ditemukan' });
      }

      await prisma.materialCalcExclusion.delete({ where: { id: found.id } });
      await writeAudit({
        cycleId: id,
        userId: request.user!.id,
        action: 'DELETE',
        sourceType: 'CALCULATION',
        entityType: 'MaterialCalcExclusion',
        entityId: found.id,
        dataBefore: {
          kind: found.kind,
          groupKey: found.groupKey,
          poolRef: found.poolRef,
          reason: found.reason,
        },
        notes: `Material dikembalikan ke ukuran "${found.groupLabel}": ${found.poolLabel}`,
      });

      const outcome = await calculateCycleResult(id, request.user!.id);
      return reply.send({
        data: {
          id: found.id,
          deleted: true,
          recalculated: outcome.ok,
          runNumber: outcome.ok ? outcome.runNumber : null,
        },
      });
    },
  );

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
