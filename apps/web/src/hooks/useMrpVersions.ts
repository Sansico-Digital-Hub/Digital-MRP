import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { PERIOD_QUERY_KEY, type DataModule } from './usePeriods';

/**
 * Riwayat upload MRP (versioning mingguan).
 *
 * Setiap "Save Overwrite" membuat satu snapshot. Data aktif (`weekly_schedules`)
 * selalu = versi terbaru, sedangkan versi lama tetap bisa dibandingkan.
 */

export interface MrpVersionMeta {
  id: string;
  periodId: string;
  moduleType: DataModule;
  versionNumber: number;
  isCurrent: boolean;
  source: 'UPLOAD' | 'BACKFILL';
  fileName: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
  uploadedByName: string | null;
  itemCount: number;
  rowCount: number;
  totalQty: number;
  weekStartDate: string | null;
  weekCount: number;
  notes: string | null;
}

export interface MrpDiffColumn {
  weekStartDate: string;
  beforeWeekNumber: number | null;
  afterWeekNumber: number | null;
}

export type MrpDiffStatus = 'NEW' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';

export interface MrpDiffPart {
  partNumber: string;
  description: string;
  status: MrpDiffStatus;
  beforeTotal: number;
  afterTotal: number;
  changedWeeks: number;
  /** Sejajar dengan `columns`: [qty lama, qty baru]. */
  weeks: Array<[number, number]>;
}

export interface MrpDiffSummary {
  partsBefore: number;
  partsAfter: number;
  newParts: number;
  removedParts: number;
  changedParts: number;
  unchangedParts: number;
  totalBefore: number;
  totalAfter: number;
  totalDelta: number;
  changedCells: number;
  weekCountBefore: number;
  weekCountAfter: number;
  weeksAdded: string[];
  weeksRemoved: string[];
  beforeWeekStartDate: string | null;
  afterWeekStartDate: string | null;
}

export interface MrpDiffPayload {
  hasBaseline: boolean;
  columns: MrpDiffColumn[];
  summary: MrpDiffSummary;
  parts: MrpDiffPart[];
}

export interface MrpBaselineRef {
  id: string | null;
  versionNumber: number;
  uploadedAt: string | null;
  uploadedByName: string | null;
  fileName: string | null;
  source: 'VERSION' | 'LIVE';
}

export interface MrpPreviewResponse extends MrpDiffPayload {
  baseline: MrpBaselineRef | null;
  nextVersionNumber: number;
  warnings: string[];
}

export interface MrpCompareResponse extends MrpDiffPayload {
  before: MrpVersionMeta | null;
  after: MrpVersionMeta;
}

/** Baris hasil parser Excel yang dikirim ke API. */
export interface MrpUploadWeek {
  weekNumber: number;
  weekStartDate: string;
  quantity: number;
}

export interface MrpUploadRow {
  partNumber: string;
  description: string;
  weeks: MrpUploadWeek[];
}

export interface SaveMrpVersionInput {
  periodId: string;
  moduleType: DataModule;
  fileName: string;
  clientRequestId: string;
  rows: MrpUploadRow[];
}

export interface MrpSaveResponse {
  data: MrpVersionMeta;
  duplicate: boolean;
  count: number;
  replaced?: number;
  periodId: string;
  moduleType: DataModule;
  label: string;
  created: boolean;
}

const VERSIONS_KEY = (periodId: string | null | undefined, moduleType: DataModule) => [
  'mrpVersions',
  periodId ?? 'none',
  moduleType,
];

export function useMrpVersions(periodId: string | null | undefined, moduleType: DataModule) {
  return useQuery<{ data: MrpVersionMeta[]; currentVersionId: string | null }, Error>({
    queryKey: VERSIONS_KEY(periodId, moduleType),
    enabled: Boolean(periodId),
    queryFn: () =>
      fetchApi(
        `/mrp-versions?periodId=${encodeURIComponent(periodId as string)}&moduleType=${moduleType}`,
      ),
  });
}

/** Pratinjau perubahan terhadap versi terakhir — dipanggil saat file dipilih. */
export function usePreviewMrpVersion() {
  return useMutation<
    MrpPreviewResponse,
    Error,
    { periodId: string; moduleType: DataModule; rows: MrpUploadRow[] }
  >({
    mutationFn: (body) =>
      fetchApi('/mrp-versions/preview', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

export function useSaveMrpVersion() {
  const queryClient = useQueryClient();
  return useMutation<MrpSaveResponse, Error, SaveMrpVersionInput>({
    mutationFn: (body) =>
      fetchApi('/mrp-versions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mrpVersions'] });
      queryClient.invalidateQueries({ queryKey: ['weeklySchedule'] });
      queryClient.invalidateQueries({ queryKey: PERIOD_QUERY_KEY });
    },
  });
}

/** Hapus satu snapshot riwayat — endpoint menolak bila bukan Super Admin. */
export function useDeleteMrpVersion() {
  const queryClient = useQueryClient();
  return useMutation<
    {
      success: boolean;
      id: string;
      versionNumber: number;
      wasCurrent: boolean;
      promotedVersionNumber: number | null;
      liveRowCount: number | null;
    },
    Error,
    string
  >({
    mutationFn: (id) =>
      fetchApi(`/mrp-versions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mrpVersions'] });
    },
  });
}

export function useMrpVersionCompare(
  versionId: string | null | undefined,
  againstId: string | null | undefined,
) {
  return useQuery<MrpCompareResponse, Error>({
    queryKey: ['mrpVersions', 'compare', versionId ?? 'none', againstId ?? 'auto'],
    enabled: Boolean(versionId),
    queryFn: () =>
      fetchApi(
        `/mrp-versions/${encodeURIComponent(versionId as string)}/compare${
          againstId ? `?againstId=${encodeURIComponent(againstId)}` : ''
        }`,
      ),
  });
}

export interface MrpPartTrendResponse {
  data: {
    partNumber: string;
    columns: Array<{ weekStartDate: string; weekNumber: number | null }>;
    versions: MrpVersionMeta[];
    cells: Record<string, number[]>;
  };
}

export function useMrpPartTrend(
  periodId: string | null | undefined,
  moduleType: DataModule,
  partNumber: string | null,
) {
  return useQuery<MrpPartTrendResponse, Error>({
    queryKey: ['mrpVersions', 'trend', periodId ?? 'none', moduleType, partNumber ?? ''],
    enabled: Boolean(periodId && partNumber),
    queryFn: () =>
      fetchApi(
        `/mrp-versions/trend?periodId=${encodeURIComponent(periodId as string)}&moduleType=${moduleType}&partNumber=${encodeURIComponent(
          partNumber as string,
        )}`,
      ),
  });
}

export interface MrpVersionDetailResponse {
  data: {
    version: MrpVersionMeta;
    parts: Array<{
      partNumber: string;
      description: string;
      total: number;
      weeks: Array<{
        weekNumber: number;
        weekStartDate: string;
        weekEndDate: string;
        quantity: number;
      }>;
    }>;
  };
  totalParts: number;
  page: number;
  pageSize: number;
}

export function useMrpVersionDetail(
  versionId: string | null | undefined,
  page: number,
  search: string,
) {
  return useQuery<MrpVersionDetailResponse, Error>({
    queryKey: ['mrpVersions', 'detail', versionId ?? 'none', page, search],
    enabled: Boolean(versionId),
    queryFn: () =>
      fetchApi(
        `/mrp-versions/${encodeURIComponent(versionId as string)}?page=${page}&pageSize=25&search=${encodeURIComponent(
          search,
        )}`,
      ),
  });
}
