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
 * - Isi tabel: lembar (lbr) untuk semua baris. Keterangan kg (= lbr × Kg/Lbr)
 *   ditampilkan pada baris Total + Allowance, Stock As Of, Outstanding PO, dan End Ind.
 * - Header dokumen di halaman pertama, nomor halaman di footer.
 */
import type { MaterialGroup, WeeklyMatrix, WeeklyMatrixRow } from '../hooks/useMaterialCalc';
import { PdfDocument, PdfPage, wrapText, type PdfFontName } from './pdf/pdfWriter';

// ── Ukuran halaman & kolom ────────────────────────────────────────────────

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN_X = 22.7; // ± 8 mm
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 26; // ruang untuk footer
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const CONTENT_BOTTOM = PAGE_H - MARGIN_BOTTOM;

/** Lebar kolom tetap (pt). Sisanya dibagi rata untuk seluruh kolom minggu. */
const COL = { part: 44, desc: 104, gsm: 18, width: 20, length: 23, up: 12, kg: 26 };
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
  desc: 5.1,
  label: 5.6,
  kg: 4.3,
  po: 3.5,
  footer: 5.2,
};

const COLORS = {
  text: '#111827',
  muted: '#6b7280',
  faint: '#9ca3af',
  border: '#cbd5e1',
  headBg: '#eef0f3',
  bandBg: '#e0e7ff',
  labelBg: '#f7f8fa',
  strongBg: '#e8eefc',
  endBg: '#e5e7eb',
  red: '#c00000',
  indigo: '#4f46e5',
  strongBorder: '#94a3b8',
};

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

export const MATERIAL_TYPE_LABELS: Record<string, string> = {
  Paper: 'Paper',
  PET: 'PET (R-PET)',
  Flute: 'Flute / Duplek',
  Lainnya: 'Tanpa Data NPOF / Lainnya',
};

export interface PdfExportMeta {
  periodLabel?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  calculatedAt?: string | null;
  exportedAt?: Date;
}

export function materialTypeLabel(materialType: string): string {
  return MATERIAL_TYPE_LABELS[materialType] ?? materialType;
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

function num(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function fmtDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function fmtWeekDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
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
      lineWidth: 0.4,
    });
  }
}

// ── Model isi tabel ───────────────────────────────────────────────────────

interface WeekCell {
  top?: Line;
  bottom?: Line;
  poNumbers?: string[];
}

interface ExportRow {
  kind: 'part' | 'summary';
  label?: string;
  strong?: boolean;
  cells: WeekCell[];
}

function sheetLine(value: number | undefined): Line {
  const v = value ?? 0;
  return { text: num(v, 0), size: FS.body, color: v < 0 ? COLORS.red : COLORS.text };
}

function kgLine(value: number | undefined): Line {
  const v = value ?? 0;
  // Sengaja sama besar & warna penuh dengan baris lbr (tanpa peredupan).
  return { text: num(v, 2), size: FS.body, color: v < 0 ? COLORS.red : COLORS.text };
}

// ── Builder utama ─────────────────────────────────────────────────────────

export function buildMaterialTypePdf(
  materialType: string,
  groups: MaterialGroup[],
  meta: PdfExportMeta = {},
): Uint8Array {
  const doc = new PdfDocument(PAGE_W, PAGE_H);
  const label = materialTypeLabel(materialType);
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
  if (meta.periodLabel) periodBits.push(`Periode: ${meta.periodLabel}`);
  if (meta.periodStart && meta.periodEnd) {
    periodBits.push(`MRP ${fmtDate(meta.periodStart)} – ${fmtDate(meta.periodEnd)}`);
  }
  if (meta.calculatedAt) periodBits.push(`Dihitung: ${fmtDate(meta.calculatedAt, true)}`);
  page.text(MARGIN_X, y + FS.docLine * 0.85, periodBits.join('  ·  ') || 'Periode tidak diketahui', {
    size: FS.docLine,
    color: COLORS.muted,
  });
  y += FS.docLine + 2.5;

  const summaryBits = [
    `${usableGroups.length} grup ukuran`,
    `${usableGroups.reduce((sum, g) => sum + g.details.length, 0)} part`,
    `Diekspor: ${fmtDate(exportedAt.toISOString(), true)}`,
  ];
  if (suppliers.length) summaryBits.push(`Supplier: ${suppliers.join(', ')}`);
  page.text(MARGIN_X, y + FS.docLine * 0.85, summaryBits.join('  ·  '), { size: FS.docLine, color: COLORS.muted });
  y += FS.docLine + 2.5;
  page.text(
    MARGIN_X,
    y + FS.docLine * 0.85,
    'Semua angka dalam lembar (lbr). Keterangan kg (= lbr × Kg/Lbr) pada baris Total + Allowance, Stock As Of, Outstanding PO, End Ind.',
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
      page.text(columns[7].x + bandWidth / 2, y + ROW.band / 2 + FS.band / 2 - 0.7, 'lembar (lbr)', {
        font: 'bold',
        size: FS.band,
        color: '#3730a3',
        align: 'center',
      });
      y += ROW.band;
    }

    const titles = ['Part Number', 'Deskripsi', 'GSM', 'Width', 'Length', 'Up', 'Kg/Lbr'];
    const subs = ['', '', '', '', '', '', ''];
    matrix.columns.forEach((col) => {
      titles.push(col.poMonthLabel);
      subs.push(fmtWeekDate(col.weekStartDate));
    });

    drawRow(
      page,
      y,
      ROW.tableHeader,
      columns,
      titles.map((title, index) => ({
        lines: [
          { text: title, size: FS.header, font: index < 7 ? 'bold' : 'regular', color: index < 7 ? COLORS.text : COLORS.indigo },
          ...(subs[index] ? [{ text: subs[index], size: FS.headerSub, color: COLORS.faint }] : []),
        ],
      })),
      { fill: COLORS.headBg },
    );
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

    const rows: ExportRow[] = matrix.rows.map((row: WeeklyMatrixRow) => ({
      kind: 'part' as const,
      cells: matrix.columns.map((_, index) => ({ top: sheetLine(row.weeksSheet[index]) })),
    }));

    const summaryRow = (
      lbl: string,
      sheets: number[] | number,
      opts: { strong?: boolean; showKg?: boolean; kg?: number[] | number; po?: string[][]; onlyFirst?: boolean } = {},
    ): ExportRow => {
      const sheetArr = Array.isArray(sheets) ? sheets : [sheets];
      const kgArr = opts.kg === undefined ? [] : Array.isArray(opts.kg) ? opts.kg : [opts.kg];
      return {
        kind: 'summary',
        label: lbl,
        strong: opts.strong,
        cells: matrix.columns.map((_, index) => {
          const hasValue = !opts.onlyFirst || index === 0;
          const value = sheetArr[index];
          return {
            top: hasValue ? sheetLine(value) : { text: '—', size: FS.body, color: COLORS.faint },
            ...(opts.showKg && hasValue ? { bottom: kgLine(kgArr[index]) } : {}),
            ...(opts.po?.[index]?.length ? { poNumbers: opts.po[index] } : {}),
          };
        }),
      };
    };

    const allRows: ExportRow[] = [
      ...rows,
      summaryRow('Total Req  ·  sebagian estimasi', summary.totalReqSheet, { strong: true }),
      summaryRow('Allowance (5%)', summary.allowanceSheet),
      summaryRow('Total + Allowance', summary.totalPlusAllowanceSheet, {
        strong: true,
        showKg: true,
        kg: kgOf(summary.totalPlusAllowanceSheet),
      }),
      summaryRow('Stock As Of', summary.stockAsOfSheet, {
        onlyFirst: true,
        showKg: true,
        kg: kgOf(summary.stockAsOfSheet),
      }),
      summaryRow('Outstanding PO', summary.outstandingPoSheet, {
        po: summary.outstandingPoNumbers,
        showKg: true,
        kg: kgOf(summary.outstandingPoSheet),
      }),
      summaryRow('End Ind', summary.endIndSheet, {
        showKg: true,
        kg: kgOf(summary.endIndSheet),
        strong: true,
      }),
    ];

    const descLines = matrix.rows.map((row) => wrapText(row.productName, COL.desc - CELL_PAD * 2, FS.desc, 3));
    const rowHeights = allRows.map((row, index) => {
      if (row.kind === 'part') {
        const lines = descLines[index]?.length ?? 1;
        return Math.max(ROW.bodyMin, lines * (FS.desc + 0.9) + 3.2);
      }
      const hasPo = row.cells.some((cell) => (cell.poNumbers?.length ?? 0) > 0);
      const hasKg = row.cells.some((cell) => cell.bottom);
      return (hasKg ? ROW.endInd : ROW.summary) + (hasPo ? FS.po + 1 : 0);
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
        `${titleBits.join('  |  ')}${continuation ? '   (lanjutan)' : ''}`,
        { font: 'bold', size: FS.groupTitle, color: COLORS.text },
      );
      y += ROW.groupTitle;

      if (!continuation) {
        const estimasi = group.details.filter((d) => d.noNpofData).length;
        const bits = [
          label,
          `${group.details.length} part`,
          `Lead time ${group.leadTimeMonths} bln`,
          group.isSufficient
            ? `Tercukupi, sisa ${num(group.surplusSheet, 0)} lbr`
            : `Kurang ${num(group.totalShortageSheet, 0)} lbr`,
        ];
        if (estimasi > 0) bits.push(`⚠ ${num(estimasi, 0)} part estimasi (data NPOF belum lengkap)`);
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
        const rowData = matrix.rows[index];
        const cells: CellSpec[] = [
          { lines: [{ text: rowData.partNumber, size: FS.body, font: 'bold' }], valign: 'middle' },
          {
            lines: (descLines[index] ?? ['—']).map((text) => ({ text, size: FS.desc, color: COLORS.muted })),
            valign: 'middle',
          },
          { lines: [{ text: rowData.gsm || '—', size: FS.body }], valign: 'middle' },
          { lines: [{ text: rowData.width === null ? '—' : num(rowData.width, 0), size: FS.body }], valign: 'middle' },
          { lines: [{ text: rowData.length === null ? '—' : num(rowData.length, 0), size: FS.body }], valign: 'middle' },
          { lines: [{ text: num(rowData.up, 0), size: FS.body }], valign: 'middle' },
          { lines: [{ text: rowData.hasKg === false ? '—' : num(rowData.kgPerSheet, 4), size: FS.body }], valign: 'middle' },
          ...row.cells.map((cell) => ({
            lines: cell.top ? [{ text: cell.top.text, size: FS.body, color: cell.top.color }] : [],
            valign: 'middle' as const,
          })),
        ];
        drawRow(page, y, height, columns, cells, { bottomBorder: true });
        for (const column of columns.slice(0, 7)) {
          page.line(column.x, y, column.x, y + height, { color: COLORS.border, lineWidth: 0.25 });
        }
      } else {
        const fixedWidth = columns.slice(0, 7).reduce((sum, c) => sum + c.width, 0);
        const strong = Boolean(row.strong);
        const fill = row.label?.startsWith('End Ind') ? COLORS.endBg : strong ? COLORS.strongBg : COLORS.labelBg;
        page.rect(MARGIN_X, y, CONTENT_W, height, { fill });
        page.text(columns[0].x + CELL_PAD, y + height / 2 + FS.label / 2 - 0.9, row.label ?? '', {
          font: 'bold',
          size: FS.label,
          color: COLORS.text,
          maxWidth: fixedWidth - CELL_PAD * 2,
        });
        drawRow(
          page,
          y,
          height,
          columns.slice(7),
          row.cells.map((cell) => ({
            lines: [
              ...(cell.top ? [{ text: cell.top.text, size: cell.top.size ?? FS.body, color: cell.top.color }] : []),
              ...(cell.bottom ? [{ text: cell.bottom.text, size: cell.bottom.size ?? FS.kg, color: cell.bottom.color }] : []),
              ...(cell.poNumbers ? [{ text: cell.poNumbers.join(', '), size: FS.po, color: COLORS.indigo }] : []),
            ],
          })),
          { bottomBorder: false },
        );
        page.line(MARGIN_X, y + height, MARGIN_X + CONTENT_W, y + height, { color: COLORS.border, lineWidth: 0.4 });
        page.line(MARGIN_X + fixedWidth, y, MARGIN_X + fixedWidth, y + height, { color: COLORS.border, lineWidth: 0.3 });
      }

      y += height;
    });

    y += ROW.groupGap;
  }

  // ── Footer: nomor halaman (setelah jumlah halaman diketahui) ──
  const pages = doc.getPages();
  const footerLeft = `${pdfFileName(materialType, exportedAt)}  ·  ${label}`;
  pages.forEach((footerPage, index) => {
    const fy = PAGE_H - MARGIN_BOTTOM + 12;
    footerPage.line(MARGIN_X, fy - 9, MARGIN_X + CONTENT_W, fy - 9, { color: COLORS.border, lineWidth: 0.4 });
    footerPage.text(MARGIN_X, fy, footerLeft, { size: FS.footer, color: COLORS.faint });
    footerPage.text(MARGIN_X + CONTENT_W, fy, `Halaman ${index + 1} dari ${pages.length}`, {
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

