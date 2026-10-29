import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

export interface Item {
  id: string;
  partNumber: string;
  itemName: string;
  unit: string;
  createdAt: string;
}

export function useItems() {
  return useQuery<{ data: Item[] }, Error>({
    queryKey: ['items'],
    queryFn: () => fetchApi('/items'),
  });
}

export function useMasterCartons() {
  return useQuery<{ data: any[] }, Error>({
    queryKey: ['masterCartons'],
    queryFn: () => fetchApi('/master-cartons'),
  });
}

export function useCreateMasterCarton() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (newMc: { cartonCode: string; toyNameItemId: string; partNumberCode: string }) => 
      fetchApi('/master-cartons', {
        method: 'POST',
        body: JSON.stringify(newMc),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masterCartons'] });
    },
  });
}

export function useCreateItem() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (newItem: { partNumber: string; itemName: string; unit: string }) => 
      fetchApi('/items', {
        method: 'POST',
        body: JSON.stringify(newItem),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useDeleteItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/items/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useUpdateItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, partNumber, itemName, unit }: { id: string; partNumber: string; itemName: string; unit: string }) => 
      fetchApi(`/items/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ partNumber, itemName, unit }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export function useUpdateMasterCarton() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, cartonCode, toyNameItemId, partNumberCode }: { id: string; cartonCode: string; toyNameItemId: string; partNumberCode: string }) => 
      fetchApi(`/master-cartons/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ cartonCode, toyNameItemId, partNumberCode }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masterCartons'] });
    },
  });
}

export function useDeleteMasterCarton() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/master-cartons/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['masterCartons'] });
    },
  });
}
