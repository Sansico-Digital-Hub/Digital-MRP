import { FastifyInstance, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES } from '../lib/permissions';
import { breakMinutes } from '@pdits/shared';
import {
  PrintingError,
  CLOCK,
  isDate,
  isWall,
  loadCalendar,
  loadMachines,
  wallToDate,
} from '../lib/printing';

/**
 * Modul Printing (KBA) — tahap 1: mesin cetak & kalender produksi.
 *
 * Semua orang yang login boleh MELIHAT; yang boleh MENGUBAH = role Production
 * (`EDIT_ROLES.production`), karena Printing adalah bagian Production Planning.
 * Perubahan memakai optimistic locking (`version`) supaya dua planner yang
 * mengedit bersamaan tidak saling menimpa tanpa sadar.
 */

const MAX_SHIFTS = 6;
const MAX_HOLIDAYS = 200;
const MAX_MAINTENANCE_DAYS = 31;

type Body = Record<string, unknown>;
const text = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof PrintingError) {
    return reply.code(error.statusCode).send({ error: 'Printing', message: error.message });
  }
  throw error;
}

function conflict(what: string): never {
  throw new PrintingError(409, `${what} sudah diubah orang lain. Muat ulang halaman lalu coba lagi.`);
}

export default async function printingRoutes(server: FastifyInstance) {
  const canEdit = { preValidation: [authenticate, requireRole(EDIT_ROLES.production)] };
  const canView = { preValidation: [authenticate] };

  // ============================================================
  // MESIN CETAK
  // ============================================================

  server.get('/api/v1/printing/machines', canView, async () => {
    return { data: await loadMachines() };
  });

  server.put<{ Params: { id: string }; Body: Body }>(
    '/api/v1/printing/machines/:id',
    canEdit,
    async (request, reply) => {
      try {
        const body = request.body ?? {};
        const speed = Number(body.speed),
          setupHours = Number(body.setupHours),
          effectiveHours = Number(body.effectiveHours);
        if (
          !Number.isFinite(speed) ||
          speed <= 0 ||
          speed > 1e7 ||
          !Number.isFinite(setupHours) ||
          setupHours < 0 ||
          setupHours > 168 ||
          !Number.isFinite(effectiveHours) ||
          effectiveHours <= 0 ||
          effectiveHours > 24
        ) {
          throw new PrintingError(400, 'Periksa kapasitas, jam setup, dan jam efektif (di atas 0, maksimal 24 jam).');
        }

        const before = await prisma.printingMachine.findUnique({ where: { id: request.params.id } });
        if (!before) throw new PrintingError(404, 'Mesin tidak ditemukan.');

        const userId = request.user!.id;
        await prisma.$transaction(async (tx) => {
          const { count } = await tx.printingMachine.updateMany({
            where: { id: before.id, version: Number(body.version) },
            data: { speed, setupHours, effectiveHours, updatedBy: userId, version: { increment: 1 } },
          });
          if (!count) conflict(`Kapasitas ${before.name}`);
          await tx.auditLog.create({
            data: {
              userId,
              action: 'UPDATE',
              entityType: 'PrintingMachine',
              entityId: before.id,
              dataBefore: before as any,
              dataAfter: { speed, setupHours, effectiveHours },
              notes: `Kapasitas ${before.name} diubah. Jadwal yang sudah tersimpan tidak berubah.`,
            },
          });
        });

        const machines = await loadMachines();
        return reply.send({ data: machines.find((m) => m.id === before.id) });
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  // ============================================================
  // KALENDER PRODUKSI (shift, hari libur, maintenance)
  // ============================================================

  server.get('/api/v1/printing/calendar', canView, async () => {
    return { data: await loadCalendar() };
  });

  server.put<{ Body: Body }>('/api/v1/printing/calendar/shifts', canEdit, async (request, reply) => {
    try {
      const body = request.body ?? {};
      const list = Array.isArray(body.shifts) ? (body.shifts as Body[]) : [];
      if (!list.length || list.length > MAX_SHIFTS) {
        throw new PrintingError(400, `Isi 1 sampai ${MAX_SHIFTS} shift.`);
      }
      const shifts = list.map((s, i) => {
        const shift = {
          name: text(s?.name, 40) || `Shift ${i + 1}`,
          start: String(s?.start ?? ''),
          end: String(s?.end ?? ''),
          breakStart: String(s?.breakStart ?? ''),
          breakEnd: String(s?.breakEnd ?? ''),
        };
        if (![shift.start, shift.end, shift.breakStart, shift.breakEnd].every((t) => CLOCK.test(t))) {
          throw new PrintingError(400, `${shift.name}: isi semua jam dengan format HH:MM.`);
        }
        const length = breakMinutes(shift.breakStart, shift.breakEnd);
        if (!length || length > 180) {
          throw new PrintingError(400, `${shift.name}: istirahat antara 1 menit sampai 3 jam.`);
        }
        return shift;
      });

      const userId = request.user!.id;
      await prisma.$transaction(async (tx) => {
        const current = await tx.printingShift.findMany({ orderBy: { sortOrder: 'asc' } });
        const version = current.reduce((v, s) => Math.max(v, s.version), 0);
        if (Number(body.version) !== version) conflict('Daftar shift');
        await tx.printingShift.deleteMany({});
        await tx.printingShift.createMany({
          data: shifts.map((s, i) => ({ ...s, sortOrder: i + 1, version: version + 1, updatedBy: userId })),
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'UPDATE',
            entityType: 'PrintingShift',
            entityId: 'shifts',
            dataBefore: current as any,
            dataAfter: shifts,
            notes: `Istirahat shift: ${shifts.map((s) => `${s.name} ${s.breakStart}–${s.breakEnd}`).join(', ')}.`,
          },
        });
      });

      return reply.send({ data: await loadCalendar() });
    } catch (error) {
      return fail(reply, error);
    }
  });

  server.post<{ Body: Body }>('/api/v1/printing/calendar/holidays', canEdit, async (request, reply) => {
    try {
      const body = request.body ?? {};
      const date = String(body.date ?? ''),
        name = text(body.name, 80);
      if (!isDate(date)) throw new PrintingError(400, 'Isi tanggal hari libur.');
      if (!name) throw new PrintingError(400, `${date}: isi nama hari libur.`);
      if (await prisma.printingHoliday.findUnique({ where: { date: new Date(`${date}T00:00:00Z`) } })) {
        throw new PrintingError(409, `${date} sudah ada di daftar hari libur.`);
      }
      if ((await prisma.printingHoliday.count()) >= MAX_HOLIDAYS) {
        throw new PrintingError(400, `Maksimal ${MAX_HOLIDAYS} hari libur. Hapus tanggal lama dulu.`);
      }

      const userId = request.user!.id;
      try {
        await prisma.$transaction(async (tx) => {
          const holiday = await tx.printingHoliday.create({
            data: { date: new Date(`${date}T00:00:00Z`), name, createdBy: userId },
          });
          await tx.auditLog.create({
            data: {
              userId,
              action: 'CREATE',
              entityType: 'PrintingHoliday',
              entityId: holiday.id,
              dataAfter: { date, name },
            },
          });
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new PrintingError(409, `${date} sudah ada di daftar hari libur.`);
        }
        throw error;
      }

      return reply.code(201).send({ data: await loadCalendar() });
    } catch (error) {
      return fail(reply, error);
    }
  });

  server.delete<{ Params: { id: string } }>(
    '/api/v1/printing/calendar/holidays/:id',
    canEdit,
    async (request, reply) => {
      try {
        const old = await prisma.printingHoliday.findUnique({ where: { id: request.params.id } });
        if (!old) throw new PrintingError(404, 'Hari libur tidak ditemukan.');
        await prisma.$transaction([
          prisma.printingHoliday.delete({ where: { id: old.id } }),
          prisma.auditLog.create({
            data: {
              userId: request.user!.id,
              action: 'DELETE',
              entityType: 'PrintingHoliday',
              entityId: old.id,
              dataBefore: old as any,
            },
          }),
        ]);
        return reply.send({ data: await loadCalendar() });
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  /** Validasi body maintenance (dipakai create & update). */
  async function maintenanceInput(body: Body) {
    const machine = await prisma.printingMachine.findUnique({ where: { id: String(body.machineId ?? '') } });
    if (!machine) throw new PrintingError(400, 'Pilih mesin.');
    const start = String(body.start ?? ''),
      end = String(body.end ?? ''),
      reason = text(body.reason, 200);
    if (!isWall(start) || !isWall(end)) throw new PrintingError(400, 'Isi waktu mulai dan selesai maintenance.');
    if (end <= start) throw new PrintingError(400, 'Maintenance harus selesai setelah mulai.');
    if (wallToDate(end).getTime() - wallToDate(start).getTime() > MAX_MAINTENANCE_DAYS * 864e5) {
      throw new PrintingError(400, `Satu jendela maintenance maksimal ${MAX_MAINTENANCE_DAYS} hari.`);
    }
    if (!reason) throw new PrintingError(400, 'Isi keperluan maintenance.');
    return { machine, start, end, reason };
  }
  const span = (start: string, end: string) => `${start.replace('T', ' ')} – ${end.replace('T', ' ')}`;

  server.post<{ Body: Body }>('/api/v1/printing/maintenance', canEdit, async (request, reply) => {
    try {
      const { machine, start, end, reason } = await maintenanceInput(request.body ?? {});
      const userId = request.user!.id;
      await prisma.$transaction(async (tx) => {
        const record = await tx.printingMaintenance.create({
          data: {
            machineId: machine.id,
            startAt: wallToDate(start),
            endAt: wallToDate(end),
            reason,
            createdBy: userId,
            updatedBy: userId,
          },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'CREATE',
            entityType: 'PrintingMaintenance',
            entityId: record.id,
            dataAfter: { machineId: machine.id, start, end, reason },
            notes: `Maintenance ${machine.name}: ${span(start, end)} (${reason}).`,
          },
        });
      });
      return reply.code(201).send({ data: await loadCalendar() });
    } catch (error) {
      return fail(reply, error);
    }
  });

  server.put<{ Params: { id: string }; Body: Body }>(
    '/api/v1/printing/maintenance/:id',
    canEdit,
    async (request, reply) => {
      try {
        const body = request.body ?? {};
        const old = await prisma.printingMaintenance.findUnique({ where: { id: request.params.id } });
        if (!old) throw new PrintingError(404, 'Maintenance tidak ditemukan.');
        const { machine, start, end, reason } = await maintenanceInput(body);
        const userId = request.user!.id;
        await prisma.$transaction(async (tx) => {
          const { count } = await tx.printingMaintenance.updateMany({
            where: { id: old.id, version: Number(body.version) },
            data: {
              machineId: machine.id,
              startAt: wallToDate(start),
              endAt: wallToDate(end),
              reason,
              updatedBy: userId,
              version: { increment: 1 },
            },
          });
          if (!count) conflict('Maintenance ini');
          await tx.auditLog.create({
            data: {
              userId,
              action: 'UPDATE',
              entityType: 'PrintingMaintenance',
              entityId: old.id,
              dataBefore: old as any,
              dataAfter: { machineId: machine.id, start, end, reason },
              notes: `Maintenance ${machine.name} diubah: ${span(start, end)} (${reason}).`,
            },
          });
        });
        return reply.send({ data: await loadCalendar() });
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  server.delete<{ Params: { id: string }; Querystring: { version?: string } }>(
    '/api/v1/printing/maintenance/:id',
    canEdit,
    async (request, reply) => {
      try {
        const old = await prisma.printingMaintenance.findUnique({ where: { id: request.params.id } });
        if (!old) throw new PrintingError(404, 'Maintenance tidak ditemukan.');
        const userId = request.user!.id;
        await prisma.$transaction(async (tx) => {
          const { count } = await tx.printingMaintenance.deleteMany({
            where: { id: old.id, version: Number(request.query.version) },
          });
          if (!count) conflict('Maintenance ini');
          await tx.auditLog.create({
            data: {
              userId,
              action: 'DELETE',
              entityType: 'PrintingMaintenance',
              entityId: old.id,
              dataBefore: old as any,
            },
          });
        });
        return reply.send({ data: await loadCalendar() });
      } catch (error) {
        return fail(reply, error);
      }
    },
  );
}
