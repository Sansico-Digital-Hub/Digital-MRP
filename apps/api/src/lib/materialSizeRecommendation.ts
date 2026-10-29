/**
 * Rekomendasi ukuran material + estimasi waste.
 *
 * Fitur ini HANYA MENAMBAH INFORMASI. Alokasi stok/PO, Hotlist, allowance,
 * WIP, `shortage`, `Stock As Of`, dan `End Ind` tetap dihitung oleh
 * `materialCalcEngine.ts` dengan rumus yang sama seperti sebelumnya. Modul ini
 * murni membaca hasil alokasi lalu menghitung:
 *
 *   - kelebihan ukuran material dibanding ukuran kebutuhan (trim, cm)
 *   - waste per lembar (kg & %)
 *   - waste pembelian (atas kekurangan yang perlu dibeli)
 *   - waste produksi (atas seluruh kebutuhan produksi bersih)
 *
 * PENTING (keputusan user 2026-10-28): trim TIDAK mengurangi alokasi. Karena
 * itu semua angka waste di sini bersifat informasi dan diberi catatan
 * "trim belum diperhitungkan" di UI.
 *
 * Modul ini tidak mengakses database dan tidak memutasi `pool` / `consumptions`
 * milik pemanggil (semua perhitungan memakai salinan nilai).
 */

import {
  MAX_SIZE_MULTIPLIER,
  NEBENG_PATTERN,
  matchSize,
  parseDims,
  parseGsm,
} from './materialSizeMatch';
import { supplierOk } from './supplierAlias';

// ============================================
// Tipe
// ============================================

/** Asal ukuran yang direkomendasikan. */
export type RecommendationSource = 'stock' | 'po' | 'npof' | 'standard' | 'need';

/** Bentuk material: gulungan (1 dimensi) atau lembaran (2 dimensi). */
export type RecommendationForm = 'roll' | 'sheet';

/** Satu perhitungan waste (dipakai untuk pembelian & produksi). */
export interface WasteBasis {
  /** Qty kebutuhan (lembar) yang menjadi dasar perhitungan. */
  qtySheet: number;
  /** Jumlah satuan material yang disediakan (lembar; pecahan untuk gulungan). */
  stockUnits: number;
  /** Kg material yang dipakai/dibeli. */
  kgMaterial: number;
  /** Kg yang benar-benar menjadi produk (tanpa trim). */
  kgUsed: number;
  /** Waste karena kelebihan ukuran. */
  trimWasteKg: number;
  /** Waste karena pembulatan ke satuan utuh (lembaran). */
  roundingWasteKg: number;
  /** Total = trim + pembulatan. */
  wasteKg: number;
  /** `wasteKg / kgMaterial` (0..1). */
  wastePct: number;
}

export interface SizeRecommendation {
  /** Ukuran dalam teks, mis. `117 × 92 cm` (atau `180 cm` untuk gulungan). */
  size: string;
  width: number | null;
  length: number | null;
  form: RecommendationForm;
  source: RecommendationSource;
  /** Nama supplier pemilik ukuran ini (sudah kanonik). */
  supplier: string;
  /** Rujukan asal: `poolRef` lot stok / id baris PO / deskripsi NPOF. */
  sourceRefs: string[];
  /** 1 = ukuran sama; 2..N = ukuran kelipatan (dipotong N lane). */
  multiplier: number;
  /** Kelebihan lebar setelah dibagi `multiplier` (cm). */
  trimWidthCm: number;
  /** Kelebihan panjang (cm); 0 untuk gulungan. */
  trimLengthCm: number;
  /** Luas material yang terbuang per lembar material (cm²); 0 untuk gulungan. */
  wasteAreaCm2: number;
  /** Rata-rata waste per lembar kebutuhan (kg). */
  wastePerSheetKg: number;
  /** Waste ukuran per lembar (0..1) — murni geometri, tanpa pembulatan. */
  wastePctPerSheet: number;
  /** Waste atas kekurangan yang perlu dibeli. */
  purchase: WasteBasis;
  /** Waste atas seluruh kebutuhan produksi bersih. */
  production: WasteBasis;
  /** Sisa material yang masih tersedia untuk grup ini (kg). */
  availableKg: number;
  /** Sisa material yang masih tersedia untuk grup ini (lembar fisik). */
  availableSheet: number;
  /** true = material sudah ada di gudang (stok). */
  availableNow: boolean;
  /** Minggu kedatangan PO (0-based); null untuk stok/NPOF/standar. */
  arrivalWeek: number | null;
  /** true = bisa dipakai tanpa menunggu melewati kebutuhan pertama. */
  feasible: boolean;
  /** Catatan tambahan untuk UI (kode, bukan teks jadi). */
  notes: RecommendationNote[];
}

export type RecommendationNote =
  | 'trim-not-applied'
  | 'arrives-late'
  | 'new-purchase'
  | 'no-quantity'
  | 'size-multiplied'
  | 'baseline';

export interface GroupSizeRecommendation {
  groupKey: string;
  needWidth: number | null;
  needLength: number | null;
  needGsm: number | null;
  /** Total kekurangan yang perlu dibeli (lembar). */
  purchaseQtySheet: number;
  /** Total kebutuhan produksi bersih (lembar). */
  productionQtySheet: number;
  /** Rekomendasi teratas (paling layak + waste terkecil). */
  best: SizeRecommendation | null;
  /** Ukuran pas (waste 0%) sebagai pembanding; null bila ukuran tak terbaca. */
  baseline: SizeRecommendation | null;
  /** Alternatif terurut, maksimal `maxOptions`. */
  options: SizeRecommendation[];
  /** Alasan bila tidak ada rekomendasi. */
  emptyReason?: 'nebeng' | 'no-dimension' | 'no-gsm' | 'no-quantity' | 'no-candidate';
}

export interface RecommendationPartInput {
  partNumber: string;
  /** kg per lembar ukuran kebutuhan. */
  fm: number;
  /** Kebutuhan produksi bersih part (lembar) — boleh negatif. */
  sheetsNet2: number;
  /** Kekurangan yang perlu dibeli (lembar); null = tercukupi. */
  shortageSheet: number | null;
  /** Minggu pertama kebutuhan part (0-based). */
  firstNeedWeek: number | null;
}

export interface RecommendationPoolInput {
  /** Kunci pool item (`stock|...` / `po|n`) — sama dengan `AllocationConsumption.key`. */
  key: string;
  /** Identitas stabil untuk pengecualian (`poolRefOf`). */
  poolRef: string;
  desc: string;
  supplier: string;
  source: 'stock' | 'po';
  availableWeek: number;
  kgRemaining: number;
  sheetRemaining: number;
  poNumber: string | null;
  /** true = seluruh pool item dikeluarkan user untuk grup ini. */
  excluded: boolean;
  /** Bagian yang dikeluarkan sebagian (kg). */
  excludedKg: number;
  /** Bagian yang dikeluarkan sebagian (lembar). */
  excludedSheet: number;
}

export interface RecommendationConsumptionInput {
  key: string;
  fromKg: number;
  /** Lembar dalam UKURAN KEBUTUHAN (bukan lembar fisik). */
  fromSheet: number;
  multiplier: number;
}

export interface RecommendationNpofSizeInput {
  size: string;
  gsm: number | null;
  supplier: string;
}

export interface RecommendationOptions {
  toleranceCm: number;
  requireSupplierMatch: boolean;
  /** Jumlah alternatif yang dikembalikan. */
  maxOptions: number;
  /** Kelipatan maksimum yang diuji (default `MAX_SIZE_MULTIPLIER`). */
  maxMultiplier: number;
  /** Sertakan ukuran dari NPOF yang belum ada di stok/PO. */
  includeNpof: boolean;
  /** Ukuran standar (cm) yang selalu dipertimbangkan, mis. `[180]`. */
  standardSizes: number[];
}

export interface RecommendationInput {
  groupKey: string;
  ukuran: string;
  gramatur: string;
  supplier: string;
  parts: RecommendationPartInput[];
  pool: RecommendationPoolInput[];
  consumptions: RecommendationConsumptionInput[];
  npofSizes: RecommendationNpofSizeInput[];
  options: RecommendationOptions;
}

// ============================================
// Helper
// ============================================

const EPS = 1e-9;

/** Bulatkan ke 6 desimal supaya JSON hasil tidak penuh derau float. */
const r6 = (value: number): number => (Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : 0);

const numberText = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

function sizeLabel(width: number, length: number | null): string {
  return length !== null ? `${numberText(width)} × ${numberText(length)} cm` : `${numberText(width)} cm`;
}

/**
 * Kelipatan potongan untuk material yang hanya diketahui LEBARNYA (mis. ukuran
 * standar `180 cm`). Aturannya sama dengan `matchSize()`: selisih setelah
 * dibagi kelipatan harus berada dalam toleransi; 1 = ukuran pas/lebih besar
 * sedikit, 2..N = dibelah N lane.
 */
function multiplierForWidth(
  width: number,
  needWidth: number,
  toleranceCm: number,
  maxMultiplier: number,
): number | null {
  const delta = width - needWidth;
  if (delta >= -EPS && delta <= toleranceCm + EPS) return 1;
  for (let multiplier = 2; multiplier <= maxMultiplier; multiplier += 1) {
    const slicedDelta = width / multiplier - needWidth;
    if (slicedDelta >= -EPS && slicedDelta <= toleranceCm + EPS) return multiplier;
  }
  return null;
}

/**
 * Rasio luas (atau lebar, untuk gulungan) material terhadap ukuran kebutuhan.
 * Dipakai bersama oleh rekomendasi dan oleh perhitungan waste pemakaian nyata
 * (lot stok / PO yang benar-benar terpakai satu grup).
 */
export function sizeRatio(
  stockWidth: number | null,
  stockLength: number | null,
  needWidth: number | null,
  needLength: number | null,
): number {
  if (stockWidth === null || needWidth === null || needWidth <= EPS) return 1;
  if (stockLength !== null && needLength !== null) {
    const needArea = needWidth * needLength;
    if (needArea > EPS) {
      const ratio = (stockWidth * stockLength) / needArea;
      /**
       * Rasio luas TIDAK BOLEH < 1: kalau itu terjadi, angka "panjang" bukan
       * dimensi sungguhan — mis. deskripsi `DUPLEX 450GSM/ 69CM (27")` yang
       * angka 27 adalah satuan inci, bukan panjang kertas. Dalam kasus seperti
       * ini kembali ke perbandingan LEBAR saja, sama seperti cara alokasi
       * mencocokkan material tersebut.
       */
      if (ratio >= 1 - 1e-9) return ratio;
    }
  }
  // Gulungan / sisi lain tidak sebanding: bandingkan lebar saja, jangan
  // mencampur luas (2 dimensi) dengan lebar (1 dimensi).
  return Math.max(1, stockWidth / needWidth);
}

/**
 * Waste dari material yang BENAR-BENAR terpakai (lot stok / PO).
 *
 * `usedKg`     = kg yang menjadi PRODUK (bagian yang teralokasi ke ukuran grup).
 * `ratio`      = luas material ÷ luas kebutuhan (lihat `sizeRatio`).
 * `multiplier` = jumlah potong ukuran kebutuhan per satuan material.
 *
 * Untuk menghasilkan `usedKg` produk dari material yang lebih besar, dibutuhkan
 * `usedKg × ratio / multiplier` kg material; selisihnya adalah trim.
 *
 * Contoh: 1.575 kg produk dari roll 60 cm untuk kebutuhan 59 cm →
 *   waste 26,69 kg, yaitu 1,67% dari material yang dipakai (1.601,69 kg).
 */
export function wasteOfUsage(
  usedKg: number,
  ratio: number,
  multiplier: number,
): { wasteKg: number; wastePct: number } {
  const m = Math.max(1, multiplier);
  if (!(usedKg > EPS) || !(ratio > EPS)) return { wasteKg: 0, wastePct: 0 };
  const materialPerProduct = ratio / m;
  const wastePct = Math.max(0, 1 - m / ratio);
  return { wasteKg: r6(usedKg * (materialPerProduct - 1)), wastePct };
}

function emptyBasis(): WasteBasis {
  return {
    qtySheet: 0,
    stockUnits: 0,
    kgMaterial: 0,
    kgUsed: 0,
    trimWasteKg: 0,
    roundingWasteKg: 0,
    wasteKg: 0,
    wastePct: 0,
  };
}

/**
 * Hitung satu basis waste untuk satu part.
 *
 * `ratio` = luas material ÷ luas kebutuhan (= 1 bila ukuran sama). Satu satuan
 * material menyediakan `ratio / multiplier` kali material satu lembar kebutuhan,
 * sehingga kg material per lembar kebutuhan = `fm × ratio / multiplier`.
 * Untuk gulungan satuannya kg, jadi `stockUnits` tidak dibulatkan ke atas.
 */
function basisForPart(
  fm: number,
  qtySheet: number,
  ratio: number,
  multiplier: number,
  form: RecommendationForm,
): WasteBasis {
  if (!(qtySheet > 0) || !(fm > 0) || !(ratio > 0) || !(multiplier > 0)) return emptyBasis();

  const perNeedKg = (fm * ratio) / multiplier;
  const stockUnits =
    form === 'sheet' ? Math.ceil(qtySheet / multiplier - 1e-9) : qtySheet / multiplier;
  const kgMaterial = stockUnits * fm * ratio;
  const kgUsed = qtySheet * fm;
  const trimWasteKg = qtySheet * (perNeedKg - fm);
  // Selisih yang tersisa (hanya muncul pada pembulatan lembar).
  const roundingWasteKg = Math.max(0, kgMaterial - kgUsed - trimWasteKg);

  return {
    qtySheet: r6(qtySheet),
    stockUnits: r6(stockUnits),
    kgMaterial: r6(kgMaterial),
    kgUsed: r6(kgUsed),
    trimWasteKg: r6(trimWasteKg),
    roundingWasteKg: r6(roundingWasteKg),
    wasteKg: r6(trimWasteKg + roundingWasteKg),
    wastePct: kgMaterial > EPS ? (trimWasteKg + roundingWasteKg) / kgMaterial : 0,
  };
}

function sumBasis(list: WasteBasis[]): WasteBasis {
  const total = emptyBasis();
  for (const b of list) {
    total.qtySheet += b.qtySheet;
    total.stockUnits += b.stockUnits;
    total.kgMaterial += b.kgMaterial;
    total.kgUsed += b.kgUsed;
    total.trimWasteKg += b.trimWasteKg;
    total.roundingWasteKg += b.roundingWasteKg;
    total.wasteKg += b.wasteKg;
  }
  total.qtySheet = r6(total.qtySheet);
  total.stockUnits = r6(total.stockUnits);
  total.kgMaterial = r6(total.kgMaterial);
  total.kgUsed = r6(total.kgUsed);
  total.trimWasteKg = r6(total.trimWasteKg);
  total.roundingWasteKg = r6(total.roundingWasteKg);
  total.wasteKg = r6(total.wasteKg);
  total.wastePct = total.kgMaterial > EPS ? total.wasteKg / total.kgMaterial : 0;
  return total;
}

/** Kandidat ukuran hasil agregasi (satu baris = satu ukuran + satu sumber). */
interface Candidate {
  key: string;
  width: number;
  length: number | null;
  form: RecommendationForm;
  source: RecommendationSource;
  supplier: string;
  multiplier: number;
  availableKg: number;
  availableSheet: number;
  arrivalWeek: number | null;
  sourceRefs: string[];
}

// ============================================
// Builder
// ============================================

export function buildGroupRecommendation(input: RecommendationInput): GroupSizeRecommendation {
  const { ukuran, gramatur, supplier, parts, options } = input;
  const maxMultiplier = Math.max(1, options.maxMultiplier || MAX_SIZE_MULTIPLIER);

  const needDims = parseDims(ukuran);
  const needWidth = needDims[0] ?? null;
  const needLength = needDims[1] ?? null;
  const needGsm = parseGsm(gramatur);

  const purchaseQtySheet = r6(
    parts.reduce((sum, p) => sum + Math.max(0, p.shortageSheet ?? 0), 0),
  );
  const productionQtySheet = r6(parts.reduce((sum, p) => sum + Math.max(0, p.sheetsNet2), 0));

  const firstNeedWeek = parts.reduce<number | null>((min, p) => {
    if (p.firstNeedWeek === null) return min;
    return min === null || p.firstNeedWeek < min ? p.firstNeedWeek : min;
  }, null);

  const result: GroupSizeRecommendation = {
    groupKey: input.groupKey,
    needWidth,
    needLength,
    needGsm,
    purchaseQtySheet,
    productionQtySheet,
    best: null,
    baseline: null,
    options: [],
  };

  // Ukuran yang sengaja tidak dihitung (nebeng / satu layout).
  if (NEBENG_PATTERN.test(ukuran)) return { ...result, emptyReason: 'nebeng' };
  if (needWidth === null) return { ...result, emptyReason: 'no-dimension' };
  if (needGsm === null) return { ...result, emptyReason: 'no-gsm' };

  const baseline = makeBaseline(needWidth, needLength, needGsm, supplier, parts);
  result.baseline = baseline;

  if (purchaseQtySheet <= EPS && productionQtySheet <= EPS) {
    return { ...result, emptyReason: 'no-quantity' };
  }

  // ── Pemakaian nyata per pool item (tidak memutasi data pemanggil) ────────
  const usedByPool = new Map<string, { kg: number; sheet: number }>();
  for (const c of input.consumptions) {
    const cur = usedByPool.get(c.key) ?? { kg: 0, sheet: 0 };
    cur.kg += c.fromKg;
    cur.sheet += c.fromSheet / Math.max(1, c.multiplier);
    usedByPool.set(c.key, cur);
  }

  // ── Kandidat dari stok & PO ──────────────────────────────────────────────
  const candidates = new Map<string, Candidate>();
  const sizesSeen = new Set<string>();

  const addCandidate = (
    width: number,
    length: number | null,
    form: RecommendationForm,
    source: RecommendationSource,
    candidateSupplier: string,
    multiplier: number,
    availableKg: number,
    availableSheet: number,
    arrivalWeek: number | null,
    ref: string,
  ) => {
    const key = `${form}|${width}|${length ?? 0}|${source}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.availableKg += availableKg;
      existing.availableSheet += availableSheet;
      if (arrivalWeek !== null) {
        existing.arrivalWeek =
          existing.arrivalWeek === null ? arrivalWeek : Math.min(existing.arrivalWeek, arrivalWeek);
      }
      if (ref && !existing.sourceRefs.includes(ref)) existing.sourceRefs.push(ref);
      return;
    }
    candidates.set(key, {
      key,
      width,
      length,
      form,
      source,
      supplier: candidateSupplier,
      multiplier,
      availableKg,
      availableSheet,
      arrivalWeek,
      sourceRefs: ref ? [ref] : [],
    });
  };

  for (const item of input.pool) {
    if (!supplierOk(item.supplier, supplier, options.requireSupplierMatch)) continue;
    const match = matchSize(item.desc, needGsm, needWidth, options.toleranceCm, needLength, maxMultiplier);
    if (!match) continue;
    const dims = parseDims(item.desc);
    const width = dims[0];
    if (width === undefined) continue;
    const length = dims[1] ?? null;
    const form: RecommendationForm = length !== null ? 'sheet' : 'roll';

    sizesSeen.add(`${form}|${width}|${length ?? 0}`);

    // Material yang dikeluarkan user untuk grup ini tidak boleh dihitung
    // sebagai ketersediaan.
    if (item.excluded) continue;
    const used = usedByPool.get(item.key) ?? { kg: 0, sheet: 0 };
    const availableKg = Math.max(0, item.kgRemaining - used.kg - item.excludedKg);
    const availableSheet = Math.max(0, item.sheetRemaining - used.sheet - item.excludedSheet);
    if (availableKg <= EPS && availableSheet <= EPS) continue;

    addCandidate(
      width,
      length,
      form,
      item.source,
      item.supplier,
      match.multiplier,
      availableKg,
      availableSheet,
      item.source === 'po' ? item.availableWeek : null,
      item.poNumber || item.poolRef,
    );
  }

  // ── Kandidat dari NPOF (ukuran yang pernah dipakai, belum tentu ada stok) ──
  if (options.includeNpof) {
    for (const npof of input.npofSizes) {
      if (!npof.size) continue;
      if (!supplierOk(npof.supplier, supplier, options.requireSupplierMatch)) continue;
      const match = matchSize(npof.size, needGsm, needWidth, options.toleranceCm, needLength, maxMultiplier);
      if (!match) continue;
      const dims = parseDims(npof.size);
      const width = dims[0];
      if (width === undefined) continue;
      const length = dims[1] ?? null;
      const form: RecommendationForm = length !== null ? 'sheet' : 'roll';
      if (sizesSeen.has(`${form}|${width}|${length ?? 0}`)) continue;
      sizesSeen.add(`${form}|${width}|${length ?? 0}`);
      addCandidate(width, length, form, 'npof', npof.supplier, match.multiplier, 0, 0, null, npof.size.trim());
    }
  }

  // ── Kandidat ukuran standar (mis. jumbo roll 180 cm) ────────────────────
  for (const cm of options.standardSizes ?? []) {
    if (!(cm > 0)) continue;
    const multiplier = multiplierForWidth(cm, needWidth, options.toleranceCm, maxMultiplier);
    if (multiplier === null) continue;
    const form: RecommendationForm = 'roll';
    if (sizesSeen.has(`${form}|${cm}|0`)) continue;
    sizesSeen.add(`${form}|${cm}|0`);
    addCandidate(cm, null, form, 'standard', supplier, multiplier, 0, 0, null, `standard-${cm}`);
  }

  // ── Hitung metrik tiap kandidat ─────────────────────────────────────────
  const evaluated: SizeRecommendation[] = [];
  for (const c of candidates.values()) {
    evaluated.push(evaluateCandidate(c, parts, needWidth, needLength, firstNeedWeek));
  }

  evaluated.sort(compareCandidates);

  const maxOptions = Math.max(1, options.maxOptions || 8);
  result.options = evaluated.slice(0, maxOptions);
  result.best = evaluated[0] ?? null;
  if (!result.best) result.emptyReason = 'no-candidate';

  return result;
}

/**
 * Ukuran pas (waste 0%) sebagai pembanding. Tidak pernah dianggap "tersedia":
 * tujuannya hanya menunjukkan bahwa ukuran ideal memang tidak menghasilkan waste.
 */
function makeBaseline(
  needWidth: number,
  needLength: number | null,
  needGsm: number,
  supplier: string,
  parts: RecommendationPartInput[],
): SizeRecommendation {
  const form: RecommendationForm = needLength !== null ? 'sheet' : 'roll';
  return {
    size: sizeLabel(needWidth, needLength),
    width: needWidth,
    length: needLength,
    form,
    source: 'need',
    supplier,
    sourceRefs: [],
    multiplier: 1,
    trimWidthCm: 0,
    trimLengthCm: 0,
    wasteAreaCm2: 0,
    wastePerSheetKg: 0,
    wastePctPerSheet: 0,
    purchase: sumBasis(
      parts.map((p) => basisForPart(p.fm, Math.max(0, p.shortageSheet ?? 0), 1, 1, form)),
    ),
    production: sumBasis(parts.map((p) => basisForPart(p.fm, Math.max(0, p.sheetsNet2), 1, 1, form))),
    availableKg: 0,
    availableSheet: 0,
    availableNow: false,
    arrivalWeek: null,
    feasible: false,
    notes: ['baseline'],
  };
}

function evaluateCandidate(
  c: Candidate,
  parts: RecommendationPartInput[],
  needWidth: number,
  needLength: number | null,
  firstNeedWeek: number | null,
): SizeRecommendation {
  const multiplier = Math.max(1, c.multiplier);
  const areaNeed = needLength !== null ? needWidth * needLength : needWidth;
  const areaStock = c.length !== null ? c.width * c.length : c.width;
  /**
   * Rasio luas material terhadap luas kebutuhan.
   *
   * Untuk GULUNGAN (hanya lebar) panjang tidak ikut dibandingkan: roll selebar
   * 60 cm untuk kebutuhan 59 x 60 cm menyediakan 60/59 kali material, bukan
   * 60/3540. Karena itu sisi yang dibandingkan harus sejenis — jangan mencampur
   * luas (2 dimensi) dengan lebar (1 dimensi).
   */
  const ratio =
    c.form === 'roll'
      ? needWidth > EPS
        ? c.width / needWidth
        : 1
      : needWidth > EPS && needLength !== null && c.length !== null
        ? areaStock / areaNeed
        : needWidth > EPS
          ? c.width / needWidth
          : 1;

  const trimWidthCm = Math.max(0, c.width - multiplier * needWidth);
  const trimLengthCm =
    c.form === 'sheet' && c.length !== null && needLength !== null
      ? Math.max(0, c.length - needLength)
      : 0;
  const wasteAreaCm2 =
    c.form === 'sheet' && c.length !== null && needLength !== null
      ? Math.max(0, areaStock - multiplier * areaNeed)
      : 0;

  const purchase = sumBasis(
    parts.map((p) => basisForPart(p.fm, Math.max(0, p.shortageSheet ?? 0), ratio, multiplier, c.form)),
  );
  const production = sumBasis(
    parts.map((p) => basisForPart(p.fm, Math.max(0, p.sheetsNet2), ratio, multiplier, c.form)),
  );

  const wastePctPerSheet = Math.max(0, 1 - multiplier / ratio);
  const base = production.qtySheet > EPS ? production : purchase;
  const wastePerSheetKg = base.qtySheet > EPS ? base.wasteKg / base.qtySheet : 0;

  const hasQty = c.availableKg > EPS || c.availableSheet > EPS;
  const availableNow = hasQty && c.source === 'stock';
  const arrivalWeek = c.source === 'po' ? c.arrivalWeek : null;
  const arrivalOk =
    c.source !== 'po' || arrivalWeek === null || firstNeedWeek === null || arrivalWeek <= firstNeedWeek;
  const feasible = (c.source === 'stock' || c.source === 'po') && hasQty && arrivalOk;

  const notes: RecommendationNote[] = [];
  if (wastePerSheetKg > EPS) notes.push('trim-not-applied');
  if (c.source === 'po' && !arrivalOk) notes.push('arrives-late');
  if (c.source === 'npof' || c.source === 'standard') notes.push('new-purchase');
  if (multiplier > 1) notes.push('size-multiplied');

  return {
    size: sizeLabel(c.width, c.length),
    width: c.width,
    length: c.length,
    form: c.form,
    source: c.source,
    supplier: c.supplier,
    sourceRefs: c.sourceRefs,
    multiplier,
    trimWidthCm: r6(trimWidthCm),
    trimLengthCm: r6(trimLengthCm),
    wasteAreaCm2: r6(wasteAreaCm2),
    wastePerSheetKg: r6(wastePerSheetKg),
    wastePctPerSheet,
    purchase,
    production,
    availableKg: r6(c.availableKg),
    availableSheet: r6(c.availableSheet),
    availableNow,
    arrivalWeek,
    feasible,
    notes,
  };
}

/**
 * Kg pembanding untuk pengurutan. Kalau belum ada pembelian (kebutuhan sudah
 * tercukupi) dipakai kg produksi, supaya pilihan tidak "seri" semua di 0 kg.
 */
function comparableKg(row: SizeRecommendation): number {
  return row.purchase.qtySheet > EPS ? row.purchase.kgMaterial : row.production.kgMaterial;
}

/**
 * Urutan rekomendasi (mudah dijelaskan, tanpa skor "ajaib"):
 *  1. Yang bisa dipenuhi sebelum kebutuhan (stok sekarang / PO tiba tepat waktu)
 *  2. Waste per lembar terkecil
 *  3. Kg material terkecil
 *  4. Ukuran fisik terkecil (lebih mudah ditangani daripada jumbo roll)
 *  5. Potongan per lembar terbanyak
 */
function compareCandidates(a: SizeRecommendation, b: SizeRecommendation): number {
  if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
  if (Math.abs(a.wastePctPerSheet - b.wastePctPerSheet) > EPS) {
    return a.wastePctPerSheet - b.wastePctPerSheet;
  }
  const kgA = comparableKg(a);
  const kgB = comparableKg(b);
  if (Math.abs(kgA - kgB) > EPS) return kgA - kgB;
  if ((a.width ?? 0) !== (b.width ?? 0)) return (a.width ?? 0) - (b.width ?? 0);
  return b.multiplier - a.multiplier;
}
