/**
 * Helper bersama untuk membaca kolom referensi customer ("Ref-B") pada file
 * Excel Stock Raw Material (`Ref_B_PO`) dan Outstanding PO (`PR Ref-B`).
 *
 * Kedua file menyimpan nilai yang sama-sama berarti "kertas ini untuk customer
 * mana", tetapi nama headernya berbeda. Nilainya disimpan ke satu field
 * seragam `refB` di database.
 */

/**
 * Normalisasi NAMA HEADER supaya pencocokan TIDAK peduli:
 *  - huruf besar/kecil   ("pr ref-b" == "PR Ref-B")
 *  - spasi di awal/akhir (" PR Ref-B " == "PR Ref-B")
 *  - pemisah spasi/underscore/hyphen ("Ref_B_PO" == "Ref B PO" == "REFBPO")
 *
 * Contoh: "PR Ref-B" -> "PRREFB" ; "Ref_B_PO" -> "REFBPO" ;
 *         "Sum of QTY_ORDER" -> "SUMOFQTYORDER".
 */
export function normalizeHeaderName(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[\s_\-]+/g, '')
    .trim();
}

/**
 * Apakah nilai referensi mengandung "MTL" (contains, bukan sama persis)?
 *
 * Aturan:
 *  - contains: "MTL", "PT MTL", "MTL-001", "mtl/JUL 26/RP11.000" semuanya lolos
 *  - TIDAK case-sensitive: "mtl" == "Mtl" == "MTL"
 *  - spasi berlebih di awal/akhir diabaikan
 *  - kosong / null / undefined / NaN -> false (baris dilewati)
 */
export function matchesMtl(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text || text.toUpperCase() === 'NAN') return false;
  return text.toUpperCase().includes('MTL');
}
