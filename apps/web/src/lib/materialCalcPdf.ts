/**
 * Export PDF Material Calculation — SATU FILE PDF PER FOLDER JENIS MATERIAL.
 *
 * Aturan yang dipenuhi:
 * - Semua grup ukuran di dalam satu jenis material masuk ke PDF yang sama;
 *   jenis material berbeda TIDAK pernah dicampur dalam satu file.
 * - Setiap ukuran menampilkan 26 kolom minggu sekaligus (landscape, tidak
 *   dipecah ke samping) dan tidak ada kolom yang dipotong.
 * - SATU UKURAN = SATU HALAMAN: tiap blok ukuran selalu mulai di halaman baru
 *   (ukuran tidak lagi ditumpuk dalam satu halaman). Blok pertama boleh ikut
 *   halaman header dokumen.
 * - Kalau tabel satu ukuran memang lebih tinggi dari satu halaman, baris
 *   lanjutannya diberi judul "(lanjutan)" + header kolom ulang dan tidak ada
 *   baris yang terbelah.
 * - Setiap angka minggu diikuti satuannya (lbr/sheets atau kg), seperti pada view.
 *   Baris part HANYA menampilkan lembar; keterangan kg (= lbr × Kg/Lbr) hanya
 *   pada baris Total + Allowance, Stock As Of, Outstanding PO, dan End Ind.
 * - Setiap kolom diberi garis pemisah dan seluruh border tabel berwarna hitam
 *   dengan tebal yang sama.
 * - Header dokumen di halaman pertama, nomor halaman di footer.
 */
import type { MaterialGroup, WeeklyMatrix, WeeklyMatrixRow } from '../hooks/useMaterialCalc';
import type { Lang } from '../i18n';
import materialCalcDict from '../i18n/pages/materialCalc';
import commonDict from '../i18n/common';
import unitDict from '../i18n/unit';
import { PdfDocument, PdfPage, wrapText, type PdfFontName } from './pdf/pdfWriter';

// ── Terjemahan ────────────────────────────────────────────────────────────
//
// Modul ini sengaja TIDAK mengimpor `../i18n/index.ts` karena file tersebut
// memakai `import.meta.glob` (khusus Vite) sehingga akan gagal kalau dipakai
// dari skrip Node (`apps/api/verify-pdf-export.ts`). Sebagai gantinya dict-nya
// dibaca langsung dari file terjemahan biasa.

type PdfDictTree = Record<string, unknown>;

const PDF_NAMESPACES: Record<string, Record<Lang, PdfDictTree>> = {
  materialCalc: materialCalcDict as unknown as Record<Lang, PdfDictTree>,
  common: commonDict as unknown as Record<Lang, PdfDictTree>,
  unit: unitDict as unknown as Record<Lang, PdfDictTree>,
};

/** Kode locale BCP-47 untuk `toLocaleString` / `toLocaleDateString`. */
const pdfLocale = (lang: Lang): string => (lang === 'id' ? 'id-ID' : 'en-US');

function pick(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, tree);
}

/** Terjemahkan key `namespace.path.ke.teks` dari file terjemahan. */
function pdfText(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const [namespace, ...rest] = key.split('.');
  const path = rest.join('.');
  const tree = PDF_NAMESPACES[namespace];
  const text = String(pick(tree?.[lang], path) ?? pick(tree?.id, path) ?? key);
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}


// ── Ukuran halaman & kolom ────────────────────────────────────────────────

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN_X = 22.7; // ± 8 mm
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 26; // ruang untuk footer
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const CONTENT_BOTTOM = PAGE_H - MARGIN_BOTTOM;

/** Lebar kolom tetap (pt). Sisanya dibagi rata untuk seluruh kolom minggu. */
const COL = { part: 44, desc: 78, gsm: 18, width: 20, length: 23, up: 12, kg: 26 };
const FIXED_W = COL.part + COL.desc + COL.gsm + COL.width + COL.length + COL.up + COL.kg;

const FS = {
  title: 13,
  docLine: 5.9,
  groupTitle: 8.4,
  groupMeta: 5.1,
  band: 5.2,
  header: 5.2,
  headerSub: 4.4,
  body: 5.6,
  unit: 3.6,
  kgValue: 4.3,
  desc: 5.1,
  label: 5.6,
  po: 3.5,
  footer: 5.2,
};

const COLORS = {
  text: '#111827',
  muted: '#6b7280',
  faint: '#9ca3af',
  border: '#000000',
  headBg: '#eef0f3',
  bandBg: '#e0e7ff',
  labelBg: '#f7f8fa',
  strongBg: '#e8eefc',
  endBg: '#e5e7eb',
  red: '#c00000',
  indigo: '#4f46e5',
  strongBorder: '#94a3b8',
};

/** Tebal seluruh garis tabel (border hitam) — horizontal & vertikal sama. */
const GRID_W = 1;

const ROW = {
  band: 8.5,
  tableHeader: 17,
  bodyMin: 9.2,
  summary: 9.8,
  endInd: 16.5,
  groupTitle: 12,
  groupMeta: 8.5,
  groupGap: 10,
};

/** Blok tanda tangan yang digambar SEKALI di halaman terakhir dokumen. */
const SIGN = {
  /** Jarak dari baris terakhir blok tabel ke judul kolom tanda tangan. */
  gap: 16,
  label: 7,
  /** Tinggi ruang kosong untuk tanda tangan (antara judul dan garis nama). */
  space: 34,
  name: 5.2,
  gapLabel: 4,
  gapLine: 4,
};
const SIGN_HEIGHT = SIGN.gap + SIGN.label + SIGN.gapLabel + SIGN.space + SIGN.gapLine + SIGN.name;

const MATERIAL_TYPE_LABEL_KEYS: Record<string, string> = {
  Paper: 'materialCalc.materialTypePdf.paper',
  PET: 'materialCalc.materialTypePdf.pet',
  Flute: 'materialCalc.materialTypePdf.flute',
  Lainnya: 'materialCalc.materialTypePdf.lainnya',
};

export interface PdfExportMeta {
  periodLabel?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  calculatedAt?: string | null;
  exportedAt?: Date;
}

export function materialTypeLabel(materialType: string, lang: Lang = 'id'): string {
  const key = MATERIAL_TYPE_LABEL_KEYS[materialType];
  return key ? pdfText(lang, key) : materialType;
}

/** Nama file aman: tanpa spasi atau simbol yang bermasalah di Windows. */
export function materialTypeFileSlug(materialType: string): string {
  const slug = String(materialType || 'Lainnya')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'Material';
}

export function isoDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function pdfFileName(materialType: string, date = new Date()): string {
  return `MaterialCalc_${materialTypeFileSlug(materialType)}_${isoDate(date)}.pdf`;
}

// ── Format angka & tanggal ────────────────────────────────────────────────

function num(value: number | null | undefined, decimals = 0, lang: Lang = 'id'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString(pdfLocale(lang), { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function fmtDate(value: string | null | undefined, withTime = false, lang: Lang = 'id'): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(pdfLocale(lang), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function fmtWeekDate(value: string, lang: Lang = 'id'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(pdfLocale(lang), { day: '2-digit', month: 'short' });
}

// ── Primitif gambar ───────────────────────────────────────────────────────

interface Column {
  x: number;
  width: number;
  align: 'left' | 'right' | 'center';
}

function buildColumns(weekCount: number): Column[] {
  const weekWidth = Math.max(8, (CONTENT_W - FIXED_W) / Math.max(1, weekCount));
  const columns: Column[] = [];
  let x = MARGIN_X;
  const push = (width: number, align: 'left' | 'right' | 'center') => {
    columns.push({ x, width, align });
    x += width;
  };
  push(COL.part, 'left');
  push(COL.desc, 'left');
  push(COL.gsm, 'left');
  push(COL.width, 'right');
  push(COL.length, 'right');
  push(COL.up, 'right');
  push(COL.kg, 'right');
  for (let i = 0; i < weekCount; i += 1) push(weekWidth, 'right');
  return columns;
}

interface Line {
  text: string;
  size?: number;
  font?: PdfFontName;
  color?: string;
}

interface CellSpec {
  lines: Line[];
  valign?: 'top' | 'middle';
}

const CELL_PAD = 2.2;

/**
 * Gambar satu baris tabel: latar, teks per kolom, garis bawah.
 * Angka tidak pernah dipotong (overflow) — kalau terlalu panjang fontnya
 * dikecilkan sampai batas minimum, bukan dihilangkan.
 */
function drawRow(
  page: PdfPage,
  y: number,
  height: number,
  columns: Column[],
  cells: CellSpec[],
  options: { fill?: string; bottomBorder?: boolean } = {},
): void {
  if (options.fill) {
    const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
    page.rect(columns[0].x, y, totalWidth, height, { fill: options.fill });
  }

  cells.forEach((cell, index) => {
    const column = columns[index];
    if (!column || !cell.lines.length) return;
    const maxWidth = column.width - CELL_PAD * 2;
    const gap = 0.9;
    const blockHeight = cell.lines.reduce((sum, line) => sum + (line.size ?? FS.body) + gap, 0) - gap;
    let cursorY =
      cell.valign === 'top'
        ? y + 2 + (cell.lines[0]?.size ?? FS.body)
        : y + (height - blockHeight) / 2 + (cell.lines[0]?.size ?? FS.body);

    for (const line of cell.lines) {
      const size = line.size ?? FS.body;
      const x =
        column.align === 'right'
          ? column.x + column.width - CELL_PAD
          : column.align === 'center'
            ? column.x + column.width / 2
            : column.x + CELL_PAD;
      page.text(x, cursorY, line.text, {
        font: line.font ?? 'regular',
        size,
        color: line.color ?? COLORS.text,
        align: column.align,
        maxWidth,
        minSize: 2.6,
        overflow: true,
      });
      cursorY += size + gap;
    }
  });

  if (options.bottomBorder !== false) {
    const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
    page.line(columns[0].x, y + height, columns[0].x + totalWidth, y + height, {
      color: COLORS.border,
      lineWidth: GRID_W,
    });
  }
}

/**
 * Garis tepi kiri/kanan tabel + garis pemisah SETIAP kolom.
 * `mergedLabel` dipakai baris ringkasan yang sel labelnya digabung sampai kolom
 * Kg/Sheet, jadi garis di antara kolom tetap dilewati.
 */
function drawGrid(
  page: PdfPage,
  y: number,
  height: number,
  columns: Column[],
  mergedLabel = false,
): void {
  const left = columns[0].x;
  const last = columns[columns.length - 1];
  const right = last.x + last.width;
  const drawV = (x: number) => page.line(x, y, x, y + height, { color: COLORS.border, lineWidth: GRID_W });

  drawV(left);
  for (let index = 1; index < columns.length; index += 1) {
    if (mergedLabel && index < 7) continue;
    drawV(columns[index].x);
  }
  drawV(right);
}

/** Tinggi teks bertumpuk dalam satu sel (tanpa padding). */
function linesHeight(lines: Line[]): number {
  if (!lines.length) return 0;
  return lines.reduce((sum, line) => sum + (line.size ?? FS.body) + 0.9, 0) - 0.9;
}

// ── Model isi tabel ───────────────────────────────────────────────────────

interface WeekCell {
  /** Lembar; `null` = tidak ada nilai (tanda "—"). */
  sheets: number | null;
  /** Kg; `undefined` = baris ini tidak menampilkan kg. */
  kg?: number | null;
  /** false = grup tidak punya Kg/Lbr, kolom kg ditandai "—". */
  hasKg?: boolean;
  poNumbers?: string[];
}

interface ExportRow {
  kind: 'part' | 'summary';
  label?: string;
  strong?: boolean;
  endInd?: boolean;
  cells: WeekCell[];
}

/**
 * Blok tanda tangan: satu kolom per penandatangan (Dibuat oleh, Diperiksa oleh,
 * General Manager, Plant Manager) — masing-masing dengan ruang tanda tangan,
 * garis nama, dan keterangan "Nama & Tanggal".
 * Hanya digambar di halaman TERAKHIR dokumen.
 */
function drawSignatureBlock(page: PdfPage, top: number, labels: string[], nameDate: string): void {
  const cellWidth = CONTENT_W / labels.length;
  const innerWidth = cellWidth - CELL_PAD * 2;

  // Garis pemisah antara tabel terakhir dan blok tanda tangan.
  const ruleY = top + SIGN.gap - 7;
  page.line(MARGIN_X, ruleY, MARGIN_X + CONTENT_W, ruleY, { color: COLORS.strongBorder, lineWidth: 0.6 });

  const titleY = top + SIGN.gap + SIGN.label * 0.85;
  const lineY = top + SIGN.gap + SIGN.label + SIGN.gapLabel + SIGN.space;
  const nameY = lineY + SIGN.gapLine + SIGN.name * 0.85;

  labels.forEach((label, index) => {
    const x = MARGIN_X + cellWidth * index;
    page.text(x, titleY, label, {
      font: 'bold',
      size: SIGN.label,
      color: COLORS.text,
      maxWidth: innerWidth,
    });
    page.line(x, lineY, x + innerWidth, lineY, { color: COLORS.text, lineWidth: 0.5 });
    page.text(x, nameY, nameDate, { size: SIGN.name, color: COLORS.muted, maxWidth: innerWidth });
  });
}

/**
 * Isi satu sel minggu. Setiap angka diikuti satuan di baris kecil di bawahnya
 * (mis. "1.011" lalu "lbr") supaya kolom yang sempit tetap terbaca dan
 * tampilannya sama dengan view Material Calculation.
 */
function weekCellLines(cell: WeekCell, lang: Lang): Line[] {
  if (cell.sheets === null) return [{ text: '—', size: FS.body, color: COLORS.faint }];

  const lines: Line[] = [
    {
      text: num(cell.sheets, 0, lang),
      size: FS.body,
      color: cell.sheets < 0 ? COLORS.red : COLORS.text,
    },
    { text: pdfText(lang, 'unit.sheets'), size: FS.unit, color: COLORS.muted },
  ];

  if (cell.kg !== undefined) {
    if (cell.hasKg === false) {
      lines.push({ text: '—', size: FS.kgValue, color: COLORS.faint });
    } else {
      const kilos = cell.kg ?? 0;
      lines.push({
        text: num(kilos, 2, lang),
        size: FS.kgValue,
        color: kilos < 0 ? COLORS.red : COLORS.text,
      });
      lines.push({ text: pdfText(lang, 'unit.kg'), size: FS.unit, color: COLORS.muted });
    }
  }

  if (cell.poNumbers?.length) {
    lines.push({ text: cell.poNumbers.join(', '), size: FS.po, color: COLORS.indigo });
  }
  return lines;
}

// ── Builder utama ─────────────────────────────────────────────────────────

export function buildMaterialTypePdf(
  materialType: string,
  groups: MaterialGroup[],
  meta: PdfExportMeta = {},
  lang: Lang = 'id',
): Uint8Array {
  const doc = new PdfDocument(PAGE_W, PAGE_H);
  const label = materialTypeLabel(materialType, lang);
  const exportedAt = meta.exportedAt ?? new Date();
  const usableGroups = groups.filter(
    (group): group is MaterialGroup & { weeklyMatrix: WeeklyMatrix } => Boolean(group.weeklyMatrix?.columns?.length),
  );
  const suppliers = [...new Set(usableGroups.map((g) => g.supplier).filter(Boolean))];

  let page = doc.addPage();
  let y = MARGIN_TOP;

  const newPage = () => {
    page = doc.addPage();
    y = MARGIN_TOP;
  };

  // ── Header dokumen (halaman pertama) ──
  page.text(MARGIN_X, y + FS.title * 0.85, `Material Calculation — ${label}`, {
    font: 'bold',
    size: FS.title,
    color: COLORS.text,
  });
  y += FS.title + 3;
  const periodBits: string[] = [];
  if (meta.periodLabel) periodBits.push(`${pdfText(lang, 'materialCalc.pdf.period')}: ${meta.periodLabel}`);
  if (meta.periodStart && meta.periodEnd) {
    periodBits.push(`MRP ${fmtDate(meta.periodStart, false, lang)} – ${fmtDate(meta.periodEnd, false, lang)}`);
  }
  if (meta.calculatedAt) periodBits.push(`${pdfText(lang, 'materialCalc.pdf.calculated')}: ${fmtDate(meta.calculatedAt, true, lang)}`);
  page.text(MARGIN_X, y + FS.docLine * 0.85, periodBits.join('  ·  ') || pdfText(lang, 'materialCalc.pdf.unknownPeriod'), {
    size: FS.docLine,
    color: COLORS.muted,
  });
  y += FS.docLine + 2.5;

  const summaryBits = [
    pdfText(lang, 'materialCalc.pdf.groupCount', { count: usableGroups.length }),
    pdfText(lang, 'materialCalc.group.partCount', {
      count: usableGroups.reduce((sum, g) => sum + g.details.length, 0),
    }),
    `${pdfText(lang, 'materialCalc.pdf.exported')}: ${fmtDate(exportedAt.toISOString(), true, lang)}`,
  ];
  if (suppliers.length) summaryBits.push(`${pdfText(lang, 'materialCalc.source.supplier')}: ${suppliers.join(', ')}`);
  page.text(MARGIN_X, y + FS.docLine * 0.85, summaryBits.join('  ·  '), { size: FS.docLine, color: COLORS.muted });
  y += FS.docLine + 2.5;
  page.text(
    MARGIN_X,
    y + FS.docLine * 0.85,
    pdfText(lang, 'materialCalc.pdf.unitNote'),
    { size: FS.docLine, color: COLORS.faint },
  );
  y += FS.docLine + 7;
  page.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y, { color: COLORS.strongBorder, lineWidth: 0.6 });
  y += 9;

  // ── Header tabel mingguan (diulang setiap halaman lanjutan) ──
  const drawTableHeader = (matrix: WeeklyMatrix, columns: Column[], withBand: boolean) => {
    if (withBand) {
      const bandWidth = columns.slice(7).reduce((sum, c) => sum + c.width, 0);
      page.rect(columns[7].x, y, bandWidth, ROW.band, { fill: COLORS.bandBg });
      page.text(columns[7].x + bandWidth / 2, y + ROW.band / 2 + FS.band / 2 - 0.7, pdfText(lang, 'materialCalc.pdf.columnSheets'), {
        font: 'bold',
        size: FS.band,
        color: '#3730a3',
        align: 'center',
      });
      y += ROW.band;
    }

    const titles = [
      pdfText(lang, 'materialCalc.source.partNumber'),
      pdfText(lang, 'common.description'),
      'GSM',
      'Width',
      'Length',
      'Up',
      pdfText(lang, 'materialCalc.matrix.kgPerSheet'),
    ];
    // Header kolom minggu = TANGGAL dari MRP saja (mis. "10 Okt"); label bulan PO
    // ("Jul 26", "Agu 26", …) dihapus atas permintaan user, jadi baris kedua kosong.
    const subs = ['', '', '', '', '', '', ''];
    matrix.columns.forEach((col) => {
      titles.push(fmtWeekDate(col.weekStartDate, lang));
      subs.push('');
    });

    const headerY = y;
    drawRow(
      page,
      headerY,
      ROW.tableHeader,
      columns,
      titles.map((title, index) => ({
        lines: [
          { text: title, size: FS.header, font: index < 7 ? 'bold' : 'regular', color: index < 7 ? COLORS.text : COLORS.indigo },
          ...(subs[index] ? [{ text: subs[index], size: FS.headerSub, color: COLORS.faint }] : []),
        ],
      })),
      { fill: COLORS.headBg, bottomBorder: false },
    );
    drawGrid(page, headerY, ROW.tableHeader, columns);
    page.line(MARGIN_X, headerY, MARGIN_X + CONTENT_W, headerY, { color: COLORS.border, lineWidth: GRID_W });
    page.line(MARGIN_X, headerY + ROW.tableHeader, MARGIN_X + CONTENT_W, headerY + ROW.tableHeader, {
      color: COLORS.border,
      lineWidth: GRID_W,
    });
    y += ROW.tableHeader;
  };

  // ── Satu blok ukuran ──
  // 1 ukuran = 1 halaman: setiap ukuran berikutnya SELALU mulai di halaman baru.
  // Blok pertama tetap memakai halaman header dokumen selama masih muat;
  // ukuran dengan tabel lebih tinggi dari satu halaman tetap berlanjut ke
  // halaman berikutnya (judul "(lanjutan)" + header kolom ulang).
  let firstGroup = true;
  for (const group of usableGroups) {
    const matrix = group.weeklyMatrix;
    const columns = buildColumns(matrix.columns.length);
    const summary = matrix.summary;
    /** Kg/Lbr grup = kolom "Kg/Lbr" baris pertama yang punya formula material. */
    const groupFm = matrix.rows.find((r) => r.hasKg)?.kgPerSheet ?? 0;
    const kgOf = (value: number[] | number): number[] | number =>
      Array.isArray(value) ? value.map((v) => (v ?? 0) * groupFm) : (value ?? 0) * groupFm;

    /** Baris part: HANYA lembar (satuan sheets/lbr), tanpa keterangan kg. */
    const rows: ExportRow[] = matrix.rows.map((row: WeeklyMatrixRow) => ({
      kind: 'part' as const,
      cells: matrix.columns.map((_, index) => ({ sheets: row.weeksSheet[index] ?? 0 })),
    }));

    const summaryRow = (
      lbl: string,
      sheets: number[] | number,
      opts: { strong?: boolean; kg?: number[] | number; po?: string[][]; onlyFirst?: boolean; endInd?: boolean } = {},
    ): ExportRow => {
      const sheetArr = Array.isArray(sheets) ? sheets : [sheets];
      const kgArr = opts.kg === undefined ? undefined : Array.isArray(opts.kg) ? opts.kg : [opts.kg];
      return {
        kind: 'summary',
        label: lbl,
        strong: opts.strong,
        endInd: opts.endInd,
        cells: matrix.columns.map((_, index) => {
          const hasValue = !opts.onlyFirst || index === 0;
          if (!hasValue) return { sheets: null };
          return {
            sheets: sheetArr[index] ?? 0,
            ...(kgArr ? { kg: kgArr[index] ?? 0, hasKg: groupFm > 0 } : {}),
            ...(opts.po?.[index]?.length ? { poNumbers: opts.po[index] } : {}),
          };
        }),
      };
    };

    const allRows: ExportRow[] = [
      ...rows,
      // Total Req & Allowance: hanya lembar.
      summaryRow(pdfText(lang, 'materialCalc.pdf.totalReq'), summary.totalReqSheet, { strong: true }),
      summaryRow(pdfText(lang, 'materialCalc.matrix.allowance'), summary.allowanceSheet),
      // Baris berikut menampilkan lembar + kg, sama seperti view.
      summaryRow(pdfText(lang, 'materialCalc.matrix.totalPlusAllowance'), summary.totalPlusAllowanceSheet, {
        strong: true,
        kg: kgOf(summary.totalPlusAllowanceSheet),
      }),
      summaryRow(pdfText(lang, 'materialCalc.matrix.stockAsOf'), summary.stockAsOfSheet, {
        onlyFirst: true,
        kg: kgOf(summary.stockAsOfSheet),
      }),
      summaryRow(pdfText(lang, 'materialCalc.matrix.outstandingPo'), summary.outstandingPoSheet, {
        po: summary.outstandingPoNumbers,
        kg: kgOf(summary.outstandingPoSheet),
      }),
      summaryRow(pdfText(lang, 'materialCalc.matrix.endInd'), summary.endIndSheet, {
        kg: kgOf(summary.endIndSheet),
        strong: true,
        endInd: true,
      }),
    ];

    const descLines = matrix.rows.map((row) => wrapText(row.productName, COL.desc - CELL_PAD * 2, FS.desc, 3));

    const rowCellSpecs: CellSpec[][] = allRows.map((row, index) => {
      if (row.kind === 'part') {
        const rowData = matrix.rows[index];
        return [
          { lines: [{ text: rowData.partNumber, size: FS.body, font: 'bold' }], valign: 'middle' },
          {
            lines: (descLines[index] ?? ['—']).map((text) => ({ text, size: FS.desc, color: COLORS.muted })),
            valign: 'middle',
          },
          { lines: [{ text: rowData.gsm || '—', size: FS.body }], valign: 'middle' },
          { lines: [{ text: rowData.width === null ? '—' : num(rowData.width, 0, lang), size: FS.body }], valign: 'middle' },
          { lines: [{ text: rowData.length === null ? '—' : num(rowData.length, 0, lang), size: FS.body }], valign: 'middle' },
          { lines: [{ text: num(rowData.up, 0, lang), size: FS.body }], valign: 'middle' },
          { lines: [{ text: rowData.hasKg === false ? '—' : num(rowData.kgPerSheet, 4, lang), size: FS.body }], valign: 'middle' },
          ...row.cells.map((cell) => ({ lines: weekCellLines(cell, lang), valign: 'middle' as const })),
        ];
      }
      return row.cells.map((cell) => ({ lines: weekCellLines(cell, lang), valign: 'top' as const }));
    });

    const rowHeights = allRows.map((row, index) => {
      const minHeight = row.endInd ? ROW.endInd : row.kind === 'part' ? ROW.bodyMin : ROW.summary;
      // +7 memberi ruang descender baris terakhir supaya tidak menyentuh border bawah.
      const contentHeight = Math.max(...rowCellSpecs[index].map((cell) => linesHeight(cell.lines) + 7));
      return Math.max(minHeight, contentHeight);
    });

    const blockHeading = ROW.groupTitle + ROW.groupMeta;
    // Tinggi minimum yang wajib muat supaya judul ukuran tidak menggantung sendiri
    // di dasar halaman (judul + header kolom + minimal 1 baris).
    const minimalKeep = blockHeading + ROW.band + ROW.tableHeader + (rowHeights[0] ?? ROW.bodyMin);

    if (firstGroup) {
      firstGroup = false;
      // Blok pertama boleh berbagi halaman dengan header dokumen, tetapi tetap
      // pindah halaman kalau judul + header + baris pertama sudah tidak muat.
      if (y + minimalKeep > CONTENT_BOTTOM) newPage();
    } else {
      // Satu ukuran = satu halaman: mulai ukuran berikutnya di halaman baru.
      newPage();
    }

    const drawGroupHeading = (continuation: boolean) => {
      const titleBits = [group.ukuran];
      if (group.gramatur) titleBits.push(`${group.gramatur} GSM`);
      if (group.supplier) titleBits.push(group.supplier);
      page.text(
        MARGIN_X,
        y + FS.groupTitle * 0.82,
        `${titleBits.join('  |  ')}${continuation ? `   ${pdfText(lang, 'materialCalc.pdf.continued')}` : ''}`,
        { font: 'bold', size: FS.groupTitle, color: COLORS.text },
      );
      y += ROW.groupTitle;

      if (!continuation) {
        const estimasi = group.details.filter((d) => d.noNpofData).length;
        const bits = [
          label,
          pdfText(lang, 'materialCalc.group.partCount', { count: group.details.length }),
          pdfText(lang, 'materialCalc.table.leadTime') + ` ${group.leadTimeMonths} ${pdfText(lang, 'unit.months')}`,
          group.isSufficient
            ? pdfText(lang, 'materialCalc.pdf.sufficientSurplus', { value: num(group.surplusSheet, 0, lang) })
            : pdfText(lang, 'materialCalc.pdf.shortageSheet', { value: num(group.totalShortageSheet, 0, lang) }),
        ];
        if (estimasi > 0) bits.push(pdfText(lang, 'materialCalc.pdf.estimatedParts', { count: num(estimasi, 0, lang) }));
        page.text(MARGIN_X, y + FS.groupMeta * 0.85, bits.join('  ·  '), { size: FS.groupMeta, color: COLORS.muted });
      }
      y += ROW.groupMeta;
    };

    drawGroupHeading(false);
    drawTableHeader(matrix, columns, true);

    allRows.forEach((row, index) => {
      const height = rowHeights[index];
      if (y + height > CONTENT_BOTTOM) {
        newPage();
        drawGroupHeading(true);
        drawTableHeader(matrix, columns, false);
      }

      if (row.kind === 'part') {
        drawRow(page, y, height, columns, rowCellSpecs[index], { bottomBorder: false });
      } else {
        const fixedWidth = columns.slice(0, 7).reduce((sum, c) => sum + c.width, 0);
        const strong = Boolean(row.strong);
        const fill = row.endInd ? COLORS.endBg : strong ? COLORS.strongBg : COLORS.labelBg;
        page.rect(MARGIN_X, y, CONTENT_W, height, { fill });
        page.text(columns[0].x + CELL_PAD, y + height / 2 + FS.label / 2 - 0.9, row.label ?? '', {
          font: 'bold',
          size: FS.label,
          color: COLORS.text,
          maxWidth: fixedWidth - CELL_PAD * 2,
        });
        drawRow(page, y, height, columns.slice(7), rowCellSpecs[index], { bottomBorder: false });
      }

      page.line(MARGIN_X, y + height, MARGIN_X + CONTENT_W, y + height, { color: COLORS.border, lineWidth: GRID_W });
      drawGrid(page, y, height, columns, row.kind === 'summary');

      y += height;
    });

    y += ROW.groupGap;
  }

  // ── Blok tanda tangan — HANYA di halaman terakhir ──
  // Kalau sisa ruang di halaman terakhir tidak cukup, blok ini pindah ke
  // halaman baru (yang lalu menjadi halaman terakhir).
  const signatureLabels = [
    pdfText(lang, 'materialCalc.pdf.signature.doneBy'),
    pdfText(lang, 'materialCalc.pdf.signature.checkedBy'),
    pdfText(lang, 'materialCalc.pdf.signature.generalManager'),
    pdfText(lang, 'materialCalc.pdf.signature.plantManager'),
  ];
  if (y + SIGN_HEIGHT > CONTENT_BOTTOM) newPage();
  drawSignatureBlock(page, y, signatureLabels, pdfText(lang, 'materialCalc.pdf.signature.nameDate'));

  // ── Footer: nomor halaman (setelah jumlah halaman diketahui) ──
  const pages = doc.getPages();
  const footerLeft = `${pdfFileName(materialType, exportedAt)}  ·  ${label}`;
  pages.forEach((footerPage, index) => {
    const fy = PAGE_H - MARGIN_BOTTOM + 12;
    footerPage.line(MARGIN_X, fy - 9, MARGIN_X + CONTENT_W, fy - 9, { color: COLORS.border, lineWidth: 0.4 });
    footerPage.text(MARGIN_X, fy, footerLeft, { size: FS.footer, color: COLORS.faint });
    footerPage.text(MARGIN_X + CONTENT_W, fy, pdfText(lang, 'materialCalc.pdf.page', { current: index + 1, total: pages.length }), {
      size: FS.footer,
      color: COLORS.muted,
      align: 'right',
    });
  });

  return doc.build();
}

// ── Unduh di browser: lihat materialCalcExport.ts ──────────────────────────
// (Dipisah supaya modul ini murni/tanpa DOM, sehingga bisa dipakai juga oleh
//  skrip verifikasi Node: apps/api/verify-pdf-export.ts.)

