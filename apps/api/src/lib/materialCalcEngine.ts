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

import { canonicalSupplier, supplierLeadTimeMonths } from './supplierAlias';

// ============================================
// Konstanta
// ============================================

/** Lokasi WIP yang satuannya lembar; selain ini dihitung pcs. */
const WIP_SHEET_LOCATIONS = ['blister', 'uv', 'varnish opp', 'die cut'];

/** Satuan yang berarti "lembar". Data nyata memakai "sht", bukan "sheet". */
const SHEET_UNITS = ['sheet', 'sheets', 'sht', 'lbr', 'lembar'];

/** Satuan yang berarti "rim" (1 rim = `sheetsPerRim` lembar). */
const RIM_UNITS = ['rim', 'ream'];

/**
 * Satuan yang berarti "ton". Master Data Outstanding PO memakai singkatan "t",
 * jadi tanpa daftar ini barisnya dianggap satuan tak dikenal dan seluruh PO-nya
 * dibuang dari kolam (mis. PO `I1G000349` 450gsm/120cm 10 t milik HANCHANG).
 */
const TON_UNITS = ['t', 'ton', 'tons', 'tonne', 'tonnes'];

/** 1 ton = 1.000 kg. */
const KG_PER_TON = 1000;

/** Item dengan penanda ini tidak dihitung. */
export const NEBENG_PATTERN = /nebeng|satu\s*layout|tidak\s*dihitung/i;

/** Rata-rata jumlah minggu per bulan, dipakai menerjemahkan lead time bulan -> minggu. */
const WEEKS_PER_MONTH = 52 / 12;

/**
 * Toleransi kg untuk "kebutuhan vs alokasi".
 * `allocatedKg` adalah hasil PENJUMLAHAN potongan alokasi (`take`), sedangkan
 * `kgNet2` dihitung dari rumus lain, jadi selisih 1 ULP float (±2,27e-13 kg)
 * itu WAJAR dan bukan kekurangan nyata.
 * Tanpa toleransi ini: `shortageKg > 0` -> `isSufficient = false` dan
 * `Math.ceil(2,27e-13 / 0,32175) = 1` lembar per part.
 * Bukti nyata (2026-10-13, grup `100 x 71.5 CM | 450 | XSD`): kartu menulis
 * "4 sheets / 0 kg" padahal `allocatedKg` = `kgNet2` persis dan tabel 26 minggu
 * positif semua. Bukan kekurangan — murni sisa pembulatan.
 */
const CALC_EPSILON_KG = 1e-9;

/**
 * Toleransi untuk PEMBULATAN KE ATAS jumlah lembar (`Math.ceil(shortageKg / fm)`).
 * Kekurangan yang persis 1 lembar bisa terhitung jadi 2 karena galat float:
 * `0,3217500000000004 / 0,32175 = 1,0000000000000004` -> `ceil` = 2.
 */
const CALC_EPSILON_RATIO = 1e-9;

// ============================================
// Lead time & satuan
// ============================================

/**
 * Lead time kedatangan material, dalam bulan.
 *
 * Nama supplier dinormalisasi dulu lewat `supplierAlias.ts` supaya "PHIL
 * CORPORATION" (nama PT) tetap terbaca sebagai HANCHANG, dan "PT. MEGA SURYA
 * ERATAMA"/"MEGA PAPER" tetap terbaca sebagai MEGA. Pola teks di bawah hanya
 * cadangan untuk supplier yang belum terdaftar di daftar alias.
 */
export function getLeadTimeMonths(supplier: string): number {
  const mapped = supplierLeadTimeMonths(supplier);
  if (mapped !== null) return mapped;

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

export function isTonUnit(unit: string | null | undefined): boolean {
  return TON_UNITS.includes(String(unit || '').trim().toLowerCase());
}

/** Kg dari qty yang satuannya `unit` (ton dikali 1.000). 0 = satuan tak dikenal. */
export function toKilogram(qty: number, unit: string | null | undefined): number {
  const u = String(unit || '').trim().toLowerCase();
  if (u === 'kg' || u === 'kgs' || u === 'kilogram') return qty;
  if (isTonUnit(u)) return qty * KG_PER_TON;
  return 0;
}

// ============================================
// Pencocokan material: gramatur + ukuran
// ============================================

const normalizeNumText = (text: string | null | undefined) =>
  String(text || '').replace(/,/g, '.').toLowerCase();

/**
 * Ambil gramatur: "DUPLEX 450GSM/ 68.5CM" -> 450 ; "450 GSM" -> 450 ; "450" -> 450.
 *
 * PENTING: angka tanpa label hanya sah sebagai gramatur kalau dia SATU-SATUNYA
 * angka di teks. Kolom ukuran NPOF berisi dimensi seperti "100 x 71.5 CM", dan
 * pola lama `^\s*(\d{3,4})\b` membaca 100 sebagai gramatur — akibatnya 100
 * dibuang `parseDims()` sebagai gramatur, sehingga lebar tampil 71.5 dan
 * panjang hilang (part JRT63/JJN95, ukuran 100 x 71.5 cm).
 */
export function parseGsm(text: string | null | undefined): number | null {
  const s = normalizeNumText(text);
  const labeled = s.match(/(\d{3,4})\s*(?:gsm|gr\b|gram)/);
  if (labeled) return Number(labeled[1]);

  // Angka tanpa label ("450", "450 g") hanya sah kalau dia satu-satunya angka
  // DAN tidak langsung menempel kata lain ("180cm" bukan gramatur).
  const numbers = s.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length !== 1) return null;
  const value = Number(numbers[0]);
  if (!Number.isInteger(value) || value < 100 || value > 9999) return null;
  return /^\s*\d{3,4}\s*(?!\w)/.test(s) ? value : null;
}

/** Semua angka > 20 yang BUKAN gramatur -> dimensi cm, urutan tetap dipertahankan. */
export function parseDims(text: string | null | undefined): number[] {
  const s = normalizeNumText(text);
  const gsm = parseGsm(text);
  return [...s.matchAll(/(\d+(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 20 && n !== gsm);
}

/**
 * Kelipatan maksimum yang diuji saat mencari material "lebih besar N kali".
 * Contoh nyata: stok `DUPLEX 450GSM/ 117X92CM` dipakai untuk ukuran
 * `58.5 x 92 CM` karena 117 = 2 × 58.5 (satu lembar dibelah dua).
 */
export const MAX_SIZE_MULTIPLIER = 6;

export interface SizeMatch {
  /** true = ukuran sama persis dengan kebutuhan (prioritas utama saat alokasi). */
  exact: boolean;
  /**
   * Selisih lebar material - lebar kebutuhan (cm), selalu >= 0 bila lolos.
   * Untuk ukuran kelipatan, selisih dihitung setelah lebar stok dibagi
   * `multiplier`, sehingga 117 cm untuk kebutuhan 58.5 cm bernilai delta 0.
   */
  delta: number;
  /**
   * Berapa potong ukuran kebutuhan yang dihasilkan SATU satuan stok.
   * `1` = ukuran sama (perilaku lama); `2` = lebar stok 2× kebutuhan, dst.
   */
  multiplier: number;
}

/**
 * Aturan pencocokan (keputusan user, rancangan §2.6):
 *  1. Gramatur harus sama persis
 *  2. Lebar material tidak boleh lebih kecil dari kebutuhan
 *  3. Boleh lebih besar, selisih maksimal `toleranceCm`
 *  4. Selisih 0 berarti ukuran sama persis
 *
 * TAMBAHAN (permintaan user 2026-10-13): kalau tidak ada ukuran yang pas,
 * cari ukuran yang merupakan **KELIPATAN** dari kebutuhan. Ini terjadi karena
 * pembelian sebelumnya memakai kertas yang tidak dibelah, misalnya:
 *   - kebutuhan 58.5 x 92 cm, stok berukuran 117 x 92 cm (117 = 2 × 58.5)
 * → satu lembar/gulungan stok berisi 2 potong ukuran kebutuhan, jadi jumlah
 *   stok yang berguna ikut dikalikan `multiplier` (lihat `AllocationConsumption`).
 * Kelipatan yang dicoba: 2, 3, ... sampai `maxMultiplier`.
 *
 * Untuk ukuran kelipatan, sisi LAIN (panjang) wajib sama — mesin hanya membelah
 * pada satu sumbu, jadi `117 x 92` hanya sah untuk `58.5 x 92`, bukan untuk
 * `58.5 x 70` walaupun lebarnya cocok. Stok berbentuk gulungan hanya punya satu
 * dimensi, sehingga panjangnya bebas (tidak diperiksa).
 * Pemeriksaan panjang ini SENGAJA hanya untuk ukuran kelipatan supaya perilaku
 * pencocokan lama (lebar saja, sesuai skrip validasi 29/98) tidak berubah.
 *
 * Sengaja HANYA memakai dimensi pertama (lebar) untuk aturan utama, mengikuti
 * skrip analisis yang menghasilkan angka 29 dari 98 part.
 */
export function matchSize(
  materialDesc: string | null | undefined,
  needGsm: number | null,
  needWidth: number | null,
  toleranceCm: number,
  needLength: number | null = null,
  maxMultiplier = MAX_SIZE_MULTIPLIER,
): SizeMatch | null {
  if (needGsm === null || needWidth === null) return null;
  const gsm = parseGsm(materialDesc);
  if (gsm === null || gsm !== needGsm) return null;
  const dims = parseDims(materialDesc);
  const width = dims[0];
  if (width === undefined) return null;

  const delta = width - needWidth;
  if (delta >= -1e-9 && delta <= toleranceCm + 1e-9) {
    return { exact: delta < 1e-9, delta: Math.max(0, delta), multiplier: 1 };
  }

  // Sisi lain harus sama; gulungan (1 dimensi) tidak punya panjang.
  const stockLength = dims[1];
  if (
    stockLength !== undefined &&
    needLength !== null &&
    Math.abs(stockLength - needLength) > toleranceCm + 1e-9
  ) {
    return null;
  }

  // Ukuran lebih besar tetapi merupakan kelipatan (mis. 117 untuk 58.5).
  for (let multiplier = 2; multiplier <= maxMultiplier; multiplier += 1) {
    const sliced = width / multiplier;
    const slicedDelta = sliced - needWidth;
    if (slicedDelta >= -1e-9 && slicedDelta <= toleranceCm + 1e-9) {
      return { exact: false, delta: Math.max(0, slicedDelta), multiplier };
    }
  }

  return null;
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
  /**
   * Hasil mingguan dalam kg = `(saldo Hotlist − qty MRP) ÷ Up × Kg/Lbr`.
   * Positif = sisa stok, negatif = kekurangan.
   */
  weeks: number[];
  /** Sama seperti `weeks`, dalam lembar: `(saldo Hotlist − qty MRP) ÷ Up`. */
  weeksSheet: number[];
}

export interface WeeklyMatrixSummary {
  /** Total kebutuhan mingguan (kg) — HANYA kekurangan (nilai negatif) dijumlahkan. */
  totalReq: number[];
  /** Total kebutuhan mingguan (lembar) — HANYA kekurangan (nilai negatif). */
  totalReqSheet: number[];
  allowance: number[];
  allowanceSheet: number[];
  totalPlusAllowance: number[];
  totalPlusAllowanceSheet: number[];
  /**
   * Stok raw material yang terpakai grup ini (kg). Murni stok — PO TIDAK ikut
   * dihitung lagi di sini (posenya ada di `outstandingPo`).
   */
  stockAsOf: number;
  stockAsOfSheet: number;
  /** Rincian per lot stok (gulungan kg/ton vs lembaran) untuk dropdown UI. */
  stockDetails: StockDetail[];
  /**
   * Outstanding PO per minggu = qtyOrder − qtyDelivered dari Master Data,
   * ditempatkan di minggu kedatangan PO. TIDAK dipotong alokasi.
   */
  outstandingPo: number[];
  outstandingPoSheet: number[];
  /**
   * Nomor PO per minggu (sejajar dengan `outstandingPo`). Satu minggu bisa
   * berisi beberapa nomor PO karena satu PO boleh mencakup beberapa item.
   * Ditampilkan di UI sebagai caption kecil di bawah angka kg.
   */
  outstandingPoNumbers: string[][];
  /** Rincian tiap baris PO per minggu (sejajar `outstandingPo`). */
  outstandingPoDetails: OutstandingPoDetail[][];
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
  /** Satuan asli PO (`qtyOrderUnit`). Hanya untuk `source === 'po'`. */
  unit?: string | null;
  /** Tanggal rencana kedatangan PO. Hanya untuk `source === 'po'`. */
  planReceivedDate?: Date | null;
  /**
   * Identitas STABIL pool item untuk pengecualian user
   * (`MaterialCalcExclusion.poolRef`):
   * - stok: `${itemDesc}||${supplier}` (kunci agregasi lot)
   * - PO  : `id` baris `outstanding_pos`
   * Kalau kosong, `poolRefOf()` jatuh ke `key`.
   */
  poolRef?: string;
}

/**
 * Material kolam yang DIKELUARKAN user dari perhitungan SATU ukuran (grup).
 *
 * Dipakai ketika sebuah lot stok / baris PO sebenarnya tidak ikut dalam
 * perhitungan ukuran itu — misalnya karena ukurannya hanya kelipatan (117 cm
 * untuk 58,5 cm) atau karena materialnya sudah dipakai ukuran lain. Pool item
 * hanya dilewati untuk grup yang tercantum; grup lain tetap bisa memakainya.
 */
export interface PoolExclusion {
  source: 'stock' | 'po';
  /** `${ukuran}||${gramatur}||${supplier}` — sama dengan `groupKey` grup. */
  groupKey: string;
  /** `poolRef` pool item (lihat `poolRefOf`). */
  poolRef: string;
  /** Alasan dari user — hanya diteruskan ke output untuk ditampilkan. */
  reason?: string | null;
  /**
   * Jumlah yang DIKELUARKAN dari ukuran ini — hanya SEBAGIAN (permintaan user
   * 2026-10-15: "bukan hanya mengeluarkan keseluruhan qty po nya tapi bisa juga
   * hanya memakai sebagian dari yang ada").
   *
   * Kosong / 0 / tidak diisi = seluruh pool item dikeluarkan (perilaku lama).
   * Bagian yang TIDAK dikeluarkan tetap dipakai ukuran ini; sisanya otomatis
   * jadi tersedia bagi ukuran lain karena alokasi dijalankan ulang.
   */
  qty?: number | null;
  /** Satuan `qty`: `kg` (bagian bersatuan kg) atau `sheet` (bagian lembar). */
  unit?: string | null;
}

/** Satuan internal pengecualian sebagian. */
export type PoolQtyUnit = 'kg' | 'sheet';

/**
 * Batas pemakaian sebuah pool item oleh SATU grup = total − jumlah yang
 * dikeluarkan user. Dipakai dua tempat supaya angkanya selalu sejalan:
 * alokasi (tidak boleh melebihi) dan baris `Outstanding PO` (yang dihitung
 * hanya bagian milik ukuran ini).
 */
export interface PartialExclusionCap {
  unit: PoolQtyUnit;
  limit: number;
}

/** Satuan pengecualian sebagian dari input user (rim/lembar -> `sheet`). */
export function poolQtyUnit(unit: string | null | undefined): PoolQtyUnit {
  const u = String(unit || '').trim().toLowerCase();
  return isSheetUnit(u) || isRimUnit(u) ? 'sheet' : 'kg';
}

/**
 * Kunci pengecualian di dalam satu perhitungan: `groupKey||source||poolRef`.
 * Pengecualian berlaku PER GRUP, jadi pool item yang sama masih bisa dipakai
 * grup lain — ini yang membuat material "pindah" ke ukuran yang membutuhkannya.
 */
export function exclusionKey(groupKey: string, source: 'stock' | 'po', poolRef: string): string {
  return `${groupKey}||${source}||${poolRef}`;
}

/** Identitas stabil sebuah pool item (= nilai `MaterialCalcExclusion.poolRef`). */
export function poolRefOf(item: {
  key: string;
  desc: string;
  supplier: string;
  source: 'stock' | 'po';
  poolRef?: string;
}): string {
  if (item.poolRef) return item.poolRef;
  return item.source === 'stock' ? `${item.desc}||${item.supplier}` : item.key;
}

/**
 * Kunci grup: `${ukuran}||${gramatur}||${supplier}`.
 * SATU-SATUNYA tempat kunci ini dibentuk — `groupMap`, `Requirement.groupKey`,
 * dan `MaterialCalcExclusion.groupKey` WAJIB memakai nilai yang sama persis,
 * kalau tidak pengecualian user tidak akan terbaca.
 */
export function groupKeyOf(ukuran: string, gramatur: string, supplier: string): string {
  return `${ukuran}||${gramatur}||${supplier}`;
}

/** Satu kebutuhan part pada satu minggu. */
export interface Requirement {
  partNumber: string;
  weekIndex: number;
  needKg: number;
  gsm: number | null;
  width: number | null;
  /** Panjang ukuran kebutuhan (cm) — dipakai memvalidasi ukuran kelipatan. */
  length?: number | null;
  supplier: string;
  /** kg per lembar — untuk mengubah material bersatuan lembar menjadi kg. */
  fm: number;
  /**
   * `${ukuran}||${gramatur}||${supplier}` grup pemilik part ini. Dipakai supaya
   * `AllocationOptions.exclusions` bisa melewati pool item yang DILEWATI untuk
   * grup ini saja. Kosong = tidak ada pengecualian yang berlaku.
   */
  groupKey?: string;
}

export interface AllocationOptions {
  toleranceCm: number;
  /**
   * true = supplier dipakai sebagai syarat cocok (**default sejak 2026-10-15**).
   *
   * Keputusan user: "PO dan stok dua-duanya wajib sesupplier", sesuai
   * spesifikasi §2 — NPOF dihubungkan ke Stock Raw Material dan Outstanding PO
   * lewat **Item Desc + Supplier**. Sebelumnya supplier tidak diperiksa sehingga
   * gulungan 450gsm/120cm milik MEGA ikut dipakai & tampil di ukuran
   * `120 x 85.5 CM` milik HANCHANG.
   *
   * Perbandingan memakai `canonicalSupplier()` (jadi "PHIL CORPORATION" ==
   * "Hanchang Paper" == "HANCHANG"), dan supplier yang DATANYA KOSONG ('' / '-'
   * / "Unknown") tetap berarti "bebas" — tidak ada yang bisa dibandingkan.
   */
  requireSupplierMatch: boolean;
  /**
   * Himpunan kunci `exclusionKey(groupKey, source, poolRef)` — pool item yang
   * TIDAK boleh dipakai oleh grup tersebut. Dibuat dari `source.exclusions`.
   */
  exclusions?: ReadonlySet<string>;
  /**
   * Pengecualian SEBAGIAN: batas pemakaian pool item untuk satu grup
   * (`exclusionKey` -> jatah yang tersisa setelah bagiannya dikeluarkan user).
   * Pool item yang ada di sini TETAP boleh dipakai, hanya dibatasi jumlahnya.
   */
  partialCaps?: ReadonlyMap<string, PartialExclusionCap>;
}

/**
 * Satu pemakaian material dari kolam alokasi. Dipakai untuk MEMISAHKAN asal
 * material: stok raw material vs Outstanding PO.
 *
 * Permintaan user (2026-10-13): perhitungan stok dan PO tidak boleh disatukan —
 * baris `Stock As Of` harus benar-benar stok saja, sedangkan baris
 * `Outstanding PO` menampilkan sisanya sendiri.
 */
export interface AllocationConsumption {
  /** Kunci pool item (`stock|desc||supplier` atau `po|n`). */
  key: string;
  source: 'stock' | 'po';
  desc: string;
  supplier: string;
  poNumber: string | null;
  /** Part yang memakai material ini. */
  partNumber: string;
  /** kg yang diambil dari bagian bersatuan kg. */
  fromKg: number;
  /**
   * lembar yang diambil dari bagian bersatuan lembar/rim.
   * Dinyatakan dalam **ukuran kebutuhan part pemakai**, jadi material kelipatan
   * (mis. stok 117 cm untuk kebutuhan 58.5 cm) melaporkan angka 2× lebih besar
   * daripada lembar fisik yang berkurang.
   */
  fromSheet: number;
  /** Total kg yang dialokasikan (fromKg + fromSheet × fm part pemakai). */
  kg: number;
  /** Kelipatan ukuran yang dipakai (`1` = ukuran sama, `2` = 2× lebar, dst). */
  multiplier: number;
}

/** Bentuk fisik lot stok: gulungan (kg/ton) atau lembaran. */
export type StockForm = 'roll' | 'sheet' | 'mixed' | 'unknown';

/** Rincian satu lot stok (itemDesc + supplier) untuk dropdown `Stock As Of`. */
export interface StockDetail {
  desc: string;
  supplier: string;
  form: StockForm;
  /**
   * Identitas pool item (= `MaterialCalcExclusion.poolRef`). Dipakai UI untuk
   * mengeluarkan / mengembalikan baris ini lewat endpoint pengecualian.
   */
  poolRef: string;
  /** Total stok lot ini (semua barisnya dijumlahkan). */
  totalKg: number;
  totalSheet: number;
  /**
   * Berapa potong ukuran grup ini yang dihasilkan satu satuan stok lot ini.
   * `1` = ukuran sama persis; `2` = lebar stok 2× kebutuhan (mis. stok
   * `117 x 92 cm` untuk ukuran `58.5 x 92 cm`), dst.
   */
  multiplier: number;
  /** Lebar & panjang fisik lot stok (cm) — dipakai UI untuk keterangan. */
  sourceWidth: number | null;
  sourceLength: number | null;
  /**
   * Stok lot ini dinyatakan dalam ukuran grup.
   *   - lot lembaran: `totalSheet × multiplier`
   *   - lot gulungan: `totalKg ÷ Kg/Lbr grup` (kg tidak berubah saat dibelah)
   * Contoh: 5.000 lbr 117 x 92 cm dengan `multiplier` 2 = **10.000 lbr** 58,5 x 92 cm.
   */
  equivalentSheet: number;
  /**
   * Bagian yang benar-benar terpakai grup ini. `allocatedKg` = kg dari bagian
   * bersatuan kg + `allocatedSheet` × Kg/Lbr grup, sehingga selalu sejalan
   * dengan baris `Stock As Of`.
   */
  allocatedKg: number;
  allocatedSheet: number;
  /**
   * true = baris ini DIKELUARKAN user dari perhitungan ukuran ini
   * (`MaterialCalcExclusion`). Angkanya TIDAK ikut `stockAsOf` / `End Ind`,
   * tetapi tetap dikirim supaya bisa ditampilkan dan dikembalikan.
   */
  excluded?: boolean;
  /**
   * Bagian lot ini yang DIKELUARKAN user dari ukuran ini — hanya untuk
   * pengecualian SEBAGIAN (satuan fisik lot: kg / lembar). `0` = tidak ada
   * bagian yang dikeluarkan.
   */
  excludedKg: number;
  excludedSheet: number;
  /** Alasan yang ditulis user saat mengeluarkan baris ini. */
  exclusionReason?: string | null;
}

/** Rincian satu baris PO untuk dropdown `Outstanding PO`. */
export interface OutstandingPoDetail {
  poNumber: string | null;
  /**
   * Identitas pool item (= `id` baris `outstanding_pos`). Dipakai UI untuk
   * mengeluarkan / mengembalikan baris ini lewat endpoint pengecualian.
   */
  poolRef: string;
  itemDesc: string;
  supplier: string;
  /** Kolom minggu tempat PO masuk (0-based). */
  weekIndex: number;
  planReceivedDate: string | null;
  /** Satuan asli PO di Master Data (kg / rim / sht). */
  unit: string | null;
  /** Jumlah PO awal (setelah dikurangi qty delivered). */
  qtyKg: number;
  qtySheet: number;
  /** Bagian PO yang sudah teralokasi ke grup ini. */
  allocatedKg: number;
  allocatedSheet: number;
  /** Sisa PO setelah dikurangi bagian yang terpakai (= qty − terpakai). */
  remainingKg: number;
  remainingSheet: number;
  /**
   * Bagian qty yang DIKELUARKAN user dari ukuran ini — hanya untuk pengecualian
   * SEBAGIAN (satuan fisik PO: kg / lembar). Baris `Outstanding PO` minggu itu
   * hanya menghitung `qty − excluded`, karena sisanya milik ukuran lain.
   */
  excludedKg: number;
  excludedSheet: number;
  /** true = PO ini DIKELUARKAN user dari perhitungan ukuran ini. */
  excluded?: boolean;
  /** Alasan yang ditulis user saat mengeluarkan baris ini. */
  exclusionReason?: string | null;
}

/**
 * Supplier yang DATANYA TIDAK ADA. Nilai ini tidak bisa dibandingkan dengan
 * supplier mana pun, jadi pool item-nya tetap dianggap cocok — kalau tidak,
 * part tanpa data NPOF (14 baris NPOF supplier kosong, dipakai fallback jumbo
 * roll 180 cm) tidak akan pernah dapat material sama sekali walaupun materialnya
 * nyata ada di gudang.
 */
const SUPPLIER_PLACEHOLDERS = ['', '-', 'unknown', 'n/a', 'na', 'tanpa supplier'];

function hasSupplierData(value: string | null | undefined): boolean {
  return !SUPPLIER_PLACEHOLDERS.includes(String(value || '').trim().toLowerCase());
}

/**
 * Cocokkan supplier pool dengan kebutuhan part.
 *
 * Kedua sisi dinormalisasi lewat `canonicalSupplier()` sehingga
 * "PT. MEGA SURYA ERATAMA" == "MEGA PAPER" == "MEGA", dan
 * "PHIL CORPORATION" == "HANCHANG" == "Hanchang Paper".
 *
 * Sejak 2026-10-15 `required` = true adalah DEFAULT (keputusan user: PO dan stok
 * dua-duanya wajib sesupplier, sesuai spesifikasi "Item Desc + Supplier").
 */
function supplierOk(itemSupplier: string, needSupplier: string, required: boolean): boolean {
  if (!required) return true;
  if (!hasSupplierData(itemSupplier) || !hasSupplierData(needSupplier)) return true;
  const a = canonicalSupplier(itemSupplier).trim().toLowerCase();
  const b = canonicalSupplier(needSupplier).trim().toLowerCase();
  if (!hasSupplierData(a) || !hasSupplierData(b)) return true;
  return a === b || a.includes(b) || b.includes(a);
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
 *  - Kalau kecocokan ukurannya sama baik, **stok sendiri dipakai lebih dulu**
 *    daripada PO yang baru datang.
 *
 * Mengembalikan peta `partNumber||weekIndex` -> kg yang berhasil dialokasikan.
 * Setiap pemakaian dilaporkan lewat `onConsume` supaya pemanggil bisa memisahkan
 * asal material (stok vs PO).
 */
export function allocateSequentially(
  requirements: Requirement[],
  pool: PoolItem[],
  options: AllocationOptions,
  onConsume?: (consumption: AllocationConsumption) => void,
): Map<string, number> {
  const items = pool.map((p) => ({ ...p }));
  const allocated = new Map<string, number>();
  /**
   * Jumlah yang sudah diambil dari tiap jatah pengecualian SEBAGIAN
   * (`exclusionKey`), dalam satuan FISIK pool item (kg / lembar). Satu grup tidak
   * boleh melebihi jatah yang tersisa setelah bagiannya dikeluarkan user.
   */
  const capUsed = new Map<string, number>();

  /**
   * Bagian pool item yang masih boleh dipakai untuk kebutuhan ini.
   * `kg` & `sheet` dalam satuan FISIK pool item; `capacity` dalam kg kebutuhan.
   */
  const availableOf = (
    item: PoolItem,
    fm: number,
    multiplier: number,
    capKey: string | null,
    cap: PartialExclusionCap | undefined,
  ) => {
    let kg = Math.max(0, item.kgRemaining);
    let sheet = Math.max(0, item.sheetRemaining);
    if (cap && capKey) {
      const left = Math.max(0, cap.limit - (capUsed.get(capKey) ?? 0));
      if (left <= 1e-9) return { kg: 0, sheet: 0, capacity: 0 };
      // Batas dihitung per SATUAN: `kg` membatasi bagian bersatuan kg saja,
      // `sheet` membatasi bagian bersatuan lembar saja.
      if (cap.unit === 'kg') {
        kg = Math.min(kg, left);
        sheet = 0;
      } else {
        sheet = Math.min(sheet, left);
        kg = 0;
      }
    }
    const capacity = kg + (fm > 0 ? sheet * fm * Math.max(1, multiplier) : 0);
    return { kg, sheet, capacity };
  };

  const byWeek = new Map<number, Requirement[]>();
  for (const r of requirements) {
    if (r.needKg <= 0) continue;
    const list = byWeek.get(r.weekIndex) || [];
    list.push(r);
    byWeek.set(r.weekIndex, list);
  }

  interface Candidate {
    item: PoolItem;
    /** Kunci pengecualian sebagian (kalau grup kebutuhan diketahui). */
    capKey: string | null;
    cap: PartialExclusionCap | undefined;
    match: SizeMatch;
  }

  for (const week of [...byWeek.keys()].sort((a, b) => a - b)) {
    // Kandidat dihitung ulang tiap minggu karena sisa kolam ikut berubah.
    const entries = (byWeek.get(week) || []).map((r) => {
      const candidates = items
        .filter(
          (item) =>
            item.availableWeek <= week &&
            supplierOk(item.supplier, r.supplier, options.requireSupplierMatch) &&
            // Material yang DIKELUARKAN user untuk grup ini tidak boleh dipakai
            // (permintaan user 2026-10-14). Grup lain tetap bisa memakainya.
            !(
              options.exclusions &&
              r.groupKey &&
              options.exclusions.has(exclusionKey(r.groupKey, item.source, poolRefOf(item)))
            ),
        )
        .map((item) => {
          const capKey = r.groupKey
            ? exclusionKey(r.groupKey, item.source, poolRefOf(item))
            : null;
          return {
            item,
            capKey,
            cap: capKey ? options.partialCaps?.get(capKey) : undefined,
            match: matchSize(item.desc, r.gsm, r.width, options.toleranceCm, r.length ?? null),
          };
        })
        .filter((c): c is Candidate => c.match !== null);

      const bestDelta = candidates.length
        ? Math.min(...candidates.map((c) => c.match.delta))
        : Number.POSITIVE_INFINITY;
      const availableKg = candidates.reduce(
        (sum, c) =>
          sum + availableOf(c.item, r.fm, c.match.multiplier, c.capKey, c.cap).capacity,
        0,
      );
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
        (a, b) =>
          a.match.delta - b.match.delta ||
          // Ukuran yang benar-benar sama lebih diutamakan daripada kelipatan.
          a.match.multiplier - b.match.multiplier ||
          // Ukuran sama baik -> pakai stok yang sudah ada dulu, baru PO.
          (a.item.source === b.item.source ? 0 : a.item.source === 'stock' ? -1 : 1) ||
          a.item.key.localeCompare(b.item.key),
      );

      for (const c of candidates) {
        if (remaining <= 1e-9) break;
        const multiplier = Math.max(1, c.match.multiplier);
        const avail = availableOf(c.item, entry.r.fm, multiplier, c.capKey, c.cap);
        if (avail.capacity <= 1e-9) continue;

        const take = Math.min(remaining, avail.capacity);
        const fromKg = Math.min(take, avail.kg);
        c.item.kgRemaining -= fromKg;
        const restKg = take - fromKg;
        // `restKg` diubah ke lembar UKURAN KEBUTUHAN (bukan lembar fisik stok):
        // 1 lembar 117 cm menyediakan 2 lembar 58.5 cm, jadi lembar fisik yang
        // berkurang = fromSheet / multiplier.
        const fromSheet = restKg > 0 && entry.r.fm > 0 ? restKg / entry.r.fm : 0;
        if (fromSheet > 0) c.item.sheetRemaining -= fromSheet / multiplier;
        // Jatah pengecualian sebagian dicatat dalam satuan FISIK pool item,
        // sejajar dengan pengurangan `kgRemaining` / `sheetRemaining` di atas.
        if (c.cap && c.capKey) {
          capUsed.set(c.capKey, (capUsed.get(c.capKey) ?? 0) + fromKg + fromSheet / multiplier);
        }

        remaining -= take;

        if (onConsume) {
          onConsume({
            key: c.item.key,
            source: c.item.source,
            desc: c.item.desc,
            supplier: c.item.supplier,
            poNumber: c.item.poNumber ?? null,
            partNumber: entry.r.partNumber,
            fromKg,
            fromSheet,
            kg: take,
            multiplier,
          });
        }
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
  const rawShortageKg = kgNet2 - allocatedKg;
  // Selisih di bawah toleransi dianggap NOL (galat pembulatan float), supaya
  // part yang sebenarnya terpenuhi penuh tidak berubah jadi "kurang 1 lembar".
  const shortageKg = Math.abs(rawShortageKg) < CALC_EPSILON_KG ? 0 : rawShortageKg;

  let shortageSheet: number | null = null;
  let shortagePcs: number | null = null;
  const isSufficient = shortageKg <= 0;
  const surplusKgResult = isSufficient ? Math.abs(shortageKg) : null;

  if (!isSufficient) {
    // Step 6.4: pembulatan ke atas (toleransi hanya membuang galat float).
    shortageSheet = Math.ceil(shortageKg / fm - CALC_EPSILON_RATIO);
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
    /** `id` baris `outstanding_pos` — dipakai sebagai `poolRef` pengecualian. */
    id?: string;
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
  /**
   * Pool item yang DIKELUARKAN user untuk grup tertentu (tabel
   * `material_calc_exclusions`). Berlaku per periode — pemanggil yang mengisi.
   */
  exclusions?: PoolExclusion[];
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
  /** Total kg teralokasi (stok + PO). Dipakai untuk shortage. */
  allocatedKg: number;
  /** Bagian yang berasal dari STOK saja (baris `Stock As Of`). */
  allocatedStockKg: number;
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
  /**
   * `${ukuran}||${gramatur}||${supplier}` — kunci yang dipakai tabel
   * `material_calc_exclusions`. Hasil perhitungan LAMA belum punya field ini;
   * UI menyusunnya sendiri sebagai cadangan.
   */
  groupKey?: string;
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

  /**
   * Pengecualian pool per grup (tabel `material_calc_exclusions`).
   * Satu himpunan datar dengan kunci `exclusionKey()` supaya pencarian O(1)
   * di dalam loop alokasi, dan satu peta alasan untuk ditampilkan di rincian.
   */
  const exclusionSet = new Set<string>();
  const exclusionReasons = new Map<string, string | null>();
  /**
   * Pengecualian SEBAGIAN: masih menyimpan berapa yang dikeluarkan. Batas
   * pemakaiannya (`PartialExclusionCap`) baru bisa dihitung setelah kolam
   * material dibangun, karena butuh total lot/PO-nya.
   */
  const partialExclusions = new Map<
    string,
    { source: 'stock' | 'po'; poolRef: string; qty: number; unit: PoolQtyUnit }
  >();
  for (const ex of source.exclusions ?? []) {
    const k = exclusionKey(ex.groupKey, ex.source, ex.poolRef);
    exclusionReasons.set(k, ex.reason ?? null);
    const qty = Number(ex.qty);
    if (Number.isFinite(qty) && qty > 0) {
      partialExclusions.set(k, {
        source: ex.source,
        poolRef: ex.poolRef,
        qty,
        unit: poolQtyUnit(ex.unit),
      });
    } else {
      exclusionSet.add(k);
    }
  }

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

  /**
   * Basis waktu perhitungan = awal kolom minggu PERTAMA, bukan MIN seluruh baris
   * MRP. Penting: kalau ada satu baris MRP yang tanggalnya salah (mis. tahun
   * 2026 padahal harusnya 2027), MIN-nya ikut turun dan SEMUA PO jadi dianggap
   * tiba di minggu terakhir sehingga baris `Outstanding PO` tampak kosong.
   */
  const timelineStart = new Date(weeks[0]?.weekStartDate ?? periodStart);
  const timelineBase = options.timelineBaseDate ?? timelineStart;

  if (demandByPartNumber.size === 0) {
    return {
      periodStartDate: timelineStart,
      periodEndDate: new Date(timelineStart.getTime() + (weekCount * 7 - 1) * 86400000),
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
    // Supplier dinormalisasi: lot "MEGA" dan "MEGA SURYA ERATAMA" dianggap satu.
    const supplier = canonicalSupplier(s.supplier);
    const key = `${s.itemDesc}||${supplier}`;
    const agg =
      stockAgg.get(key) || { desc: s.itemDesc, supplier, kg: 0, sheet: 0 };
    const qty = Number(s.qty) || 0;
    if (isSheetUnit(s.unit)) agg.sheet += qty;
    else if (isRimUnit(s.unit)) agg.sheet += qty * options.sheetsPerRim;
    else if (isTonUnit(s.unit)) agg.kg += qty * KG_PER_TON;
    else agg.kg += qty;
    stockAgg.set(key, agg);
  }
  /**
   * Bentuk fisik tiap lot stok, untuk dropdown `Stock As Of`: gulungan (kg/ton)
   * atau lembaran. Satu lot bisa berisi keduanya (satuan kg + sht) -> `mixed`.
   */
  const stockFormByKey = new Map<string, StockForm>();
  for (const [key, agg] of stockAgg.entries()) {
    const hasKg = agg.kg > 1e-9;
    const hasSheet = agg.sheet > 1e-9;
    let form: StockForm;
    if (hasKg && hasSheet) form = 'mixed';
    else if (hasSheet) form = 'sheet';
    else if (hasKg) form = parseDims(agg.desc).length >= 2 ? 'sheet' : 'roll';
    else form = 'unknown';
    stockFormByKey.set(`stock|${key}`, form);
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
      // Kunci agregasi lot = identitas stabil untuk pengecualian user.
      poolRef: key,
    });
  }

  const weekIndexOfDate = (value: Date | null | undefined): number => {
    if (!value) return 0; // tanggal kosong -> anggap sudah tiba
    const diff = new Date(value).getTime() - timelineStart.getTime();
    return Math.min(weekCount - 1, Math.max(0, Math.floor(diff / (7 * 86400000))));
  };

  for (const po of source.pos) {
    const remaining = Number(po.qtyOrder) - Number(po.qtyDelivered);
    if (!Number.isFinite(remaining) || remaining <= 0) continue;

    const unit = String(po.qtyOrderUnit || '').trim().toLowerCase();
    // Satuan `t` (ton) adalah satuan yang paling banyak dipakai Master Data PO
    // (58 dari 117 baris). Tanpa konversi ini barisnya punya kg = 0 DAN lembar = 0,
    // jadi seluruh PO-nya hilang dari baris `Outstanding PO`.
    const kgQty = isTonUnit(unit) ? remaining * KG_PER_TON : unit === 'kg' ? remaining : 0;
    const sheetQty = isSheetUnit(unit)
      ? remaining
      : isRimUnit(unit)
        ? remaining * options.sheetsPerRim
        : 0;
    if (kgQty <= 0 && sheetQty <= 0) continue;

    pool.push({
      key: `po|${pool.length}`,
      desc: po.itemDesc,
      supplier: canonicalSupplier(po.supplierName),
      source: 'po',
      availableWeek: weekIndexOfDate(po.planReceivedDate),
      kgRemaining: kgQty,
      sheetRemaining: sheetQty,
      poNumber: po.poNumber ?? null,
      unit: po.qtyOrderUnit,
      planReceivedDate: po.planReceivedDate ?? null,
      // Id baris Master Data — stabil walau urutan data berubah.
      poolRef: po.id,
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
    // Nama supplier dinormalisasi supaya satu ukuran tidak terpecah jadi
    // beberapa grup hanya karena beda tulisan (lihat `supplierAlias.ts`).
    const supplier = canonicalSupplier(normalizeNpofText(npof?.supplier, 'Unknown'));
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
    const partDims = parseDims(part.ukuran);
    const width = NEBENG_PATTERN.test(part.ukuran) ? null : (partDims[0] ?? null);
    const length = NEBENG_PATTERN.test(part.ukuran) ? null : (partDims[1] ?? null);

    const weekly = [...part.weekDemandPcs.entries()].filter(([, qty]) => qty > 0);
    const totalWeekly = weekly.reduce((sum, [, qty]) => sum + qty, 0);

    if (totalWeekly <= 0) {
      requirements.push({
        partNumber: part.partNumber,
        weekIndex: 0,
        needKg: part.needKg,
        gsm,
        width,
        length,
        supplier: part.supplier,
        fm: part.fm,
        groupKey: groupKeyOf(part.ukuran, part.gramatur, part.supplier),
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
        length,
        supplier: part.supplier,
        fm: part.fm,
        groupKey: groupKeyOf(part.ukuran, part.gramatur, part.supplier),
      });
    }
  }

  /**
   * Batas pemakaian untuk pengecualian SEBAGIAN = total lot/PO − jumlah yang
   * dikeluarkan user. Kalau yang dikeluarkan sama dengan (atau lebih dari)
   * totalnya, perlakuannya sama seperti pengecualian penuh.
   */
  const poolItemByRef = new Map<string, PoolItem>();
  for (const item of pool) poolItemByRef.set(`${item.source}|${poolRefOf(item)}`, item);

  const partialCaps = new Map<string, PartialExclusionCap>();
  for (const [k, ex] of partialExclusions) {
    const item = poolItemByRef.get(`${ex.source}|${ex.poolRef}`);
    const total = !item
      ? 0
      : ex.unit === 'kg'
        ? Math.max(0, item.kgRemaining)
        : Math.max(0, item.sheetRemaining);
    const limit = total - ex.qty;
    if (limit <= 1e-9) {
      exclusionSet.add(k);
      continue;
    }
    partialCaps.set(k, { unit: ex.unit, limit });
  }

  const consumptions: AllocationConsumption[] = [];
  const allocatedByKey = allocateSequentially(
    requirements,
    pool,
    {
      toleranceCm: options.toleranceCm,
      requireSupplierMatch: options.requireSupplierMatch,
      exclusions: exclusionSet,
      partialCaps,
    },
    (c) => consumptions.push(c),
  );

  const allocatedByPart = new Map<string, number>();
  for (const [key, kg] of allocatedByKey.entries()) {
    const pn = key.slice(0, key.lastIndexOf('||'));
    allocatedByPart.set(pn, (allocatedByPart.get(pn) || 0) + kg);
  }

  /** Bagian alokasi yang berasal dari STOK saja (dasar baris `Stock As Of`). */
  const allocatedStockByPart = new Map<string, number>();
  for (const c of consumptions) {
    if (c.source !== 'stock') continue;
    allocatedStockByPart.set(c.partNumber, (allocatedStockByPart.get(c.partNumber) || 0) + c.kg);
  }

  // ── 8. Hasil akhir per part ─────────────────────────────────────────────
  const partDetails: PartNumberDetail[] = [];
  let partsWithStock = 0;
  let allocatedTotal = 0;

  for (const part of parts) {
    const allocatedKg = allocatedByPart.get(part.partNumber) || 0;
    const allocatedStockKg = allocatedStockByPart.get(part.partNumber) || 0;
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
      allocatedStockKg,
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
  interface GroupAcc extends Omit<MaterialGroupResult, 'weeklyMatrix' | 'hasKg' | 'surplusSheet'> {
    /** Kunci grup — dipakai `buildMatrix` untuk membaca pengecualian user. */
    groupKey: string;
  }
  const groupMap = new Map<string, GroupAcc>();
  for (const pd of partDetails) {
    const groupKey = groupKeyOf(pd.ukuran, pd.gramatur, pd.supplier);
    let group = groupMap.get(groupKey);
    if (!group) {
      group = {
        groupKey,
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
  // Rumus per minggu (permintaan user 2026-10-12): kebutuhan material TIDAK lagi
  // sekadar MRP ÷ UPS, tetapi memakai SALDO STOK (carry-over) dari Hotlist:
  //   saldo_awal[1]      = BI Total Hotlist part (pcs)
  //   saldo_awal[w]      = max(saldo_akhir_pcs[w-1], 0)  → defisit TIDAK diakumulasi
  //   hasil_sheets[w]    = (saldo_awal[w] - qty MRP[w]) / ups
  //   hasil_kg[w]        = hasil_sheets[w] * kg_per_sheet
  //   saldo_akhir_pcs[w] = saldo_awal[w] - qty MRP[w]     (pcs, bukan lembar)
  // Nilai positif = sisa stok (tidak butuh material), negatif = kekurangan.
  const weeklyByPart = new Map<string, { sheet: number[]; kg: number[] }>();
  for (const part of parts) {
    const sheet = new Array(weekCount).fill(0) as number[];
    const kg = new Array(weekCount).fill(0) as number[];
    let saldoPcs = part.biTotal; // Hotlist BI Total = saldo awal minggu 1
    for (let wi = 0; wi < weekCount; wi += 1) {
      const qty = part.weekDemandPcs.get(wi) ?? 0;
      const s = part.ups > 0 ? (saldoPcs - qty) / part.ups : 0;
      sheet[wi] = s;
      kg[wi] = s * part.fm;
      saldoPcs = Math.max(saldoPcs - qty, 0);
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

    // Total Req = penjumlahan KEKURANGAN saja (nilai negatif). Sisa stok tiap
    // part (nilai positif) TIDAK dijumlahkan — permintaan user: kalau hasil part
    // positif, baris Total Req menampilkan 0 karena tidak butuh material.
    const totalReqSheet = new Array(weekCount).fill(0) as number[];
    const totalReq = new Array(weekCount).fill(0) as number[];
    for (const r of rows) {
      for (let i = 0; i < weekCount; i += 1) {
        const s = r.weeksSheet[i] || 0;
        if (s < 0) {
          totalReqSheet[i] += s;
          totalReq[i] += r.weeks[i] || 0;
        }
      }
    }
    const allowanceSheet = totalReqSheet.map((v) => v * 0.05);
    const allowance = totalReq.map((v) => v * 0.05);
    const totalPlusAllowanceSheet = totalReqSheet.map((v, i) => v + allowanceSheet[i]);
    const totalPlusAllowance = totalReq.map((v, i) => v + allowance[i]);

    // ── Stock As Of = STOK SAJA ───────────────────────────────────────────
    // Permintaan user (2026-10-13): perhitungan stok raw material dan
    // Outstanding PO jangan disatukan. Baris ini hanya berisi stok yang
    // benar-benar terpakai grup ini; material dari PO tampil di baris
    // `Outstanding PO` beserta nomor PO-nya.
    const stockAsOf = g.details.reduce((s, d) => s + (d.allocatedStockKg || 0), 0);
    const groupFm = g.details.find((d) => d.fm > 0)?.fm ?? 0;
    const stockAsOfSheet = groupFm > 0 ? stockAsOf / groupFm : 0;

    const gsm = parseGsm(g.gramatur);
    const groupDims = parseDims(g.ukuran);
    const groupWidth = groupDims[0] ?? null;
    const groupLength = groupDims[1] ?? null;

    // Alokasi berjalan global, jadi pemakaian pool harus disaring dulu ke part
    // yang memang ada di grup ini.
    const groupParts = new Set(g.details.map((d) => d.partNumber));
    const usedByPoolKey = new Map<string, { kg: number; sheet: number }>();
    for (const c of consumptions) {
      if (!groupParts.has(c.partNumber)) continue;
      const cur = usedByPoolKey.get(c.key) || { kg: 0, sheet: 0 };
      cur.kg += c.fromKg;
      cur.sheet += c.fromSheet;
      usedByPoolKey.set(c.key, cur);
    }

    /**
     * Bagian pool item yang DIKELUARKAN user dari ukuran ini (pengecualian
     * sebagian), dalam satuan FISIK pool item. Pengecualian penuh tidak lewat
     * sini — itu sudah ditandai `excluded` dan tidak dihitung sama sekali.
     */
    const excludedPartsOf = (exKey: string, item: PoolItem) => {
      const ex = partialExclusions.get(exKey);
      if (!ex) return { kg: 0, sheet: 0 };
      return ex.unit === 'sheet'
        ? { kg: 0, sheet: Math.min(ex.qty, Math.max(0, item.sheetRemaining)) }
        : { kg: Math.min(ex.qty, Math.max(0, item.kgRemaining)), sheet: 0 };
    };

    // Rincian tiap lot stok yang ukurannya cocok (gulungan kg/ton vs lembaran).
    // Termasuk lot yang ukurannya KELIPATAN kebutuhan (mis. 117 cm untuk 58.5 cm):
    // jumlahnya dilaporkan juga dalam satuan ukuran grup (`equivalentSheet`)
    // supaya jelas berapa lembar yang benar-benar berguna.
    const stockDetails: StockDetail[] = [];
    for (const item of pool) {
      if (item.source !== 'stock') continue;
      // Stok beda supplier TIDAK boleh dihitung di ukuran ini (spesifikasi §2:
      // NPOF ↔ Stock lewat Item Desc + Supplier).
      if (!supplierOk(item.supplier, g.supplier, options.requireSupplierMatch)) continue;
      const match = matchSize(item.desc, gsm, groupWidth, options.toleranceCm, groupLength);
      if (match === null) continue;
      const used = usedByPoolKey.get(item.key);
      const dims = parseDims(item.desc);
      const ref = poolRefOf(item);
      const exKey = exclusionKey(g.groupKey, 'stock', ref);
      const isExcluded = exclusionSet.has(exKey);
      const excluded = excludedPartsOf(exKey, item);
      stockDetails.push({
        desc: item.desc,
        supplier: item.supplier,
        form: stockFormByKey.get(item.key) ?? 'unknown',
        poolRef: ref,
        excluded: isExcluded,
        exclusionReason: isExcluded ? exclusionReasons.get(exKey) ?? null : null,
        excludedKg: excluded.kg,
        excludedSheet: excluded.sheet,
        totalKg: item.kgRemaining,
        totalSheet: item.sheetRemaining,
        multiplier: match.multiplier,
        sourceWidth: dims[0] ?? null,
        sourceLength: dims[1] ?? null,
        // Setara ukuran grup: lembar × kelipatan (lot lembaran) + kg ÷ Kg/Lbr
        // grup (lot gulungan) — sejalan dengan cara `stockAsOfSheet` dihitung.
        equivalentSheet:
          item.sheetRemaining * match.multiplier + (groupFm > 0 ? item.kgRemaining / groupFm : 0),
        // Kg yang benar-benar terpakai; bagian lembar dikonversi lewat Kg/Lbr grup
        // supaya angka kg = lbr × Kg/Lbr, sama seperti baris `Stock As Of`.
        allocatedKg: (used?.kg ?? 0) + (used?.sheet ?? 0) * groupFm,
        allocatedSheet: used?.sheet ?? 0,
      });
    }
    stockDetails.sort((a, b) => a.desc.localeCompare(b.desc));

    // Outstanding PO: PO yang ukurannya cocok, tampil di minggu kedatangannya
    // SEPERTI DI MASTER DATA (sisa = qtyOrder − qtyDelivered). Alokasi TIDAK
    // memotong angka ini — kalau dipotong, PO yang sudah "dipakai" perhitungan
    // akan hilang dari layar (tampil 0) walaupun PO-nya nyata. Berapa yang
    // sudah terpakai grup ini tetap bisa dilihat di kolom rinciannya.
    //
    // Pengecualian SEBAGIAN (2026-10-15) dihitung di sini: bagian yang
    // dikeluarkan user BUKAN milik ukuran ini, jadi baris `Outstanding PO`
    // hanya menghitung sisanya (`qty − excluded`) dan sisanya itu pula yang
    // boleh dipakai alokasi (lihat `partialCaps`).
    const outstandingPo = new Array(weekCount).fill(0) as number[];
    const outstandingPoSheet = new Array(weekCount).fill(0) as number[];
    // Nomor PO tiap minggu, sejajar dengan `outstandingPo`. Satu nomor PO bisa
    // muncul beberapa kali di kolam (satu PO boleh mencakup beberapa item),
    // jadi di-dedupe per minggu.
    const outstandingPoNumbers: string[][] = Array.from({ length: weekCount }, () => []);
    const outstandingPoDetails: OutstandingPoDetail[][] = Array.from({ length: weekCount }, () => []);
    for (const item of pool) {
      if (item.source !== 'po') continue;
      // PO beda supplier TIDAK ikut ukuran ini (spesifikasi §2: NPOF ↔ PO lewat
      // Item Desc + Supplier) — inilah yang membuat PO MEGA tidak lagi nongol
      // di ukuran 120 x 85.5 CM milik HANCHANG.
      if (!supplierOk(item.supplier, g.supplier, options.requireSupplierMatch)) continue;
      if (matchSize(item.desc, gsm, groupWidth, options.toleranceCm, groupLength) === null) continue;

      const used = usedByPoolKey.get(item.key);
      const allocatedKg = used?.kg ?? 0;
      const allocatedSheet = used?.sheet ?? 0;
      const wi = Math.min(weekCount - 1, Math.max(0, item.availableWeek));
      const ref = poolRefOf(item);
      const exKey = exclusionKey(g.groupKey, 'po', ref);
      const isExcluded = exclusionSet.has(exKey);
      const excluded = excludedPartsOf(exKey, item);
      const qtyKg = item.kgRemaining;
      const qtySheet = item.sheetRemaining;

      outstandingPoDetails[wi].push({
        poNumber: item.poNumber ?? null,
        poolRef: ref,
        itemDesc: item.desc,
        supplier: item.supplier,
        weekIndex: wi,
        planReceivedDate: item.planReceivedDate ? item.planReceivedDate.toISOString() : null,
        unit: item.unit ?? null,
        qtyKg,
        qtySheet,
        excludedKg: excluded.kg,
        excludedSheet: excluded.sheet,
        allocatedKg,
        allocatedSheet,
        remainingKg: Math.max(0, qtyKg - excluded.kg - allocatedKg),
        remainingSheet: Math.max(0, qtySheet - excluded.sheet - allocatedSheet),
        excluded: isExcluded,
        exclusionReason: isExcluded ? exclusionReasons.get(exKey) ?? null : null,
      });

      // PO yang dikeluarkan user TIDAK ikut baris `Outstanding PO` / `End Ind`.
      if (isExcluded) continue;

      // Bagian milik ukuran ini saja (= qty − yang dikeluarkan sebagian).
      const keptKg = Math.max(0, qtyKg - excluded.kg);
      const keptSheet = Math.max(0, qtySheet - excluded.sheet);

      outstandingPo[wi] += keptKg + (groupFm > 0 ? keptSheet * groupFm : 0);
      // PO bersatuan kg tidak punya angka lembar. Konversi ke lembar memakai
      // Kg/Lbr grup supaya baris `Outstanding PO` (dan `End Ind`) terisi di
      // KEDUA satuan — sama seperti stok yang juga dikonversi lewat `groupFm`.
      // Dua baris di atas sengaja saling cermin: kg array = sheet array × Kg/Lbr
      // grup, supaya angka kg dan lbr pada satu sel `End Ind` tidak bertentangan.
      outstandingPoSheet[wi] += keptSheet + (groupFm > 0 ? keptKg / groupFm : 0);
      const no = String(item.poNumber || '').trim();
      if (no && !outstandingPoNumbers[wi].includes(no)) outstandingPoNumbers[wi].push(no);
    }

    // End Ind = saldo berjalan minggu demi minggu.
    // Sejak rumus carry-over (2026-10-12) `Total + Allowance` bernilai NEGATIF
    // saat kurang, jadi saldo DITAMBAH (bukan dikurangi) supaya End Ind tetap
    // menunjukkan defisit sebagai angka minus — sama seperti tampilan lama.
    const endInd = new Array(weekCount).fill(0) as number[];
    const endIndSheet = new Array(weekCount).fill(0) as number[];
    let balanceKg = stockAsOf;
    let balanceSheet = stockAsOfSheet;
    for (let i = 0; i < weekCount; i += 1) {
      balanceKg = balanceKg + outstandingPo[i] + totalPlusAllowance[i];
      balanceSheet = balanceSheet + outstandingPoSheet[i] + totalPlusAllowanceSheet[i];
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
        stockDetails,
        outstandingPo,
        outstandingPoSheet,
        outstandingPoNumbers,
        outstandingPoDetails,
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
      groupKey: g.groupKey,
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
    lastWeekEnd ?? new Date(timelineStart.getTime() + (weekCount * 7 - 1) * 86400000);

  return {
    periodStartDate: timelineStart,
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
