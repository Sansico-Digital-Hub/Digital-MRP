import prisma from './prisma';

/**
 * Helper bersama untuk sistem PERIODE UPLOAD (lihat
 * migration 20260928000000_master_data_period).
 *
 * Semua halaman Master Data (26-Week Demand, WIP, Hot List, Stock Raw Material,
 * Outstanding PO) menyimpan datanya dengan `periodId`. Upload/add manual WAJIB
 * menyertakan periode, dan penimpaan hanya boleh terjadi DI DALAM periode itu.
 */

export const SOURCE_TYPES = ['MRP', 'HOTLIST', 'STOCK_RM', 'OUTSTANDING_PO', 'WIP'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const RETENTION_MONTHS = 18;

// ============================================================
// PEMISAHAN MODUL (Production Planning vs Material Planning)
// ============================================================
// `weekly_schedules` (MRP 26 Weeks) dan `wips` dipakai oleh DUA modul secara
// tampilan, tetapi datanya HARUS terpisah. Setiap baris menyimpan `moduleType`
// dan semua query WAJIB memfilternya — jangan pernah membaca/menulis tanpa ini,
// karena itu yang menyebabkan data satu modul menimpa modul lain.

export const MODULE_TYPES = ['PRODUCTION', 'MATERIAL'] as const;
export type DataModule = (typeof MODULE_TYPES)[number];

export const MODULE_LABELS: Record<DataModule, string> = {
  PRODUCTION: 'Production Planning',
  MATERIAL: 'Material Planning',
};

/** Normalisasi nilai moduleType (case-insensitive). Null kalau tidak valid. */
export function parseModuleType(value: unknown): DataModule | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  return (MODULE_TYPES as readonly string[]).includes(v) ? (v as DataModule) : null;
}

/**
 * Untuk endpoint TULIS: moduleType WAJIB. Sengaja tidak memakai default supaya
 * tidak ada upload yang "diam-diam" masuk ke modul lain.
 */
export function requireModuleType(
  value: unknown,
  action: string,
): { ok: true; moduleType: DataModule } | { ok: false; code: number; message: string } {
  const moduleType = parseModuleType(value);
  if (!moduleType) {
    return {
      ok: false,
      code: 400,
      message: `${action} memerlukan field \`moduleType\` bernilai "PRODUCTION" atau "MATERIAL" supaya data tidak tercampur antar modul.`,
    };
  }
  return { ok: true, moduleType };
}

/**
 * Untuk endpoint BACA: moduleType opsional dengan default MODULE_DEFAULT.
 * Dipakai oleh endpoint lintas-modul lama (mis. tracking) yang belum/tidak
 * mengirim moduleType — default-nya tetap modul Production.
 */
export const MODULE_DEFAULT: DataModule = 'PRODUCTION';

export function resolveModuleType(value: unknown): DataModule {
  return parseModuleType(value) ?? MODULE_DEFAULT;
}

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
export function labelFromMonth(month: string): string {
  const [year, m] = month.split('-');
  const name = MONTH_NAMES_ID[Number(m) - 1] ?? month;
  return `${name} ${year}`;
}

/** Validasi "yyyy-MM"; null kalau tidak valid. */
export function parseMonth(value: unknown): string | null {
  const v = typeof value === 'string' ? value.trim() : '';
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export type PeriodResolution =
  | { ok: true; periodId: string; label: string; created: boolean }
  | { ok: false; code: number; message: string };

/**
 * Tentukan periode tujuan upload dari body request.
 * Prioritas: `periodId` (periode yang sudah ada) -> `periodMonth` ("2026-09",
 * dibuat kalau belum ada). Salah satu WAJIB ada.
 */
export async function resolveUploadPeriod(
  body: Record<string, unknown>,
  userId: string,
): Promise<PeriodResolution> {
  const periodId = typeof body.periodId === 'string' ? body.periodId.trim() : '';

  if (periodId) {
    const cycle = await prisma.planningCycle.findUnique({ where: { id: periodId } });
    if (!cycle) {
      return { ok: false, code: 404, message: 'Periode tidak ditemukan. Pilih periode lain.' };
    }
    if (cycle.isLocked) {
      return { ok: false, code: 409, message: `Periode "${cycle.label}" terkunci. Buka kunci dulu.` };
    }
    return { ok: true, periodId: cycle.id, label: cycle.label, created: false };
  }

  const month = parseMonth(body.periodMonth);
  if (!month) {
    return {
      ok: false,
      code: 400,
      message:
        'Periode wajib dipilih sebelum upload. Kirim `periodId` (periode yang sudah ada) atau `periodMonth` dalam format "YYYY-MM" (mis. "2026-09").',
    };
  }

  const existing = await prisma.planningCycle.findUnique({ where: { uploadMonth: month } });
  if (existing) {
    if (existing.isLocked) {
      return { ok: false, code: 409, message: `Periode "${existing.label}" terkunci. Buka kunci dulu.` };
    }
    return { ok: true, periodId: existing.id, label: existing.label, created: false };
  }

  const label = typeof body.periodLabel === 'string' && body.periodLabel.trim()
    ? body.periodLabel.trim()
    : labelFromMonth(month);

  const created = await prisma.planningCycle.create({
    data: {
      uploadMonth: month,
      label,
      mrpStartDate: null,
      mrpEndDate: null,
      weekCount: 26,
      retentionDueAt: addMonths(new Date(), RETENTION_MONTHS),
      createdBy: userId,
    },
  });

  await prisma.cycleAuditLog.create({
    data: {
      cycleId: created.id,
      userId,
      action: 'CREATE',
      sourceType: 'CYCLE',
      entityType: 'PlanningCycle',
      entityId: created.id,
      notes: `Periode dibuat otomatis saat upload: ${created.label} (bulan ${created.uploadMonth})`,
    },
  });

  return { ok: true, periodId: created.id, label: created.label, created: true };
}

/** Periode yang boleh ditulis (ada + tidak terkunci). Untuk endpoint non-upload. */
export async function requireWritablePeriod(
  periodId: string,
): Promise<{ ok: true; label: string } | { ok: false; code: number; message: string }> {
  const cycle = await prisma.planningCycle.findUnique({ where: { id: periodId } });
  if (!cycle) return { ok: false, code: 404, message: 'Periode tidak ditemukan.' };
  if (cycle.isLocked) {
    return { ok: false, code: 409, message: `Periode "${cycle.label}" terkunci. Buka kunci dulu.` };
  }
  return { ok: true, label: cycle.label };
}

/**
 * Tandai periode berubah (dipakai edit/hapus manual). WAJIB dipanggil setiap ada
 * perubahan data periode, supaya hasil perhitungan yang lama ditandai "perlu
 * dihitung ulang" (STALE).
 *
 * `userId` = pelaku perubahan, dipakai folder periode untuk menampilkan
 * "edit terakhir oleh siapa". Upload TIDAK lewat sini (lihat recordPeriodChange).
 */
export async function touchPeriod(periodId: string, userId?: string) {
  const now = new Date();
  await prisma.planningCycle.update({
    where: { id: periodId },
    data: {
      lastDataChangeAt: now,
      lastDataChangeKind: 'EDIT',
      lastEditedAt: now,
      ...(userId ? { lastEditedBy: userId, lastDataChangeBy: userId } : {}),
    },
  });
}

// ============================================================
// CHECKSUM DATA MASTER PER PERIODE
// ============================================================
// Ringkasan murah (5 query agregat) yang cukup untuk mendeteksi perubahan:
// jumlah baris, total nilai, dan waktu update terakhir. Disimpan di
// `CycleResult.dataSignature` saat perhitungan, lalu dibandingkan saat folder
// periode dibuka kembali.

export interface SourceSignature {
  rows: number;
  sum: number;
  lastUpdatedAt: string | null;
}

export type PeriodSignature = Record<SourceType, SourceSignature>;

function packSignature(
  agg: { _count: { _all: number }; _sum: Record<string, unknown> | null; _max: { updatedAt: Date | null } },
  sumKey: string,
): SourceSignature {
  const raw = agg._sum?.[sumKey];
  return {
    rows: agg._count._all,
    sum: Number(raw ?? 0),
    lastUpdatedAt: agg._max.updatedAt ? agg._max.updatedAt.toISOString() : null,
  };
}

/**
 * Hitung checksum data master untuk SATU periode (5 query, tanpa ambil baris).
 * `moduleType` menentukan data MRP & WIP MANA yang ikut dihitung — perhitungan
 * Material Calculation memakai modul MATERIAL, sedangkan Production Planning
 * memakai PRODUCTION. Sumber lain (Hotlist/Stock/PO) memang hanya milik Material.
 */
export async function computePeriodSignature(
  periodId: string,
  moduleType: DataModule = MODULE_DEFAULT,
): Promise<PeriodSignature> {
  const [mrp, hotlist, stock, po, wip] = await Promise.all([
    prisma.weeklySchedule.aggregate({
      where: { periodId, moduleType },
      _count: { _all: true },
      _sum: { quantity: true },
      _max: { updatedAt: true },
    }),
    prisma.hotlist.aggregate({
      where: { periodId },
      _count: { _all: true },
      _sum: { biTotal: true },
      _max: { updatedAt: true },
    }),
    prisma.stockRawMaterial.aggregate({
      where: { periodId },
      _count: { _all: true },
      _sum: { qty: true },
      _max: { updatedAt: true },
    }),
    prisma.outstandingPO.aggregate({
      where: { periodId },
      _count: { _all: true },
      _sum: { qtyOrder: true },
      _max: { updatedAt: true },
    }),
    prisma.wIP.aggregate({
      where: { periodId, moduleType },
      _count: { _all: true },
      _sum: { quantity: true },
      _max: { updatedAt: true },
    }),
  ]);

  return {
    MRP: packSignature(mrp as never, 'quantity'),
    HOTLIST: packSignature(hotlist as never, 'biTotal'),
    STOCK_RM: packSignature(stock as never, 'qty'),
    OUTSTANDING_PO: packSignature(po as never, 'qtyOrder'),
    WIP: packSignature(wip as never, 'quantity'),
  };
}

/**
 * Bandingkan checksum tersimpan dengan kondisi data master sekarang.
 * `comparable = false` bila perhitungan lama belum punya checksum.
 */
export function compareSignature(stored: unknown, current: PeriodSignature) {
  const saved = (stored ?? null) as PeriodSignature | null;
  const changedSources: SourceType[] = [];

  for (const key of SOURCE_TYPES) {
    const a = saved?.[key];
    if (!a) continue;
    const b = current[key];
    if (a.rows !== b.rows || Math.abs(a.sum - b.sum) > 1e-6 || a.lastUpdatedAt !== b.lastUpdatedAt) {
      changedSources.push(key);
    }
  }

  return {
    comparable: Boolean(saved),
    changedSources,
    anyChanged: changedSources.length > 0,
  };
}

/**
 * Rentang tanggal MRP satu periode = MIN(weekStartDate) .. MAX(weekEndDate) dari
 * SELURUH baris MRP modul MATERIAL periode itu.
 *
 * ⚠️ SELALU dihitung ulang dari data nyata, JANGAN memakai min/max batch upload
 * terakhir. Rentang ini dipakai `/calculate` sebagai `periodStartDate` (dasar
 * penerjemahan tanggal PO -> indeks minggu). Kalau nilainya salah — mis. karena
 * satu upload sebagian atau data uji — semua PO akan dianggap tiba di minggu 1
 * dan hasil perhitungannya keliru. Insiden nyata: periode September 2026 sempat
 * menyimpan 5–11 Jan 2032 padahal datanya 19 Sep 2026 – 13 Mar 2027.
 */
export async function recomputeMrpRange(
  periodId: string,
): Promise<{ start: Date | null; end: Date | null }> {
  const agg = await prisma.weeklySchedule.aggregate({
    where: { periodId, moduleType: 'MATERIAL' },
    _min: { weekStartDate: true },
    _max: { weekEndDate: true },
  });
  return { start: agg._min.weekStartDate ?? null, end: agg._max.weekEndDate ?? null };
}

/**
 * Catat hasil upload/penghapusan ke jejak periode:
 *  - CycleSourceUpload  (kapan, file apa, berapa baris, oleh siapa)
 *  - perbarui cap waktu PlanningCycle
 *  - CycleAuditLog      (satu baris ringkas per aksi, bukan per baris data)
 */
export async function recordPeriodChange(params: {
  periodId: string;
  userId: string;
  sourceType: SourceType;
  rowCount: number;
  replaced?: number;
  fileName?: string | null;
  mode?: string;
  /**
   * Modul pemilik data (PRODUCTION | MATERIAL). Dipakai untuk label audit dan
   * untuk memutuskan apakah rentang MRP periode (`mrpStartDate/mrpEndDate`)
   * perlu diperbarui.
   */
  moduleType?: DataModule;
  notes?: string;
}) {
  const now = new Date();
  const replaced = params.replaced ?? 0;
  const moduleType = params.moduleType ?? MODULE_DEFAULT;
  const moduleLabel = MODULE_LABELS[moduleType];

  await prisma.cycleSourceUpload.create({
    data: {
      cycleId: params.periodId,
      sourceType: params.sourceType,
      fileName: params.fileName ?? null,
      rowCount: params.rowCount,
      mode: params.mode ?? 'replace',
      uploadedBy: params.userId,
    },
  });

  // `PlanningCycle.mrpStartDate/mrpEndDate` = dasar timeline Material Calculation,
  // jadi HANYA boleh diisi oleh upload MRP modul MATERIAL. Upload MRP modul
  // Production tidak boleh menggeser timeline perhitungan material.
  // Nilainya dihitung ulang dari SELURUH data periode (bukan batch terakhir).
  const shouldUpdateMrpRange = params.sourceType === 'MRP' && moduleType === 'MATERIAL';
  const mrpRange = shouldUpdateMrpRange ? await recomputeMrpRange(params.periodId) : null;

  await prisma.planningCycle.update({
    where: { id: params.periodId },
    data: {
      lastUploadedAt: now,
      lastDataChangeAt: now,
      lastDataChangeBy: params.userId,
      lastDataChangeKind: 'UPLOAD',
      ...(mrpRange ? { mrpStartDate: mrpRange.start, mrpEndDate: mrpRange.end } : {}),
    },
  });

  await prisma.cycleAuditLog.create({
    data: {
      cycleId: params.periodId,
      userId: params.userId,
      action: replaced > 0 ? 'UPDATE' : 'CREATE',
      sourceType: params.sourceType,
      entityType: 'CycleSourceUpload',
      notes:
        params.notes ??
        `Upload ${params.sourceType} [${moduleLabel}]: ${params.rowCount} baris masuk, ${replaced} baris lama di periode ini diganti. Modul lain tidak terpengaruh.`,
    },
  });
}
