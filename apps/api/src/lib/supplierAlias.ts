/**
 * Normalisasi nama supplier.
 *
 * Masalah nyata: satu supplier yang sama ditulis dengan banyak cara, tergantung
 * sumber datanya (NPOF ditulis tangan, stok dari ERP, PO dari Excel pembelian).
 * Contoh di data nyata:
 *   - NPOF: "Hanchang Paper" (133 baris), "HANCHANG" (14), "Hanchang Paper, Foshan" (6)
 *   - PO  : "PHIL CORPORATION" (45 baris) — perusahaan yang SAMA dengan Hanchang
 *   - PO  : "PT. MEGA SURYA ERATAMA" (44) vs NPOF "MEGA PAPER" (31) / "MEGA" (22)
 *   - PO  : "HONGKONG PAPER SOURCES CO.LTD." (23) vs NPOF "Hongkong Paper" (76) / "XSD" (24)
 *
 * Kalau tidak disatukan, dampaknya ke kalkulasi:
 *  1. `groupKey = ukuran || gramatur || supplier` -> satu ukuran terpecah jadi
 *     beberapa grup hanya karena beda tulisan, jadi angka per grup & filter
 *     supplier di UI ikut salah.
 *  2. Lead time kedatangan dicari dari NAMA supplier (MEGA = 2 bulan, Hanchang /
 *     XSD = 3 bulan). Salah tulis = salah lead time = salah kebutuhan.
 *  3. Kalau `MATERIAL_REQUIRE_SUPPLIER=true`, pencocokan stok/PO memakai nama
 *     supplier sehingga stok "PT. MEGA SURYA ERATAMA" tidak dianggap milik "MEGA".
 *
 * SATU SUMBER KEBENARAN untuk semua tempat. Jangan menyalin daftar ini ke file
 * lain — impor dari sini. Daftar yang sama ditampilkan ke user lewat key i18n
 * `materialCalc.supplierAlias.note` (id & en), jadi kalau diubah di sini,
 * perbarui juga teks catatan itu.
 */

export interface SupplierAliasGroup {
  /** Nama kanonik yang dipakai di seluruh sistem. */
  canonical: string;
  /** Lead time kedatangan (bulan) untuk supplier ini. */
  leadTimeMonths: number;
  /**
   * Semua tulisan yang dianggap supplier yang sama.
   * Pencocokan bersifat TOKEN (bukan substring): alias cocok kalau SEMUA kata
   * di alias muncul sebagai kata utuh pada nama supplier. Jadi "MEGA" cocok
   * dengan "PT. MEGA SURYA ERATAMA", tetapi TIDAK cocok dengan "MEGAH".
   */
  aliases: string[];
}

export const SUPPLIER_ALIAS_GROUPS: SupplierAliasGroup[] = [
  {
    canonical: 'HANCHANG',
    leadTimeMonths: 3,
    aliases: ['HANCHANG', 'HANCHANG PAPER', 'PHIL CORPORATION'],
  },
  {
    canonical: 'XSD',
    leadTimeMonths: 3,
    aliases: ['XSD', 'XSD INTERNASIONAL PAPER', 'HONGKONG PAPER', 'HONGKONG PAPER SOURCES'],
  },
  {
    canonical: 'MEGA',
    leadTimeMonths: 2,
    aliases: ['MEGA', 'MEGA PAPER', 'MEGA SURYA ERATAMA'],
  },
  {
    canonical: 'BOSUNG',
    leadTimeMonths: 3,
    // Tidak diminta user, tapi polanya sama: NPOF punya "Bosung" (7) dan
    // "PT.BOSUNG INDONESIA" (7). Hapus grup ini kalau memang beda entitas.
    aliases: ['BOSUNG', 'BOSUNG INDONESIA'],
  },
];

/** Pecah teks menjadi kata (huruf/angka saja, kapital). */
export function supplierTokens(value: string | null | undefined): string[] {
  return String(value || '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Nama kanonik supplier.
 *
 * Nilai kosong/null tetap kosong. Supplier yang tidak ada di daftar alias
 * dikembalikan APA ADANYA (hanya di-trim) supaya tampilan tidak berubah.
 */
export function canonicalSupplier(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const tokens = supplierTokens(raw);
  if (tokens.length === 0) return raw;
  const tokenSet = new Set(tokens);

  let best: { canonical: string; score: number } | null = null;
  for (const group of SUPPLIER_ALIAS_GROUPS) {
    for (const alias of group.aliases) {
      const aliasTokens = supplierTokens(alias);
      if (aliasTokens.length === 0) continue;
      if (!aliasTokens.every((token) => tokenSet.has(token))) continue;
      // Alias paling spesifik (kata terbanyak) yang menang.
      if (!best || aliasTokens.length > best.score) {
        best = { canonical: group.canonical, score: aliasTokens.length };
      }
    }
  }

  return best?.canonical ?? raw;
}

/** Lead time supplier (bulan) dari daftar alias; `null` = tidak dikenal. */
export function supplierLeadTimeMonths(value: string | null | undefined): number | null {
  const canonical = canonicalSupplier(value);
  if (!canonical) return null;
  const group = SUPPLIER_ALIAS_GROUPS.find((g) => g.canonical === canonical);
  return group ? group.leadTimeMonths : null;
}

/** Apakah nama ini supplier yang punya alias (dipakai untuk badge/uji). */
export function isAliasedSupplier(value: string | null | undefined): boolean {
  const canonical = canonicalSupplier(value);
  return SUPPLIER_ALIAS_GROUPS.some((g) => g.canonical === canonical);
}

/**
 * Supplier yang DATANYA TIDAK ADA. Nilai ini tidak bisa dibandingkan dengan
 * supplier mana pun, jadi pool item-nya tetap dianggap cocok — kalau tidak,
 * part tanpa data NPOF (14 baris NPOF supplier kosong, dipakai fallback jumbo
 * roll 180 cm) tidak akan pernah dapat material sama sekali walaupun materialnya
 * nyata ada di gudang.
 */
const SUPPLIER_PLACEHOLDERS = ['', '-', 'unknown', 'n/a', 'na', 'tanpa supplier'];

export function hasSupplierData(value: string | null | undefined): boolean {
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
export function supplierOk(
  itemSupplier: string,
  needSupplier: string,
  required: boolean,
): boolean {
  if (!required) return true;
  if (!hasSupplierData(itemSupplier) || !hasSupplierData(needSupplier)) return true;
  const a = canonicalSupplier(itemSupplier).trim().toLowerCase();
  const b = canonicalSupplier(needSupplier).trim().toLowerCase();
  if (!hasSupplierData(a) || !hasSupplierData(b)) return true;
  return a === b || a.includes(b) || b.includes(a);
}
