import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Loader2,
  RefreshCw,
  ScanSearch,
  Info,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { dateTimeLabel, exportMrpComparisonToExcel, formatQty, fullDate } from '../../lib/mrpCompare';
import {
  useDeleteMrpVersion,
  useMrpVersionCompare,
  useMrpVersions,
  type MrpVersionMeta,
} from '../../hooks/useMrpVersions';
import type { DataModule } from '../../hooks/usePeriods';
import { useAuthStore } from '../../stores/authStore';
import { ChangeSummaryCards } from './ChangeSummaryCards';
import { VersionCompareTable } from './VersionCompareTable';
import { VersionSnapshotModal } from './VersionSnapshotModal';
import { PartTrendPanel } from './PartTrendPanel';

function versionLabel(version: MrpVersionMeta): string {
  return `Upload ke-${version.versionNumber}`;
}

function VersionCard({
  version,
  onOpen,
  onCompare,
  onDelete,
  canCompare,
  isLatest,
}: {
  version: MrpVersionMeta;
  onOpen: () => void;
  onCompare: (() => void) | null;
  onDelete: (() => void) | null;
  canCompare: boolean;
  isLatest: boolean;
}) {
  return (
    <div
      className={cn(
        'border rounded-lg bg-card p-4 flex flex-col gap-2 transition-colors',
        version.isCurrent ? 'border-emerald-500/70 shadow-sm' : 'hover:border-primary/50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex items-center gap-2 font-semibold text-sm hover:text-primary text-left"
          title="Buka isi snapshot"
        >
          <FolderOpen size={16} className="text-amber-500 shrink-0" />
          {versionLabel(version)}
        </button>
        <div className="flex flex-wrap gap-1 justify-end">
          {version.isCurrent && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600 text-white font-semibold">
              VERSI AKTIF
            </span>
          )}
          {version.source === 'BACKFILL' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold">
              DATA AWAL
            </span>
          )}
          {isLatest && !version.isCurrent && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-foreground font-semibold">
              TERBARU
            </span>
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-0.5">
        <p>
          {dateTimeLabel(version.uploadedAt)} · {version.uploadedByName ?? 'Sistem'}
        </p>
        <p className="flex items-center gap-1 truncate" title={version.fileName ?? ''}>
          <FileSpreadsheet size={12} /> {version.fileName ?? '(tanpa nama file)'}
        </p>
        <p>
          {version.itemCount.toLocaleString('id-ID')} part · {version.rowCount.toLocaleString('id-ID')} baris ·{' '}
          {version.weekCount} minggu
        </p>
        <p>
          Total Qty <span className="font-semibold text-foreground">{formatQty(version.totalQty)}</span>
          {version.weekStartDate ? ` · mulai ${fullDate(version.weekStartDate)}` : ''}
        </p>
      </div>

      <div className="flex gap-2 mt-1">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 h-8 border rounded-md text-xs font-medium hover:bg-muted transition-colors"
        >
          Lihat Isi
        </button>
        {onCompare && (
          <button
            type="button"
            onClick={onCompare}
            disabled={!canCompare}
            className="flex-1 h-8 border rounded-md text-xs font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          >
            <ArrowLeftRight size={12} /> Bandingkan
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            title="Hapus riwayat upload ini (khusus Super Admin)"
            className="h-8 w-9 shrink-0 border rounded-md flex items-center justify-center text-muted-foreground hover:text-red-600 hover:border-red-200 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Tab "History & Compare" untuk satu periode + modul.
 *
 * Setiap upload tersimpan sebagai folder versi. Dua versi bisa dibandingkan
 * (default: terbaru vs sebelumnya), dan qty satu Part Number bisa dilihat
 * trendnya dari upload ke upload.
 */
export function UploadHistoryPanel({
  periodId,
  periodLabel,
  moduleType,
  isAdmin,
}: {
  periodId: string;
  periodLabel: string;
  moduleType: DataModule;
  isAdmin: boolean;
}) {
  const { data, isLoading, isFetching, refetch, error } = useMrpVersions(periodId, moduleType);
  const versions = useMemo(() => data?.data ?? [], [data]);
  const deleteVersion = useDeleteMrpVersion();
  // Hapus riwayat hanya untuk Super Admin (API juga menolak role lain).
  const isSuperAdmin = useAuthStore((state) => state.user?.role) === 'SUPER_ADMIN';

  const handleDeleteVersion = (version: MrpVersionMeta) => {
    // Calon pengganti bila versi aktif dihapus: versi terbaru yang tersisa.
    const fallback = versions.find((candidate) => candidate.id !== version.id);
    const confirmed = window.confirm(
      version.isCurrent
        ? fallback
          ? `Hapus Upload ke-${version.versionNumber}?\n\nVersi ini sedang AKTIF. Menghapusnya akan MENGHAPUS data aktif periode ini dan menggantinya dengan isi Upload ke-${fallback.versionNumber} (data aktif bergeser ke versi sebelumnya). Tindakan ini permanen.`
          : `Hapus Upload ke-${version.versionNumber}?\n\nVersi ini sedang AKTIF dan satu-satunya versi tersimpan. Menghapusnya akan MENGHAPUS seluruh data aktif periode ini. Tindakan ini permanen.`
        : `Hapus Upload ke-${version.versionNumber}?\n\nSnapshot ini dihapus permanen dan tidak bisa dikembalikan. Data aktif tidak terpengaruh.`,
    );
    if (!confirmed) return;
    deleteVersion.mutate(version.id, {
      onSuccess: (result) =>
        alert(
          `Riwayat Upload ke-${version.versionNumber} berhasil dihapus.` +
            (result.wasCurrent
              ? result.promotedVersionNumber
                ? `\nData aktif sekarang memakai Upload ke-${result.promotedVersionNumber} (${(result.liveRowCount ?? 0).toLocaleString('id-ID')} baris).`
                : '\nData aktif periode ini sekarang kosong.'
              : ''),
        ),
      onError: (mutationError) => alert(mutationError.message),
    });
  };

  const [detailVersionId, setDetailVersionId] = useState<string | null>(null);
  const [trendPart, setTrendPart] = useState<string | null>(null);
  const [trendInput, setTrendInput] = useState('');
  const trendRef = useRef<HTMLDivElement | null>(null);

  const latestId = versions[0]?.id ?? '';
  const previousId = versions[1]?.id ?? '';
  // Pilihan versi disimpan bersama kunci periode+modul+daftar versi, sehingga
  // otomatis kembali ke default (terbaru vs sebelumnya) saat konteks berubah.
  const selectionKey = `${periodId}:${moduleType}:${latestId}:${previousId}`;
  const [selection, setSelection] = useState<{ key: string; after: string; before: string } | null>(null);
  const compareAfter = selection?.key === selectionKey ? selection.after : latestId;
  const compareBefore = selection?.key === selectionKey ? selection.before : previousId;
  const setCompare = (after: string, before: string) => setSelection({ key: selectionKey, after, before });

  const canCompare = Boolean(compareAfter && compareBefore && compareAfter !== compareBefore);
  const compareQuery = useMrpVersionCompare(canCompare ? compareAfter : null, canCompare ? compareBefore : null);

  const versionById = useMemo(() => new Map(versions.map((version) => [version.id, version])), [versions]);
  const afterMeta = versionById.get(compareAfter);
  const beforeMeta = versionById.get(compareBefore);
  const detailVersion = detailVersionId ? versionById.get(detailVersionId) : null;

  const openTrend = (partNumber: string) => {
    setTrendPart(partNumber);
    setTrendInput(partNumber);
    requestAnimationFrame(() => trendRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleExport = () => {
    const result = compareQuery.data;
    if (!result?.hasBaseline || !afterMeta || !beforeMeta) return;
    exportMrpComparisonToExcel({
      columns: result.columns,
      parts: result.parts,
      summary: result.summary,
      periodLabel,
      moduleType,
      beforeLabel: versionLabel(beforeMeta),
      afterLabel: versionLabel(afterMeta),
    });
  };

  if (isLoading) {
    return (
      <div className="p-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Memuat riwayat upload...
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-sm text-red-600">{(error as Error).message}</div>;
  }

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border rounded-lg px-3 py-2">
          <Info size={14} className="mt-0.5 shrink-0" />
          <p>
            Riwayat menampilkan setiap upload Excel sebagai snapshot. Versi aktif selalu sama dengan{' '}
            <strong>Data Aktif</strong>; edit manual pada Data Aktif (ubah qty / tambah / hapus baris)
            tidak mengubah snapshot. Snapshot bisa dihapus oleh <strong>Super Admin</strong> — menghapus
            versi aktif akan mengganti Data Aktif dengan isi versi sebelumnya (rollback).
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="h-8 px-3 border rounded-md text-xs font-medium hover:bg-muted flex items-center gap-1.5 shrink-0"
        >
          {isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Muat ulang
        </button>
      </div>

      {versions.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground border rounded-lg bg-card">
          <FolderOpen className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm font-semibold">Belum ada riwayat upload</p>
          <p className="text-xs mt-1">
            {isAdmin
              ? 'Upload file Excel lewat tombol "Import Excel" — setiap upload akan tersimpan sebagai versi baru.'
              : 'Belum ada file MRP yang diupload untuk periode dan modul ini.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">
              Daftar Upload ({versions.length} versi)
            </h4>
            <span className="text-xs text-muted-foreground">
              Terbaru: {afterMeta ? versionLabel(afterMeta) : '—'}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {versions.map((version, index) => (
              <VersionCard
                key={version.id}
                version={version}
                isLatest={index === 0}
                canCompare={versions.length > 1}
                onOpen={() => setDetailVersionId(version.id)}
                onDelete={isSuperAdmin ? () => handleDeleteVersion(version) : null}
                onCompare={() => {
                  setCompare(version.id, versions[index + 1]?.id ?? '');
                }}
              />
            ))}
          </div>
          {versions.length === 1 && (
            <p className="text-xs text-muted-foreground">
              Baru ada 1 versi untuk periode ini. Perbandingan tersedia setelah upload berikutnya
              (minggu depan).
            </p>
          )}
        </div>
      )}

      {versions.length >= 2 && (
        <div className="border rounded-lg bg-card">
          <div className="p-4 border-b flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Versi Lama
              </label>
              <select
                value={compareBefore}
                onChange={(event) => setCompare(compareAfter, event.target.value)}
                className="h-9 px-3 border rounded-md bg-background text-sm min-w-[190px]"
              >
                <option value="">— pilih versi —</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id} disabled={version.id === compareAfter}>
                    {versionLabel(version)} · {dateTimeLabel(version.uploadedAt)}
                  </option>
                ))}
              </select>
            </div>
            <ArrowLeftRight size={16} className="mb-2.5 text-muted-foreground" />
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Versi Baru
              </label>
              <select
                value={compareAfter}
                onChange={(event) => setCompare(event.target.value, compareBefore)}
                className="h-9 px-3 border rounded-md bg-background text-sm min-w-[190px]"
              >
                <option value="">— pilih versi —</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id} disabled={version.id === compareBefore}>
                    {versionLabel(version)} · {dateTimeLabel(version.uploadedAt)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleExport}
              disabled={!compareQuery.data?.hasBaseline}
              className="h-9 px-3 border rounded-md text-sm font-medium hover:bg-muted flex items-center gap-1.5 disabled:opacity-40"
            >
              <Download size={14} /> Export Excel
            </button>
          </div>

          <div className="p-4 space-y-4">
            {!canCompare ? (
              <p className="text-sm text-muted-foreground">
                Pilih dua versi yang berbeda untuk dibandingkan.
              </p>
            ) : compareQuery.isLoading ? (
              <div className="py-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={16} className="animate-spin" /> Membandingkan versi...
              </div>
            ) : compareQuery.isError ? (
              <div className="text-sm text-red-600">{(compareQuery.error as Error).message}</div>
            ) : !compareQuery.data?.hasBaseline || !compareQuery.data.before ? (
              <div className="text-sm text-muted-foreground">
                Versi ini tidak punya pembanding sebelumnya (upload pertama).
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">
                    {versionLabel(compareQuery.data.before)} ({dateTimeLabel(compareQuery.data.before.uploadedAt)})
                  </span>
                  <ArrowLeftRight size={14} className="text-muted-foreground" />
                  <span className="font-semibold">
                    {versionLabel(compareQuery.data.after)} ({dateTimeLabel(compareQuery.data.after.uploadedAt)})
                  </span>
                </div>
                <ChangeSummaryCards summary={compareQuery.data.summary} />
                <VersionCompareTable
                  columns={compareQuery.data.columns}
                  parts={compareQuery.data.parts}
                  onSelectPart={openTrend}
                  emptyMessage="Tidak ada part yang berubah antar kedua versi."
                />
              </>
            )}
          </div>
        </div>
      )}

      <div ref={trendRef} className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Riwayat per Part Number
            </label>
            <input
              type="text"
              value={trendInput}
              onChange={(event) => setTrendInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && trendInput.trim()) openTrend(trendInput.trim());
              }}
              placeholder="Contoh: JLG10-4399P"
              className="h-9 px-3 border rounded-md bg-background text-sm min-w-[220px]"
            />
          </div>
          <button
            type="button"
            onClick={() => trendInput.trim() && openTrend(trendInput.trim())}
            disabled={!trendInput.trim()}
            className="h-9 px-3 border rounded-md text-sm font-medium hover:bg-muted flex items-center gap-1.5 disabled:opacity-40"
          >
            <ScanSearch size={14} /> Lihat Trend
          </button>
        </div>
        {trendPart && (
          <PartTrendPanel
            periodId={periodId}
            moduleType={moduleType}
            partNumber={trendPart}
            onClose={() => setTrendPart(null)}
          />
        )}
      </div>

      {detailVersion && detailVersionId && (
        <VersionSnapshotModal
          versionId={detailVersionId}
          versionLabel={versionLabel(detailVersion)}
          onClose={() => setDetailVersionId(null)}
        />
      )}
    </div>
  );
}
