import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { PERIOD_QUERY_KEY } from './usePeriods';

export interface OutstandingPOData {
  id: string;
  periodId: string;
  /** Nomor PO dari kolom `PO NO`. Wajib diisi, tidak unik (satu PO boleh banyak item). */
  poNumber: string;
  planReceivedDate: string;
  supplierName: string;
  itemDesc: string;
  qtyOrder: number;
  qtyOrderUnit: string;
  qtyDelivered: number;
  qtyDeliveredUnit: string;
  /**
   * Referensi customer dari kolom Excel `PR Ref-B`. Hanya baris yang nilainya
   * mengandung "MTL" yang masuk ke sistem. `null` untuk data lama.
   */
  refB: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Satu baris Excel yang gagal diimpor (mis. kolom `PO NO` kosong). */
export interface OutstandingPOImportError {
  /** Nomor baris di file Excel (1-based, termasuk baris judul). */
  row: number;
  poNumber?: string;
  message: string;
}

export interface OutstandingPOUploadResult {
  message: string;
  data: Omit<OutstandingPOData, 'id' | 'periodId' | 'createdAt' | 'updatedAt'>[];
  errors: OutstandingPOImportError[];
  summary: {
    /** Total baris data di file (sebelum filter MTL). */
    totalRows: number;
    /** Baris masuk: kolom "PR Ref-B" mengandung "MTL". */
    included: number;
    /** Baris dilewati: kolom "PR Ref-B" TIDAK mengandung "MTL". */
    skippedNoMtl: number;
    /** Baris gagal karena validasi lain (mis. PO NO kosong). */
    failed: number;
    /** Baris kosong / subtotal / "Grand Total" (info tambahan). */
    skippedNonData: number;
    total: number;
    valid: number;
  };
}

/**
 * Data Outstanding PO untuk SATU periode. `periodId` wajib — tanpa itu permintaan
 * tidak dijalankan supaya data antar periode tidak pernah tercampur.
 */
export function useOutstandingPO(periodId?: string | null) {
  return useQuery({
    queryKey: ['outstanding-po', periodId],
    enabled: Boolean(periodId),
    queryFn: async () => {
      const response = await fetchApi<{ data: OutstandingPOData[] }>(
        `/outstanding-po?periodId=${encodeURIComponent(periodId as string)}`,
      );
      return response.data;
    },
  });
}

export function useUploadOutstandingPO() {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetchApi<OutstandingPOUploadResult>(
        '/outstanding-po/upload',
        {
          method: 'POST',
          body: formData,
        }
      );
      return response;
    },
  });
}

export function useImportOutstandingPO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ data, mode, periodId }: { data: any[]; mode: 'add' | 'overwrite'; periodId: string }) => {
      const response = await fetchApi<{ message: string }>('/outstanding-po/import', { 
        method: 'POST',
        body: JSON.stringify({ data, mode, periodId }),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outstanding-po'] });
      queryClient.invalidateQueries({ queryKey: PERIOD_QUERY_KEY });
    },
  });
}

export function useAddManualOutstandingPO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Omit<OutstandingPOData, 'id' | 'periodId' | 'createdAt' | 'updatedAt'> & { periodId: string }) => {
      const response = await fetchApi<{ data: OutstandingPOData }>('/outstanding-po', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outstanding-po'] });
      queryClient.invalidateQueries({ queryKey: PERIOD_QUERY_KEY });
    },
  });
}

export function useUpdateOutstandingPO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Omit<OutstandingPOData, 'id' | 'createdAt' | 'updatedAt'>> }) => {
      const response = await fetchApi<{ data: OutstandingPOData }>(`/outstanding-po/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outstanding-po'] });
    },
  });
}

export function useDeleteOutstandingPO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchApi<{ message: string }>(`/outstanding-po/${id}`, {
        method: 'DELETE',
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outstanding-po'] });
    },
  });
}

export function useBulkDeleteOutstandingPO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      const response = await fetchApi<{ message: string; count: number }>('/outstanding-po/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outstanding-po'] });
    },
  });
}
