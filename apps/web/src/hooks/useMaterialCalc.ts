import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import type { DataModule } from './usePeriods';

export interface PartNumberDetail {
  partNumber: string;
  productName: string;
  demandPcs: number;
  noNpofData: boolean;
  sheetsKotor: number;
  kgKotor: number;
  hotlistNet: number;
  pcsNet1: number;
  sheetsNet1Allow: number;
  wipSheet: number;
  wipPcs: number;
  sheetsNet2: number;
  kgNet2: number;
  shortageKg: number | null;
  shortageSheet: number | null;
  shortagePcs: number | null;
  isSufficient: boolean;
  surplusKg: number | null;
  /** kg stok/PO yang benar-benar teralokasi ke part ini. */
  allocatedKg: number;
  /** Paper | PET | Flute | Lainnya. */
  materialType: string;
}

/** Tabel mingguan 26 kolom, sesuai Gambar 3 pada rancangan. */
export interface WeeklyMatrixColumn {
  weekNumber: number;
  weekStartDate: string;
  /** Bulan saat PO harus dipesan untuk minggu ini. */
  poMonthLabel: string;
}

export interface WeeklyMatrixRow {
  partNumber: string;
  productName: string;
  gsm: string;
  width: number | null;
  length: number | null;
  up: number;
  /** false = part ini tidak punya formula material, angkanya hanya lembar. */
  hasKg: boolean;
  kgPerSheet: number;
  weeks: number[];
  weeksSheet: number[];
}

export interface WeeklyMatrixSummary {
  totalReq: number[];
  totalReqSheet: number[];
  allowance: number[];
  allowanceSheet: number[];
  totalPlusAllowance: number[];
  totalPlusAllowanceSheet: number[];
  stockAsOf: number;
  stockAsOfSheet: number;
  outstandingPo: number[];
  outstandingPoSheet: number[];
  /**
   * Nomor PO per minggu (sejajar dengan `outstandingPo`). Satu minggu bisa
   * berisi beberapa nomor PO. Ditampilkan kecil di bawah angka kg.
   */
  outstandingPoNumbers: string[][];
  endInd: number[];
  endIndSheet: number[];
}

export interface WeeklyMatrix {
  columns: WeeklyMatrixColumn[];
  rows: WeeklyMatrixRow[];
  summary: WeeklyMatrixSummary;
}

export interface MaterialGroup {
  ukuran: string;
  gramatur: string;
  supplier: string;
  leadTimeMonths: number;
  planningTimeline?: {
    purchaseMonth: string;
    arrivalMonth: string;
    usageMonth: string;
  };
  totalShortageSheet: number | null;
  totalShortagePcs: number | null;
  totalShortageKg: number | null;
  isSufficient: boolean;
  surplusKg: number | null;
  /** Paper | PET | Flute | Lainnya — dasar pengelompokan folder di UI. */
  materialType: string;
  /** false = tidak ada part di grup ini yang punya formula material (kg). */
  hasKg: boolean;
  /** Sisa stok grup ini dalam lembar. */
  surplusSheet: number | null;
  details: PartNumberDetail[];
  /** Tabel mingguan 26 kolom. */
  weeklyMatrix: WeeklyMatrix;
}

export interface MaterialCalcWeek {
  weekNumber: number;
  weekStartDate: string;
  weekEndDate: string;
}

export interface MaterialCalcResponse {
  calculatedAt: string;
  periodWeeks: number;
  periodStartDate: string;
  periodEndDate: string;
  weeks?: MaterialCalcWeek[];
  totals?: {
    partCount: number;
    partsWithoutNpof: number;
    partsWithStock: number;
    allocatedKg: number;
  };
  sourceData: Record<string, unknown[]>;
  groups: MaterialGroup[];
}

export interface CalculationHistorySummary {
  id: string;
  monthKey: string;
  periodStartDate: string;
  periodEndDate: string;
  periodWeeks: number;
  calculatedAt: string;
  savedAt: string;
  user: { name: string };
  sources: { sourceType: string }[];
}

export interface CalculationHistoryDetail extends CalculationHistorySummary {
  resultSnapshot: MaterialCalcResponse;
  sources: { sourceType: string; dataSnapshot: unknown }[];
}

export interface MRPWeek {
  year: number;
  weekNumber: number;
  weekStartDate: string;
  weekEndDate: string;
}

export function useMRPWeeks() {
  return useQuery<{ data: Array<{ year: number; weekNumber: number; weekStartDate: string; weekEndDate: string }> }, Error>({
    queryKey: ['mrp-weeks'],
    queryFn: () => fetchApi('/weekly-schedule'),
    staleTime: 5 * 60 * 1000,
    select: (response) => {
      const weeks = new Map<string, MRPWeek>();
      for (const record of response.data) {
        if (!record.weekStartDate || !record.weekEndDate || Number.isNaN(Date.parse(record.weekStartDate)) || Number.isNaN(Date.parse(record.weekEndDate))) {
          continue;
        }
        const key = `${record.year}-${record.weekNumber}`;
        const current = weeks.get(key);
        if (!current || record.weekStartDate < current.weekStartDate) {
          weeks.set(key, {
            year: record.year,
            weekNumber: record.weekNumber,
            weekStartDate: record.weekStartDate,
            weekEndDate: record.weekEndDate,
          });
        }
      }
      return { data: [...weeks.values()].sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate)) };
    },
  });
}

export function useMaterialCalc(startDate: string, endDate: string, enabled: boolean) {
  return useQuery({
    queryKey: ['material-calculation', startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate, endDate });
      const response = await fetchApi<MaterialCalcResponse>(
        `/material-calculation?${params.toString()}`
      );
      return response;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useSaveMaterialCalculation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: MaterialCalcResponse) =>
      fetchApi('/material-calculation/history', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-calculation-history'] });
    },
  });
}

export function useCalculationHistory() {
  return useQuery<{ data: CalculationHistorySummary[] }, Error>({
    queryKey: ['material-calculation-history'],
    queryFn: () => fetchApi('/material-calculation/history'),
    staleTime: 30 * 1000,
  });
}

export function useUpdateCalculationHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; periodStartDate: string; periodEndDate: string }) =>
      fetchApi(`/material-calculation/history/${data.id}`, {
        method: 'PUT',
        body: JSON.stringify({ periodStartDate: data.periodStartDate, periodEndDate: data.periodEndDate }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['material-calculation-history'] }),
  });
}

export function useDeleteCalculationHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi(`/material-calculation/history/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['material-calculation-history'] }),
  });
}

export function useCalculationHistoryDetail(id: string | null) {
  return useQuery<{ data: CalculationHistoryDetail }, Error>({
    queryKey: ['material-calculation-history', id],
    queryFn: () => fetchApi(`/material-calculation/history/${id}`),
    enabled: Boolean(id),
  });
}

// ============================================================
// PERIODE (PlanningCycle) — alur baru, menggantikan History bulanan
// ============================================================

export interface CycleSourceRow {
  sourceType: string;
  rowCount: number;
  uploadedAt: string;
  uploadedBy: string;
  fileName: string | null;
}

export interface CycleSourceStatus {
  sourceType: string;
  rowCount: number;
  uploaded: boolean;
  uploadedAt: string | null;
  uploadedBy: string | null;
  fileName: string | null;
}

export interface CycleSummary {
  id: string;
  uploadMonth: string;
  label: string;
  status: 'DRAFT' | 'CALCULATED';
  /** Dihitung di server: NOT_CALCULATED | CALCULATED | STALE */
  derivedStatus: 'NOT_CALCULATED' | 'CALCULATED' | 'STALE';
  isStale: boolean;
  isLocked: boolean;
  displayText: string;
  firstUploadedAt: string;
  lastUploadedAt: string;
  lastDataChangeAt: string;
  mrpStartDate: string;
  mrpEndDate: string;
  weekCount: number;
  notes: string | null;
  currentResult: {
    id: string;
    runNumber: number;
    calculatedAt: string;
    calculatedBy: string;
    isSaved: boolean;
    savedNote: string | null;
  } | null;
  savedResultCount: number;
  sources: CycleSourceRow[];
  npofInfo: {
    isShared: boolean;
    totalRows: number;
    lastUpdatedAt: string | null;
    changedSinceCalculation: boolean;
  };
}

export interface CycleResultSummary {
  id: string;
  runNumber: number;
  periodStartDate: string;
  periodEndDate: string;
  periodWeeks: number;
  calculatedAt: string;
  calculatedBy: string;
  isCurrent: boolean;
  isSaved: boolean;
  savedNote: string | null;
  summarySnapshot: { totals?: MaterialCalcResponse['totals'] } | null;
}

export interface CycleCalculationResult {
  id: string;
  runNumber: number;
  calculatedAt: string;
  periodStartDate: string;
  periodEndDate: string;
  periodWeeks: number;
  weekCount: number;
  weeks: MaterialCalcWeek[];
  totals: { partCount: number; partsWithoutNpof: number; partsWithStock: number; allocatedKg: number };
  groups: MaterialGroup[];
}

export interface CycleAuditEntry {
  id: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  sourceType: string | null;
  entityType: string;
  notes: string | null;
  createdAt: string;
  user: { name: string; email: string };
}

export interface ExpiredCycle {
  id: string;
  label: string;
  uploadMonth: string;
  retentionDueAt: string;
  retentionNotifiedAt: string | null;
  hasSavedResults: boolean;
  savedResults: { id: string; runNumber: number; calculatedAt: string; savedNote: string | null }[];
}

export function useCycles() {
  return useQuery<{ data: CycleSummary[] }, Error>({
    queryKey: ['material-planning-cycles'],
    queryFn: () => fetchApi('/material-planning/cycles'),
    staleTime: 15 * 1000,
  });
}

export function useCreateCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { uploadMonth?: string; label?: string; notes?: string }) =>
      fetchApi('/material-planning/cycles', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['material-planning-cycles'] }),
  });
}

export function useCycleSources(cycleId: string | null) {
  return useQuery<{ data: CycleSourceStatus[] }, Error>({
    queryKey: ['material-planning-sources', cycleId],
    queryFn: () => fetchApi(`/material-planning/cycles/${cycleId}/sources`),
    enabled: Boolean(cycleId),
  });
}

/**
 * CATATAN (2026-09-28): `useImportLiveIntoCycle` DIHAPUS bersama endpoint
 * `/material-planning/cycles/:id/import-live`. Data periode sekarang diupload
 * langsung dari halaman Master Data (lihat `usePeriods.ts`).
 */

// ============================================================
// FOLDER PERIODE: validitas hasil + isi data master per periode
// ============================================================

export interface CycleDataStatus {
  hasResult: boolean;
  runNumber: number | null;
  calculatedAt: string | null;
  /** false = perhitungan lama belum punya checksum, validasi pakai cap waktu */
  signatureComparable: boolean;
  /** sumber yang datanya berubah setelah perhitungan (MRP/WIP/HOTLIST/STOCK_RM/OUTSTANDING_PO) */
  changedSources: string[];
  isValid: boolean;
  isInvalid: boolean;
  invalidReason: string | null;
}

/** Status validitas hasil perhitungan periode ini terhadap data master SEKARANG. */
export function useCycleDataStatus(cycleId: string | null) {
  return useQuery<{ data: CycleDataStatus }, Error>({
    queryKey: ['material-planning-data-status', cycleId],
    enabled: Boolean(cycleId),
    queryFn: () => fetchApi(`/material-planning/cycles/${cycleId}/data-status`),
    staleTime: 10 * 1000,
  });
}

/**
 * Endpoint Master Data yang sudah mendukung `?periodId=`. Dipakai untuk membuka
 * folder MRP / WIP / HOT LIST / STOCK RM / OS PO di halaman Material Calculation
 * — jadi tidak ada data yang diduplikasi.
 */
export const PERIOD_SOURCE_ENDPOINT: Record<string, string> = {
  MRP: '/weekly-schedule',
  WIP: '/wip',
  HOTLIST: '/hotlist',
  STOCK_RM: '/stock-raw-material',
  OUTSTANDING_PO: '/outstanding-po',
};

/**
 * MRP 26 Weeks dan WIP dipakai BERSAMA oleh Production Planning dan Material
 * Planning, tetapi datanya disimpan TERPISAH. Material Calculation adalah bagian
 * Material Planning, jadi kedua sumber ini WAJIB dibaca dengan
 * `moduleType=MATERIAL` — kalau tidak, angka WIP/MRP Production akan ikut terhitung.
 */
const MODULE_SCOPED_SOURCES: Record<string, DataModule> = {
  MRP: 'MATERIAL',
  WIP: 'MATERIAL',
};

export function usePeriodSourceRows(cycleId: string | null, source: string | null) {
  return useQuery<{ data: any[] }, Error>({
    queryKey: ['material-planning-source-rows', cycleId, source],
    enabled: Boolean(cycleId && source && PERIOD_SOURCE_ENDPOINT[source]),
    queryFn: () => {
      const params = new URLSearchParams({ periodId: cycleId as string });
      const mod = MODULE_SCOPED_SOURCES[source as string];
      if (mod) params.set('moduleType', mod);
      return fetchApi(`${PERIOD_SOURCE_ENDPOINT[source as string]}?${params.toString()}`);
    },
    staleTime: 30 * 1000,
  });
}

export function useNpofCheck(cycleId: string | null, enabled = true) {
  return useQuery<{ data: { changedSinceCalculation: boolean; npofLastUpdatedAt: string | null; lastCalculatedAt: string | null; message: string } }, Error>({
    queryKey: ['material-planning-npof-check', cycleId],
    queryFn: () => fetchApi(`/material-planning/cycles/${cycleId}/npof-check`),
    enabled: Boolean(cycleId) && enabled,
  });
}

// ── Cakupan NPOF: part MRP yang tidak ada / kurang lengkap di NPOF ─────────

export type NpofRequiredField = 'gramatur' | 'ukuran' | 'formula' | 'ups' | 'material' | 'supplier';

/** Label tampilan untuk tiap field NPOF yang bisa kosong. */
export const NPOF_FIELD_LABELS: Record<NpofRequiredField, string> = {
  gramatur: 'Gramatur',
  ukuran: 'Ukuran sheet',
  formula: 'Formula material',
  ups: 'Ups',
  material: 'Jenis material',
  supplier: 'Supplier',
};

export interface NpofCoverageRow {
  partNumber: string;
  productName: string;
  /** MISSING = tidak ada baris NPOF; INCOMPLETE = ada tapi ada field kosong. */
  status: 'MISSING' | 'INCOMPLETE';
  /** true = formula/ups kosong, sehingga kg part ini hanya estimasi. */
  critical: boolean;
  demandWeekCount: number;
  npofId: number | null;
  material: string | null;
  materialType: string | null;
  supplier: string | null;
  gramatur: string | null;
  ukuran: string | null;
  missingFields: NpofRequiredField[];
  isNebeng: boolean;
}

export interface NpofCoverageData {
  summary: {
    mrpPartCount: number;
    missingNpofCount: number;
    incompleteNpofCount: number;
    completeNpofCount: number;
    criticalCount: number;
  };
  rows: NpofCoverageRow[];
  npofTotalRows: number;
  periodLabel: string;
}

/** Part MRP periode ini yang tidak ada / datanya kurang di NPOF. */
export function useNpofCoverage(cycleId: string | null) {
  return useQuery<{ data: NpofCoverageData }, Error>({
    queryKey: ['material-planning-npof-coverage', cycleId],
    queryFn: () => fetchApi(`/material-planning/cycles/${cycleId}/npof-coverage`),
    enabled: Boolean(cycleId),
    staleTime: 30 * 1000,
  });
}

export function useCalculateCycle() {
  const queryClient = useQueryClient();
  return useMutation<{ data: CycleCalculationResult }, Error, { cycleId: string }>({
    mutationFn: (data) => fetchApi(`/material-planning/cycles/${data.cycleId}/calculate`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-planning-cycles'] });
      queryClient.invalidateQueries({ queryKey: ['material-planning-results'] });
    },
  });
}

export function useCycleResults(cycleId: string | null) {
  return useQuery<{ data: CycleResultSummary[] }, Error>({
    queryKey: ['material-planning-results', cycleId],
    queryFn: () => fetchApi(`/material-planning/cycles/${cycleId}/results`),
    enabled: Boolean(cycleId),
  });
}

/** Ambil isi satu run tertentu (snapshot resultSnapshot-nya). */
export function useCycleResultDetail(cycleId: string | null, resultId: string | null) {
  return useQuery<
    { data: { id: string; runNumber: number; calculatedAt: string; resultSnapshot: MaterialCalcResponse } },
    Error
  >({
    queryKey: ['material-planning-result-detail', cycleId, resultId],
    queryFn: () => fetchApi(`/material-planning/cycles/${cycleId}/results/${resultId}`),
    enabled: Boolean(cycleId) && Boolean(resultId),
  });
}

export function usePatchCycleResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { cycleId: string; resultId: string; isSaved?: boolean; savedNote?: string }) =>
      fetchApi(`/material-planning/cycles/${data.cycleId}/results/${data.resultId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isSaved: data.isSaved, savedNote: data.savedNote }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-planning-results'] });
      queryClient.invalidateQueries({ queryKey: ['material-planning-cycles'] });
    },
  });
}

export function useCycleAudit(cycleId: string | null, enabled = true) {
  return useQuery<{ data: CycleAuditEntry[] }, Error>({
    queryKey: ['material-planning-audit', cycleId],
    queryFn: () => fetchApi(`/material-planning/cycles/${cycleId}/audit`),
    enabled: Boolean(cycleId) && enabled,
  });
}

export function useExpiredCycles(enabled = true) {
  return useQuery<{ data: ExpiredCycle[]; extensions: number[] }, Error>({
    queryKey: ['material-planning-expired'],
    queryFn: () => fetchApi('/material-planning/cycles/expired'),
    enabled,
  });
}

export function useCycleRetentionAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { cycleId: string; action: 'keep' | 'delete'; months?: number }) =>
      fetchApi(
        `/material-planning/cycles/${data.cycleId}/${data.action === 'keep' ? 'extend-retention' : 'confirm-delete'}`,
        { method: 'POST', body: JSON.stringify({ months: data.months }) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-planning-expired'] });
      queryClient.invalidateQueries({ queryKey: ['material-planning-cycles'] });
    },
  });
}
