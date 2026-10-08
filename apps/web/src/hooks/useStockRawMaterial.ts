import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { PERIOD_QUERY_KEY } from './usePeriods';

export interface StockRawMaterialData {
  id: string;
  periodId: string;
  itemDesc: string;
  supplier: string | null;
  unit: string;
  qty: number;
  date: string;
  /**
   * Referensi customer dari kolom Excel `Ref_B_PO`. Hanya baris yang nilainya
   * mengandung "MTL" yang masuk ke sistem. `null` untuk data lama.
   */
  refB: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Ringkasan hasil pembacaan file Excel Stock Raw Material. */
export interface StockRawMaterialUploadSummary {
  /** Total baris data di file (sebelum filter MTL). */
  totalRows: number;
  /** Baris masuk: kolom "Ref_B_PO" mengandung "MTL". */
  included: number;
  /** Baris dilewati: kolom "Ref_B_PO" TIDAK mengandung "MTL". */
  skippedNoMtl: number;
  failed: number;
  skippedNonData: number;
  total: number;
  valid: number;
}

/**
 * Data stok untuk SATU periode. `periodId` wajib — tanpa itu permintaan tidak
 * dijalankan supaya stok antar periode tidak pernah tercampur.
 */
export const useStockRawMaterial = (periodId?: string | null) => {
  return useQuery({
    queryKey: ['stockRawMaterial', periodId],
    enabled: Boolean(periodId),
    queryFn: async () => {
      const response = await fetchApi<{ data: StockRawMaterialData[] }>(
        `/stock-raw-material?periodId=${encodeURIComponent(periodId as string)}`,
      );
      return response;
    },
  });
};

export const useUploadStockRawMaterial = () => {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetchApi<{
        message: string;
        data: Omit<StockRawMaterialData, 'id' | 'createdAt' | 'updatedAt'>[];
        summary?: StockRawMaterialUploadSummary;
      }>('/stock-raw-material/upload', {
        method: 'POST',
        body: formData,
      });
      return response;
    },
  });
};

export const useAddManualStockRawMaterial = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { itemDesc: string; supplier: string; unit: string; qty: number; date: string; periodId: string; refB?: string | null }) => {
      const response = await fetchApi<{ data: StockRawMaterialData }>('/stock-raw-material', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockRawMaterial'] });
      queryClient.invalidateQueries({ queryKey: PERIOD_QUERY_KEY });
    },
  });
};

export const useUpdateStockRawMaterial = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ itemDesc: string; supplier: string; unit: string; qty: number; date: string; refB: string | null }> }) => {
      const response = await fetchApi<{ data: StockRawMaterialData }>(`/stock-raw-material/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockRawMaterial'] });
    },
  });
};

export const useDeleteStockRawMaterial = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchApi<{ message: string }>(`/stock-raw-material/${id}`, {
        method: 'DELETE',
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockRawMaterial'] });
    },
  });
};

export const useImportStockRawMaterial = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ data, mode, periodId }: { data: Omit<StockRawMaterialData, 'id' | 'periodId' | 'createdAt' | 'updatedAt'>[], mode: 'add' | 'overwrite'; periodId: string }) => {
      const response = await fetchApi<{ message: string; count: number }>('/stock-raw-material/import', {
        method: 'POST',
        body: JSON.stringify({ data, mode, periodId }),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockRawMaterial'] });
      queryClient.invalidateQueries({ queryKey: PERIOD_QUERY_KEY });
    },
  });
};

export const useBulkDeleteStockRawMaterial = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const response = await fetchApi<{ message: string; count: number }>('/stock-raw-material/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stockRawMaterial'] });
    },
  });
};
