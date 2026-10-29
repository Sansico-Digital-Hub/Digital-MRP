import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES, requireModuleAccess } from '../lib/permissions';
import {
  requireModuleType,
  resolveUploadPeriod,
  recordPeriodChange,
  recomputeMrpRange,
} from '../lib/periodScope';
import {
  collectMrpPayloadWarnings,
  diffMrpSeries,
  duplicatePartWarning,
  normalizeWeekDate,
  seriesFromParts,
  seriesFromRows,
  type MrpDiffColumn,
  type MrpDiffSummary,
  type MrpPartInput,
  type MrpSeriesMap,
} from '../lib/mrpVersionDiff';

const ROW_CHUNK = 5000;
const SAVE_TIMEOUT_MS = 180_000;

const VERSION_META_SELECT = {
  id: true,
  periodId: true,
  moduleType: true,
  versionNumber: true,
  isCurrent: true,
  source: true,
  fileName: true,
  uploadedAt: true,
  uploadedBy: true,
  uploadedByName: true,
  itemCount: true,
  rowCount: true,
  totalQty: true,
  weekStartDate: true,
  weekCount: true,
  notes: true,
} as const;

interface ValidatedPayload {
  parts: MrpPartInput[];
  warnings: string[];
  /** Baris siap tulis: satu baris per part x minggu. */
  weekRows: Array<{
    partNumber: string;
    description: string;
    weekNumber: number;
    weekStartDate: string;
    weekEndDate: string;
    quantity: number;
  }>;
  itemCount: number;
  totalQty: number;
  weekStartDate: string | null;
  weekCount: number;
}

function endOfWeek(startDate: string): string {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}

/**
 * Validasi payload upload dari modal import.
 * `reason` dikembalikan sebagai pesan 400 supaya UI bisa menampilkan penyebabnya.
 */
function validatePayload(rawRows: unknown): { ok: true; data: ValidatedPayload } | { ok: false; reason: string } {
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return { ok: false, reason: 'Tidak ada baris data yang dikirim.' };
  }

  const parts: MrpPartInput[] = [];
  const weekRows: ValidatedPayload['weekRows'] = [];
  const seenParts = new Set<string>();
  const rawPartNumbers: string[] = [];
  const dates = new Set<string>();
  let totalQty = 0;
  let invalidDateCells = 0;

  for (const rawPart of rawRows as any[]) {
    const partNumber = String(rawPart?.partNumber ?? rawPart?.itemCode ?? '').trim();
    if (!partNumber) continue;
    rawPartNumbers.push(partNumber);
    if (seenParts.has(partNumber)) continue; // duplikat: kemunculan pertama menang
    seenParts.add(partNumber);

    const description = String(rawPart?.description ?? '').trim();
    const rawWeeks = Array.isArray(rawPart?.weeks) ? rawPart.weeks : [];
    const weeks: MrpPartInput['weeks'] = [];

    rawWeeks.forEach((rawWeek: any, index: number) => {
      const weekStartDate = normalizeWeekDate(rawWeek?.weekStartDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)) {
        invalidDateCells += 1;
        return;
      }
      const quantity = Number(rawWeek?.quantity);
      const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
      const weekNumber = Number(rawWeek?.weekNumber) || index + 1;
      weeks.push({ weekStartDate, quantity: safeQuantity, weekNumber });
      dates.add(weekStartDate);
      totalQty += safeQuantity;
      weekRows.push({
        partNumber,
        description,
        weekNumber,
        weekStartDate,
        weekEndDate: endOfWeek(weekStartDate),
        quantity: safeQuantity,
      });
    });

    if (weeks.length > 0) parts.push({ partNumber, description, weeks });
  }

  if (parts.length === 0) {
    return { ok: false, reason: 'Tidak ada baris valid. Periksa kolom PN dan tanggal minggu pada file.' };
  }
  if (invalidDateCells > 0) {
    return {
      ok: false,
      reason: `${invalidDateCells} sel tanggal minggu tidak terbaca. Perbarui file Excel (baris tanggal wajib ada di bawah nomor minggu).`,
    };
  }

  const sortedDates = Array.from(dates).sort();
  const warnings = collectMrpPayloadWarnings(parts);
  const duplicateWarning = duplicatePartWarning(rawPartNumbers);
  if (duplicateWarning) warnings.unshift(duplicateWarning);

  return {
    ok: true,
    data: {
      parts,
      warnings,
      weekRows,
      itemCount: parts.length,
      totalQty,
      weekStartDate: sortedDates[0] ?? null,
      weekCount: sortedDates.length,
    },
  };
}

/** Buat/lengkapi master item untuk semua PN pada payload, kembalikan peta PN -> itemId. */
async function resolveItemIds(parts: MrpPartInput[]): Promise<Map<string, string>> {
  const codes = Array.from(new Set(parts.map((part) => part.partNumber)));
  const descriptionByCode = new Map<string, string>();
  for (const part of parts) {
    if (!descriptionByCode.get(part.partNumber)) descriptionByCode.set(part.partNumber, part.description || part.partNumber);
  }

  const existing = await prisma.item.findMany({
    where: { partNumber: { in: codes } },
    select: { id: true, partNumber: true, itemName: true },
  });
  const map = new Map(existing.map((item) => [item.partNumber, item.id]));

  const missing = codes.filter((code) => !map.has(code));
  if (missing.length > 0) {
    await prisma.item.createMany({
      data: missing.map((code) => ({
        partNumber: code,
        itemName: descriptionByCode.get(code) || code,
        unit: 'PCS',
      })),
      skipDuplicates: true,
    });
    const created = await prisma.item.findMany({
      where: { partNumber: { in: missing } },
      select: { id: true, partNumber: true },
    });
    for (const item of created) map.set(item.partNumber, item.id);
  }

  const staleNames = existing.filter(
    (item) => descriptionByCode.get(item.partNumber) && item.itemName !== descriptionByCode.get(item.partNumber),
  );
  for (let index = 0; index < staleNames.length; index += 200) {
    await Promise.all(
      staleNames.slice(index, index + 200).map((item) =>
        prisma.item.update({
          where: { id: item.id },
          data: { itemName: descriptionByCode.get(item.partNumber) as string },
        }),
      ),
    );
  }

  return map;
}

/**
 * Snapshot bersifat IMMUTABLE (dibuat sekali, tidak pernah diedit), jadi deret
 * qty-nya aman di-cache. Menarik ulang puluhan ribu baris untuk setiap
 * perbandingan/preview terlalu mahal. Dibatasi 3 versi untuk membatasi memori.
 */
const SERIES_CACHE_LIMIT = 3;
const seriesCache = new Map<string, MrpSeriesMap>();

async function loadVersionSeries(versionId: string): Promise<MrpSeriesMap> {
  const cached = seriesCache.get(versionId);
  if (cached) {
    seriesCache.delete(versionId);
    seriesCache.set(versionId, cached);
    return cached;
  }

  const rows = await prisma.mrpVersionRow.findMany({
    where: { versionId },
    select: { partNumber: true, description: true, weekNumber: true, weekStartDate: true, quantity: true },
  });
  const series = seriesFromRows(rows);

  seriesCache.set(versionId, series);
  while (seriesCache.size > SERIES_CACHE_LIMIT) {
    const oldest = seriesCache.keys().next().value;
    if (!oldest) break;
    seriesCache.delete(oldest);
  }

  return series;
}

/**
 * Ganti isi DATA AKTIF (`weekly_schedules`) dengan isi satu snapshot versi.
 * Dipakai saat versi aktif dihapus → data aktif "bergeser" ke versi sebelumnya.
 */
async function replaceLiveDataFromVersion(
  tx: Prisma.TransactionClient,
  versionId: string,
  periodId: string,
  moduleType: 'PRODUCTION' | 'MATERIAL',
): Promise<number> {
  const rows = await tx.mrpVersionRow.findMany({
    where: { versionId },
    select: {
      itemId: true,
      partNumber: true,
      description: true,
      weekNumber: true,
      weekStartDate: true,
      weekEndDate: true,
      quantity: true,
    },
  });

  // Item bisa sudah terhapus setelah snapshot dibuat → pastikan ada sebelum menulis.
  const codes = Array.from(new Set(rows.map((row) => row.partNumber)));
  const descriptionByCode = new Map<string, string>();
  for (const row of rows) {
    if (!descriptionByCode.get(row.partNumber)) descriptionByCode.set(row.partNumber, row.description || row.partNumber);
  }

  let items = codes.length
    ? await tx.item.findMany({ where: { partNumber: { in: codes } }, select: { id: true, partNumber: true } })
    : [];
  const known = new Set(items.map((item) => item.partNumber));
  const missing = codes.filter((code) => !known.has(code));
  if (missing.length > 0) {
    await tx.item.createMany({
      data: missing.map((code) => ({ partNumber: code, itemName: descriptionByCode.get(code) || code, unit: 'PCS' })),
      skipDuplicates: true,
    });
    items = await tx.item.findMany({ where: { partNumber: { in: codes } }, select: { id: true, partNumber: true } });
  }
  const itemIdByCode = new Map(items.map((item) => [item.partNumber, item.id]));

  await tx.weeklySchedule.deleteMany({ where: { periodId, moduleType } });

  const data = rows
    .map((row) => {
      const itemId = itemIdByCode.get(row.partNumber) ?? row.itemId;
      if (!itemId) return null;
      return {
        periodId,
        moduleType,
        year: row.weekStartDate.getUTCFullYear(),
        weekNumber: row.weekNumber,
        weekStartDate: row.weekStartDate,
        weekEndDate: row.weekEndDate,
        itemId,
        quantity: row.quantity,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  for (let index = 0; index < data.length; index += ROW_CHUNK) {
    await tx.weeklySchedule.createMany({ data: data.slice(index, index + ROW_CHUNK), skipDuplicates: true });
  }

  return data.length;
}

/**
 * Snapshot pembanding untuk preview.
 * Prioritas: versi terakhir yang tersimpan. Kalau belum ada versi (mis. data
 * periode diisi lewat jalur lama), data AKTIF dipakai sebagai pembanding supaya
 * ringkasan perubahan tidak menyesatkan.
 */
async function loadBaseline(periodId: string, moduleType: 'PRODUCTION' | 'MATERIAL') {
  const latest = await prisma.mrpVersion.findFirst({
    where: { periodId, moduleType },
    orderBy: { versionNumber: 'desc' },
    select: VERSION_META_SELECT,
  });

  if (latest) {
    return { meta: latest, source: 'VERSION' as const, series: await loadVersionSeries(latest.id) };
  }

  const live = await prisma.weeklySchedule.findMany({
    where: { periodId, moduleType },
    select: {
      weekNumber: true,
      weekStartDate: true,
      quantity: true,
      item: { select: { partNumber: true, itemName: true } },
    },
  });
  if (live.length === 0) return null;

  return {
    meta: null,
    source: 'LIVE' as const,
    series: seriesFromRows(
      live.map((row) => ({
        partNumber: row.item.partNumber,
        description: row.item.itemName,
        weekNumber: row.weekNumber,
        weekStartDate: row.weekStartDate,
        quantity: row.quantity,
      })),
    ),
  };
}

function emptyDiff(): { columns: MrpDiffColumn[]; summary: MrpDiffSummary; parts: [] } {
  return {
    columns: [],
    summary: {
      partsBefore: 0,
      partsAfter: 0,
      newParts: 0,
      removedParts: 0,
      changedParts: 0,
      unchangedParts: 0,
      totalBefore: 0,
      totalAfter: 0,
      totalDelta: 0,
      changedCells: 0,
      weekCountBefore: 0,
      weekCountAfter: 0,
      weeksAdded: [],
      weeksRemoved: [],
      beforeWeekStartDate: null,
      afterWeekStartDate: null,
    },
    parts: [],
  };
}

export default async function mrpVersionRoutes(server: FastifyInstance) {
  // GET /api/v1/mrp-versions?periodId=...&moduleType=...
  // Daftar upload (folder "Upload ke-N") untuk satu periode + modul.
  server.get('/api/v1/mrp-versions', { preValidation: [authenticate] }, async (request, reply) => {
    const { periodId, moduleType } = request.query as { periodId?: string; moduleType?: string };
    if (!periodId) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Parameter periodId wajib diisi.' });
    }
    const moduleRes = requireModuleType(moduleType, 'Riwayat MRP');
    if (!moduleRes.ok) {
      return reply.code(moduleRes.code).send({ error: 'Bad Request', message: moduleRes.message });
    }

    const versions = await prisma.mrpVersion.findMany({
      where: { periodId, moduleType: moduleRes.moduleType },
      orderBy: { versionNumber: 'desc' },
      select: VERSION_META_SELECT,
    });

    return reply.send({
      data: versions,
      currentVersionId: versions.find((version) => version.isCurrent)?.id ?? null,
    });
  });

  // GET /api/v1/mrp-versions/trend?periodId=&moduleType=&partNumber=
  // Riwayat satu Part Number dari upload ke upload (trend per versi).
  server.get('/api/v1/mrp-versions/trend', { preValidation: [authenticate] }, async (request, reply) => {
    const { periodId, moduleType, partNumber } = request.query as {
      periodId?: string;
      moduleType?: string;
      partNumber?: string;
    };
    if (!periodId || !partNumber) {
      return reply
        .code(400)
        .send({ error: 'Bad Request', message: 'Parameter periodId dan partNumber wajib diisi.' });
    }
    const moduleRes = requireModuleType(moduleType, 'Riwayat MRP');
    if (!moduleRes.ok) {
      return reply.code(moduleRes.code).send({ error: 'Bad Request', message: moduleRes.message });
    }

    const versions = await prisma.mrpVersion.findMany({
      where: { periodId, moduleType: moduleRes.moduleType },
      orderBy: { versionNumber: 'asc' },
      select: VERSION_META_SELECT,
    });
    if (versions.length === 0) {
      return reply.send({ data: { partNumber, columns: [], versions: [], cells: {} } });
    }

    const rows = await prisma.mrpVersionRow.findMany({
      where: { versionId: { in: versions.map((version) => version.id) }, partNumber },
      select: { versionId: true, weekStartDate: true, weekNumber: true, quantity: true },
    });

    const dateSet = new Set<string>();
    const weekNumberByDate = new Map<string, number>();
    const quantities = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const date = normalizeWeekDate(row.weekStartDate);
      dateSet.add(date);
      const current = weekNumberByDate.get(date);
      if (current === undefined || row.weekNumber < current) weekNumberByDate.set(date, row.weekNumber);
      if (!quantities.has(row.versionId)) quantities.set(row.versionId, new Map());
      quantities.get(row.versionId)!.set(date, row.quantity);
    }

    const columns = Array.from(dateSet)
      .sort()
      .map((date) => ({ weekStartDate: date, weekNumber: weekNumberByDate.get(date) ?? null }));

    const cells: Record<string, number[]> = {};
    const totals: Record<string, number> = {};
    for (const version of versions) {
      const series = quantities.get(version.id) ?? new Map<string, number>();
      const values = columns.map((column) => series.get(column.weekStartDate) ?? 0);
      cells[version.id] = values;
      totals[version.id] = values.reduce((sum, value) => sum + value, 0);
    }

    return reply.send({
      data: {
        partNumber,
        columns,
        versions: versions.map((version) => ({ ...version, totalQty: totals[version.id] ?? 0 })),
        cells,
      },
    });
  });

  // POST /api/v1/mrp-versions/preview
  // Bandingkan isi file yang akan diupload dengan versi terakhir SEBELUM disimpan.
  server.post(
    '/api/v1/mrp-versions/preview',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared), requireModuleAccess()] },
    async (request, reply) => {
      const body = request.body as any;

      const resolved = await resolveUploadPeriod(body, request.user!.id);
      if (!resolved.ok) {
        return reply.code(resolved.code).send({ error: 'Bad Request', message: resolved.message });
      }
      const moduleRes = requireModuleType(body.moduleType, 'Upload MRP 26 Weeks');
      if (!moduleRes.ok) {
        return reply.code(moduleRes.code).send({ error: 'Bad Request', message: moduleRes.message });
      }

      const validated = validatePayload(body.rows);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'Bad Request', message: validated.reason });
      }

      const baseline = await loadBaseline(resolved.periodId, moduleRes.moduleType);
      if (!baseline) {
        return reply.send({
          hasBaseline: false,
          baseline: null,
          nextVersionNumber: 1,
          warnings: validated.data.warnings,
          ...emptyDiff(),
        });
      }

      const diff = diffMrpSeries(baseline.series, seriesFromParts(validated.data.parts));
      const nextVersionNumber = baseline.meta ? baseline.meta.versionNumber + 1 : 1;

      return reply.send({
        hasBaseline: true,
        baseline: baseline.meta
          ? {
              id: baseline.meta.id,
              versionNumber: baseline.meta.versionNumber,
              uploadedAt: baseline.meta.uploadedAt,
              uploadedByName: baseline.meta.uploadedByName,
              fileName: baseline.meta.fileName,
              source: baseline.source,
            }
          : { id: null, versionNumber: 0, uploadedAt: null, uploadedByName: null, fileName: null, source: baseline.source },
        nextVersionNumber,
        warnings: validated.data.warnings,
        columns: diff.columns,
        summary: diff.summary,
        parts: diff.parts,
      });
    },
  );

  // POST /api/v1/mrp-versions
  // Simpan upload sebagai versi baru (snapshot) + jadikan versi aktif.
  server.post(
    '/api/v1/mrp-versions',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared), requireModuleAccess()] },
    async (request, reply) => {
      const body = request.body as any;

      const resolved = await resolveUploadPeriod(body, request.user!.id);
      if (!resolved.ok) {
        return reply.code(resolved.code).send({ error: 'Bad Request', message: resolved.message });
      }
      const moduleRes = requireModuleType(body.moduleType, 'Upload MRP 26 Weeks');
      if (!moduleRes.ok) {
        return reply.code(moduleRes.code).send({ error: 'Bad Request', message: moduleRes.message });
      }

      const validated = validatePayload(body.rows);
      if (!validated.ok) {
        return reply.code(400).send({ error: 'Bad Request', message: validated.reason });
      }
      const { parts, weekRows, itemCount, totalQty, weekStartDate, weekCount } = validated.data;
      const { periodId } = resolved;
      const { moduleType } = moduleRes;

      // Kunci idempotensi: double-click / retry mengembalikan versi yang sama.
      const clientRequestId =
        typeof body.clientRequestId === 'string' && body.clientRequestId.trim().length > 0
          ? body.clientRequestId.trim().slice(0, 191)
          : null;
      if (clientRequestId) {
        const existing = await prisma.mrpVersion.findUnique({
          where: { clientRequestId },
          select: VERSION_META_SELECT,
        });
        if (existing) {
          return reply.code(200).send({
            data: existing,
            duplicate: true,
            count: existing.rowCount,
            periodId,
            moduleType,
            label: resolved.label,
            created: resolved.created,
          });
        }
      }

      const itemIds = await resolveItemIds(parts);
      const previousCount = await prisma.weeklySchedule.count({ where: { periodId, moduleType } });

      const liveRows = weekRows
        .map((row) => {
          const itemId = itemIds.get(row.partNumber);
          if (!itemId) return null;
          return {
            periodId,
            moduleType,
            year: Number(row.weekStartDate.slice(0, 4)),
            weekNumber: row.weekNumber,
            weekStartDate: new Date(`${row.weekStartDate}T00:00:00Z`),
            weekEndDate: new Date(`${row.weekEndDate}T00:00:00Z`),
            itemId,
            quantity: row.quantity,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      const snapshotRows = weekRows.map((row) => ({
        itemId: itemIds.get(row.partNumber) ?? null,
        partNumber: row.partNumber,
        description: row.description || null,
        weekNumber: row.weekNumber,
        weekStartDate: new Date(`${row.weekStartDate}T00:00:00Z`),
        weekEndDate: new Date(`${row.weekEndDate}T00:00:00Z`),
        quantity: row.quantity,
      }));

      const fileName = typeof body.fileName === 'string' ? body.fileName.slice(0, 191) : null;
      const uploader = await prisma.user.findUnique({
        where: { id: request.user!.id },
        select: { name: true },
      });

      const now = new Date();

      const created = await prisma.$transaction(
        async (tx) => {
          // Serialisasi pembuatan versi per periode: dua upload bersamaan tidak
          // boleh mendapat nomor versi yang sama.
          await tx.$queryRaw`SELECT id FROM planning_cycles WHERE id = ${periodId} FOR UPDATE`;

          const last = await tx.mrpVersion.findFirst({
            where: { periodId, moduleType },
            orderBy: { versionNumber: 'desc' },
            select: { versionNumber: true },
          });
          const versionNumber = (last?.versionNumber ?? 0) + 1;

          await tx.mrpVersion.updateMany({
            where: { periodId, moduleType, isCurrent: true },
            data: { isCurrent: false, currentKey: null },
          });

          const version = await tx.mrpVersion.create({
            data: {
              periodId,
              moduleType,
              versionNumber,
              isCurrent: true,
              currentKey: `${periodId}:${moduleType}`,
              source: 'UPLOAD',
              fileName,
              uploadedAt: now,
              uploadedBy: request.user!.id,
              uploadedByName: uploader?.name ?? null,
              itemCount,
              rowCount: snapshotRows.length,
              totalQty,
              weekStartDate: weekStartDate ? new Date(`${weekStartDate}T00:00:00Z`) : null,
              weekCount,
              clientRequestId,
            },
            select: VERSION_META_SELECT,
          });

          for (let index = 0; index < snapshotRows.length; index += ROW_CHUNK) {
            await tx.mrpVersionRow.createMany({
              data: snapshotRows.slice(index, index + ROW_CHUNK).map((row) => ({ ...row, versionId: version.id })),
            });
          }

          // Data aktif selalu = versi terbaru.
          await tx.weeklySchedule.deleteMany({ where: { periodId, moduleType } });
          for (let index = 0; index < liveRows.length; index += ROW_CHUNK) {
            await tx.weeklySchedule.createMany({
              data: liveRows.slice(index, index + ROW_CHUNK),
              skipDuplicates: true,
            });
          }

          return version;
        },
        { timeout: SAVE_TIMEOUT_MS, maxWait: 20_000 },
      );

      await recordPeriodChange({
        periodId,
        userId: request.user!.id,
        sourceType: 'MRP',
        moduleType,
        rowCount: created.rowCount,
        replaced: previousCount,
        fileName,
        mode: 'overwrite',
        notes: `Upload MRP [${moduleType}] disimpan sebagai versi ke-${created.versionNumber}: ${created.itemCount} part, ${created.rowCount} baris minggu. Versi sebelumnya tetap tersimpan di riwayat.`,
      });

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'CREATE',
          entityType: 'MrpVersion',
          entityId: created.id,
          notes: `MRP ${moduleType} versi ke-${created.versionNumber} (${created.itemCount} part, ${created.rowCount} baris)`,
        },
      });

      return reply.code(201).send({
        data: created,
        duplicate: false,
        count: created.rowCount,
        replaced: previousCount,
        periodId,
        moduleType,
        label: resolved.label,
        created: resolved.created,
      });
    },
  );

  // GET /api/v1/mrp-versions/:id — isi satu snapshot (per part, dipaginasi).
  server.get('/api/v1/mrp-versions/:id', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { search, page, pageSize } = request.query as {
      search?: string;
      page?: string;
      pageSize?: string;
    };

    const version = await prisma.mrpVersion.findUnique({ where: { id }, select: VERSION_META_SELECT });
    if (!version) {
      return reply.code(404).send({ error: 'Not Found', message: 'Versi tidak ditemukan.' });
    }

    const size = Math.min(Math.max(Number(pageSize) || 25, 1), 200);
    const currentPage = Math.max(Number(page) || 1, 1);
    const keyword = (search ?? '').trim();

    const grouped = await prisma.mrpVersionRow.groupBy({
      by: ['partNumber'],
      where: {
        versionId: id,
        ...(keyword
          ? {
              OR: [
                { partNumber: { contains: keyword } },
                { description: { contains: keyword } },
              ],
            }
          : {}),
      },
      _sum: { quantity: true },
      _max: { description: true },
      orderBy: { partNumber: 'asc' },
      skip: (currentPage - 1) * size,
      take: size,
    });

    const totalGrouped = await prisma.mrpVersionRow.groupBy({
      by: ['partNumber'],
      where: {
        versionId: id,
        ...(keyword
          ? {
              OR: [
                { partNumber: { contains: keyword } },
                { description: { contains: keyword } },
              ],
            }
          : {}),
      },
    });

    const partNumbers = grouped.map((group) => group.partNumber);
    const rows = partNumbers.length
      ? await prisma.mrpVersionRow.findMany({
          where: { versionId: id, partNumber: { in: partNumbers } },
          select: {
            partNumber: true,
            weekNumber: true,
            weekStartDate: true,
            weekEndDate: true,
            quantity: true,
          },
          orderBy: { weekStartDate: 'asc' },
        })
      : [];

    const weeksByPart = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!weeksByPart.has(row.partNumber)) weeksByPart.set(row.partNumber, []);
      weeksByPart.get(row.partNumber)!.push(row);
    }

    return reply.send({
      data: {
        version,
        parts: grouped.map((group) => ({
          partNumber: group.partNumber,
          description: group._max.description ?? '',
          total: group._sum.quantity ?? 0,
          weeks: (weeksByPart.get(group.partNumber) ?? []).map((row) => ({
            weekNumber: row.weekNumber,
            weekStartDate: normalizeWeekDate(row.weekStartDate),
            weekEndDate: normalizeWeekDate(row.weekEndDate),
            quantity: row.quantity,
          })),
        })),
      },
      totalParts: totalGrouped.length,
      page: currentPage,
      pageSize: size,
    });
  });

  // DELETE /api/v1/mrp-versions/:id
  // Hapus satu snapshot dari riwayat — HANYA Super Admin.
  //  - Versi NON-aktif  : hanya riwayat yang dihapus, data aktif tidak berubah.
  //  - Versi AKTIF      : data aktif ikut diganti isi versi sebelumnya (ROLLBACK).
  //                        Bila tidak ada versi tersisa, data aktif dikosongkan.
  server.delete(
    '/api/v1/mrp-versions/:id',
    { preValidation: [authenticate, requireRole(['SUPER_ADMIN'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const version = await prisma.mrpVersion.findUnique({ where: { id }, select: VERSION_META_SELECT });
      if (!version) {
        return reply.code(404).send({ error: 'Not Found', message: 'Versi tidak ditemukan.' });
      }

      const outcome = await prisma.$transaction(
        async (tx) => {
          await tx.mrpVersion.delete({ where: { id } });

          if (!version.isCurrent) return { promoted: null, liveRows: null as number | null };

          const nextCurrent = await tx.mrpVersion.findFirst({
            where: { periodId: version.periodId, moduleType: version.moduleType },
            orderBy: { versionNumber: 'desc' },
            select: { id: true, versionNumber: true },
          });

          if (!nextCurrent) {
            // Tidak ada versi tersisa → data aktif dikosongkan.
            await tx.weeklySchedule.deleteMany({
              where: { periodId: version.periodId, moduleType: version.moduleType },
            });
            return { promoted: null, liveRows: 0 };
          }

          await tx.mrpVersion.update({
            where: { id: nextCurrent.id },
            data: { isCurrent: true, currentKey: `${version.periodId}:${version.moduleType}` },
          });
          const liveRows = await replaceLiveDataFromVersion(
            tx,
            nextCurrent.id,
            version.periodId,
            version.moduleType,
          );
          return { promoted: nextCurrent, liveRows };
        },
        { timeout: SAVE_TIMEOUT_MS, maxWait: 20_000 },
      );

      // Snapshot immutable di-cache; buang entri agar memori tidak menyimpan data terhapus.
      seriesCache.delete(id);

      const now = new Date();
      if (version.isCurrent) {
        const mrpRange =
          version.moduleType === 'MATERIAL' ? await recomputeMrpRange(version.periodId) : null;
        await prisma.planningCycle.update({
          where: { id: version.periodId },
          data: {
            lastDataChangeAt: now,
            lastDataChangeBy: request.user!.id,
            lastDataChangeKind: 'ROLLBACK',
            ...(mrpRange ? { mrpStartDate: mrpRange.start, mrpEndDate: mrpRange.end } : {}),
          },
        });
      }

      const rollbackNote = version.isCurrent
        ? outcome.promoted
          ? ` Data aktif diganti isi versi ke-${outcome.promoted.versionNumber} (${outcome.liveRows ?? 0} baris).`
          : ' Tidak ada versi tersisa sehingga data aktif dikosongkan.'
        : '';

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'DELETE',
          entityType: 'MrpVersion',
          entityId: id,
          notes: `Hapus riwayat MRP ${version.moduleType} versi ke-${version.versionNumber}${rollbackNote}`,
        },
      });

      await prisma.cycleAuditLog.create({
        data: {
          cycleId: version.periodId,
          userId: request.user!.id,
          action: 'DELETE',
          sourceType: 'MRP',
          entityType: 'MrpVersion',
          entityId: id,
          notes: `Riwayat upload dihapus: versi ke-${version.versionNumber} (${version.itemCount} part, ${version.rowCount} baris).${rollbackNote}`,
        },
      });

      return reply.send({
        success: true,
        id,
        versionNumber: version.versionNumber,
        wasCurrent: version.isCurrent,
        promotedVersionNumber: outcome.promoted?.versionNumber ?? null,
        liveRowCount: outcome.liveRows,
      });
    },
  );

  // GET /api/v1/mrp-versions/:id/compare?againstId=...
  // Bandingkan `:id` (versi baru) dengan `againstId` (versi lama). Default:
  // versi tepat sebelumnya pada periode + modul yang sama.
  server.get(
    '/api/v1/mrp-versions/:id/compare',
    { preValidation: [authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { againstId } = request.query as { againstId?: string };

      const version = await prisma.mrpVersion.findUnique({ where: { id }, select: VERSION_META_SELECT });
      if (!version) {
        return reply.code(404).send({ error: 'Not Found', message: 'Versi tidak ditemukan.' });
      }

      const base = againstId
        ? await prisma.mrpVersion.findUnique({ where: { id: againstId }, select: VERSION_META_SELECT })
        : await prisma.mrpVersion.findFirst({
            where: {
              periodId: version.periodId,
              moduleType: version.moduleType,
              versionNumber: { lt: version.versionNumber },
            },
            orderBy: { versionNumber: 'desc' },
            select: VERSION_META_SELECT,
          });

      if (!base) {
        return reply.send({
          before: null,
          after: version,
          hasBaseline: false,
          ...emptyDiff(),
        });
      }

      const [beforeSeries, afterSeries] = await Promise.all([
        loadVersionSeries(base.id),
        loadVersionSeries(version.id),
      ]);

      const diff = diffMrpSeries(beforeSeries, afterSeries);

      return reply.send({
        before: base,
        after: version,
        hasBaseline: true,
        columns: diff.columns,
        summary: diff.summary,
        parts: diff.parts,
      });
    },
  );
}
