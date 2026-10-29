/**
 * Pencocokan ukuran & gramatur material.
 *
 * Dipisah dari `materialCalcEngine.ts` supaya modul lain yang hanya butuh
 * pencocokan ukuran (mis. `materialSizeRecommendation.ts`) bisa memakainya
 * TANPA membuat impor melingkar dengan mesin kalkulasi.
 *
 * `materialCalcEngine.ts` tetap me-re-export seluruh isi file ini, jadi
 * pemanggil lama (`verify-material-calc.ts`, `npofCoverage.ts`, route) tidak
 * perlu diubah.
 */

// ============================================
// Pencocokan material: gramatur + ukuran
// ============================================

/** Item dengan penanda ini tidak dihitung (nebeng = ikut layout part lain). */
export const NEBENG_PATTERN = /nebeng|satu\s*layout|tidak\s*dihitung/i;

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
