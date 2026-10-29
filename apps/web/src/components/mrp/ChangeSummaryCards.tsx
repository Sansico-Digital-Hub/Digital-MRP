import { ArrowLeftRight, Minus, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatPercent, formatQty, formatSignedQty, fullDate } from '../../lib/mrpCompare';
import type { MrpDiffSummary } from '../../hooks/useMrpVersions';

/** Daftar tanggal minggu, dipotong supaya banner tidak memanjang saat rentang jauh berbeda. */
function formatWeekList(dates: string[], limit = 6): string {
  const shown = dates.slice(0, limit).map((date) => fullDate(date)).join(', ');
  return dates.length > limit ? `${shown}, … (+${dates.length - limit} minggu)` : shown;
}

/**
 * Ringkasan perubahan dua versi MRP: jumlah part baru / dihapus / berubah /
 * tanpa perubahan, plus pergeseran total qty dan rentang minggu.
 */
export function ChangeSummaryCards({
  summary,
  className,
}: {
  summary: MrpDiffSummary;
  className?: string;
}) {
  const cards = [
    {
      label: 'Part Baru',
      value: summary.newParts,
      icon: Plus,
      tone: 'text-emerald-600 dark:text-emerald-400',
      hint: 'PN yang belum ada di versi sebelumnya',
    },
    {
      label: 'Part Dihapus',
      value: summary.removedParts,
      icon: Trash2,
      tone: 'text-red-600 dark:text-red-400',
      hint: 'PN yang hilang dari file terbaru',
    },
    {
      label: 'Qty Berubah',
      value: summary.changedParts,
      icon: ArrowLeftRight,
      tone: 'text-amber-600 dark:text-amber-400',
      hint: 'PN yang qty mingguannya berbeda',
    },
    {
      label: 'Tanpa Perubahan',
      value: summary.unchangedParts,
      icon: Minus,
      tone: 'text-muted-foreground',
      hint: 'PN dengan qty identik di semua minggu',
    },
  ];

  const totalDeltaTone =
    summary.totalDelta > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : summary.totalDelta < 0
        ? 'text-red-600 dark:text-red-400'
        : 'text-muted-foreground';

  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-muted/30 rounded-lg p-3 text-center" title={card.hint}>
              <div className={cn('text-2xl font-bold flex items-center justify-center gap-1.5', card.tone)}>
                <Icon size={16} />
                {card.value.toLocaleString('id-ID')}
              </div>
              <div className="text-xs text-muted-foreground">{card.label}</div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs bg-muted/20 border rounded-lg px-3 py-2">
        <span className="text-muted-foreground">
          Total Qty:{' '}
          <span className="font-semibold text-foreground">{formatQty(summary.totalBefore)}</span>
          <span className="mx-1">→</span>
          <span className="font-semibold text-foreground">{formatQty(summary.totalAfter)}</span>
        </span>
        <span className={cn('font-semibold', totalDeltaTone)}>
          {formatSignedQty(summary.totalDelta)} ({formatPercent(summary.totalBefore, summary.totalAfter)})
        </span>
        <span className="text-muted-foreground">
          Minggu: {summary.weekCountBefore} → {summary.weekCountAfter}
        </span>
        <span className="text-muted-foreground">
          Sel berubah: {summary.changedCells.toLocaleString('id-ID')}
        </span>
      </div>

      {(summary.weeksAdded.length > 0 || summary.weeksRemoved.length > 0) && (
        <div className="text-xs border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 rounded-lg px-3 py-2 space-y-1">
          <p className="font-semibold text-amber-800 dark:text-amber-300">
            Rentang minggu bergeser — perbandingan tetap memakai tanggal awal minggu.
          </p>
          {summary.weeksAdded.length > 0 && (
            <p className="text-amber-900/80 dark:text-amber-200/80">
              Minggu baru: {formatWeekList(summary.weeksAdded)}
            </p>
          )}
          {summary.weeksRemoved.length > 0 && (
            <p className="text-amber-900/80 dark:text-amber-200/80">
              Minggu hilang: {formatWeekList(summary.weeksRemoved)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
