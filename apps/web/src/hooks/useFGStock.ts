import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

export interface FGStock {
  id: string;
  quantity: number;
  date: string;
  shift: number | null;
  notes: string | null;
  updatedAt: string;
  item: {
    id: string;
    partNumber: string;
    itemName: string;
  };
  user: {
    name: string;
  };
}

export function useFGStocks() {
  return useQuery<{ data: FGStock[] }, Error>({
    queryKey: ['fgStocks'],
    queryFn: () => fetchApi('/fg-stock'),
  });
}

export function useUpsertFGStock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { itemId?: string; itemCode?: string; quantity: number; date: string; notes?: string; saveMode?: 'overwrite' | 'add'; unit?: string }) => 
      fetchApi('/fg-stock', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fgStocks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteFGStock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => 
      fetchApi(`/fg-stock/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fgStocks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateFGStock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { id: string; quantity: number; date: string; notes?: string }) => 
      fetchApi(`/fg-stock/${data.id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fgStocks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useBulkUpsertFGStock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { records: Array<{ itemCode: string; quantity: number; date: string; unit?: string }>; saveMode: 'overwrite' | 'add' }) => 
      fetchApi('/fg-stock/bulk', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fgStocks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useBulkDeleteFGStock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { ids: string[] }) => 
      fetchApi('/fg-stock/bulk', {
        method: 'DELETE',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fgStocks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
