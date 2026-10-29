import { useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { dateTimeLabel, formatQty, shortDate } from '../../lib/mrpCompare';
import { useMrpVersionDetail } from '../../hooks/useMrpVersions';

/**
 * Isi satu snapshot versi (read-only) — dipakai saat folder "Upload ke-N" dibuka.
 */
export function VersionSnapshotModal({
  versionId,
  versionLabel,
  onClose,
}: {
  versionId: string;
  versionLabel: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, error } = useMrpVersionDetail(versionId, page, search);

  const version = data?.data.version;
  const parts = data?.data.parts ?? [];
  const totalPages = Math.max(Math.ceil((data?.totalParts ?? 0) / (data?.pageSize ?? 25)), 1);
  const weeks = parts[0]?.weeks ?? [];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card text-card-foreground border rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-start p-5 border-b">
          <div>
            <h3 className="text-lg font-bold">
              {versionLabel}
              {version?.isCurrent && (
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-600 text-white align-middle">
                  VERSI AKTIF
                </span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {version ? `${dateTimeLabel(version.uploadedAt)} · ${version.uploadedByName ?? 'Sistem'}` : ''}
              {version?.fileName ? ` · ${version.fileName}` : ''}
            </p>
            {version && (
              <p className="text-xs text-muted-foreground">
                {version.itemCount.toLocaleString('id-ID')} part · {version.weekCount} minggu ·{' '}
                {formatQty(version.totalQty)} qty
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            title="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
            <input
              type="text"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Cari Part Number / Description..."
              className="w-full h-8 pl-8 pr-3 border rounded-md bg-background text-xs"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {(data?.totalParts ?? 0).toLocaleString('id-ID')} part
          </span>
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Memuat snapshot...
            </div>
          ) : isError ? (
            <div className="p-8 text-sm text-red-600">{(error as Error).message}</div>
          ) : parts.length === 0 ? (
            <div className="p-8 text-sm text-muted-foreground text-center">Tidak ada data.</div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-muted sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 sticky left-0 z-20 bg-muted min-w-[130px] font-semibold">Part Number</th>
                  <th className="px-3 py-2 sticky left-[130px] z-20 bg-muted min-w-[160px] font-semibold">Description</th>
                  {weeks.map((week) => (
                    <th key={week.weekStartDate} className="px-2 py-1 text-center min-w-[80px] font-semibold">
                      <div>W{week.weekNumber}</div>
                      <div className="text-[10px] font-normal normal-case text-muted-foreground">
                        {shortDate(week.weekStartDate)}
                      </div>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right min-w-[90px] font-semibold bg-muted">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {parts.map((part) => (
                  <tr key={part.partNumber} className="hover:bg-muted/40">
                    <td className="px-3 py-1.5 sticky left-0 z-10 bg-card font-medium">{part.partNumber}</td>
                    <td
                      className="px-3 py-1.5 sticky left-[130px] z-10 bg-card text-muted-foreground max-w-[160px] truncate"
                      title={part.description}
                    >
                      {part.description || '—'}
                    </td>
                    {weeks.map((week) => {
                      const cell = part.weeks.find((item) => item.weekStartDate === week.weekStartDate);
                      return (
                        <td key={week.weekStartDate} className="px-2 py-1.5 text-center tabular-nums">
                          {cell ? cell.quantity.toLocaleString('id-ID') : <span className="text-muted-foreground/30">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formatQty(part.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="p-3 border-t flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Halaman {data?.page ?? 1} dari {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={(data?.page ?? 1) <= 1}
              className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft size={13} />
            </button>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              disabled={(data?.page ?? 1) >= totalPages}
              className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
