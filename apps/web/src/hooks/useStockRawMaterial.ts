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

/** Satu part number yang bisa memakai sebuah lot stok, beserta estimasi waste. */
export interface StockAllocationCandidate {
  partNumber: string;
  productName: string;
  ukuran: string;
  gramatur: string;
  groupSupplier: string;
  materialType: string | null;
  demandPcs: number;
  needSheet: number;
  needKg: number;
  shortageSheet: number | null;
  isSufficient: boolean;
  /** Jumlah potong ukuran part per satuan material. */
  multiplier: number;
  trimWidthCm: number;
  trimLengthCm: number;
  /** Waste ukuran per lembar (0..1). */
  wastePct: number;
  /** Kapasitas lot ini bila dipakai untuk part tersebut (kg). */
  lotCapacityKg: number;
  /** Bagian yang bisa dialokasikan (kg) = min(kapasitas, kebutuhan). */
  allocatableKg: number;
  /** Estimasi waste dari `allocatableKg` (kg). */
  wasteKg: number;
  /** Bagian lot ini yang sudah terpakai part tersebut menurut hasil perhitungan. */
  alreadyAllocatedKg: number;
}

export interface StockAllocationRecommendation {
  itemDesc: string;
  supplier: string;
  lots: number;
  totalKg: number;
  totalSheet: number;
  lotWidth: number | null;
  lotLength: number | null;
  lotGsm: number | null;
  hasResult: boolean;
  calculatedAt: string | null;
  /** `no-dimension` = deskripsi item tidak memuat ukuran/gramatur. */
  reason?: 'no-dimension';
  candidates: StockAllocationCandidate[];
}

/**
 * Rekomendasi alokasi untuk satu item stok pada satu periode.
 * Membaca snapshot hasil perhitungan (tidak menghitung ulang).
 */
export const useStockAllocationRecommendation = (
  periodId: string | null | undefined,
  itemDesc: string | null | undefined,
  supplier: string | null | undefined,
  enabled = true,
) => {
  return useQuery({
    queryKey: ['stockAllocationRecommendation', periodId, itemDesc, supplier],
    enabled: Boolean(enabled && periodId && itemDesc),
    queryFn: async () => {
      const params = new URLSearchParams({ periodId: periodId as string, itemDesc: itemDesc as string });
      if (supplier) params.set('supplier', supplier);
      return fetchApi<{ data: StockAllocationRecommendation }>(
        `/stock-raw-material/allocation-recommendation?${params.toString()}`,
      );
    },
  });
};

/** Pemakaian satu lot oleh satu ukuran (grup) tujuan. */
export interface StockUsageAllocation {
  ukuran: string;
  gramatur: string;
  supplier: string;
  allocatedKg: number;
  /** Lembar dalam satuan ukuran grup tujuan. */
  allocatedSheet: number;
  /** Lembar FISIK lot yang berkurang (`allocatedSheet / multiplier`). */
  physicalSheet: number;
  multiplier: number;
  parts: string[];
}

/** Ringkasan pemakaian satu material (itemDesc + supplier). */
export interface StockUsageItem {
  key: string;
  itemDesc: string;
  supplier: string;
  supplierAliases: string[];
  /** Kunci baris tabel stok (`itemDesc||supplier`) untuk pencocokan. */
  matchKeys: string[];
  width: number | null;
  length: number | null;
  gsm: number | null;
  form: 'roll' | 'sheet' | 'mixed' | 'unknown';
  lots: number;
  totalKg: number;
  totalSheet: number;
  kgPerSheet: number | null;
  sheetKgBasis: 'dimension' | 'usage' | 'unknown';
  capacityKg: number;
  usedKg: number;
  usedSheet: number;
  usedPct: number | null;
  remainingKg: number;
  remainingSheet: number;
  excludedKg: number;
  wasteKg: number;
  seenInResult: boolean;
  overAllocated: boolean;
  unknownUnits: string[];
  allocations: StockUsageAllocation[];
}

export interface StockUsageTotals {
  materials: number;
  lots: number;
  totalKg: number;
  capacityKg: number;
  usedKg: number;
  remainingKg: number;
  usedPct: number;
  unusedMaterials: number;
  partialMaterials: number;
  usedUpMaterials: number;
}

export interface StockUsagePayload {
  periodId: string;
  sheetsPerRim: number;
  /** `null` = periode belum pernah dihitung. */
  result: {
    id: string;
    runNumber: number;
    calculatedAt: string;
    dataVersionAt: string;
    isStale: boolean;
  } | null;
  items: StockUsageItem[];
  totals: StockUsageTotals;
}

/**
 * Monitoring pemakaian stok per ukuran pada satu periode.
 * Angka "terpakai" berasal dari snapshot hasil perhitungan aktif.
 */
export const useStockUsage = (periodId?: string | null) => {
  return useQuery({
    queryKey: ['stockUsage', periodId],
    enabled: Boolean(periodId),
    queryFn: async () => {
      return fetchApi<{ data: StockUsagePayload }>(
        `/stock-raw-material/usage?periodId=${encodeURIComponent(periodId as string)}`,
      );
    },
  });
};

export const useUploadStockRawMaterial = () => {  return useMutation({
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
