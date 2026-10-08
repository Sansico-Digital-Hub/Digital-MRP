/**
 * Mesin kalkulasi Material Calculation.
 *
 * Sengaja dipisah dari route supaya SATU logika dipakai oleh dua mode:
 *  1. Mode live  -> membaca tabel operasional (weekly_schedule, wips, stock_raw_materials, ...)
 *  2. Mode periode -> membaca tabel milik satu PlanningCycle (cycle_mrp_weeks, ...)
 *
 * Semua fungsi di sini MURNI: tidak mengakses database dan tidak membaca waktu
 * sekarang. Basis tanggal selalu diberikan pemanggil, sehingga hasilnya bisa
 * diuji dan periode lama tetap stabil walau dihitung ulang kapan saja.
 */

// ============================================
// Konstanta
// ============================================

/** Lokasi WIP yang satuannya lembar; selain ini dihitung pcs. */
const WIP_SHEET_LOCATIONS = ['blister', 'uv', 'varnish opp', 'die cut'];

/** Satuan yang berarti "lembar". Data nyata memakai "sht", bukan "sheet". */
const SHEET_UNITS = ['sheet', 'sheets', 'sht', 'lbr', 'lembar'];

/** Satuan yang berarti "rim" (1 rim = `sheetsPerRim` lembar). */
const RIM_UNITS = ['rim', 'ream'];

/** Item dengan penanda ini tidak dihitung. */
export const NEBENG_PATTERN = /nebeng|satu\s*layout|tidak\s*dihitung/i;

/** Rata-rata jumlah minggu per bulan, dipakai menerjemahkan lead time bulan -> minggu. */
const WEEKS_PER_MONTH = 52 / 12;

// ============================================
// Lead time & satuan
// ============================================

/** Lead time kedatangan material, dalam bulan. */
export function getLeadTimeMonths(supplier: string): number {
  const s = (supplier || '').toLowerCase();
  if (s.includes('mega')) return 2;
  if (s.includes('hanchang')) return 3;
  if (s.includes('hansol')) return 3;
  if (s.includes('xsd') || s.includes('hongkong')) return 3;
  return 3; // default: import
}

/** Lead time diterjemahkan ke jumlah minggu MRP (2 bulan ≈ 9 minggu, 3 bulan ≈ 13 minggu). */
export function getLeadTimeWeeks(leadTimeMonths: number): number {
  return Math.max(1, Math.round(leadTimeMonths * WEEKS_PER_MONTH));
}

export function getWipUnit(location: string): 'sheet' | 'pcs' {
  const loc = (location || '').toLowerCase();
  return WIP_SHEET_LOCATIONS.some((l) => loc.includes(l)) ? 'sheet' : 'pcs';
}

export function isSheetUnit(unit: string | null | undefined): boolean {
  return SHEET_UNITS.includes(String(unit || '').trim().toLowerCase());
}

export function isRimUnit(unit: string | null | undefined): boolean {
  return RIM_UNITS.includes(String(unit || '').trim().toLowerCase());
}

// ============================================
// Pencocokan material: gramatur + ukuran
// ============================================

const normalizeNumText = (text: string | null | undefined) =>
  String(text || '').replace(/,/g, '.').toLowerCase();

/** Ambil gramatur: "DUPLEX 450GSM/ 68.5CM" -> 450 ; "450 GSM" -> 450 ; "450" -> 450. */
export function parseGsm(text: string | null | undefined): number | null {
  const s = normalizeNumText(text);
  const m = s.match(/(\d{3,4})\s*gsm/) ?? s.match(/^\s*(\d{3,4})\b/);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

/** Semua angka > 20 yang BUKAN gramatur -> dimensi cm, urutan tetap dipertahankan. */
export function parseDims(text: string | null | undefined): number[] {
  const s = normalizeNumText(text);
  const gsm = parseGsm(text);
  return [...s.matchAll(/(\d+(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 20 && n !== gsm);
}

export interface SizeMatch {
  /** true = ukuran sama persis dengan kebutuhan (prioritas utama saat alokasi). */
  exact: boolean;
  /** selisih lebar material - lebar kebutuhan (cm), selalu >= 0 bila lolos. */
  delta: number;
}

/**
 * Aturan pencocokan (keputusan user, rancangan §2.6):
 *  1. Gramatur harus sama persis
 *  2. Lebar material tidak boleh lebih kecil dari kebutuhan
 *  3. Boleh lebih besar, selisih maksimal `toleranceCm`
 *  4. Selisih 0 berarti ukuran sama persis
 *
 * Sengaja HANYA memakai dimensi pertama (lebar), mengikuti skrip analisis yang
 * menghasilkan angka 29 dari 98 part.
 */
export function matchSize(
  materialDesc: string | null | undefined,
  needGsm: number | null,
  needWidth: number | null,
  toleranceCm: number,
): SizeMatch | null {
  if (needGsm === null || needWidth === null) return null;
  const gsm = parseGsm(materialDesc);
  if (gsm === null || gsm !== needGsm) return null;
  const width = parseDims(materialDesc)[0];
  if (width === undefined) return null;
  const delta = width - needWidth;
  if (delta < 0 || delta > toleranceCm + 1e-9) return null;
  return { exact: delta < 1e-9, delta };
}

// ============================================
// Angka & teks NPOF
// ============================================

export function parseMaterialNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = String(value).trim().replace(',', '.');
  const parsed = parseFloat(normalized);
  if (!isNaN(parsed)) return parsed;

  try {
    const expression = normalized.replace(/[^0-9.+*/()\-\s]/g, '');
    return Number(Function(`"use strict"; return (${expression})`)()) || 0;
  } catch {
    return 0;
  }
}

export function normalizeNpofText(value: string | null | undefined, fallback: string): string {
  const normalized = String(value || '').trim();
  return !normalized || normalized === '-' || normalized.toLowerCase() === 'null' ? fallback : normalized;
}

/** Timeline tampilan: bulan pembelian / kedatangan / pemakaian. */
export function getPlanningTimeline(leadTimeMonths: number, baseDate: Date) {
  const purchaseDate = new Date(baseDate);
  purchaseDate.setUTCHours(0, 0, 0, 0);
  purchaseDate.setUTCDate(1);

  const arrivalDate = new Date(purchaseDate);
  arrivalDate.setUTCMonth(arrivalDate.getUTCMonth() + Math.max(0, leadTimeMonths - 1));

  const usageDate = new Date(purchaseDate);
  usageDate.setUTCMonth(usageDate.getUTCMonth() + leadTimeMonths);

  const formatMonth = (date: Date) => date.toISOString().slice(0, 7);
  return {
    purchaseMonth: formatMonth(purchaseDate),
    arrivalMonth: formatMonth(arrivalDate),
    usageMonth: formatMonth(usageDate),
  };
}

// ============================================
// Tabel mingguan 26 kolom (sesuai Gambar 3)
// ============================================

const MONTH_SHORT_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Bulan saat PO harus dipesan supaya material tiba sebelum minggu pemakaian. */
export function poMonthLabel(weekStart: Date, leadTimeMonths: number): string {
  const d = new Date(weekStart);
  d.setUTCMonth(d.getUTCMonth() - Math.max(0, leadTimeMonths));
  return `${MONTH_SHORT_ID[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** Keluarga material dari kolom `material` NPOF. */
export function getMaterialFamily(
  material: string | null | undefined,
): 'Paper' | 'PET' | 'Flute' | 'Lainnya' {
  const m = String(material || '').toLowerCase();
  if (!m) return 'Lainnya';
  if (m.includes('pet')) return 'PET';
  if (m.includes('flute') || m.includes('duplek')) return 'Flute';
  if (m.includes('paper') || m.includes('kraft') || m.includes('art')) return 'Paper';
  return 'Lainnya';
}

export interface WeeklyMatrixColumn {
  weekNumber: number;
  weekStartDate: string;
  /** Bulan pemesanan PO untuk minggu ini. */
  poMonthLabel: string;
}

export interface WeeklyMatrixRow {
  partNumber: string;
  productName: string;
  gsm: string;
  width: number | null;
  length: number | null;
  up: number;
  /** false = part ini tidak punya formula material, angkanya hanya lembar. */
  hasKg: boolean;
  kgPerSheet: number;
  /** kebutuhan mingguan dalam kg */
  weeks: number[];
  /** kebutuhan mingguan dalam lembar */
  weeksSheet: number[];
}

export interface WeeklyMatrixSummary {
  totalReq: number[];
  totalReqSheet: number[];
  allowance: number[];
  allowanceSheet: number[];
  totalPlusAllowance: number[];
  totalPlusAllowanceSheet: number[];
  stockAsOf: number;
  stockAsOfSheet: number;
  outstandingPo: number[];
  outstandingPoSheet: number[];
  /**
   * Nomor PO per minggu (sejajar dengan `outstandingPo`). Satu minggu bisa
   * berisi beberapa nomor PO karena satu PO boleh mencakup beberapa item.
   * Ditampilkan di UI sebagai caption kecil di bawah angka kg.
   */
  outstandingPoNumbers: string[][];
  endInd: number[];
  endIndSheet: number[];
}

export interface WeeklyMatrix {
  columns: WeeklyMatrixColumn[];
  rows: WeeklyMatrixRow[];
  summary: WeeklyMatrixSummary;
}

// ============================================
// Alokasi berurutan (menggantikan rumus Surplus per part)
// ============================================

/** Satu sumber material: item stok (tersedia sejak awal) atau PO (tersedia saat tiba). */
export interface PoolItem {
  key: string;
  desc: string;
  supplier: string;
  source: 'stock' | 'po';
  /** 0 = tersedia sejak awal periode; PO = indeks minggu kedatangan (0-based). */
  availableWeek: number;
  kgRemaining: number;
  /** porsi bersatuan lembar (dikonversi ke kg memakai `fm` part saat dipakai). */
  sheetRemaining: number;
  /** Nomor PO (hanya untuk `source === 'po'`). Tidak unik antar baris. */
  poNumber?: string | null;
}

/** Satu kebutuhan part pada satu minggu. */
export interface Requirement {
  partNumber: string;
  weekIndex: number;
  needKg: number;
  gsm: number | null;
  width: number | null;
  supplier: string;
  /** kg per lembar — untuk mengubah material bersatuan lembar menjadi kg. */
  fm: number;
}

export interface AllocationOptions {
  toleranceCm: number;
  /**
   * false (default) = supplier TIDAK dipakai sebagai syarat cocok.
   * Ini mengikuti skrip validasi yang menghasilkan angka 29 part.
   * Kalau diaktifkan, hasil turun menjadi 13 part karena supplier NPOF berupa
   * nama panjang ("Hanchang Paper") sedangkan supplier stok berupa kode ("HANCHANG").
   */
  requireSupplierMatch: boolean;
}

function supplierOk(itemSupplier: string, needSupplier: string, required: boolean): boolean {
  if (!required) return true;
  const a = String(itemSupplier || '').trim().toLowerCase();
  const b = String(needSupplier || '').trim().toLowerCase();
  if (!a || !b) return true;
  return a.includes(b) || b.includes(a);
}

/**
 * Alokasi stok + PO secara berurutan.
 *
 * Aturan (keputusan user):
 *  - Satu sumber material dikonsumsi SEKALI (inilah yang menghilangkan double-count).
 *  - Urutan utama = MINGGU kebutuhan, paling awal dilayani dulu.
 *  - Dalam minggu yang sama: (1) kecocokan ukuran terbaik -> (2) yang kebutuhannya
 *    bisa ditutup penuh -> (3) part number A→Z.
 *  - DILARANG dibagi rata; satu part dihabiskan dulu baru sisanya ke berikutnya.
 *  - PO baru masuk kolam mulai minggu kedatangannya.
 *
 * Mengembalikan peta `partNumber||weekIndex` -> kg yang berhasil dialokasikan.
 */
export function allocateSequentially(
  requirements: Requirement[],
  pool: PoolItem[],
  options: AllocationOptions,
): Map<string, number> {
  const items = pool.map((p) => ({ ...p }));
  const allocated = new Map<string, number>();

  const byWeek = new Map<number, Requirement[]>();
  for (const r of requirements) {
    if (r.needKg <= 0) continue;
    const list = byWeek.get(r.weekIndex) || [];
    list.push(r);
    byWeek.set(r.weekIndex, list);
  }

  const capacityFor = (item: PoolItem, fm: number) =>
    Math.max(0, item.kgRemaining) + (fm > 0 ? Math.max(0, item.sheetRemaining) * fm : 0);

  for (const week of [...byWeek.keys()].sort((a, b) => a - b)) {
    // Kandidat dihitung ulang tiap minggu karena sisa kolam ikut berubah.
    const entries = (byWeek.get(week) || []).map((r) => {
      const candidates = items
        .filter(
          (item) =>
            item.availableWeek <= week && supplierOk(item.supplier, r.supplier, options.requireSupplierMatch),
        )
        .map((item) => ({ item, match: matchSize(item.desc, r.gsm, r.width, options.toleranceCm) }))
        .filter((c): c is { item: PoolItem; match: SizeMatch } => c.match !== null);

      const bestDelta = candidates.length
        ? Math.min(...candidates.map((c) => c.match.delta))
        : Number.POSITIVE_INFINITY;
      const availableKg = candidates.reduce((sum, c) => sum + capacityFor(c.item, r.fm), 0);
      return { r, candidates, bestDelta, canFullyCover: availableKg >= r.needKg - 1e-9 };
    });

    entries.sort((a, b) => {
      if (a.bestDelta !== b.bestDelta) return a.bestDelta - b.bestDelta; // aturan 1
      if (a.canFullyCover !== b.canFullyCover) return a.canFullyCover ? -1 : 1; // aturan 2
      return a.r.partNumber.localeCompare(b.r.partNumber); // aturan 3
    });

    for (const entry of entries) {
      let remaining = entry.r.needKg;
      const candidates = [...entry.candidates].sort(
        (a, b) => a.match.delta - b.match.delta || a.item.key.localeCompare(b.item.key),
      );

      for (const c of candidates) {
        if (remaining <= 1e-9) break;
        const capacity = capacityFor(c.item, entry.r.fm);
        if (capacity <= 1e-9) continue;

        const take = Math.min(remaining, capacity);
        const fromKg = Math.min(take, Math.max(0, c.item.kgRemaining));
        c.item.kgRemaining -= fromKg;
        const restKg = take - fromKg;
        if (restKg > 0 && entry.r.fm > 0) c.item.sheetRemaining -= restKg / entry.r.fm;

        remaining -= take;
      }

      allocated.set(`${entry.r.partNumber}||${entry.r.weekIndex}`, entry.r.needKg - remaining);
    }
  }

  for (const r of requirements) {
    const k = `${r.partNumber}||${r.weekIndex}`;
    if (!allocated.has(k)) allocated.set(k, 0);
  }

  return allocated;
}

// ============================================
// Perhitungan per part (rumus Spesifikasi §2–§6)
// ============================================

export interface CalcInput {
  demandPcs: number;
  ups: number;
  fm: number; // formulaMaterial kg/sheet
  biTotal: number; // hotlist biTotal (pcs)
  leadTimeDemandPcs: number;
  wipSheet: number;
  wipPcs: number;
  /** kg hasil alokasi berurutan dari stok + PO. */
  allocatedKg: number;
}

export interface CalcResult {
  sheetsKotor: number;
  kgKotor: number;
  hotlistNet: number;
  pcsNet1: number;
  sheetsNet1: number;
  sheetsNet1Allow: number;
  pcsNet1Allow: number;
  kgNet1Allow: number;
  wipSheet: number;
  wipPcs: number;
  sheetsNet2: number;
  kgNet2: number;
  ltNeedSheet: number;
  ltNeedKg: number;
  shortageKg: number;
  shortageSheet: number | null;
  shortagePcs: number | null;
  isSufficient: boolean;
  surplusKg: number | null;
}

export function calculatePart(input: CalcInput): CalcResult {
  const { demandPcs, ups, fm, biTotal, leadTimeDemandPcs, wipSheet, wipPcs } = input;

  // Step 2: Gross
  const sheetsKotor = demandPcs / ups;
  const kgKotor = sheetsKotor * fm;

  // Step 3: Hotlist net
  const hotlistNet = Math.max(0, biTotal - leadTimeDemandPcs);
  const pcsNet1 = demandPcs - hotlistNet; // bisa negatif
  const sheetsNet1 = pcsNet1 / ups;

  // Step 4: Allowance 5%
  const sheetsNet1Allow = sheetsNet1 * 1.05;
  const pcsNet1Allow = pcsNet1 * 1.05;
  const kgNet1Allow = sheetsNet1Allow * fm;

  // Step 5: WIP net
  const sheetsNet2 = ((sheetsNet1Allow - wipSheet) * ups - wipPcs) / ups;

  // Step 6: Kebutuhan Produksi Bersih
  const kgNet2 = sheetsNet2 * fm;

  // Step 6.1: kebutuhan selama lead time
  const ltPcsNet1 = leadTimeDemandPcs - Math.max(0, biTotal);
  const ltSheetsNet1Allow = (ltPcsNet1 / ups) * 1.05;
  const ltSheetsNet2 = ((ltSheetsNet1Allow - wipSheet) * ups - wipPcs) / ups;
  const ltNeedSheet = ltSheetsNet2;
  const ltNeedKg = ltNeedSheet * fm;

  // Step 6.3: Shortage = kebutuhan bersih - alokasi nyata
  const { allocatedKg } = input;
  const shortageKg = kgNet2 - allocatedKg;

  let shortageSheet: number | null = null;
  let shortagePcs: number | null = null;
  const isSufficient = shortageKg <= 0;
  const surplusKgResult = isSufficient ? Math.abs(shortageKg) : null;

  if (!isSufficient) {
    // Step 6.4: pembulatan ke atas
    shortageSheet = Math.ceil(shortageKg / fm);
    shortagePcs = shortageSheet * ups;
  }

  return {
    sheetsKotor,
    kgKotor,
    hotlistNet,
    pcsNet1,
    sheetsNet1,
    sheetsNet1Allow,
    pcsNet1Allow,
    kgNet1Allow,
    wipSheet,
    wipPcs,
    sheetsNet2,
    kgNet2,
    ltNeedSheet,
    ltNeedKg,
    shortageKg,
    shortageSheet,
    shortagePcs,
    isSufficient,
    surplusKg: surplusKgResult,
  };
}

// ============================================
// Orkestrasi: dari data mentah -> hasil per part + grup
// ============================================

export interface MaterialCalcSource {
  /** Demand MRP. `weekNumber` dipakai sebagai urutan minggu (1..weekCount). */
  mrpWeeks: Array<{
    partNumber: string;
    description?: string | null;
    year: number;
    weekNumber: number;
    weekStartDate: Date;
    weekEndDate: Date;
    quantity: number;
  }>;
  hotlists: Array<{ partNumber: string; biTotal: number }>;
  stocks: Array<{ itemDesc: string; supplier?: string | null; qty: number; unit: string }>;
  pos: Array<{
    itemDesc: string;
    supplierName: string;
    qtyOrder: number;
    qtyOrderUnit: string;
    qtyDelivered: number;
    planReceivedDate?: Date | null;
    /** Nomor PO dari kolom `PO NO`. Wajib diisi di Master Data, boleh berulang. */
    poNumber?: string | null;
  }>;
  wips: Array<{ partNumber: string; location: string; quantity: number }>;
  npofs: Array<{
    partNumber: string;
    productName?: string | null;
    material?: string | null;
    gramatur?: string | null;
    supplier?: string | null;
    sheetedSize?: string | null;
    formulaMaterial?: string | null;
    ups?: string | null;
  }>;
}

export interface MaterialCalcOptions {
  /** Jumlah minggu yang dihitung. Default 26. */
  weekCount?: number;
  /** Awal periode. Dipakai untuk menerjemahkan tanggal PO -> indeks minggu. */
  periodStartDate: Date;
  /** Basis perhitungan timeline pembelian. Biasanya = periodStartDate. */
  timelineBaseDate?: Date;
  toleranceCm: number;
  sheetsPerRim: number;
  requireSupplierMatch: boolean;
}

export interface PartNumberDetail {
  partNumber: string;
  productName: string;
  demandPcs: number;
  noNpofData: boolean;
  sheetsKotor: number;
  kgKotor: number;
  hotlistNet: number;
  pcsNet1: number;
  sheetsNet1Allow: number;
  wipSheet: number;
  wipPcs: number;
  sheetsNet2: number;
  kgNet2: number;
  allocatedKg: number;
  shortageKg: number;
  shortageSheet: number | null;
  shortagePcs: number | null;
  isSufficient: boolean;
  surplusKg: number | null;
  ukuran: string;
  gramatur: string;
  supplier: string;
  /** Paper | PET | Flute | Lainnya — dipakai untuk pengelompokan folder di UI. */
  materialType: string;
  leadTimeMonths: number;
  planningTimeline: { purchaseMonth: string; arrivalMonth: string; usageMonth: string };
  fm: number;
  ups: number;
}

export interface MaterialGroupResult {
  ukuran: string;
  gramatur: string;
  supplier: string;
  leadTimeMonths: number;
  planningTimeline: { purchaseMonth: string; arrivalMonth: string; usageMonth: string };
  totalShortageSheet: number | null;
  totalShortagePcs: number | null;
  totalShortageKg: number | null;
  isSufficient: boolean;
  surplusKg: number | null;
  /** Paper | PET | Flute | Lainnya — dasar pengelompokan folder di UI. */
  materialType: string;
  /** false = tidak ada part di grup ini yang punya formula material (kg). */
  hasKg: boolean;
  /** Sisa stok grup ini dalam lembar (pasangan dari surplusKg). */
  surplusSheet: number | null;
  details: PartNumberDetail[];
  /** Tabel mingguan 26 kolom sesuai Gambar 3. */
  weeklyMatrix: WeeklyMatrix;
}

export interface WeekColumn {
  weekNumber: number;
  weekStartDate: string;
  weekEndDate: string;
}

export interface MaterialCalcEngineResult {
  periodStartDate: Date;
  periodEndDate: Date;
  periodWeeks: number;
  weekCount: number;
  weeks: WeekColumn[];
  groups: MaterialGroupResult[];
  totals: {
    partCount: number;
    partsWithoutNpof: number;
    partsWithStock: number;
    allocatedKg: number;
  };
}

/**
 * Jalankan kalkulasi penuh dari data yang sudah disiapkan pemanggil.
 * Fungsi ini tidak menyentuh database sama sekali.
 */
export function runMaterialCalculation(
  source: MaterialCalcSource,
  options: MaterialCalcOptions,
): MaterialCalcEngineResult {
  const weekCount = Math.max(1, options.weekCount ?? 26);
  const periodStart = options.periodStartDate;
  const timelineBase = options.timelineBaseDate ?? periodStart;

  // ── 1. NPOF per part + nilai default ────────────────────────────────────
  const npofByPartNumber = new Map<string, MaterialCalcSource['npofs'][number]>();
  for (const m of source.npofs) {
    if (!npofByPartNumber.has(m.partNumber)) npofByPartNumber.set(m.partNumber, m);
  }

  const gramaturCounts = new Map<string, number>();
  for (const m of source.npofs) {
    if (m.gramatur) gramaturCounts.set(m.gramatur, (gramaturCounts.get(m.gramatur) || 0) + 1);
  }
  const defaultGramatur = [...gramaturCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  const formulaMaterials = source.npofs
    .map((m) => parseMaterialNumber(m.formulaMaterial))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const defaultFormulaMaterial = formulaMaterials[Math.floor(formulaMaterials.length / 2)] || 0;

  const upsValues = source.npofs
    .map((m) => parseMaterialNumber(m.ups))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const defaultUps = upsValues[Math.floor(upsValues.length / 2)] || 1;

  // ── 2. Demand per part per minggu ───────────────────────────────────────
  const demandByPartNumber = new Map<string, number>();
  const demandByPartWeek = new Map<string, Map<number, number>>();
  const itemNameByPart = new Map<string, string>();
  const weekBounds = new Map<number, { start: Date; end: Date }>();

  for (const ws of source.mrpWeeks) {
    const wi = Math.min(weekCount - 1, Math.max(0, ws.weekNumber - 1)); // weekNumber 1..N -> index 0..N-1
    demandByPartNumber.set(ws.partNumber, (demandByPartNumber.get(ws.partNumber) || 0) + ws.quantity);

    const per = demandByPartWeek.get(ws.partNumber) || new Map<number, number>();
    per.set(wi, (per.get(wi) || 0) + ws.quantity);
    demandByPartWeek.set(ws.partNumber, per);

    if (ws.description && !itemNameByPart.has(ws.partNumber)) itemNameByPart.set(ws.partNumber, ws.description);
    const existing = weekBounds.get(wi);
    if (!existing || ws.weekStartDate < existing.start) {
      weekBounds.set(wi, { start: ws.weekStartDate, end: ws.weekEndDate });
    }
  }

  // ── 3. Kolom minggu SELALU dibangun dari kalender MRP, bukan dari data demand ──
  const weeks: WeekColumn[] = [];
  for (let i = 0; i < weekCount; i += 1) {
    const bounds = weekBounds.get(i);
    const fallbackStart = new Date(periodStart.getTime() + i * 7 * 86400000);
    const fallbackEnd = new Date(periodStart.getTime() + ((i + 1) * 7 - 1) * 86400000);
    weeks.push({
      weekNumber: i + 1,
      weekStartDate: (bounds?.start ?? fallbackStart).toISOString(),
      weekEndDate: (bounds?.end ?? fallbackEnd).toISOString(),
    });
  }

  if (demandByPartNumber.size === 0) {
    return {
      periodStartDate: periodStart,
      periodEndDate: new Date(periodStart.getTime() + (weekCount * 7 - 1) * 86400000),
      periodWeeks: weekCount,
      weekCount,
      weeks,
      groups: [],
      totals: { partCount: 0, partsWithoutNpof: 0, partsWithStock: 0, allocatedKg: 0 },
    };
  }

  // ── 4. Hotlist & WIP ────────────────────────────────────────────────────
  const hotlistByPartNumber = new Map<string, number>();
  for (const h of source.hotlists) hotlistByPartNumber.set(h.partNumber, h.biTotal);

  const wipSheetByPN = new Map<string, number>();
  const wipPcsByPN = new Map<string, number>();
  for (const w of source.wips) {
    if (getWipUnit(w.location) === 'sheet') {
      wipSheetByPN.set(w.partNumber, (wipSheetByPN.get(w.partNumber) || 0) + w.quantity);
    } else {
      wipPcsByPN.set(w.partNumber, (wipPcsByPN.get(w.partNumber) || 0) + w.quantity);
    }
  }

  // ── 5. Kolam material: semua lot stok + sisa PO ─────────────────────────
  const pool: PoolItem[] = [];
  const stockAgg = new Map<string, { desc: string; supplier: string; kg: number; sheet: number }>();
  for (const s of source.stocks) {
    const key = `${s.itemDesc}||${s.supplier || ''}`;
    const agg = stockAgg.get(key) || { desc: s.itemDesc, supplier: s.supplier || '', kg: 0, sheet: 0 };
    const qty = Number(s.qty) || 0;
    if (isSheetUnit(s.unit)) agg.sheet += qty;
    else if (isRimUnit(s.unit)) agg.sheet += qty * options.sheetsPerRim;
    else agg.kg += qty;
    stockAgg.set(key, agg);
  }
  for (const [key, agg] of stockAgg.entries()) {
    if (agg.kg <= 0 && agg.sheet <= 0) continue;
    pool.push({
      key: `stock|${key}`,
      desc: agg.desc,
      supplier: agg.supplier,
      source: 'stock',
      availableWeek: 0,
      kgRemaining: agg.kg,
      sheetRemaining: agg.sheet,
    });
  }

  const weekIndexOfDate = (value: Date | null | undefined): number => {
    if (!value) return 0; // tanggal kosong -> anggap sudah tiba
    const diff = new Date(value).getTime() - periodStart.getTime();
    return Math.min(weekCount - 1, Math.max(0, Math.floor(diff / (7 * 86400000))));
  };

  for (const po of source.pos) {
    const remaining = Number(po.qtyOrder) - Number(po.qtyDelivered);
    if (!Number.isFinite(remaining) || remaining <= 0) continue;

    const unit = String(po.qtyOrderUnit || '').trim().toLowerCase();
    const kgQty = unit === 'kg' ? remaining : 0;
    const sheetQty = isSheetUnit(unit)
      ? remaining
      : isRimUnit(unit)
        ? remaining * options.sheetsPerRim
        : 0;
    if (kgQty <= 0 && sheetQty <= 0) continue;

    pool.push({
      key: `po|${pool.length}`,
      desc: po.itemDesc,
      supplier: po.supplierName || '',
      source: 'po',
      availableWeek: weekIndexOfDate(po.planReceivedDate),
      kgRemaining: kgQty,
      sheetRemaining: sheetQty,
      poNumber: po.poNumber ?? null,
    });
  }

  // ── 6. Kebutuhan bersih tiap part ───────────────────────────────────────
  interface PartBase {
    partNumber: string;
    productName: string;
    demandPcs: number;
    noNpofData: boolean;
    ukuran: string;
    gramatur: string;
    supplier: string;
    materialType: string;
    leadTimeMonths: number;
    fm: number;
    ups: number;
    wipSheet: number;
    wipPcs: number;
    biTotal: number;
    leadTimeDemandPcs: number;
    weekDemandPcs: Map<number, number>;
    needKg: number;
  }

  const parts: PartBase[] = [];
  for (const pn of demandByPartNumber.keys()) {
    const demandPcs = demandByPartNumber.get(pn) || 0;
    const npof = npofByPartNumber.get(pn);
    let noNpofData = !npof;

    const sheetedSize = normalizeNpofText(npof?.sheetedSize, '180cm (jumbo roll)');
    const gramatur = normalizeNpofText(npof?.gramatur, defaultGramatur || '-');
    const supplier = normalizeNpofText(npof?.supplier, 'Unknown');
    const materialType = getMaterialFamily(npof?.material);
    const fmFromNpof = parseMaterialNumber(npof?.formulaMaterial);
    const upsFromNpof = parseMaterialNumber(npof?.ups);
    const fm = fmFromNpof > 0 ? fmFromNpof : defaultFormulaMaterial;
    const ups = upsFromNpof > 0 ? upsFromNpof : defaultUps;
    if (fmFromNpof <= 0 || upsFromNpof <= 0) noNpofData = true;
    if (fm <= 0 || ups <= 0) continue;

    const leadTimeMonths = getLeadTimeMonths(supplier);
    // Lead time demand = minggu 1..N dari MRP periode ini sendiri (keputusan round 2).
    const leadTimeWeeks = getLeadTimeWeeks(leadTimeMonths);
    const perWeek = demandByPartWeek.get(pn) || new Map<number, number>();
    let leadTimeDemandPcs = 0;
    for (const [wi, qty] of perWeek.entries()) {
      if (wi < leadTimeWeeks) leadTimeDemandPcs += qty;
    }

    const wipSheet = wipSheetByPN.get(pn) || 0;
    const wipPcs = wipPcsByPN.get(pn) || 0;
    const biTotal = hotlistByPartNumber.get(pn) || 0;

    const base = calculatePart({
      demandPcs,
      ups,
      fm,
      biTotal,
      leadTimeDemandPcs,
      wipSheet,
      wipPcs,
      allocatedKg: 0,
    });

    parts.push({
      partNumber: pn,
      productName: npof?.productName || itemNameByPart.get(pn) || pn,
      demandPcs,
      noNpofData,
      ukuran: sheetedSize,
      gramatur,
      supplier,
      materialType,
      leadTimeMonths,
      fm,
      ups,
      wipSheet,
      wipPcs,
      biTotal,
      leadTimeDemandPcs,
      weekDemandPcs: perWeek,
      needKg: Math.max(0, base.kgNet2),
    });
  }

  // ── 7. Alokasi berurutan ────────────────────────────────────────────────
  const requirements: Requirement[] = [];
  for (const part of parts) {
    if (part.needKg <= 0) continue;

    const gsm = parseGsm(part.gramatur);
    const width = NEBENG_PATTERN.test(part.ukuran) ? null : (parseDims(part.ukuran)[0] ?? null);

    const weekly = [...part.weekDemandPcs.entries()].filter(([, qty]) => qty > 0);
    const totalWeekly = weekly.reduce((sum, [, qty]) => sum + qty, 0);

    if (totalWeekly <= 0) {
      requirements.push({
        partNumber: part.partNumber,
        weekIndex: 0,
        needKg: part.needKg,
        gsm,
        width,
        supplier: part.supplier,
        fm: part.fm,
      });
      continue;
    }

    for (const [wi, qty] of weekly) {
      requirements.push({
        partNumber: part.partNumber,
        weekIndex: wi,
        needKg: (part.needKg * qty) / totalWeekly,
        gsm,
        width,
        supplier: part.supplier,
        fm: part.fm,
      });
    }
  }

  const allocatedByKey = allocateSequentially(requirements, pool, {
    toleranceCm: options.toleranceCm,
    requireSupplierMatch: options.requireSupplierMatch,
  });

  const allocatedByPart = new Map<string, number>();
  for (const [key, kg] of allocatedByKey.entries()) {
    const pn = key.slice(0, key.lastIndexOf('||'));
    allocatedByPart.set(pn, (allocatedByPart.get(pn) || 0) + kg);
  }

  // ── 8. Hasil akhir per part ─────────────────────────────────────────────
  const partDetails: PartNumberDetail[] = [];
  let partsWithStock = 0;
  let allocatedTotal = 0;

  for (const part of parts) {
    const allocatedKg = allocatedByPart.get(part.partNumber) || 0;
    if (allocatedKg > 0) partsWithStock += 1;
    allocatedTotal += allocatedKg;

    const result = calculatePart({
      demandPcs: part.demandPcs,
      ups: part.ups,
      fm: part.fm,
      biTotal: part.biTotal,
      leadTimeDemandPcs: part.leadTimeDemandPcs,
      wipSheet: part.wipSheet,
      wipPcs: part.wipPcs,
      allocatedKg,
    });

    partDetails.push({
      partNumber: part.partNumber,
      productName: part.productName,
      demandPcs: part.demandPcs,
      noNpofData: part.noNpofData,
      sheetsKotor: result.sheetsKotor,
      kgKotor: result.kgKotor,
      hotlistNet: result.hotlistNet,
      pcsNet1: result.pcsNet1,
      sheetsNet1Allow: result.sheetsNet1Allow,
      wipSheet: result.wipSheet,
      wipPcs: result.wipPcs,
      sheetsNet2: result.sheetsNet2,
      kgNet2: result.kgNet2,
      allocatedKg,
      shortageKg: result.shortageKg,
      shortageSheet: result.shortageSheet,
      shortagePcs: result.shortagePcs,
      isSufficient: result.isSufficient,
      surplusKg: result.surplusKg,
      ukuran: part.ukuran,
      gramatur: part.gramatur,
      supplier: part.supplier,
      materialType: part.materialType,
      leadTimeMonths: part.leadTimeMonths,
      planningTimeline: getPlanningTimeline(part.leadTimeMonths, timelineBase),
      fm: part.fm,
      ups: part.ups,
    });
  }

  // ── 9. Kelompokkan per ukuran + gramatur + supplier ─────────────────────
  interface GroupAcc extends Omit<MaterialGroupResult, 'weeklyMatrix' | 'hasKg' | 'surplusSheet'> {}
  const groupMap = new Map<string, GroupAcc>();
  for (const pd of partDetails) {
    const groupKey = `${pd.ukuran}||${pd.gramatur}||${pd.supplier}`;
    let group = groupMap.get(groupKey);
    if (!group) {
      group = {
        ukuran: pd.ukuran,
        gramatur: pd.gramatur,
        supplier: pd.supplier,
        leadTimeMonths: pd.leadTimeMonths,
        planningTimeline: pd.planningTimeline,
        totalShortageSheet: 0,
        totalShortagePcs: 0,
        totalShortageKg: 0,
        isSufficient: true,
        surplusKg: 0,
        materialType: pd.materialType,
        details: [],
      };
      groupMap.set(groupKey, group);
    }
    group.details.push(pd);
    if (!pd.isSufficient) {
      group.totalShortageSheet = (group.totalShortageSheet || 0) + (pd.shortageSheet || 0);
      group.totalShortagePcs = (group.totalShortagePcs || 0) + (pd.shortagePcs || 0);
      group.totalShortageKg = (group.totalShortageKg || 0) + pd.shortageKg;
      group.isSufficient = false;
    } else {
      group.surplusKg = (group.surplusKg || 0) + (pd.surplusKg || 0);
    }
  }

  // ── 10. Tabel mingguan (kolom dari kalender MRP, bukan dari data demand) ─
  const weeklyByPart = new Map<string, { sheet: number[]; kg: number[] }>();
  for (const part of parts) {
    const sheet = new Array(weekCount).fill(0) as number[];
    const kg = new Array(weekCount).fill(0) as number[];
    for (const [wi, qty] of part.weekDemandPcs.entries()) {
      if (wi < 0 || wi >= weekCount) continue;
      const s = part.ups > 0 ? qty / part.ups : 0;
      sheet[wi] = s;
      kg[wi] = s * part.fm;
    }
    weeklyByPart.set(part.partNumber, { sheet, kg });
  }

  const buildMatrix = (g: GroupAcc): WeeklyMatrix => {
    const rows: WeeklyMatrixRow[] = g.details.map((d) => {
      const weekly = weeklyByPart.get(d.partNumber) ?? {
        sheet: new Array(weekCount).fill(0) as number[],
        kg: new Array(weekCount).fill(0) as number[],
      };
      const dims = parseDims(d.ukuran);
      return {
        partNumber: d.partNumber,
        productName: d.productName,
        gsm: d.gramatur,
        width: dims[0] ?? null,
        length: dims[1] ?? null,
        up: d.ups,
        hasKg: d.fm > 0,
        kgPerSheet: d.fm,
        weeks: weekly.kg,
        weeksSheet: weekly.sheet,
      };
    });

    const totalReqSheet = new Array(weekCount).fill(0) as number[];
    const totalReq = new Array(weekCount).fill(0) as number[];
    for (const r of rows) {
      for (let i = 0; i < weekCount; i += 1) {
        totalReqSheet[i] += r.weeksSheet[i] || 0;
        totalReq[i] += r.weeks[i] || 0;
      }
    }
    const allowanceSheet = totalReqSheet.map((v) => v * 0.05);
    const allowance = totalReq.map((v) => v * 0.05);
    const totalPlusAllowanceSheet = totalReqSheet.map((v, i) => v + allowanceSheet[i]);
    const totalPlusAllowance = totalReq.map((v, i) => v + allowance[i]);

    // Stock As Of = stok yang BENAR-BENAR teralokasi ke grup ini, bukan stok penuh.
    const stockAsOf = g.details.reduce((s, d) => s + (d.allocatedKg || 0), 0);
    const groupFm = g.details.find((d) => d.fm > 0)?.fm ?? 0;
    const stockAsOfSheet = groupFm > 0 ? stockAsOf / groupFm : 0;

    // Outstanding PO: hanya yang ukurannya cocok, di minggu kedatangannya.
    const gsm = parseGsm(g.gramatur);
    const groupWidth = parseDims(g.ukuran)[0] ?? null;
    const outstandingPo = new Array(weekCount).fill(0) as number[];
    const outstandingPoSheet = new Array(weekCount).fill(0) as number[];
    // Nomor PO tiap minggu, sejajar dengan `outstandingPo`. Satu nomor PO bisa
    // muncul beberapa kali di kolam (satu PO boleh mencakup beberapa item),
    // jadi di-dedupe per minggu. Hanya PO yang masih bersisa yang dicatat.
    const outstandingPoNumbers: string[][] = Array.from({ length: weekCount }, () => []);
    for (const item of pool) {
      if (item.source !== 'po') continue;
      if (matchSize(item.desc, gsm, groupWidth, options.toleranceCm) === null) continue;
      if (item.kgRemaining <= 1e-9 && item.sheetRemaining <= 1e-9) continue;
      const wi = Math.min(weekCount - 1, Math.max(0, item.availableWeek));
      outstandingPo[wi] += item.kgRemaining;
      // PO bersatuan kg tidak punya angka lembar. Konversi ke lembar memakai
      // Kg/Lbr grup supaya baris `Outstanding PO` (dan `End Ind`) terisi di
      // KEDUA satuan — sama seperti stok yang juga dikonversi lewat `groupFm`.
      // Tanpa ini, PO 5.000 kg hanya masuk array kg sehingga baris tabel
      // menampilkan "0 lbr / 0 kg" padahal PO-nya ada.
      outstandingPoSheet[wi] += item.sheetRemaining + (groupFm > 0 ? item.kgRemaining / groupFm : 0);
      const no = String(item.poNumber || '').trim();
      if (no && !outstandingPoNumbers[wi].includes(no)) outstandingPoNumbers[wi].push(no);
    }

    // End Ind = saldo berjalan minggu demi minggu.
    const endInd = new Array(weekCount).fill(0) as number[];
    const endIndSheet = new Array(weekCount).fill(0) as number[];
    let balanceKg = stockAsOf;
    let balanceSheet = stockAsOfSheet;
    for (let i = 0; i < weekCount; i += 1) {
      balanceKg = balanceKg + outstandingPo[i] - totalPlusAllowance[i];
      balanceSheet = balanceSheet + outstandingPoSheet[i] - totalPlusAllowanceSheet[i];
      endInd[i] = balanceKg;
      endIndSheet[i] = balanceSheet;
    }

    return {
      columns: weeks.map((w) => ({
        weekNumber: w.weekNumber,
        weekStartDate: w.weekStartDate,
        poMonthLabel: poMonthLabel(new Date(w.weekStartDate), g.leadTimeMonths),
      })),
      rows,
      summary: {
        totalReq,
        totalReqSheet,
        allowance,
        allowanceSheet,
        totalPlusAllowance,
        totalPlusAllowanceSheet,
        stockAsOf,
        stockAsOfSheet,
        outstandingPo,
        outstandingPoSheet,
        outstandingPoNumbers,
        endInd,
        endIndSheet,
      },
    };
  };

  const groups: MaterialGroupResult[] = [...groupMap.values()].map((g) => {
    const hasKg = g.details.some((d) => d.fm > 0);
    const surplusKg = g.isSufficient ? g.surplusKg : null;
    const groupFm = g.details.find((d) => d.fm > 0)?.fm ?? 0;
    return {
      ukuran: g.ukuran,
      gramatur: g.gramatur,
      supplier: g.supplier,
      leadTimeMonths: g.leadTimeMonths,
      planningTimeline: g.planningTimeline,
      totalShortageSheet: g.isSufficient ? null : Math.ceil(g.totalShortageSheet || 0),
      totalShortagePcs: g.isSufficient ? null : Math.ceil(g.totalShortagePcs || 0),
      totalShortageKg: g.isSufficient ? null : g.totalShortageKg,
      isSufficient: g.isSufficient,
      surplusKg,
      materialType: g.materialType,
      hasKg,
      surplusSheet: hasKg && groupFm > 0 && surplusKg !== null ? surplusKg / groupFm : null,
      details: g.details,
      weeklyMatrix: buildMatrix(g),
    };
  });

  const lastWeekEnd = weekBounds.get(weekCount - 1)?.end;
  const periodEndDate =
    lastWeekEnd ?? new Date(periodStart.getTime() + (weekCount * 7 - 1) * 86400000);

  return {
    periodStartDate: periodStart,
    periodEndDate,
    periodWeeks: weekCount,
    weekCount,
    weeks,
    groups,
    totals: {
      partCount: partDetails.length,
      partsWithoutNpof: partDetails.filter((p) => p.noNpofData).length,
      partsWithStock,
      allocatedKg: allocatedTotal,
    },
  };
}
