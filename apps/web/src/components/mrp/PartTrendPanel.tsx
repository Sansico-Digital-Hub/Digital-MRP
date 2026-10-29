import { Loader2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { dateTimeLabel, formatQty, formatSignedQty, shortDate } from '../../lib/mrpCompare';
import { useMrpPartTrend } from '../../hooks/useMrpVersions';
import type { DataModule } from '../../hooks/usePeriods';

/**
 * Trend satu Part Number dari upload ke upload (per versi).
 * Kolom = versi upload, baris = tanggal minggu.
 */
export function PartTrendPanel({
  periodId,
  moduleType,
  partNumber,
  onClose,
}: {
  periodId: string;
  moduleType: DataModule;
  partNumber: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useMrpPartTrend(periodId, moduleType, partNumber);
  const columns = data?.data.columns ?? [];
  const versions = data?.data.versions ?? [];
  const cells = data?.data.cells ?? {};

  return (
    <div className="border rounded-lg bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h4 className="font-semibold text-sm">Riwayat Part Number: {partNumber}</h4>
          <p className="text-xs text-muted-foreground">
            Qty per upload (versi) dari waktu ke waktu. Kolom minggu memakai tanggal awal minggu.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
          title="Tutup riwayat part"
        >
          <X size={16} />
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Memuat riwayat...
        </div>
      ) : isError ? (
        <div className="p-6 text-sm text-red-600">{(error as Error).message}</div>
      ) : versions.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">Belum ada versi tersimpan untuk periode ini.</div>
      ) : (
        <div className="overflow-auto max-h-[45vh]">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-muted sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 sticky left-0 z-20 bg-muted min-w-[110px] font-semibold">Minggu</th>
                {versions.map((version) => (
                  <th key={version.id} className="px-3 py-2 text-center min-w-[110px] font-semibold">
                    <div className="flex items-center justify-center gap-1">
                      Upload ke-{version.versionNumber}
                      {version.isCurrent && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-600 text-white">AKTIF</span>
                      )}
                    </div>
                    <div className="text-[10px] font-normal normal-case text-muted-foreground">
                      {dateTimeLabel(version.uploadedAt)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr className="bg-muted/20 font-medium">
                <td className="px-3 py-1.5 sticky left-0 z-10 bg-card">Total</td>
                {versions.map((version) => (
                  <td key={version.id} className="px-3 py-1.5 text-center tabular-nums">
                    {formatQty(version.totalQty)}
                  </td>
                ))}
              </tr>
              {columns.map((column, rowIndex) => (
                <tr key={column.weekStartDate} className="hover:bg-muted/30">
                  <td className="px-3 py-1.5 sticky left-0 z-10 bg-card text-muted-foreground">
                    {column.weekNumber ? `W${column.weekNumber} · ` : ''}
                    {shortDate(column.weekStartDate)}
                  </td>
                  {versions.map((version, versionIndex) => {
                    const value = cells[version.id]?.[rowIndex] ?? 0;
                    const previous =
                      versionIndex === 0 ? null : (cells[versions[versionIndex - 1].id]?.[rowIndex] ?? 0);
                    const delta = previous === null ? 0 : value - previous;
                    return (
                      <td key={version.id} className="px-3 py-1.5 text-center tabular-nums">
                        <span className={cn(value === 0 && 'text-muted-foreground/40')}>
                          {value === 0 ? '—' : formatQty(value)}
                        </span>
                        {previous !== null && Math.abs(delta) > 1e-9 && (
                          <span
                            className={cn(
                              'ml-1 text-[10px]',
                              delta > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400',
                            )}
                          >
                            {formatSignedQty(delta)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
