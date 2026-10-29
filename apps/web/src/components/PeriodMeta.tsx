import { Pencil, Upload } from 'lucide-react';
import { useTranslation } from '../i18n';
import type { PeriodSourceKey, PeriodSummary } from '../hooks/usePeriods';

/** Nama sumber data untuk menjelaskan upload terakhir berasal dari mana. */
const SOURCE_LABELS: Record<PeriodSourceKey, string> = {
  MRP: '26-Week Demand (MRP)',
  HOTLIST: 'Hot List',
  STOCK_RM: 'Stock Raw Material',
  OUTSTANDING_PO: 'Outstanding PO',
  WIP: 'WIP',
};

/**
 * Info jejak waktu pada kartu folder periode:
 *  - kapan terakhir diupload + siapa (dari `cycle_source_uploads`)
 *  - kapan terakhir diedit manual + siapa (dari `planning_cycles.last_edited_*`)
 */
export function PeriodMeta({ period, className }: { period: PeriodSummary; className?: string }) {
  const { t, locale } = useTranslation();

  const formatDateTime = (iso: string | null) => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const sourceLabel = period.lastUploadSource ? SOURCE_LABELS[period.lastUploadSource] : null;

  return (
    <div className={`mt-1 space-y-0.5 text-[11px] leading-tight text-muted-foreground ${className ?? ''}`}>
      <p className="flex items-start gap-1">
        <Upload size={11} className="mt-[2px] shrink-0" />
        <span className="min-w-0 break-words">
          <span className="font-medium">{t('components.periodUpload')}:</span>{' '}
          {period.lastUploadAt ? (
            <>
              <span className="text-foreground/80">{formatDateTime(period.lastUploadAt)}</span>
              {' · '}
              {period.lastUploadByName ?? '—'}
              {sourceLabel && <span className="text-muted-foreground/70"> · {sourceLabel}</span>}
            </>
          ) : (
            t('components.periodNoUpload')
          )}
        </span>
      </p>
      <p className="flex items-start gap-1">
        <Pencil size={11} className="mt-[2px] shrink-0" />
        <span className="min-w-0 break-words">
          <span className="font-medium">{t('components.periodLastEdit')}:</span>{' '}
          {period.lastEditedAt ? (
            <>
              <span className="text-foreground/80">{formatDateTime(period.lastEditedAt)}</span>
              {' · '}
              {period.lastEditedByName ?? '—'}
            </>
          ) : (
            t('components.periodNoEdit')
          )}
        </span>
      </p>
    </div>
  );
}
