import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { localeCode, type Lang } from '../i18n';

/**
 * Periode upload (PlanningCycle) untuk halaman Master Data.
 *
 * Sejak 2026-09-28 semua data Master Data (26-Week Demand, WIP, Hot List,
 * Stock Raw Material, Outstanding PO) disimpan per periode upload, BUKAN
 * dikelompokkan otomatis dari tanggal di dalam data.
 */

export type PeriodSourceKey = 'MRP' | 'HOTLIST' | 'STOCK_RM' | 'OUTSTANDING_PO' | 'WIP';

/**
 * Modul pemilik data untuk tabel yang dipakai bersama secara tampilan
 * (MRP 26 Weeks = `weekly_schedules`, WIP = `wips`).
 * Data kedua modul disimpan TERPISAH lewat kolom `moduleType`.
 */
export type DataModule = 'PRODUCTION' | 'MATERIAL';

export const MODULE_LABELS: Record<DataModule, string> = {
  PRODUCTION: 'Production Planning',
  MATERIAL: 'Material Planning',
};

export interface PeriodSummary {
  id: string;
  /** "2026-09" */
  uploadMonth: string;
  /** "September 2026" */
  label: string;
  isLocked: boolean;
  mrpStartDate: string | null;
  mrpEndDate: string | null;
  /** Jumlah baris sumber modul MATERIAL (dipakai Material Calculation). */
  counts: Record<PeriodSourceKey, number>;
  /** Jumlah baris MRP & WIP terpisah per modul (dipakai halaman Master Data). */
  moduleCounts: Record<DataModule, { MRP: number; WIP: number }>;
  /** Upload terakhir periode ini (dari `cycle_source_uploads`). */
  lastUploadAt: string | null;
  lastUploadByName: string | null;
  lastUploadSource: PeriodSourceKey | null;
  lastUploadFileName: string | null;
  /** Edit manual terakhir (ubah/hapus baris) — null bila belum pernah diedit. */
  lastEditedAt: string | null;
  lastEditedByName: string | null;
}

export const PERIOD_QUERY_KEY = ['periods'];

export function usePeriods() {
  return useQuery<{ data: PeriodSummary[] }, Error>({
    queryKey: PERIOD_QUERY_KEY,
    queryFn: () => fetchApi('/material-planning/periods'),
    staleTime: 10 * 1000,
  });
}

/**
 * "2026-09" -> "September 2026" (dipakai untuk pratinjau sebelum periode dibuat).
 * Bahasa default `id` supaya pemanggil lama tetap kompilasi.
 */
export function monthLabel(month: string, lang: Lang = 'id'): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString(localeCode(lang), { month: 'long', year: 'numeric' });
}

/** Nama bulan Bahasa Indonesia, dipakai backend saat membuat label otomatis. */
const MONTH_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/**
 * Label periode siap tampil, mengikuti bahasa yang sedang aktif.
 *
 * `PlanningCycle.label` dibuat OTOMATIS oleh backend dalam Bahasa Indonesia
 * (mis. "Oktober 2026"). Supaya ikut bahasa aktif, label diturunkan ulang dari
 * `uploadMonth`. Kalau user mengisi label sendiri (bukan pola otomatis), label
 * aslinya dikembalikan apa adanya.
 */
export function periodDisplayLabel(
  period: { label: string; uploadMonth: string },
  lang: Lang = 'id',
): string {
  const [year, month] = period.uploadMonth.split('-');
  const monthName = MONTH_NAMES_ID[Number(month) - 1];
  const autoLabel = year && monthName ? `${monthName} ${year}` : null;

  return autoLabel && autoLabel === period.label
    ? monthLabel(period.uploadMonth, lang)
    : period.label;
}

/**
 * Buat periode baru (kalau belum ada) supaya user bisa upload ke bulan yang
 * belum punya periode. Mengembalikan data periode yang siap dipakai.
 */
export function useCreatePeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { uploadMonth: string; label?: string }) =>
      fetchApi<{ data: { id: string; label: string; uploadMonth: string } }>('/material-planning/cycles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PERIOD_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['material-planning-cycles'] });
    },
  });
}

export function useUpdatePeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { uploadMonth?: string; label?: string } }) =>
      fetchApi(`/material-planning/cycles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PERIOD_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['material-planning-cycles'] });
    },
  });
}

export function useDeletePeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi(`/material-planning/cycles/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PERIOD_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['material-planning-cycles'] });
    },
  });
}

/** Total baris semua sumber di satu periode. */
export function periodTotal(p: PeriodSummary): number {
  return Object.values(p.counts).reduce((sum, n) => sum + n, 0);
}
