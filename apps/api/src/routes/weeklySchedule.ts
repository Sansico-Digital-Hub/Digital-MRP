import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES, canWriteModule, forbiddenModuleMessage, requireModuleAccess } from '../lib/permissions';
import {
  resolveUploadPeriod,
  recordPeriodChange,
  touchPeriod,
  recomputeMrpRange,
  requireModuleType,
  parseModuleType,
  resolveModuleType,
} from '../lib/periodScope';

/**
 * Segarkan `PlanningCycle.mrpStartDate/mrpEndDate` bila baris yang berubah milik
 * modul MATERIAL — rentang itu dasar timeline Material Calculation.
 *
 * Dipanggil SETELAH penulisan data supaya nilainya selalu = MIN/MAX data nyata,
 * bukan hanya batch terakhir (bug 2026-10-06: periode September 2026 sempat
 * menyimpan 5–11 Jan 2032 padahal datanya 19 Sep 2026 – 13 Mar 2027).
 */
async function refreshMrpRangeFor(periodId: string, moduleType: string | null | undefined) {
  if (moduleType !== 'MATERIAL') return;
  const { start, end } = await recomputeMrpRange(periodId);
  await prisma.planningCycle.update({
    where: { id: periodId },
    data: { mrpStartDate: start, mrpEndDate: end },
  });
}

export default async function weeklyScheduleRoutes(server: FastifyInstance) {
  // GET /api/v1/weekly-schedule — bisa difilter per periode + modul:
  //   ?periodId=...&moduleType=PRODUCTION|MATERIAL
  // Kalau `moduleType` TIDAK dikirim, kedua modul dibaca (dipakai hanya untuk
  // daftar referensi). Semua konsumen data wajib mengirimnya secara eksplisit.
  server.get('/api/v1/weekly-schedule', { preValidation: [authenticate] }, async (request, reply) => {
    const { year, weekNumber, itemId, periodId, moduleType } = request.query as {
      year?: string;
      weekNumber?: string;
      itemId?: string;
      periodId?: string;
      moduleType?: string;
    };

    const module = parseModuleType(moduleType);
    const where: any = {};
    if (module) where.moduleType = module;
    if (periodId) where.periodId = periodId;
    if (year) where.year = parseInt(year);
    if (weekNumber) where.weekNumber = parseInt(weekNumber);
    if (itemId) where.itemId = itemId;

    const schedules = await prisma.weeklySchedule.findMany({
      where,
      include: { item: true },
      orderBy: [{ year: 'asc' }, { weekNumber: 'asc' }],
    });

    return reply.send({ data: schedules });
  });

  // GET /api/v1/weekly-schedule/summary - Group by item using the uploaded period's
  // first data week as W1. Missing/all-zero weeks remain in the calendar.
  server.get('/api/v1/weekly-schedule/summary', { preValidation: [authenticate] }, async (request, reply) => {
    // Ringkasan WAJIB per periode — tanpa ini demand beberapa bulan akan tercampur.
    // moduleType menentukan modul mana yang dibaca (Production vs Material).
    const { periodId, moduleType } = request.query as { periodId?: string; moduleType?: string };
    if (!periodId) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Parameter periodId wajib diisi. Pilih periode dulu.',
      });
    }
    const module = resolveModuleType(moduleType);

    const schedules = await prisma.weeklySchedule.findMany({
      where: { periodId, moduleType: module },
      include: { item: true },
      orderBy: [{ weekNumber: 'asc' }, { weekStartDate: 'asc' }],
    });

    if (schedules.length === 0) {
      return reply.send({
        data: [],
        year: new Date().getFullYear(),
        moduleType: module,
        weeks: [],
        periodStart: null,
      });
    }

    // W1 = minggu pertama DATA yang diunggah (nomor minggu terkecil), bukan
    // tanggal terawal yang kebetulan tersisa di database dan bukan hari ini.
    // Seluruh 26 kolom lalu dibentuk dengan penambahan TEPAT 7 hari.
    const firstWeekNumber = schedules[0].weekNumber;
    const periodStart = new Date(schedules[0].weekStartDate);
    periodStart.setUTCHours(0, 0, 0, 0);
    const weekMilliseconds = 7 * 86400000;
    const weeks = Array.from({ length: 26 }, (_, index) => {
      const weekStart = new Date(periodStart.getTime() + index * weekMilliseconds);
      const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
      return {
        weekNumber: index + 1,
        weekStartDate: weekStart.toISOString().slice(0, 10),
        weekEndDate: weekEnd.toISOString().slice(0, 10),
      };
    });
    const relativeWeekByDate = new Map(
      weeks.map((week) => [week.weekStartDate, week.weekNumber]),
    );

    const itemMap: Record<string, any> = {};
    const assign = (s: (typeof schedules)[number], relW: number) => {
      const weekDate = s.weekStartDate.toISOString().slice(0, 10);
      if (!itemMap[s.itemId]) {
        itemMap[s.itemId] = {
          itemId: s.itemId,
          partNumber: s.item.partNumber,
          itemCode: s.item.partNumber,
          itemName: s.item.itemName,
          weeks: {},
          total: 0,
        };
      }
      itemMap[s.itemId].weeks[relW] = {
        id: s.id,
        quantity: s.quantity,
        weekStartDate: weekDate,
        weekEndDate: s.weekEndDate.toISOString().slice(0, 10),
      };
      itemMap[s.itemId].total += s.quantity;
    };

    // Baris yang tanggalnya cocok dengan kalender dipetakan lewat tanggal.
    for (const s of schedules) {
      const relW = relativeWeekByDate.get(s.weekStartDate.toISOString().slice(0, 10));
      if (relW) assign(s, relW);
    }

    // Baris dengan tanggal menyimpang (data lama sebelum perbaikan tahun) tetap
    // ditempatkan menurut nomor minggunya supaya nilainya tidak hilang.
    for (const s of schedules) {
      if (relativeWeekByDate.has(s.weekStartDate.toISOString().slice(0, 10))) continue;
      const relW = s.weekNumber - firstWeekNumber + 1;
      if (relW < 1 || relW > 26) continue; // di luar jendela 26 minggu
      if (itemMap[s.itemId]?.weeks[relW]) continue; // kolom sudah terisi
      assign(s, relW);
    }

    return reply.send({
      data: Object.values(itemMap),
      year: periodStart.getUTCFullYear(),
      moduleType: module,
      weeks,
      periodStart: weeks[0].weekStartDate,
    });
  });

  // POST /api/v1/weekly-schedule (single upsert)
  server.post(
    '/api/v1/weekly-schedule',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared), requireModuleAccess()] },
    async (request, reply) => {
      const body = request.body as any;
      const { year, weekNumber, weekStartDate, weekEndDate, itemId, itemCode, description, quantity, saveMode } = body;
      const codeToUse = itemCode || body.partNumber;

      if (!year || !weekNumber || quantity === undefined || (!itemId && !codeToUse)) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Missing required fields' });
      }

      const resolved = await resolveUploadPeriod(body, request.user!.id);
      if (!resolved.ok) {
        return reply.code(resolved.code).send({ error: 'Bad Request', message: resolved.message });
      }
      const { periodId } = resolved;

      // Data MRP dipisah per modul — WAJIB, tidak ada default.
      const moduleRes = requireModuleType(body.moduleType, 'Upload MRP 26 Weeks');
      if (!moduleRes.ok) {
        return reply.code(moduleRes.code).send({ error: 'Bad Request', message: moduleRes.message });
      }
      const { moduleType } = moduleRes;

      let finalItemId = itemId;
      if (!finalItemId && codeToUse) {
        let item = await prisma.item.findUnique({ where: { partNumber: codeToUse } });
        if (!item) {
          item = await prisma.item.create({
            data: { partNumber: codeToUse, itemName: description || codeToUse, unit: 'PCS' },
          });
        } else if (description && item.itemName !== description) {
          item = await prisma.item.update({ where: { id: item.id }, data: { itemName: description } });
        }
        finalItemId = item.id;
      }

      // Compute weekStartDate / weekEndDate if not provided
      const startDate = weekStartDate ? new Date(weekStartDate) : new Date();
      const endDate = weekEndDate ? new Date(weekEndDate) : new Date(startDate.getTime() + 6 * 86400000);

      const existing = await prisma.weeklySchedule.findUnique({
        where: {
          periodId_moduleType_year_weekNumber_itemId: {
            periodId,
            moduleType,
            year: parseInt(year),
            weekNumber: parseInt(weekNumber),
            itemId: finalItemId,
          },
        },
      });

      const newQty =
        saveMode === 'add' && existing
          ? existing.quantity + parseFloat(quantity)
          : parseFloat(quantity);

      const schedule = await prisma.weeklySchedule.upsert({
        where: {
          periodId_moduleType_year_weekNumber_itemId: {
            periodId,
            moduleType,
            year: parseInt(year),
            weekNumber: parseInt(weekNumber),
            itemId: finalItemId,
          },
        },
        update: { quantity: newQty, weekStartDate: startDate, weekEndDate: endDate },
        create: {
          periodId,
          moduleType,
          year: parseInt(year),
          weekNumber: parseInt(weekNumber),
          weekStartDate: startDate,
          weekEndDate: endDate,
          itemId: finalItemId,
          quantity: newQty,
        },
      });

      await touchPeriod(periodId);
      await refreshMrpRangeFor(periodId, moduleType);

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'WeeklySchedule',
          entityId: schedule.id,
          dataAfter: schedule as any,
        },
      });

      return reply.code(200).send({ data: schedule });
    }
  );

  // POST /api/v1/weekly-schedule/bulk
  server.post(
    '/api/v1/weekly-schedule/bulk',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared), requireModuleAccess()] },
    async (request, reply) => {
      const body = request.body as any;
      const { records, saveMode } = body;
      if (!Array.isArray(records) || records.length === 0) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No records provided' });
      }

      const resolved = await resolveUploadPeriod(body, request.user!.id);
      if (!resolved.ok) {
        return reply.code(resolved.code).send({ error: 'Bad Request', message: resolved.message });
      }
      const { periodId } = resolved;

      // Data MRP dipisah per modul — WAJIB, tidak ada default.
      const moduleRes = requireModuleType(body.moduleType, 'Upload MRP 26 Weeks');
      if (!moduleRes.ok) {
        return reply.code(moduleRes.code).send({ error: 'Bad Request', message: moduleRes.message });
      }
      const { moduleType } = moduleRes;

      // Hitungan & penimpaan SELALU dibatasi ke periode + modul ini saja.
      const previousCount = await prisma.weeklySchedule.count({ where: { periodId, moduleType } });

      const CHUNK_SIZE = 100;

      // Filter valid records upfront
      const validRecords: any[] = records.filter(
        (r: any) => r.year && r.weekNumber && r.itemCode && r.quantity !== undefined,
      );
      if (validRecords.length === 0) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No valid records' });
      }

      // ── Step 1: Batch-resolve items ──────────────────────────────────────────
      const uniqueCodes = [...new Set(validRecords.map((r: any) => r.itemCode as string))];

      // Build description map (first occurrence wins)
      const toyNameMap: Record<string, string> = {};
      for (const r of validRecords) {
        if (!toyNameMap[r.itemCode]) toyNameMap[r.itemCode] = r.description || r.itemCode;
      }

      // Fetch all existing items in one query
      const existingItems = await prisma.item.findMany({ where: { partNumber: { in: uniqueCodes } } });
      const itemCodeToId: Record<string, string> = {};
      for (const item of existingItems) itemCodeToId[item.partNumber] = item.id;

      // Create missing items in one batch
      const missingCodes = uniqueCodes.filter((code) => !itemCodeToId[code]);
      if (missingCodes.length > 0) {
        await prisma.item.createMany({
          data: missingCodes.map((code) => ({ partNumber: code, itemName: toyNameMap[code] || code, unit: 'PCS' })),
          skipDuplicates: true,
        });
        const newItems = await prisma.item.findMany({ where: { partNumber: { in: missingCodes } } });
        for (const item of newItems) itemCodeToId[item.partNumber] = item.id;
      }

      // Update stale item names in parallel (only changed ones)
      const nameUpdates = existingItems.filter(
        (item) => toyNameMap[item.partNumber] && item.itemName !== toyNameMap[item.partNumber],
      );
      if (nameUpdates.length > 0) {
        await Promise.all(
          nameUpdates.map((item) =>
            prisma.item.update({ where: { id: item.id }, data: { itemName: toyNameMap[item.partNumber] } }),
          ),
        );
      }

      const replacePeriod = saveMode === 'overwrite' && body.replacePeriod === true;

      if (saveMode === 'overwrite' && !replacePeriod) {
        const scopeMap = new Map<string, { year: number; weekNumber: number; itemIds: Set<string> }>();
        for (const r of validRecords) {
          const year = parseInt(r.year);
          const weekNumber = parseInt(r.weekNumber);
          const key = `${year}_${weekNumber}`;
          
          if (!scopeMap.has(key)) {
            scopeMap.set(key, { year, weekNumber, itemIds: new Set() });
          }
          const itemId = itemCodeToId[r.itemCode];
          if (itemId) {
            scopeMap.get(key)!.itemIds.add(itemId);
          }
        }

        for (const scope of scopeMap.values()) {
          await prisma.weeklySchedule.deleteMany({
            where: {
              periodId,
              moduleType,
              year: scope.year,
              weekNumber: scope.weekNumber,
              itemId: { notIn: Array.from(scope.itemIds) }
            }
          });
        }
      }

      // ── Step 2: Fetch all existing schedules for the years in one query ──────
      const years = [...new Set(validRecords.map((r: any) => parseInt(r.year)))] as number[];
      const existingSchedules = replacePeriod
        ? []
        : await prisma.weeklySchedule.findMany({
            where: { periodId, moduleType, year: { in: years } },
            select: { id: true, year: true, weekNumber: true, itemId: true, quantity: true },
          });
      const scheduleMap: Record<string, { id: string; quantity: number }> = {};
      for (const s of existingSchedules) {
        scheduleMap[`${s.year}_${s.weekNumber}_${s.itemId}`] = { id: s.id, quantity: s.quantity };
      }

      // ── Step 3: Classify into creates and updates ─────────────────────────────
      const toCreate: any[] = [];
      const toUpdate: { id: string; quantity: number; weekStartDate: Date; weekEndDate: Date }[] = [];

      for (const r of validRecords) {
        const itemId = itemCodeToId[r.itemCode];
        if (!itemId) continue;
        const startDate = r.weekStartDate ? new Date(r.weekStartDate) : new Date();
        const endDate = r.weekEndDate ? new Date(r.weekEndDate) : new Date(startDate.getTime() + 6 * 86400000);
        const key = `${parseInt(r.year)}_${parseInt(r.weekNumber)}_${itemId}`;
        const existing = scheduleMap[key];
        const newQty = saveMode === 'add' && existing ? existing.quantity + parseFloat(r.quantity) : parseFloat(r.quantity);
        if (newQty <= 0 && saveMode !== 'overwrite' && Number(r.quantity) !== 0) continue;

        if (existing) {
          toUpdate.push({ id: existing.id, quantity: newQty, weekStartDate: startDate, weekEndDate: endDate });
        } else {
          toCreate.push({
            periodId,
            moduleType,
            year: parseInt(r.year),
            weekNumber: parseInt(r.weekNumber),
            weekStartDate: startDate,
            weekEndDate: endDate,
            itemId,
            quantity: newQty,
          });
        }
      }

      // ── Step 4: Execute in a transaction with batched operations ──────────────
      let createdCount = 0;
      let updatedCount = 0;

      await prisma.$transaction(
        async (tx) => {
          if (replacePeriod) {
            await tx.weeklySchedule.deleteMany({ where: { periodId, moduleType } });
          }
          // createMany in chunks
          for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
            const result = await tx.weeklySchedule.createMany({ data: toCreate.slice(i, i + CHUNK_SIZE), skipDuplicates: true });
            createdCount += result.count;
          }
          // Parallel updates in chunks
          for (let i = 0; i < toUpdate.length; i += CHUNK_SIZE) {
            await Promise.all(
              toUpdate.slice(i, i + CHUNK_SIZE).map((u) =>
                tx.weeklySchedule.update({
                  where: { id: u.id },
                  data: { quantity: u.quantity, weekStartDate: u.weekStartDate, weekEndDate: u.weekEndDate },
                }),
              ),
            );
            updatedCount += toUpdate.slice(i, i + CHUNK_SIZE).length;
          }
          // Single audit log for the whole operation
          await tx.auditLog.create({
            data: {
              userId: request.user!.id,
              action: 'CREATE',
              entityType: 'WeeklySchedule',
              entityId: 'bulk',
              notes: `Bulk upserted ${createdCount + updatedCount} records (${createdCount} created, ${updatedCount} updated)`,
            },
          });
        },
        { timeout: 30000 },
      );

      // Rentang tanggal MRP diperbarui di dalam `recordPeriodChange` — nilainya
      // dihitung ulang dari SELURUH data periode, bukan batch ini saja.
      await recordPeriodChange({
        periodId,
        userId: request.user!.id,
        sourceType: 'MRP',
        moduleType,
        rowCount: createdCount + updatedCount,
        replaced: previousCount,
        mode: saveMode === 'add' ? 'add' : 'overwrite',
      });

      return reply.code(200).send({
        count: createdCount + updatedCount,
        periodId,
        moduleType,
        label: resolved.label,
        replaced: previousCount,
        created: resolved.created,
      });
    },
  );

  // PUT /api/v1/weekly-schedule/:id
  server.put(
    '/api/v1/weekly-schedule/:id',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { quantity, weekStartDate, weekEndDate } = request.body as any;

      const existing = await prisma.weeklySchedule.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Not Found', message: 'Weekly schedule not found' });
      }

      // Planner hanya boleh menyentuh baris milik modulnya sendiri.
      if (!canWriteModule(request.user?.role, existing.moduleType)) {
        return reply.code(403).send({ error: 'Forbidden', message: forbiddenModuleMessage(request.user?.role) });
      }

      const schedule = await prisma.weeklySchedule.update({
        where: { id },
        data: {
          quantity: parseFloat(quantity),
          ...(weekStartDate && { weekStartDate: new Date(weekStartDate) }),
          ...(weekEndDate && { weekEndDate: new Date(weekEndDate) })
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'UPDATE',
          entityType: 'WeeklySchedule',
          entityId: schedule.id,
          dataAfter: schedule as any,
        },
      });

      await touchPeriod(existing.periodId);
      await refreshMrpRangeFor(existing.periodId, existing.moduleType);
      return reply.send({ data: schedule });
    }
  );

  // DELETE /api/v1/weekly-schedule/bulk
  server.delete(
    '/api/v1/weekly-schedule/bulk',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared)] },
    async (request, reply) => {
      const ids = (request.body as { ids: string[] }).ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No ids provided' });
      }

      const affected = await prisma.weeklySchedule.findMany({
        where: { id: { in: ids } },
        select: { periodId: true, moduleType: true },
      });

      // Planner tidak boleh menghapus data modul planner lain, walau id-nya
      // dikirim langsung lewat API.
      if (affected.some((s) => !canWriteModule(request.user?.role, s.moduleType))) {
        return reply.code(403).send({ error: 'Forbidden', message: forbiddenModuleMessage(request.user?.role) });
      }

      const periodIds = [...new Set(affected.map((s) => s.periodId))];

      await prisma.weeklySchedule.deleteMany({
        where: { id: { in: ids } },
      });

      for (const periodId of periodIds) await touchPeriod(periodId);
      for (const periodId of periodIds) {
        const mod = affected.find((s) => s.periodId === periodId)?.moduleType;
        await refreshMrpRangeFor(periodId, mod);
      }

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'DELETE',
          entityType: 'WeeklySchedule',
          entityId: 'bulk',
          notes: `Bulk deleted ${ids.length} records`,
        },
      });

      return reply.send({ success: true, count: ids.length });
    }
  );

  // DELETE /api/v1/weekly-schedule/:id
  server.delete(
    '/api/v1/weekly-schedule/:id',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.weeklySchedule.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Not Found', message: 'Data tidak ditemukan' });
      }
      // Planner hanya boleh menyentuh baris milik modulnya sendiri.
      if (!canWriteModule(request.user?.role, existing.moduleType)) {
        return reply.code(403).send({ error: 'Forbidden', message: forbiddenModuleMessage(request.user?.role) });
      }
      await prisma.weeklySchedule.delete({ where: { id } });
      await touchPeriod(existing.periodId);
      await refreshMrpRangeFor(existing.periodId, existing.moduleType);
      return reply.send({ message: 'Deleted successfully' });
    }
  );
}
