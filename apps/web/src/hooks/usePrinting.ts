import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';

/**
 * Modul Printing (KBA): mesin cetak & kalender produksi.
 * Semua waktu adalah jam dinding WIB ("2026-10-05T07:00"), bukan ISO dengan zona.
 */

export interface PrintingMachine {
  id: string;
  name: string;
  speed: number;
  setupHours: number;
  effectiveHours: number;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
  colors: number | null;
  special: boolean | null;
  min: [number, number] | null;
  max: [number, number] | null;
  note: string | null;
  spec: string | null;
}

export interface PrintingShift {
  name: string;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
}

export interface PrintingHoliday {
  id: string;
  date: string;
  name: string;
  createdBy: string | null;
}

export interface PrintingMaintenance {
  id: string;
  machineId: string;
  start: string;
  end: string;
  reason: string;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface PrintingCalendar {
  shifts: PrintingShift[];
  shiftsVersion: number;
  holidays: PrintingHoliday[];
  maintenance: PrintingMaintenance[];
}

const MACHINES_KEY = ['printing', 'machines'];
const CALENDAR_KEY = ['printing', 'calendar'];

export function usePrintingMachines() {
  return useQuery<{ data: PrintingMachine[] }, Error>({
    queryKey: MACHINES_KEY,
    queryFn: () => fetchApi('/printing/machines'),
  });
}

export function useUpdatePrintingMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Pick<PrintingMachine, 'id' | 'speed' | 'setupHours' | 'effectiveHours' | 'version'>) =>
      fetchApi<{ data: PrintingMachine }>(`/printing/machines/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: MACHINES_KEY }),
  });
}

export function usePrintingCalendar() {
  return useQuery<{ data: PrintingCalendar }, Error>({
    queryKey: CALENDAR_KEY,
    queryFn: () => fetchApi('/printing/calendar'),
  });
}

/** Semua mutasi kalender mengembalikan kalender terbaru; cache langsung diganti. */
function useCalendarMutation<T>(request: (input: T) => Promise<{ data: PrintingCalendar }>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (res) => queryClient.setQueryData(CALENDAR_KEY, res),
    onError: () => queryClient.invalidateQueries({ queryKey: CALENDAR_KEY }),
  });
}

export function useSavePrintingShifts() {
  return useCalendarMutation((input: { version: number; shifts: PrintingShift[] }) =>
    fetchApi('/printing/calendar/shifts', { method: 'PUT', body: JSON.stringify(input) }),
  );
}

export function useAddPrintingHoliday() {
  return useCalendarMutation((input: { date: string; name: string }) =>
    fetchApi('/printing/calendar/holidays', { method: 'POST', body: JSON.stringify(input) }),
  );
}

export function useDeletePrintingHoliday() {
  return useCalendarMutation((id: string) =>
    fetchApi(`/printing/calendar/holidays/${id}`, { method: 'DELETE' }),
  );
}

export interface MaintenanceInput {
  id?: string;
  version?: number;
  machineId: string;
  start: string;
  end: string;
  reason: string;
}

export function useSavePrintingMaintenance() {
  return useCalendarMutation(({ id, ...data }: MaintenanceInput) =>
    fetchApi(id ? `/printing/maintenance/${id}` : '/printing/maintenance', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data),
    }),
  );
}

export function useDeletePrintingMaintenance() {
  return useCalendarMutation(({ id, version }: { id: string; version: number }) =>
    fetchApi(`/printing/maintenance/${id}?version=${version}`, { method: 'DELETE' }),
  );
}
