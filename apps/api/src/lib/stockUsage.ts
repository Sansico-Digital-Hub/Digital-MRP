/**
 * Monitoring penggunaan stok raw material per UKURAN.
 *
 * Menjawab: "dari stok yang ada di periode ini, berapa yang sudah dipakai
 * perhitungan dan berapa yang belum". Sumbernya BUKAN tabel baru:
 *   - kapasitas stok  -> tabel `stock_raw_materials` periode ini
 *   - jumlah terpakai -> snapshot hasil perhitungan aktif (`CycleResult`),
 *     tepatnya `groups[].weeklyMatrix.summary.stockDetails[]`.
 *
 * Satu lot bisa dipakai BEBERAPA ukuran sekaligus, jadi pemakaiannya harus
 * dijumlahkan lintas grup (inilah yang belum ada di halaman lain).
 *
 * Konversi satuan:
 *   - kg  : massa kekal, `allocatedKg` antar grup boleh langsung dijumlahkan.
 *   - sht : `allocatedSheet` dinyatakan dalam LEMBAR UKURAN GRUP, jadi lembar
 *           fisik lot = `allocatedSheet / multiplier` (lot 117 cm untuk
 *           kebutuhan 58,5 cm punya `multiplier` 2).
 *   - rim : 1 rim = `sheetsPerRim` lembar.
 */

import { parseDims, parseGsm } from './materialSizeMatch';
import { canonicalSupplier } from './supplierAlias';
import { KG_PER_TON, isKilogramUnit, isRimUnit, isSheetUnit, isTonUnit } from './stockUnits';

/** Baris stok apa adanya dari `stock_raw_materials` (hanya kolom yang dipakai). */
export interface StockUsageMasterRow {
  itemDesc: string;
  supplier: string | null;
  qty: number;
  unit: string | null;
}

/** Pemakaian satu lot oleh satu ukuran (grup) tujuan. */
export interface StockUsageAllocation {
  ukuran: string;
  gramatur: string;
  /** Supplier grup tujuan (nama kanonik). */
  supplier: string;
  /** Kg yang dipakai grup ini. */
  allocatedKg: number;
  /** Lembar dalam satuan ukuran grup ini. */
  allocatedSheet: number;
  /** `allocatedSheet / multiplier` = lembar fisik lot yang berkurang. */
  physicalSheet: number;
  multiplier: number;
  /** Part number yang dilayani grup ini. */
  parts: string[];
}

/** Ringkasan pemakaian satu material (= itemDesc + supplier, sama dengan pool kalkulasi). */
export interface StockUsageItem {
  /** `itemDesc||supplier-kanonik` — sama dengan `poolRef` di snapshot. */
  key: string;
  itemDesc: string;
  supplier: string;
  /** Semua tulisan supplier mentah yang tergabung ke item ini. */
  supplierAliases: string[];
  /** Kunci baris tabel stok (`itemDesc||supplier-mentah`) untuk pencocokan di UI. */
  matchKeys: string[];
  width: number | null;
  length: number | null;
  gsm: number | null;
  form: 'roll' | 'sheet' | 'mixed' | 'unknown';
  /** Jumlah baris lot di Master Data. */
  lots: number;
  totalKg: number;
  totalSheet: number;
  /** Kg per lembar. `null` = ukuran/gramatur tidak terbaca dari deskripsi. */
  kgPerSheet: number | null;
  /** `dimension` = dihitung dari P×L×gramatur, `usage` = diturunkan dari pemakaian. */
  sheetKgBasis: 'dimension' | 'usage' | 'unknown';
  /** Total stok dalam kg (kg + lembar × kg/lembar). */
  capacityKg: number;
  /** Kg yang sudah dipakai perhitungan. */
  usedKg: number;
  /** Lembar fisik yang sudah dipakai. */
  usedSheet: number;
  /** 0..1. `null` = kapasitas tidak bisa dinyatakan dalam kg. */
  usedPct: number | null;
  remainingKg: number;
  remainingSheet: number;
  /** Bagian yang dikeluarkan user dari perhitungan (informasi). */
  excludedKg: number;
  /** Estimasi waste dari bagian yang terpakai (informasi). */
  wasteKg: number;
  /** Material ini muncul di hasil perhitungan (walau tidak terpakai). */
  seenInResult: boolean;
  /** Pemakaian melebihi stok — biasanya karena stok diedit setelah perhitungan. */
  overAllocated: boolean;
  /** Satuan yang tidak dikenali; angkanya sementara dihitung sebagai kg. */
  unknownUnits: string[];
  allocations: StockUsageAllocation[];
}

export interface StockUsageTotals {
  materials: number;
  lots: number;
  totalKg: number;
  capacityKg: number;
  usedKg: number;
  remainingKg: number;
  usedPct: number;
  /** Material yang sama sekali belum terpakai. */
  unusedMaterials: number;
  /** Material yang sudah terpakai sebagian. */
  partialMaterials: number;
  /** Material yang stoknya habis terpakai. */
  usedUpMaterials: number;
}

export interface StockUsageResult {
  items: StockUsageItem[];
  totals: StockUsageTotals;
}

const EPSILON = 1e-9;

/**
 * Toleransi "pemakaian melebihi stok" (1%).
 *
 * Kg/lembar di sini dihitung dari P × L × gramatur pada deskripsi item,
 * sedangkan `allocatedKg` hasil perhitungan memakai `fm` dari NPOF/fomula.
 * Selisih pembulatan keduanya nyata (mis. 6.382,125 vs 6.382,25 kg untuk
 * 25.000 lembar) dan TIDAK boleh dilaporkan sebagai "melebihi stok".
 */
const OVER_ALLOCATION_TOLERANCE = 0.01;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const trimmed = (value: unknown): string => String(value ?? '').trim();

/** Kunci material yang dipakai engine saat membangun kolam (`poolRef` stok). */
const materialKey = (itemDesc: unknown, supplier: unknown): string =>
  `${trimmed(itemDesc)}||${canonicalSupplier(trimmed(supplier))}`;

/** Kg per lembar dari dimensi cm + gramatur: `P × L (cm²) × gsm / 1e7`. */
const kgPerSheetFromDimension = (
  width: number | null,
  length: number | null,
  gsm: number | null,
): number | null => {
  if (width === null || length === null || gsm === null) return null;
  const kg = (width * length * gsm) / 1e7;
  return kg > 0 ? kg : null;
};

interface MasterAccumulator {
  key: string;
  itemDesc: string;
  suppliers: Set<string>;
  kg: number;
  sheet: number;
  lots: number;
  unknownUnits: Set<string>;
}

interface UsageAccumulator {
  kgFromKgPart: number;
  kgFromSheetPart: number;
  physicalSheet: number;
  excludedKg: number;
  wasteKg: number;
  form: StockUsageItem['form'] | null;
  allocations: StockUsageAllocation[];
}

/**
 * Bangun ringkasan pemakaian dari baris stok + snapshot hasil perhitungan.
 *
 * Murni (tanpa akses DB) supaya bisa diverifikasi lewat skrip.
 * Material yang TIDAK muncul di snapshot tetap dikembalikan dengan pemakaian 0 —
 * kalau hanya membaca snapshot, material yang ukurannya tidak cocok dengan
 * kebutuhan mana pun akan hilang dari laporan.
 */
export function buildStockUsage(params: {
  rows: readonly StockUsageMasterRow[];
  resultSnapshot: unknown;
  sheetsPerRim: number;
}): StockUsageResult {
  const { rows, resultSnapshot } = params;
  const sheetsPerRim = params.sheetsPerRim > 0 ? params.sheetsPerRim : 500;

  // ── 1. Kapasitas stok per material (itemDesc + supplier kanonik) ──────
  const materialMap = new Map<string, MasterAccumulator>();
  for (const row of rows) {
    const key = materialKey(row.itemDesc, row.supplier);
    let acc = materialMap.get(key);
    if (!acc) {
      acc = {
        key,
        itemDesc: trimmed(row.itemDesc),
        suppliers: new Set<string>(),
        kg: 0,
        sheet: 0,
        lots: 0,
        unknownUnits: new Set<string>(),
      };
      materialMap.set(key, acc);
    }
    acc.suppliers.add(trimmed(row.supplier));
    acc.lots += 1;

    const qty = num(row.qty);
    const rawUnit = trimmed(row.unit);
    const unit = rawUnit.toLowerCase();
    if (isSheetUnit(unit)) acc.sheet += qty;
    else if (isRimUnit(unit)) acc.sheet += qty * sheetsPerRim;
    else if (isTonUnit(unit)) acc.kg += qty * KG_PER_TON;
    else if (isKilogramUnit(unit)) acc.kg += qty;
    else {
      // Satuan kosong / tak dikenal: sementara dihitung kg, tapi dilaporkan
      // supaya user sadar ada baris yang satuannya perlu dibetulkan.
      acc.kg += qty;
      acc.unknownUnits.add(rawUnit === '' ? '(kosong)' : rawUnit);
    }
  }

  // ── 2. Pemakaian per material dari snapshot hasil perhitungan ─────────
  const usageMap = new Map<string, UsageAccumulator>();
  const groups = ((resultSnapshot as Record<string, unknown> | null)?.groups ?? []) as Array<
    Record<string, unknown>
  >;

  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const ukuran = String(group.ukuran ?? '');
    const gramatur = String(group.gramatur ?? '');
    const groupSupplier = canonicalSupplier(String(group.supplier ?? ''));
    const groupDetails = (group.details ?? []) as Array<Record<string, unknown>>;
    const parts = groupDetails.map((d) => String(d.partNumber ?? '')).filter(Boolean);
    const groupFm = groupDetails.map((d) => num(d.fm)).find((fm) => fm > 0) ?? 0;

    const summary = (group.weeklyMatrix as Record<string, unknown> | undefined)?.summary as
      | Record<string, unknown>
      | undefined;
    const stockDetails = (summary?.stockDetails ?? []) as Array<Record<string, unknown>>;

    for (const detail of stockDetails) {
      if (!detail || typeof detail !== 'object') continue;
      const key = materialKey(detail.desc, detail.supplier);
      let acc = usageMap.get(key);
      if (!acc) {
        acc = {
          kgFromKgPart: 0,
          kgFromSheetPart: 0,
          physicalSheet: 0,
          excludedKg: 0,
          wasteKg: 0,
          form: null,
          allocations: [],
        };
        usageMap.set(key, acc);
      }

      const allocatedKg = num(detail.allocatedKg);
      const allocatedSheet = num(detail.allocatedSheet);
      const multiplier = Math.max(1, num(detail.multiplier) || 1);
      // `allocatedKg` = bagian kg + (lembar × kg/lembar grup). Dipisah supaya
      // material lembaran tetap bisa dilaporkan walau kg/lembar tidak diketahui.
      const kgFromSheetPart = groupFm > 0 ? allocatedSheet * groupFm : 0;
      acc.kgFromSheetPart += kgFromSheetPart;
      acc.kgFromKgPart += Math.max(0, allocatedKg - kgFromSheetPart);
      acc.physicalSheet += allocatedSheet / multiplier;
      acc.excludedKg += num(detail.excludedKg);
      acc.wasteKg += num(detail.wasteKg);
      acc.form = (detail.form as StockUsageItem['form']) ?? acc.form;

      if (allocatedKg > EPSILON || allocatedSheet > EPSILON) {
        acc.allocations.push({
          ukuran,
          gramatur,
          supplier: groupSupplier,
          allocatedKg,
          allocatedSheet,
          physicalSheet: allocatedSheet / multiplier,
          multiplier,
          parts: [...parts],
        });
      }
    }
  }

  // ── 3. Gabungkan ──────────────────────────────────────────────────────
  const items: StockUsageItem[] = [];
  for (const acc of materialMap.values()) {
    const dims = parseDims(acc.itemDesc);
    const width = dims[0] ?? null;
    const length = dims[1] ?? null;
    const gsm = parseGsm(acc.itemDesc);
    const usage = usageMap.get(acc.key);

    const usedKgRaw = (usage?.kgFromKgPart ?? 0) + (usage?.kgFromSheetPart ?? 0);
    const usedSheet = usage?.physicalSheet ?? 0;

    let kgPerSheet = kgPerSheetFromDimension(width, length, gsm);
    let sheetKgBasis: StockUsageItem['sheetKgBasis'] = kgPerSheet === null ? 'unknown' : 'dimension';
    if (kgPerSheet === null && usedSheet > EPSILON && usedKgRaw > EPSILON) {
      kgPerSheet = usedKgRaw / usedSheet;
      sheetKgBasis = 'usage';
    }

    const capacityKg = acc.kg + (kgPerSheet ?? 0) * acc.sheet;
    const usedKg = usedKgRaw;
    const remainingKg = Math.max(0, capacityKg - usedKg);
    const remainingSheet = Math.max(0, acc.sheet - usedSheet);
    const usedPct =
      capacityKg > EPSILON
        ? Math.min(1, usedKg / capacityKg)
        : acc.sheet > EPSILON
          ? Math.min(1, usedSheet / acc.sheet)
          : null;

    const form: StockUsageItem['form'] =
      usage?.form ??
      (acc.kg > EPSILON && acc.sheet > EPSILON
        ? 'mixed'
        : acc.sheet > EPSILON
          ? 'sheet'
          : acc.kg > EPSILON
            ? dims.length >= 2
              ? 'sheet'
              : 'roll'
            : 'unknown');

    const matchKeys = new Set<string>();
    for (const raw of acc.suppliers) {
      matchKeys.add(`${acc.itemDesc}||${raw}`);
      matchKeys.add(`${acc.itemDesc}||${raw.trim()}`);
    }

    items.push({
      key: acc.key,
      itemDesc: acc.itemDesc,
      supplier: canonicalSupplier([...acc.suppliers][0] ?? ''),
      supplierAliases: [...acc.suppliers].filter(Boolean),
      matchKeys: [...matchKeys],
      width,
      length,
      gsm,
      form,
      lots: acc.lots,
      totalKg: acc.kg,
      totalSheet: acc.sheet,
      kgPerSheet,
      sheetKgBasis,
      capacityKg,
      usedKg,
      usedSheet,
      usedPct,
      remainingKg,
      remainingSheet,
      excludedKg: usage?.excludedKg ?? 0,
      wasteKg: usage?.wasteKg ?? 0,
      seenInResult: usage !== undefined,
      overAllocated:
        capacityKg > EPSILON && usedKg > capacityKg * (1 + OVER_ALLOCATION_TOLERANCE) + 1e-6,
      unknownUnits: [...acc.unknownUnits],
      allocations: (usage?.allocations ?? []).sort(
        (a, b) => b.allocatedKg - a.allocatedKg || a.ukuran.localeCompare(b.ukuran),
      ),
    });
  }

  items.sort(
    (a, b) =>
      b.capacityKg - a.capacityKg ||
      b.totalKg - a.totalKg ||
      a.itemDesc.localeCompare(b.itemDesc) ||
      a.supplier.localeCompare(b.supplier),
  );

  const capacityKg = items.reduce((sum, i) => sum + i.capacityKg, 0);
  const usedKg = items.reduce((sum, i) => sum + i.usedKg, 0);
  const totals: StockUsageTotals = {
    materials: items.length,
    lots: items.reduce((sum, i) => sum + i.lots, 0),
    totalKg: items.reduce((sum, i) => sum + i.totalKg, 0),
    capacityKg,
    usedKg,
    remainingKg: items.reduce((sum, i) => sum + i.remainingKg, 0),
    usedPct: capacityKg > EPSILON ? Math.min(1, usedKg / capacityKg) : 0,
    unusedMaterials: items.filter((i) => i.usedKg <= 1e-6 && i.usedSheet <= 1e-6).length,
    partialMaterials: items.filter(
      (i) =>
        (i.usedKg > 1e-6 || i.usedSheet > 1e-6) &&
        i.remainingKg > 1e-6 &&
        !i.overAllocated,
    ).length,
    usedUpMaterials: items.filter(
      (i) => i.overAllocated || (i.remainingKg <= 1e-6 && (i.usedKg > 1e-6 || i.usedSheet > 1e-6)),
    ).length,
  };

  return { items, totals };
}
