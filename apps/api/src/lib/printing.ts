import type { Prisma } from '@prisma/client';
import prisma from './prisma';
import {
  ALL_DAYS,
  planningMachine,
  plannerCalendar,
  pressSpec,
  type PlanCalendar,
  type Workdays,
} from '@pdits/shared';

/**
 * Helper modul Printing (KBA): konversi jam dinding WIB, pembacaan mesin &
 * kalender produksi.
 *
 * Waktu printing disimpan sebagai jam dinding WIB TANPA konversi zona: string
 * "2026-10-05T07:00" disimpan sebagai DATETIME 2026-10-05 07:00:00. Engine di
 * `@pdits/shared` memakai format string yang sama, jadi jam pabrik tidak pernah
 * bergeser walaupun zona waktu server/browser berbeda.
 */

/** Error dengan status HTTP; dikirim apa adanya ke klien oleh route printing. */
export class PrintingError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-05T07:00" → Date yang disimpan sebagai 2026-10-05 07:00:00. */
export const wallToDate = (wall: string) => new Date(`${wall}:00.000Z`);
export const dateToWall = (date: Date) => date.toISOString().slice(0, 16);
/** Kolom @db.Date → "YYYY-MM-DD". */
export const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
/** Tanggal valid "YYYY-MM-DD" (menolak 2026-02-30). */
export const isDate = (value: string) =>
  DATE.test(value) && dateOnly(new Date(`${value}T00:00:00Z`)) === value;
export const isWall = (value: string) =>
  WALL.test(value) && !Number.isNaN(wallToDate(value).getTime()) && dateToWall(wallToDate(value)) === value;

type Db = Prisma.TransactionClient | typeof prisma;

/** Nama user untuk kolom `createdBy` / `updatedBy` (berisi id user). */
export async function userNames(ids: (string | null | undefined)[], db: Db = prisma) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map<string, string>();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

/** Mesin cetak: kapasitas dari database + spesifikasi tetap dari engine. */
export async function loadMachines(db: Db = prisma) {
  const rows = await db.printingMachine.findMany();
  const names = await userNames(rows.map((r) => r.updatedBy), db);
  return rows
    .map((row) => {
      const spec = planningMachine(row.id);
      return {
        id: row.id,
        name: row.name,
        speed: row.speed,
        setupHours: row.setupHours,
        effectiveHours: row.effectiveHours,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy ? (names.get(row.updatedBy) ?? null) : null,
        colors: spec?.colors ?? null,
        special: spec?.special ?? null,
        min: spec?.min ?? null,
        max: spec?.max ?? null,
        note: spec?.note ?? null,
        spec: spec ? pressSpec(spec) : null,
      };
    })
    .sort((a, b) => order(a.id) - order(b.id));
}
const MACHINE_ORDER = ['kba1', 'kba2', 'kba3', 'kba4', 'genius'];
const order = (id: string) => {
  const i = MACHINE_ORDER.indexOf(id);
  return i < 0 ? MACHINE_ORDER.length : i;
};

/** Shift (dengan versi daftar), hari libur, dan maintenance — semua dalam jam dinding WIB. */
export async function loadCalendar(db: Db = prisma) {
  const [shifts, holidays, maintenance] = await Promise.all([
    db.printingShift.findMany({ orderBy: { sortOrder: 'asc' } }),
    db.printingHoliday.findMany({ orderBy: { date: 'asc' } }),
    db.printingMaintenance.findMany({ orderBy: { startAt: 'asc' } }),
  ]);
  const names = await userNames(
    [...maintenance.flatMap((m) => [m.createdBy, m.updatedBy]), ...holidays.map((h) => h.createdBy)],
    db,
  );
  return {
    shifts: shifts.map(({ name, start, end, breakStart, breakEnd }) => ({ name, start, end, breakStart, breakEnd })),
    shiftsVersion: shifts.reduce((v, s) => Math.max(v, s.version), 0),
    holidays: holidays.map((h) => ({
      id: h.id,
      date: dateOnly(h.date),
      name: h.name,
      createdBy: h.createdBy ? (names.get(h.createdBy) ?? null) : null,
    })),
    maintenance: maintenance.map((m) => ({
      id: m.id,
      machineId: m.machineId,
      start: dateToWall(m.startAt),
      end: dateToWall(m.endAt),
      reason: m.reason,
      version: m.version,
      createdBy: m.createdBy ? (names.get(m.createdBy) ?? null) : null,
      updatedBy: m.updatedBy ? (names.get(m.updatedBy) ?? null) : null,
      updatedAt: m.updatedAt.toISOString(),
    })),
  };
}

/**
 * Kalender yang disimpan bersama plan: istirahat shift, hari libur, maintenance,
 * dan pilihan plan untuk tetap mencetak di hari Minggu / tanggal merah.
 */
export async function planCalendar(workdays: Workdays = ALL_DAYS, db: Db = prisma): Promise<PlanCalendar> {
  const live = await loadCalendar(db);
  return plannerCalendar(live, workdays);
}
