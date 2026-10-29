import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, History, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  formatPercent,
  formatQty,
  formatSignedQty,
  shortDate,
  weekColumnLabel,
} from '../../lib/mrpCompare';
import type { MrpDiffColumn, MrpDiffPart, MrpDiffStatus } from '../../hooks/useMrpVersions';

const ROWS_PER_PAGE = 25;

const STATUS_BADGE: Record<MrpDiffStatus, { label: string; className: string }> = {
  NEW: { label: 'NEW', className: 'bg-emerald-600 text-white' },
  REMOVED: { label: 'REMOVED', className: 'bg-red-600 text-white' },
  CHANGED: { label: 'UBAH', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' },
  UNCHANGED: { label: 'SAMA', className: 'bg-muted text-muted-foreground' },
};

function WeekCell({ before, after }: { before: number; after: number }) {
  const delta = after - before;
  if (Math.abs(delta) < 1e-9) {
    return before === 0 ? (
      <span className="text-muted-foreground/30">—</span>
    ) : (
      <span className="text-muted-foreground tabular-nums">{formatQty(before)}</span>
    );
  }

  const up = delta > 0;
  return (
    <div
      className={cn(
        'rounded px-1 py-0.5 leading-tight',
        up ? 'bg-emerald-50 dark:bg-emerald-950/40' : 'bg-red-50 dark:bg-red-950/40',
      )}
    >
      <div
        className={cn(
          'font-medium tabular-nums',
          up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
        )}
      >
        {formatQty(before)} → {formatQty(after)}
      </div>
      <div
        className={cn(
          'text-[10px] tabular-nums',
          up ? 'text-emerald-600/80 dark:text-emerald-500/80' : 'text-red-500/80 dark:text-red-400/80',
        )}
      >
        {formatSignedQty(delta)} ({formatPercent(before, after)})
      </div>
    </div>
  );
}

/**
 * Tabel perbandingan per part & per minggu (qty lama → baru, selisih, %).
 * Kolom memakai TANGGAL minggu, bukan nomor W1–W26, karena rentang upload bisa
 * bergeser antar minggu.
 */
export function VersionCompareTable({
  columns,
  parts,
  onSelectPart,
  emptyMessage = 'Tidak ada part yang cocok dengan filter.',
  initialOnlyChanged = true,
  maxHeightClass = 'max-h-[55vh]',
  toolbarExtra,
}: {
  columns: MrpDiffColumn[];
  parts: MrpDiffPart[];
  onSelectPart?: (partNumber: string) => void;
  emptyMessage?: string;
  initialOnlyChanged?: boolean;
  maxHeightClass?: string;
  toolbarExtra?: React.ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(initialOnlyChanged);
  const [page, setPage] = useState(0);  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return parts.filter((part) => {
      if (onlyChanged && part.status === 'UNCHANGED') return false;
      if (!keyword) return true;
      return (
        part.partNumber.toLowerCase().includes(keyword) ||
        part.description.toLowerCase().includes(keyword)
      );
    });
  }, [parts, onlyChanged, search]);

  const totalPages = Math.max(Math.ceil(filtered.length / ROWS_PER_PAGE), 1);
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(safePage * ROWS_PER_PAGE, (safePage + 1) * ROWS_PER_PAGE);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyChanged}
            onChange={(event) => {
              setOnlyChanged(event.target.checked);
              setPage(0);
            }}
            className="rounded border-gray-300"
          />
          Tampilkan hanya yang berubah
        </label>
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
          <input
            type="text"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="Cari Part Number / Description..."
            className="w-full h-8 pl-8 pr-3 border rounded-md bg-background text-xs"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length.toLocaleString('id-ID')} part · {columns.length} minggu
        </span>
        {toolbarExtra}
      </div>

      <div className={cn('border rounded-md overflow-auto', maxHeightClass)}>
        <table className="w-full text-xs text-left border-collapse">
          <thead className="bg-muted sticky top-0 z-20">
            <tr>
              <th className="px-3 py-2 sticky left-0 z-30 bg-muted min-w-[130px] font-semibold">Part Number</th>
              <th className="px-3 py-2 sticky left-[130px] z-30 bg-muted min-w-[170px] font-semibold">Description</th>
              <th className="px-2 py-2 text-center min-w-[70px] font-semibold">Status</th>
              {columns.map((column) => {
                const isNewWeek = column.beforeWeekNumber === null;
                const isDroppedWeek = column.afterWeekNumber === null;
                return (
                  <th
                    key={column.weekStartDate}
                    className={cn(
                      'px-2 py-1 text-center min-w-[104px] font-semibold',
                      isNewWeek && 'bg-emerald-100/70 dark:bg-emerald-950/50',
                      isDroppedWeek && 'bg-red-100/70 dark:bg-red-950/50',
                    )}
                    title={`Mulai minggu ${column.weekStartDate}`}
                  >
                    <div>{weekColumnLabel(column)}</div>
                    <div className="text-[10px] font-normal normal-case text-muted-foreground">
                      {shortDate(column.weekStartDate)}
                      {isNewWeek && ' · baru'}
                      {isDroppedWeek && ' · hilang'}
                    </div>
                  </th>
                );
              })}
              <th className="px-3 py-2 text-right min-w-[130px] font-semibold bg-muted">Total</th>
              {onSelectPart && <th className="px-2 py-2 text-center w-10 font-semibold" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (onSelectPart ? 5 : 4)} className="p-8 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visible.map((part) => {
                const badge = STATUS_BADGE[part.status];
                const totalDelta = part.afterTotal - part.beforeTotal;
                return (
                  <tr
                    key={part.partNumber}
                    className={cn(
                      'hover:bg-muted/40 transition-colors',
                      part.status === 'REMOVED' && 'opacity-70',
                    )}
                  >
                    <td className="px-3 py-1.5 sticky left-0 z-10 bg-card font-medium">{part.partNumber}</td>
                    <td
                      className="px-3 py-1.5 sticky left-[130px] z-10 bg-card text-muted-foreground max-w-[170px] truncate"
                      title={part.description}
                    >
                      {part.description || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-semibold', badge.className)}>
                        {badge.label}
                      </span>
                    </td>
                    {columns.map((column, index) => {
                      const [before, after] = part.weeks[index] ?? [0, 0];
                      return (
                        <td key={column.weekStartDate} className="px-1 py-1.5 text-center">
                          <WeekCell before={before} after={after} />
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right bg-card">
                      <div className="font-medium tabular-nums">
                        {formatQty(part.beforeTotal)} → {formatQty(part.afterTotal)}
                      </div>
                      <div
                        className={cn(
                          'text-[10px] tabular-nums',
                          Math.abs(totalDelta) < 1e-9
                            ? 'text-muted-foreground'
                            : totalDelta > 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400',
                        )}
                      >
                        {Math.abs(totalDelta) < 1e-9
                          ? 'tidak berubah'
                          : `${formatSignedQty(totalDelta)} (${formatPercent(part.beforeTotal, part.afterTotal)})`}
                      </div>
                    </td>
                    {onSelectPart && (
                      <td className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => onSelectPart(part.partNumber)}
                          title="Lihat riwayat Part Number ini"
                          className="p-1 text-muted-foreground hover:text-primary hover:bg-muted rounded transition-colors"
                        >
                          <History size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Baris {safePage * ROWS_PER_PAGE + 1}–{Math.min((safePage + 1) * ROWS_PER_PAGE, filtered.length)} dari{' '}
            {filtered.length.toLocaleString('id-ID')}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={safePage === 0}
              className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft size={13} />
            </button>
            <span>
              {safePage + 1}/{totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
              disabled={safePage >= totalPages - 1}
              className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
