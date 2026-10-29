import * as XLSX from 'xlsx';
import type { DataModule } from '../hooks/usePeriods';
import type { MrpDiffColumn, MrpDiffPart, MrpDiffSummary } from '../hooks/useMrpVersions';

/** Utilitas tampilan & export untuk perbandingan versi MRP. */

export function formatQty(value: number): string {
  return Math.round(value).toLocaleString('id-ID');
}

export function formatSignedQty(value: number): string {
  if (Math.abs(value) < 1e-9) return '0';
  return `${value > 0 ? '+' : '−'}${Math.round(Math.abs(value)).toLocaleString('id-ID')}`;
}

/**
 * Persentase perubahan. `null` bila tidak ada dasar pembanding (qty lama = 0),
 * karena "naik dari 0" tidak punya persentase yang bermakna.
 */
export function changePercent(before: number, after: number): number | null {
  if (Math.abs(before) < 1e-9) return null;
  return ((after - before) / Math.abs(before)) * 100;
}

export function formatPercent(before: number, after: number): string {
  const percent = changePercent(before, after);
  if (percent === null) return 'baru';
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('id-ID')}%`;
}

/** "12 Oct" dari 'YYYY-MM-DD' (tanpa konversi zona waktu). */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
  });
}

export function fullDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function dateTimeLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function weekColumnLabel(column: MrpDiffColumn): string {
  const before = column.beforeWeekNumber;
  const after = column.afterWeekNumber;
  if (before !== null && after !== null) {
    return before === after ? `W${after}` : `W${before}→W${after}`;
  }
  if (after !== null) return `W${after}`;
  if (before !== null) return `W${before}`;
  return '—';
}

const MODULE_FILE_LABEL: Record<DataModule, string> = {
  PRODUCTION: 'Production',
  MATERIAL: 'Material',
};

function safeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Export hasil perbandingan ke Excel: satu sheet ringkasan + satu sheet detail
 * (qty lama, qty baru, selisih, % per minggu).
 */
export function exportMrpComparisonToExcel(params: {
  columns: MrpDiffColumn[];
  parts: MrpDiffPart[];
  summary: MrpDiffSummary;
  periodLabel: string;
  moduleType: DataModule;
  beforeLabel: string;
  afterLabel: string;
  fileName?: string;
}) {
  const { columns, parts, summary, periodLabel, moduleType, beforeLabel, afterLabel } = params;

  const summaryRows: (string | number)[][] = [
    ['Perbandingan Versi MRP 26 Minggu'],
    ['Periode', periodLabel],
    ['Modul', MODULE_FILE_LABEL[moduleType]],
    ['Versi lama', beforeLabel],
    ['Versi baru', afterLabel],
    [],
    ['Ringkasan', 'Nilai'],
    ['Part baru', summary.newParts],
    ['Part dihapus', summary.removedParts],
    ['Part qty berubah', summary.changedParts],
    ['Part tanpa perubahan', summary.unchangedParts],
    ['Total part versi lama', summary.partsBefore],
    ['Total part versi baru', summary.partsAfter],
    ['Total qty versi lama', summary.totalBefore],
    ['Total qty versi baru', summary.totalAfter],
    ['Selisih total qty', summary.totalDelta],
    ['Jumlah minggu versi lama', summary.weekCountBefore],
    ['Jumlah minggu versi baru', summary.weekCountAfter],
    ['Minggu baru (hanya di versi baru)', summary.weeksAdded.map((date) => fullDate(date)).join(', ') || '-'],
    ['Minggu hilang (hanya di versi lama)', summary.weeksRemoved.map((date) => fullDate(date)).join(', ') || '-'],
  ];

  const header: (string | number)[] = ['Part Number', 'Description', 'Status'];
  for (const column of columns) {
    const label = `${weekColumnLabel(column)} (${shortDate(column.weekStartDate)})`;
    header.push(`${label} Lama`, `${label} Baru`, `${label} Selisih`, `${label} %`);
  }
  header.push('Total Lama', 'Total Baru', 'Selisih Total');

  const detailRows = parts.map((part) => {
    const row: (string | number)[] = [part.partNumber, part.description, part.status];
    columns.forEach((_, index) => {
      const [before, after] = part.weeks[index] ?? [0, 0];
      const percent = changePercent(before, after);
      row.push(before, after, after - before, percent === null ? '-' : Math.round(percent * 10) / 10);
    });
    row.push(part.beforeTotal, part.afterTotal, part.afterTotal - part.beforeTotal);
    return row;
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), safeSheetName('Ringkasan', 'Ringkasan'));
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([header, ...detailRows]),
    safeSheetName('Perubahan', 'Perubahan'),
  );

  const defaultName = `MRP-Compare-${periodLabel.replace(/\s+/g, '')}-${beforeLabel}-vs-${afterLabel}.xlsx`;
  XLSX.writeFile(workbook, params.fileName ?? defaultName);
}

/** Export isi satu snapshot (part x minggu) ke Excel. */
export function exportMrpSnapshotToExcel(params: {
  periodLabel: string;
  moduleType: DataModule;
  versionLabel: string;
  parts: Array<{
    partNumber: string;
    description: string;
    total: number;
    weeks: Array<{ weekStartDate: string; quantity: number }>;
  }>;
}) {
  const dates = new Set<string>();
  for (const part of params.parts) for (const week of part.weeks) dates.add(week.weekStartDate.slice(0, 10));
  const columns = Array.from(dates).sort();

  const header = ['Part Number', 'Description', ...columns.map((date) => shortDate(date)), 'Total'];
  const rows = params.parts.map((part) => {
    const byDate = new Map(part.weeks.map((week) => [week.weekStartDate.slice(0, 10), week.quantity]));
    return [part.partNumber, part.description, ...columns.map((date) => byDate.get(date) ?? 0), part.total];
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([header, ...rows]), safeSheetName(params.versionLabel, 'Snapshot'));
  XLSX.writeFile(
    workbook,
    `MRP-${params.periodLabel.replace(/\s+/g, '')}-${MODULE_FILE_LABEL[params.moduleType]}-${params.versionLabel.replace(/\s+/g, '')}.xlsx`,
  );
}
