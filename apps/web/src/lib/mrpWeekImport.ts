import * as XLSX from 'xlsx';

/**
 * Parser file Excel "26-Week Demand Plan" (format 26Weeks.xlsx):
 *   Baris 0 : kosong, kosong, kosong, 1, 2, 3 … 26   (nomor minggu di kolom 3+)
 *   Baris 1 : "PN", "Description", "Total", tanggal1, tanggal2 … (kolom 3+)
 *   Baris 2+: itemCode, description, total, qty1, qty2 …
 *
 * Semua tanggal minggu dibentuk dari SATU tanggal dasar dengan penambahan tepat
 * 7 hari — tanggal tiap header hanya dipakai sebagai usulan. Alasannya: pada file
 * Okt-2026 s.d. Apr-2027, kolom Januari tertulis tahun 2026 dan kolom terakhir
 * terduplikasi, sehingga mempercayai tanggal header membuat W1 bergeser dan
 * sebagian minggu kehilangan tanggal.
 */

export interface ImportWeekData {
  weekNumber: number;
  weekStartDate: string; // YYYY-MM-DD
  quantity: number;
}

export interface ImportRow {
  id: string;
  itemCode: string;
  description: string;
  weeks: ImportWeekData[];
  total: number;
}

export interface ParsedWorkbook {
  rows: ImportRow[];
  /** Tanggal minggu pertama (W1) menurut data yang diupload. */
  startDate: string;
}

function formatUTCDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return date.toISOString().slice(0, 10);
}

export function localDateFromISO(dateString: string): Date {
  const [year, month, day] = dateString.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Tambah `days` hari pada tanggal ISO ('YYYY-MM-DD') memakai aritmetika UTC. */
export function addDaysISO(dateString: string, days: number): string {
  const date = new Date(`${dateString.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const MONTH_PREFIXES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Baca satu sel tanggal minggu. Menerima serial Excel, objek Date, maupun teks
 * seperti "10-Oct" / "2-Jan" / "2026-10-10". Teks tanpa tahun mengikuti tahun
 * kolom sebelumnya supaya pergantian Desember → Januari naik satu tahun.
 */
function parseExcelWeekDate(
  cell: XLSX.CellObject | undefined,
  fallbackYear: number,
  previousDate: string,
): string {
  const value = cell?.v;
  if (typeof value === 'number' && value > 0) {
    // Serial Excel (sistem 1900) dihitung manual supaya tidak bergantung pada
    // entry point `xlsx` yang berbeda antara bundel web dan Node.
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatUTCDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value !== 'string') return '';

  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return formatUTCDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dateParts = text.match(/^(\d{1,2})[-\s/]+([A-Za-z]+)(?:[-\s/,]+(\d{2,4}))?$/);
  if (!dateParts) return '';
  const monthName = dateParts[2].toLowerCase();
  const month = MONTH_PREFIXES.findIndex((name) => monthName.startsWith(name)) + 1;
  if (month === 0) return '';

  const day = Number(dateParts[1]);
  const previousMonth = previousDate ? Number(previousDate.slice(5, 7)) : 0;
  const previousYear = previousDate ? Number(previousDate.slice(0, 4)) : fallbackYear;
  const explicitYear = dateParts[3] ? Number(dateParts[3]) : null;
  let year = explicitYear ?? (previousDate ? previousYear + (month < previousMonth ? 1 : 0) : fallbackYear);
  if (explicitYear !== null && explicitYear < 100) year += 2000;
  return formatUTCDate(year, month, day);
}

export function parse26WeekExcel(ws: XLSX.WorkSheet, fallbackYear: number): ParsedWorkbook {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  // Cari baris header tempat kolom 0 berisi "PN".
  let headerRow = -1;
  for (let r = 0; r <= Math.min(10, range.e.r); r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell && String(cell.v).trim().toUpperCase() === 'PN') {
      headerRow = r;
      break;
    }
  }
  if (headerRow === -1) return { rows: [], startDate: '' };

  // Nomor minggu ada di baris tepat di atas header (kolom 3+).
  const weekNumRow = headerRow > 0 ? headerRow - 1 : -1;

  // Kumpulkan kolom minggu beserta tanggal mentahnya. Nomor minggu diambil dari
  // baris di atas header; kalau sel itu tidak berisi angka, urutan kolom dipakai.
  const rawColumns: { col: number; weekNumber: number; rawDate: string }[] = [];
  let previousDate = '';
  let fallbackWeek = 0;
  for (let c = 3; c <= range.e.c; c++) {
    const wCell = weekNumRow >= 0 ? ws[XLSX.utils.encode_cell({ r: weekNumRow, c })] : null;
    const dCell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
    const label = Number(wCell?.v);
    const hasLabel = Number.isInteger(label) && label >= 1 && label <= 52;
    const rawDate = parseExcelWeekDate(dCell, fallbackYear, previousDate);
    if (rawDate) previousDate = rawDate;
    if (!hasLabel && !rawDate) continue; // kolom bukan minggu (mis. Total)
    fallbackWeek += 1;
    rawColumns.push({ col: c, weekNumber: hasLabel ? label : fallbackWeek, rawDate });
  }
  if (rawColumns.length === 0) return { rows: [], startDate: '' };

  // Nomor minggu wajib berurutan tanpa loncat. Kalau label di file tidak
  // konsisten, urutan kolom yang dipakai supaya tidak ada minggu yang hilang.
  const sequential = rawColumns.every(
    (column, index) => index === 0 || column.weekNumber === rawColumns[index - 1].weekNumber + 1,
  );
  if (!sequential) {
    rawColumns.forEach((column, index) => {
      column.weekNumber = index + 1;
    });
  }

  // W1 = tanggal dasar dari suara terbanyak `tanggal kolom - 7*index`, lalu semua
  // kolom dibentuk dengan penambahan TEPAT 7 hari. Tanggal tiap header tidak
  // dipakai langsung karena bisa menyimpang (mis. Januari tertulis 2026 padahal
  // minggu itu jatuh di 2027), yang membuat W1 ikut bergeser.
  const anchorVotes = new Map<string, number>();
  rawColumns.forEach((column, index) => {
    if (!column.rawDate) return;
    const candidate = addDaysISO(column.rawDate, -7 * index);
    anchorVotes.set(candidate, (anchorVotes.get(candidate) ?? 0) + 1);
  });
  let startDate = '';
  let bestVotes = 0;
  for (const [candidate, votes] of anchorVotes) {
    if (votes > bestVotes) {
      startDate = candidate;
      bestVotes = votes;
    }
  }
  if (!startDate) return { rows: [], startDate: '' };

  const weekColumns = rawColumns.map((column, index) => ({
    col: column.col,
    weekNumber: column.weekNumber,
    weekStartDate: addDaysISO(startDate, 7 * index),
  }));

  const rows: ImportRow[] = [];
  let idCounter = 0;
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const cellPN = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const cellDesc = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    const itemCode = cellPN ? String(cellPN.v).trim() : '';
    const description = cellDesc ? String(cellDesc.v).trim() : '';
    if (!itemCode || itemCode.toUpperCase() === 'PN' || itemCode.toLowerCase().includes('total')) continue;

    const weeks: ImportWeekData[] = [];
    let rowTotal = 0;
    for (const wc of weekColumns) {
      const qtyCell = ws[XLSX.utils.encode_cell({ r, c: wc.col })];
      const qty = qtyCell && typeof qtyCell.v === 'number' ? qtyCell.v : 0;
      weeks.push({ weekNumber: wc.weekNumber, weekStartDate: wc.weekStartDate, quantity: Math.round(qty) });
      rowTotal += qty;
    }
    if (weeks.length === 0) continue;
    idCounter++;
    rows.push({ id: `r-${idCounter}`, itemCode, description, weeks, total: Math.round(rowTotal) });
  }
  return { rows, startDate: weekColumns[0].weekStartDate };
}
