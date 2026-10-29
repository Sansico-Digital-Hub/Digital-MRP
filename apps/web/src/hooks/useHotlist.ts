import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { PERIOD_QUERY_KEY } from './usePeriods';

export interface HotlistData {
  id: string;
  periodId: string;
  partNumber: string;
  date: string;
  previousDate?: string | null;
  biTotal: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Data Hot List untuk SATU periode. `periodId` wajib — tanpa itu permintaan
 * tidak dijalankan supaya data antar periode tidak pernah tercampur.
 */
export const useHotlist = (periodId?: string | null) => {
  return useQuery({
    queryKey: ['hotlist', periodId],
    enabled: Boolean(periodId),
    queryFn: async () => {
      const response = await fetchApi<{ data: HotlistData[] }>(
        `/hotlist?periodId=${encodeURIComponent(periodId as string)}`,
      );
      return response;
    },
  });
};

export const useUploadHotlist = () => {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetchApi<{ message: string; data: Omit<HotlistData, 'id' | 'createdAt' | 'updatedAt'>[] }>('/hotlist/upload', {
        method: 'POST',
        body: formData,
      });
      return response;
    },
  });
};

export const useAddManualHotlist = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { partNumber: string; date: string; biTotal: number; periodId: string }) => {
      const response = await fetchApi<{ data: HotlistData }>('/hotlist', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotlist'] });
      queryClient.invalidateQueries({ queryKey: PERIOD_QUERY_KEY });
    },
  });
};

export const useUpdateHotlist = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ partNumber: string; date: string; biTotal: number }> }) => {
      const response = await fetchApi<{ data: HotlistData }>(`/hotlist/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotlist'] });
    },
  });
};

export const useDeleteHotlist = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchApi<{ message: string }>(`/hotlist/${id}`, {
        method: 'DELETE',
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotlist'] });
    },
  });
};

export const useImportHotlist = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ data, mode, periodId }: { data: Omit<HotlistData, 'id' | 'periodId' | 'createdAt' | 'updatedAt'>[], mode: 'add' | 'overwrite'; periodId: string }) => {
      const response = await fetchApi<{ message: string; count: number }>('/hotlist/import', {
        method: 'POST',
        body: JSON.stringify({ data, mode, periodId }),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotlist'] });
      queryClient.invalidateQueries({ queryKey: PERIOD_QUERY_KEY });
    },
  });
};

export const useBulkDeleteHotlist = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const response = await fetchApi<{ message: string; count: number }>('/hotlist/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hotlist'] });
    },
  });
};
