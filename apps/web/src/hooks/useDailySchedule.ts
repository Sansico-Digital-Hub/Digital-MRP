import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

export interface DailySchedule {
  id: string;
  date: string;
  shift: number;
  quantity: number;
  item: {
    id: string;
    partNumber: string;
    itemName: string;
  };
  masterCarton?: string;
  toyName?: string;
}

export function useDailySchedules(date?: string, shift?: string) {
  return useQuery<{ data: DailySchedule[] }, Error>({
    queryKey: ['dailySchedules', date, shift],
    queryFn: () => {
      const params = new URLSearchParams();
      if (date) params.append('date', date);
      if (shift) params.append('shift', shift);
      const query = params.toString() ? `?${params.toString()}` : '';
      return fetchApi(`/daily-schedule${query}`);
    },
  });
}

export function useUpsertDailySchedule() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { date: string; shift: number; itemId?: string; itemCode?: string; quantity: number; saveMode?: 'overwrite' | 'add' }) => 
      fetchApi('/daily-schedule', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dailySchedules'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useUpdateDailySchedule() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { id: string; date: string; shift: number; itemCode?: string; quantity: number }) => 
      fetchApi(`/daily-schedule/${data.id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dailySchedules'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteDailySchedule() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => 
      fetchApi(`/daily-schedule/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dailySchedules'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useBulkUpsertDailySchedule() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { records: Array<{ date: string; shift: number; itemCode: string; toyName?: string; masterCarton?: string; quantity: number }>; saveMode: 'overwrite' | 'add' }) => 
      fetchApi('/daily-schedule/bulk', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dailySchedules'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useBulkDeleteDailySchedule() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: { ids: string[] }) => 
      fetchApi('/daily-schedule/bulk', {
        method: 'DELETE',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dailySchedules'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
