import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

export interface NpofMaterialData {
  id: string;
  npofId: number;
  partNumber: string;
  productName: string;
  material: string | null;
  gramatur: string | null;
  supplier: string | null;
  sheetedSize: string | null;
  formulaMaterial: string | null;
  ups: string | null;
  isEdited: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useNpofMaterials() {
  return useQuery({
    queryKey: ['npof-materials'],
    queryFn: async () => {
      const response = await fetchApi<{ data: NpofMaterialData[] }>('/npof-materials');
      return response.data;
    },
  });
}

export function useSyncNpofMaterials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetchApi<{ 
        message: string; 
        syncCount: number;
        skippedCount: number;
        totalProcessed: number;
      }>('/npof-materials/sync', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['npof-materials'] });
    },
  });
}

export function useUpdateNpofMaterial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Omit<NpofMaterialData, 'id' | 'npofId' | 'isEdited' | 'lastSyncedAt' | 'createdAt' | 'updatedAt'>> }) => {
      const response = await fetchApi<{ data: NpofMaterialData }>(`/npof-materials/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['npof-materials'] });
    },
  });
}

export function useDeleteNpofMaterial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchApi<{ message: string }>(`/npof-materials/${id}`, {
        method: 'DELETE',
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['npof-materials'] });
    },
  });
}

export function useBulkDeleteNpofMaterials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const response = await fetchApi<{ message: string; count: number }>('/npof-materials/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['npof-materials'] });
    },
  });
}
