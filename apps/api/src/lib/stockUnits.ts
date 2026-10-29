/**
 * Konversi satuan stok raw material.
 *
 * Daftar satuan ini sebelumnya disalin di beberapa tempat (engine, route, dan
 * frontend), sehingga "sht" — satuan terbanyak di data nyata — pernah terbaca
 * sebagai kg di salah satu salinan. Semua kode baru WAJIB memakai modul ini.
 */

/** Satuan yang berarti "lembar". Data nyata memakai "sht", bukan "sheet". */
export const SHEET_UNITS = ['sheet', 'sheets', 'sht', 'lbr', 'lembar'];

/** Satuan yang berarti "rim" (1 rim = `sheetsPerRim` lembar). */
export const RIM_UNITS = ['rim', 'ream'];

/** Satuan yang berarti "ton". Master Data Outstanding PO memakai singkatan "t". */
export const TON_UNITS = ['t', 'ton', 'tons', 'tonne', 'tonnes'];

/** 1 ton = 1.000 kg. */
export const KG_PER_TON = 1000;

const normalize = (unit: string | null | undefined) => String(unit ?? '').trim().toLowerCase();

export function isSheetUnit(unit: string | null | undefined): boolean {
  return SHEET_UNITS.includes(normalize(unit));
}

export function isRimUnit(unit: string | null | undefined): boolean {
  return RIM_UNITS.includes(normalize(unit));
}

export function isTonUnit(unit: string | null | undefined): boolean {
  return TON_UNITS.includes(normalize(unit));
}

export function isKilogramUnit(unit: string | null | undefined): boolean {
  const u = normalize(unit);
  return u === 'kg' || u === 'kgs' || u === 'kilogram';
}

/** Kg dari qty yang satuannya `unit` (ton dikali 1.000). 0 = satuan tak dikenal. */
export function toKilogram(qty: number, unit: string | null | undefined): number {
  if (isKilogramUnit(unit)) return qty;
  if (isTonUnit(unit)) return qty * KG_PER_TON;
  return 0;
}
