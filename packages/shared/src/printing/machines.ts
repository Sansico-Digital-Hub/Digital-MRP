/**
 * Mesin cetak modul Printing (KBA). Spesifikasi dari daftar mesin klien
 * (dikonfirmasi Okt 2026) dan header sheet GC PRINTING. KBA 1 tidak bisa
 * mencetak tinta spesial sama sekali, walaupun job-nya 1–4 warna.
 *
 * Ukuran = ukuran lembar dalam cm, [sisi panjang, sisi pendek]. Speed = ribu
 * lembar per jam, sama dengan kolom "unit/hour" (QTY plan dalam ribu lembar).
 * ID sama dengan tabel `printing_machines`.
 *
 * Diport dari Production-Planning `src/planning-machines.js`.
 */

export type Size = [number, number];

export interface PrintingMachineSpec {
  id: string;
  name: string;
  colors: number;
  special: boolean;
  min: Size;
  max: Size;
  speed: number;
  note?: string;
}

/** Kapasitas yang dipakai sebuah plan (dari Press settings). */
export interface MachineCapacity {
  speed: number;
  setupHours: number;
  hoursPerDay: number;
}

export type CapacityMap = Partial<Record<string, Partial<MachineCapacity>>>;

export interface PlanningMachine extends PrintingMachineSpec, MachineCapacity {}

export const PLANNING_MACHINES: PrintingMachineSpec[] = [
  { id: 'kba1', name: 'KBA 1', colors: 4, special: false, min: [51, 38], max: [85, 72], speed: 4 },
  {
    id: 'kba2',
    name: 'KBA 2',
    colors: 5,
    special: true,
    min: [51, 38],
    max: [102, 72],
    speed: 5,
    note: 'KBA 2 special inks differ from KBA 3; check the colour matches the item standard.',
  },
  { id: 'kba3', name: 'KBA 3', colors: 6, special: true, min: [51, 38], max: [102, 72], speed: 6 },
  { id: 'kba4', name: 'KBA 4', colors: 6, special: true, min: [72, 60], max: [142, 100], speed: 3 },
  // 1000 lembar/jam, dikonfirmasi klien (Fase 0, 6 Okt 2026); sama dengan unit/hour = 1.
  { id: 'genius', name: 'GENIUS', colors: 4, special: true, min: [51, 36], max: [85, 67], speed: 1 },
];

/** Jam kerja per hari dan jam setup per job, seperti rumus GC PRINTING (`/21`, setup 1). */
export const HOURS_PER_DAY = 21;
export const SETUP_HOURS = 1;

export const planningMachine = (id: string | undefined): PrintingMachineSpec | undefined =>
  PLANNING_MACHINES.find((m) => m.id === id);

/** "4 colours · 51×38 – 85×72 cm · no special ink" */
export const pressSpec = (m: PrintingMachineSpec): string =>
  [
    `${m.colors} colours`,
    `${m.min.join('×')} – ${m.max.join('×')} cm`,
    m.special ? 'special ink' : 'no special ink',
  ].join(' · ');

/**
 * Aturan mesin + kapasitas yang dipakai plan: `{ kba1: { speed, setupHours, hoursPerDay } }`.
 * Nilai yang tidak ada memakai default di atas.
 */
export const withCapacity = (capacity?: CapacityMap | null): PlanningMachine[] =>
  PLANNING_MACHINES.map((m) => ({
    ...m,
    setupHours: SETUP_HOURS,
    hoursPerDay: HOURS_PER_DAY,
    ...(capacity?.[m.id] ?? {}),
  }));

/** Baris Press settings → kapasitas yang disimpan plan. */
export const capacityOf = (
  machines: { id: string; speed: number; setupHours: number; effectiveHours?: number | null }[],
): Record<string, MachineCapacity> =>
  Object.fromEntries(
    machines
      .filter((m) => planningMachine(m.id))
      .map((m) => [
        m.id,
        { speed: m.speed, setupHours: m.setupHours, hoursPerDay: m.effectiveHours || HOURS_PER_DAY },
      ]),
  );

/** "KBA 4", "kba4", "Genius" → id mesin. */
export function machineIdOf(text: unknown): string | undefined {
  const t = String(text ?? '')
    .toUpperCase()
    .replace(/\s+/g, '');
  if (t.startsWith('GENIUS')) return 'genius';
  const m = /^KBA([1-4])/.exec(t);
  return m ? `kba${m[1]}` : undefined;
}
