import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

export interface NpofMaterialRow {
  id: string;
  plantId: number;
  partNumber: string;
  partNumberNorm: string;
  partName: string | null;
  productName: string;
  npofId: number | null;
  scenario: string;
  selectedRev: string | null;
  statusLabel: string | null;
  isApproved: boolean;
  upsCounted: boolean;
  specSource: string | null;
  material: string | null;
  gramatur: string | null;
  supplier: string | null;
  sheetedSize: string | null;
  sheetedSizeRaw: string | null;
  sheetedSizeNote: string | null;
  formulaMaterial: string | null;
  ups: string | null;
  upsOriginal: number | null;
  upsCombined: number | null;
  removedInLatestRev: boolean;
  isGangPrint: boolean;
  isGangPrintParent: boolean;
  gangPrintParent: string | null;
  gangPrintGroupId: number | null;
  groupStatus: string | null;
  hasAlt: boolean;
  altPossiblyStale: boolean;
  newerRevPendingApproval: boolean;
  hasConflict: boolean;
  specAvailable: boolean;
  isActive: boolean;
  lastSyncedAt: string | null;
}

export interface NpofMaterialDetail extends NpofMaterialRow {
  npofTitle: string | null;
  conflicts: unknown[] | null;
  groupMembers: unknown[] | null;
  pendingNpofs: unknown[] | null;
  sourceNpofs: unknown[] | null;
  rawSpec: Record<string, unknown> | null;
}

export interface NpofMaterialsParams {
  page: number;
  pageSize: number;
  search?: string;
  scenario?: 'main' | 'alt' | '';
  gangPrint?: boolean;
  conflict?: boolean;
  calculation?: '' | 'active' | 'inactive';
  statusLabel?: '' | 'Draft' | 'Waiting for Approval' | 'Completed';
}

export interface NpofMaterialsResponse {
  data: NpofMaterialRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  totals: {
    ups: number;
    byScenario: { main: number; alt: number };
    rows: number;
    excluded: number;
  };
  meta: {
    plantId: number;
    plantLabel: string;
    allowedPlantIds: number[];
    lastSyncedAt: string | null;
    plantVerification: {
      verified: boolean;
      pp2Id: number | null;
      checkedAt: string | null;
      reason: string | null;
    };
  };
}

export interface NpofSyncResult {
  message: string;
  status: 'success' | 'partial' | 'failed';
  plants: Array<{
    plantId: number;
    created: number;
    updated: number;
    deactivated: number;
    skipped: number;
    durationMs: number;
    error?: string;
  }>;
  totals: {
    created: number;
    updated: number;
    deactivated: number;
    skipped: number;
    durationMs: number;
  };
}

function buildQueryString(params: NpofMaterialsParams): string {
  const query = new URLSearchParams();
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  if (params.search?.trim()) query.set('search', params.search.trim());
  if (params.scenario) query.set('scenario', params.scenario);
  if (params.gangPrint) query.set('gangPrint', 'true');
  if (params.conflict) query.set('conflict', 'true');
  if (params.calculation) query.set('calculation', params.calculation);
  if (params.statusLabel) query.set('statusLabel', params.statusLabel);
  return query.toString();
}

export function useNpofMaterials(params: NpofMaterialsParams) {
  return useQuery({
    queryKey: ['npof-materials', params],
    queryFn: async () => {
      const response = await fetchApi<NpofMaterialsResponse>(
        `/npof-materials?${buildQueryString(params)}`
      );
      return response;
    },
    placeholderData: keepPreviousData,
  });
}

export function useNpofMaterialDetail(id: string | null) {
  return useQuery({
    queryKey: ['npof-materials', 'detail', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const response = await fetchApi<{ data: NpofMaterialDetail }>(`/npof-materials/${id}`);
      return response.data;
    },
  });
}

export function useSyncNpofMaterials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetchApi<NpofSyncResult>('/npof-materials/sync', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['npof-materials'] });
      queryClient.invalidateQueries({ queryKey: ['material-planning'] });
    },
  });
}
