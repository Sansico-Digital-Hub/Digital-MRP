import { useEffect, useMemo, useState } from 'react';
import {
  useNpofMaterials,
  useNpofMaterialDetail,
  useSyncNpofMaterials,
  type NpofMaterialDetail,
  type NpofMaterialRow,
  type NpofMaterialsParams,
} from '../hooks/useNpofMaterials';
import {
  RefreshCw,
  Search,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  X,
  Info,
} from 'lucide-react';
import { format } from 'date-fns';
import { useAuthStore } from '../stores/authStore';
import { useTranslation } from '../i18n';

type ScenarioFilter = '' | 'main' | 'alt';
type StatusFilter = '' | 'Draft' | 'Waiting for Approval' | 'Completed';
type CalculationFilter = '' | 'active' | 'inactive';

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function recordList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item)
  );
}

function formatSpecSource(source: string | null, t: Translate): string {
  if (source === 'own') return t('npofMaterials.specSourceOwn');
  if (source === 'parent') return t('npofMaterials.specSourceParent');
  if (source === 'none') return t('npofMaterials.specSourceNone');
  return '—';
}

function formatRawSpec(spec: Record<string, unknown> | null): string {
  if (!spec) return '—';
  const entries = Object.entries(spec)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => `${key}=${String(value)}`);
  return entries.length > 0 ? entries.join('; ') : '—';
}

/** NPOF selalu ditampilkan dengan judulnya; id hanya jadi tooltip. */
function npofDisplayTitle(npof: Record<string, unknown>): string {
  return text(npof.npof_title) || text(npof.npof_no) || '—';
}

function npofIdHint(npof: Record<string, unknown>, t: Translate): string | undefined {
  const id = text(npof.npof_id);
  return id ? `${t('npofMaterials.npofId')} #${id}` : undefined;
}

export function NpofMaterials() {
  const { t, dateLocale } = useTranslation();
  const { canEdit } = useAuthStore();
  const isAdmin = canEdit('material');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [scenario, setScenario] = useState<ScenarioFilter>('main');
  const [statusLabel, setStatusLabel] = useState<StatusFilter>('');
  const [calculation, setCalculation] = useState<CalculationFilter>('');
  const [onlyGangPrint, setOnlyGangPrint] = useState(false);
  const [onlyConflict, setOnlyConflict] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const params = useMemo<NpofMaterialsParams>(
    () => ({
      page,
      pageSize,
      search,
      scenario,
      statusLabel,
      calculation,
      gangPrint: onlyGangPrint,
      conflict: onlyConflict,
    }),
    [page, pageSize, search, scenario, statusLabel, calculation, onlyGangPrint, onlyConflict]
  );

  const { data, isLoading, isError, error, refetch, isFetching } = useNpofMaterials(params);
  const detailQuery = useNpofMaterialDetail(detailId);
  const syncMutation = useSyncNpofMaterials();

  // Search server-side dengan debounce 300 ms.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const rows = data?.data ?? [];
  const pagination = data?.pagination;
  const totals = data?.totals;
  const meta = data?.meta;

  const handleSync = () => {
    if (!confirm(t('npofMaterials.confirmSync'))) return;
    syncMutation.mutate(undefined, {
      onSuccess: (result) => {
        alert(
          t('npofMaterials.syncSuccess', {
            created: result.totals.created,
            updated: result.totals.updated,
            deactivated: result.totals.deactivated,
            skipped: result.totals.skipped,
            duration: (result.totals.durationMs / 1000).toFixed(1),
          })
        );
      },
      onError: (syncError: Error) => {
        alert(t('npofMaterials.syncFailed', { message: syncError.message }));
      },
    });
  };

  const formatDate = (value: string | null | undefined) =>
    value ? format(new Date(value), 'PPpp', { locale: dateLocale }) : t('npofMaterials.never');
  const formatShortDate = (value: string | null | undefined) =>
    value ? format(new Date(value), 'MMM d, HH:mm', { locale: dateLocale }) : '—';

  return (
    <div className="p-6 max-w-[1800px] mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('npofMaterials.title')}</h1>
          <p className="text-gray-500 mt-1">
            {t('npofMaterials.subtitle', { plant: meta?.plantLabel ?? 'PT. Printec Perkasa II' })}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {t('npofMaterials.lastSync')}: {formatDate(meta?.lastSyncedAt)}
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={handleSync}
            disabled={syncMutation.isPending}
            className="btn btn-primary"
          >
            {syncMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {syncMutation.isPending
              ? t('npofMaterials.syncRunning')
              : t('npofMaterials.syncFromNpof')}
          </button>
        )}
      </div>

      {meta && !meta.plantVerification.verified && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{t('npofMaterials.verificationFailed')}</p>
            <p className="text-amber-700">{meta.plantVerification.reason}</p>
          </div>
        </div>
      )}

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between bg-gray-50/50">
          <div className="relative w-full xl:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder={t('npofMaterials.searchPlaceholder')}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="input pl-10 w-full bg-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-gray-600">
              <span>{t('npofMaterials.scenarioFilter')}</span>
              <select
                value={scenario}
                onChange={(event) => {
                  setScenario(event.target.value as ScenarioFilter);
                  setPage(1);
                }}
                className="input py-1.5"
              >
                <option value="">{t('npofMaterials.allScenarios')}</option>
                <option value="main">{t('npofMaterials.main')}</option>
                <option value="alt">{t('npofMaterials.alt')}</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-gray-600">
              <span>{t('npofMaterials.statusFilter')}</span>
              <select
                value={statusLabel}
                onChange={(event) => {
                  setStatusLabel(event.target.value as StatusFilter);
                  setPage(1);
                }}
                className="input py-1.5"
              >
                <option value="">{t('npofMaterials.allStatuses')}</option>
                <option value="Draft">{t('npofMaterials.statusDraft')}</option>
                <option value="Waiting for Approval">
                  {t('npofMaterials.statusWaiting')}
                </option>
                <option value="Completed">{t('npofMaterials.statusCompleted')}</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-gray-600" title={t('npofMaterials.calculationHint')}>
              <span>{t('npofMaterials.calculationFilter')}</span>
              <select
                value={calculation}
                onChange={(event) => {
                  setCalculation(event.target.value as CalculationFilter);
                  setPage(1);
                }}
                className="input py-1.5"
              >
                <option value="">{t('npofMaterials.calculationAll')}</option>
                <option value="active">{t('npofMaterials.calculationActive')}</option>
                <option value="inactive">{t('npofMaterials.calculationInactive')}</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-gray-600">
              <input
                type="checkbox"
                checked={onlyGangPrint}
                onChange={(event) => {
                  setOnlyGangPrint(event.target.checked);
                  setPage(1);
                }}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              {t('npofMaterials.onlyGangPrint')}
            </label>

            <label className="flex items-center gap-2 text-gray-600">
              <input
                type="checkbox"
                checked={onlyConflict}
                onChange={(event) => {
                  setOnlyConflict(event.target.checked);
                  setPage(1);
                }}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              {t('npofMaterials.onlyConflict')}
            </label>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm bg-white">
          <span className="text-gray-500">
            {t('npofMaterials.totalRows')}:{' '}
            <span className="font-semibold text-gray-900">{pagination?.total ?? 0}</span>
          </span>
          <span className="text-gray-500">
            {t('npofMaterials.totalUps')}:{' '}
            <span className="font-semibold text-gray-900">
              {totals?.ups ?? 0} ({scenario === 'alt' ? t('npofMaterials.alt') : t('npofMaterials.main')})
            </span>
          </span>
          <span className="text-gray-500">
            {t('npofMaterials.mainUps')}:{' '}
            <span className="font-medium text-gray-800">{totals?.byScenario.main ?? 0}</span>
            <span className="mx-2 text-gray-300">|</span>
            {t('npofMaterials.altUps')}:{' '}
            <span className="font-medium text-gray-800">{totals?.byScenario.alt ?? 0}</span>
          </span>
          {(totals?.excluded ?? 0) > 0 && (
            <span className="text-amber-600" title={t('npofMaterials.excludedHint')}>
              {t('npofMaterials.excludedRows')}: {totals?.excluded}
            </span>
          )}
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50/80 sticky top-0 backdrop-blur-sm">
              <tr>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.partNumber')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.partName')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.productName')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.material')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.gramatur')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.supplier')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.sheetedSize')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.formulaMaterial')}</th>
                <th className="px-3 py-3 font-semibold text-center">{t('npofMaterials.ups')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.rev')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.scenario')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.group')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.status')}</th>
                <th className="px-3 py-3 font-semibold">{t('npofMaterials.lastUpdated')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={14} className="px-4 py-8 text-center text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
                    {t('npofMaterials.loading')}
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={14} className="px-4 py-10 text-center">
                    <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                    <p className="font-medium text-gray-900">{t('npofMaterials.loadFailed')}</p>
                    <p className="text-sm text-gray-500 mt-1">{(error as Error)?.message}</p>
                    <button onClick={() => refetch()} className="btn btn-secondary mt-3">
                      {t('npofMaterials.retry')}
                    </button>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                        <Info className="w-6 h-6 text-gray-400" />
                      </div>
                      <p className="text-gray-900 font-medium">{t('npofMaterials.emptyTitle')}</p>
                      <p className="text-sm mt-1">{t('npofMaterials.emptyHint')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((item) => (
                  <NpofRow
                    key={item.id}
                    item={item}
                    onOpen={() => setDetailId(item.id)}
                    formatDate={formatShortDate}
                    t={t}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination && pagination.total > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <span>
                {t('npofMaterials.showing', {
                  from: (pagination.page - 1) * pagination.pageSize + 1,
                  to: Math.min(pagination.page * pagination.pageSize, pagination.total),
                  total: pagination.total,
                })}
              </span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="input py-1"
              >
                {[25, 50, 100, 200].map((size) => (
                  <option key={size} value={size}>
                    {size} / {t('npofMaterials.page')}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={pagination.page <= 1}
                className="btn btn-secondary disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                {t('npofMaterials.prev')}
              </button>
              <span className="px-2">
                {pagination.page} / {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
                disabled={pagination.page >= pagination.totalPages}
                className="btn btn-secondary disabled:opacity-50"
              >
                {t('npofMaterials.next')}
                <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          </div>
        )}
      </div>

      {detailId && (
        <DetailDrawer
          detail={detailQuery.data}
          isLoading={detailQuery.isLoading}
          isError={detailQuery.isError}
          errorMessage={(detailQuery.error as Error)?.message ?? ''}
          onClose={() => setDetailId(null)}
          formatDate={formatDate}
          plantLabel={meta?.plantLabel ?? 'PT. Printec Perkasa II'}
          t={t}
        />
      )}
    </div>
  );
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

function StatusBadges({ item, t }: { item: NpofMaterialRow; t: Translate }) {
  const badges: Array<{ label: string; className: string; title?: string }> = [];

  const statusLabel =
    item.statusLabel ?? (item.isApproved ? null : t('npofMaterials.notApproved'));
  if (statusLabel) {
    const className =
      item.statusLabel === 'Completed'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : item.statusLabel === 'Waiting for Approval'
          ? 'bg-amber-50 text-amber-700 border-amber-200'
          : 'bg-gray-100 text-gray-600 border-gray-200';
    badges.push({ label: statusLabel, className });
  }

  if (item.isGangPrint) {
    badges.push({
      label: item.isGangPrintParent
        ? t('npofMaterials.badgeGangPrintParent')
        : t('npofMaterials.badgeGangPrint'),
      className: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    });
  }
  if (item.removedInLatestRev) {
    badges.push({
      label: t('npofMaterials.badgeRemoved'),
      className: 'bg-red-50 text-red-700 border-red-200',
    });
  }
  if (item.hasConflict) {
    badges.push({
      label: t('npofMaterials.badgeConflict'),
      className: 'bg-amber-50 text-amber-700 border-amber-200',
    });
  }
  if (item.newerRevPendingApproval) {
    badges.push({
      label: t('npofMaterials.badgePendingApproval'),
      className: 'bg-blue-50 text-blue-700 border-blue-200',
    });
  }
  if (item.altPossiblyStale) {
    badges.push({
      label: t('npofMaterials.badgeStale'),
      className: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    });
  }
  if (item.groupStatus === 'partial') {
    badges.push({
      label: t('npofMaterials.badgePartial'),
      className: 'bg-orange-50 text-orange-700 border-orange-200',
    });
  }

  if (badges.length === 0) return <span className="text-gray-300">—</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span
          key={badge.label}
          title={badge.title}
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function NpofRow({
  item,
  onOpen,
  formatDate,
  t,
}: {
  item: NpofMaterialRow;
  onOpen: () => void;
  formatDate: (value: string | null | undefined) => string;
  t: Translate;
}) {
  const hasPartNumber = item.partNumber.trim() !== '';

  return (
    <tr
      onClick={onOpen}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`cursor-pointer hover:bg-gray-50/70 transition-colors ${
        item.removedInLatestRev ? 'bg-red-50/30' : ''
      } ${!item.isApproved ? 'bg-gray-50/60 opacity-70' : ''}`}
    >
      <td className="px-3 py-2.5">
        {hasPartNumber ? (
          <span className="font-mono font-medium text-gray-900">{item.partNumber}</span>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-gray-400">—</span>
            <span className="inline-flex w-fit rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
              {t('npofMaterials.partNumberEmpty')}
            </span>
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-gray-700">{item.partName || '—'}</td>
      <td className="px-3 py-2.5 text-gray-700 max-w-[260px] truncate" title={item.productName}>
        {item.productName || '—'}
      </td>
      <td className="px-3 py-2.5 text-gray-700">
        <div title={item.material ? undefined : t('npofMaterials.specUnavailable')}>
          {item.material || '—'}
        </div>
        {item.specSource === 'parent' && (
          <div
            className="text-[11px] text-indigo-600"
            title={t('npofMaterials.specFromParentHint')}
          >
            {t('npofMaterials.specFromParent', {
              parent: item.gangPrintParent || '—',
            })}
          </div>
        )}
      </td>
      <td
        className="px-3 py-2.5 text-gray-700 font-medium"
        title={item.gramatur ? undefined : t('npofMaterials.specUnavailable')}
      >
        {item.gramatur || '—'}
      </td>
      <td
        className="px-3 py-2.5 text-gray-700"
        title={item.supplier ? undefined : t('npofMaterials.specUnavailable')}
      >
        {item.supplier || '—'}
      </td>
      <td
        className="px-3 py-2.5 text-gray-700"
        title={item.sheetedSizeRaw || t('npofMaterials.specUnavailable')}
      >
        <div>{item.sheetedSize || '—'}</div>
        {item.sheetedSizeNote && (
          <div className="text-[11px] text-gray-500">{item.sheetedSizeNote}</div>
        )}
      </td>
      <td
        className="px-3 py-2.5 text-gray-500 max-w-[180px] truncate"
        title={item.formulaMaterial || t('npofMaterials.specUnavailable')}
      >
        {item.formulaMaterial || '—'}
      </td>
      <td
        className="px-3 py-2.5 text-center font-semibold text-gray-800"
        title={!item.upsCounted ? t('npofMaterials.upsNotCounted') : undefined}
      >
        {item.ups || '—'}
      </td>
      <td className="px-3 py-2.5 text-gray-700">{item.selectedRev || '—'}</td>
      <td className="px-3 py-2.5">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
            item.scenario === 'alt' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-700'
          }`}
        >
          {item.scenario === 'alt' ? t('npofMaterials.alt') : t('npofMaterials.main')}
        </span>
      </td>
      <td className="px-3 py-2.5 text-gray-700">
        {item.gangPrintGroupId ? (
          <span>
            #{item.gangPrintGroupId}
            {item.groupStatus ? (
              <span className="ml-1 text-[11px] text-gray-500">({item.groupStatus})</span>
            ) : null}
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <StatusBadges item={item} t={t} />
      </td>
      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
        {formatDate(item.lastSyncedAt)}
      </td>
    </tr>
  );
}

function DetailDrawer({
  detail,
  isLoading,
  isError,
  errorMessage,
  onClose,
  formatDate,
  plantLabel,
  t,
}: {
  detail: NpofMaterialDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  onClose: () => void;
  formatDate: (value: string | null | undefined) => string;
  plantLabel: string;
  t: Translate;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const groupMembers = recordList(detail?.groupMembers);
  const conflicts = recordList(detail?.conflicts);
  const pendingNpofs = recordList(detail?.pendingNpofs);
  const sourceNpofs = recordList(detail?.sourceNpofs);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside className="relative h-full w-full max-w-2xl bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">
              {t('npofMaterials.detailTitle')}
            </p>
            <h2 className="text-lg font-semibold text-gray-900 font-mono">
              {detail?.partNumber || '—'}
            </h2>
            <p className="text-sm text-gray-500">{detail?.partName || '—'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100" aria-label={t('npofMaterials.close')}>
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {isLoading ? (
            <div className="py-12 text-center text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
              {t('npofMaterials.detailLoading')}
            </div>
          ) : isError || !detail ? (
            <div className="py-12 text-center text-red-600">
              <AlertCircle className="w-6 h-6 mx-auto mb-2" />
              {t('npofMaterials.detailFailed')} {errorMessage}
            </div>
          ) : (
            <>
              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">
                  {t('npofMaterials.productName')}
                </h3>
                <p className="text-sm text-gray-700">{detail.productName || '—'}</p>
                <p className="text-xs text-gray-500 mt-1 break-words">{detail.npofTitle || '—'}</p>
              </section>

              <section className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <InfoField label={t('npofMaterials.plant')} value={plantLabel} />
                <InfoField
                  label={t('npofMaterials.scenario')}
                  value={detail.scenario === 'alt' ? t('npofMaterials.alt') : t('npofMaterials.main')}
                />
                <InfoField label={t('npofMaterials.rev')} value={detail.selectedRev || '—'} />
                <InfoField
                  label={t('npofMaterials.status')}
                  value={detail.statusLabel || t('npofMaterials.notApproved')}
                />
                <InfoField
                  label={t('npofMaterials.approved')}
                  value={detail.isApproved ? t('npofMaterials.yes') : t('npofMaterials.no')}
                />
                <InfoField
                  label={t('npofMaterials.selectedNpof')}
                  value={detail.npofTitle || '—'}
                  hint={detail.npofId ? `${t('npofMaterials.npofId')} #${detail.npofId}` : undefined}
                />
                <InfoField
                  label={t('npofMaterials.group')}
                  value={detail.gangPrintGroupId ? `#${detail.gangPrintGroupId}` : '—'}
                />
                <InfoField label={t('npofMaterials.groupStatus')} value={detail.groupStatus || '—'} />
                <InfoField
                  label={t('npofMaterials.upsCombined')}
                  value={text(detail.upsCombined) || '—'}
                  hint={!detail.upsCounted ? t('npofMaterials.upsNotCounted') : undefined}
                />
                <InfoField
                  label={t('npofMaterials.upsOriginal')}
                  value={text(detail.upsOriginal) || '—'}
                />
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">
                  {t('npofMaterials.specSource')}
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <InfoField label={t('npofMaterials.material')} value={detail.material || '—'} />
                  <InfoField label={t('npofMaterials.gramatur')} value={detail.gramatur || '—'} />
                  <InfoField label={t('npofMaterials.supplier')} value={detail.supplier || '—'} />
                  <InfoField
                    label={t('npofMaterials.sheetedSize')}
                    value={detail.sheetedSize || '—'}
                    hint={detail.sheetedSizeRaw || undefined}
                  />
                  <InfoField
                    label={t('npofMaterials.formulaMaterial')}
                    value={detail.formulaMaterial || '—'}
                  />
                  <InfoField
                    label={t('npofMaterials.specSource')}
                    value={formatSpecSource(detail.specSource, t)}
                    hint={!detail.specAvailable ? t('npofMaterials.specUnavailable') : undefined}
                  />
                </div>
                {detail.specSource === 'parent' && (
                  <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700">
                    <p className="font-medium">
                      {t('npofMaterials.specFromParent', {
                        parent: detail.gangPrintParent || '—',
                      })}
                    </p>
                    <p className="mt-1 text-indigo-600">{t('npofMaterials.specFromParentHint')}</p>
                    <p className="mt-1 font-mono text-[11px] text-indigo-500 break-words">
                      {t('npofMaterials.rawSpec')}: {formatRawSpec(detail.rawSpec)}
                    </p>
                  </div>
                )}
                {detail.sheetedSizeNote && (
                  <p className="mt-1 text-xs text-gray-500">
                    {t('npofMaterials.note')}: {detail.sheetedSizeNote}
                  </p>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">
                  {t('npofMaterials.groupMembers')}
                </h3>
                {groupMembers.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('npofMaterials.noGroupMembers')}</p>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {groupMembers.map((member, index) => (
                      <li key={index} className="px-3 py-2 text-sm flex justify-between gap-3">
                        <span className="font-mono text-gray-800">
                          {text(member.part_number) || '—'}
                        </span>
                        <span className="text-gray-500">
                          UPS: {text(member.ups_used) || '—'}
                          {member.is_parent ? ` · ${t('npofMaterials.badgeGangPrintParent')}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">
                  {t('npofMaterials.conflicts')}
                </h3>
                {conflicts.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('npofMaterials.noConflicts')}</p>
                ) : (
                  <ul className="space-y-2">
                    {conflicts.map((conflict, index) => (
                      <li
                        key={index}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
                      >
                        <p className="font-medium text-amber-800">
                          {text(conflict.label) || text(conflict.field)}
                        </p>
                        <p className="text-amber-700">
                          {Array.isArray(conflict.values)
                            ? conflict.values.map((value) => text(value)).join(' / ')
                            : text(conflict.values)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">
                  {t('npofMaterials.pendingNpofs')}
                </h3>
                {pendingNpofs.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('npofMaterials.noPendingNpofs')}</p>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {pendingNpofs.map((npof, index) => (
                      <li
                        key={index}
                        className="px-3 py-2 text-sm text-gray-700"
                        title={npofIdHint(npof, t)}
                      >
                        {npofDisplayTitle(npof)} · {text(npof.rev) || '—'}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-2">
                  {t('npofMaterials.sourceNpofs')}
                </h3>
                {sourceNpofs.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('npofMaterials.noSourceNpofs')}</p>
                ) : (
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {sourceNpofs.map((npof, index) => (
                      <li key={index} className="px-3 py-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <span className="text-gray-800" title={npofIdHint(npof, t)}>
                            {npofDisplayTitle(npof)}
                          </span>
                          <span className="text-gray-500">{text(npof.rev) || '—'}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {t('npofMaterials.approvedBy')}: {text(npof.approved_by_name) || '—'} ·{' '}
                          {t('npofMaterials.approvedAt')}: {formatDate(text(npof.approved_at) || null)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function InfoField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-gray-800 break-words">{value}</p>
    </div>
  );
}
