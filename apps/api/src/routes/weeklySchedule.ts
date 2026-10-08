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

  // GET /api/v1/weekly-schedule/summary
  //
  // Ringkasan MRP 26 minggu untuk SATU periode + SATU modul.
  //
  // PENTING (perbaikan 2026-10-08): kolom minggu (W1..W26) dibangun dari DATA
  // YANG DIUPLOAD, bukan dari tanggal hari ini. Sebelumnya endpoint ini membuang
  // minggu yang sudah lewat (`weekStartDate >= today`) lalu menomori ulang sisanya
  // dari 1 — akibatnya W1 bergeser ke minggu berikutnya dan angka tiap minggu tidak
  // lagi sama dengan file Excel. Sekarang:
  //   • TIDAK ADA filter tanggal — semua minggu yang tersimpan tetap tampil.
  //   • W1 = minggu paling awal di data import; W2, W3, ... mengikuti kalender 7 hari.
  //   • Posisi minggu tiap baris dihitung dari SELISIH TANGGAL terhadap W1 (bukan
  //     `weekNumber - 1`) supaya tetap benar walau penomoran minggu di data berbeda.
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

    // Ambil SELURUH baris periode + modul ini. Tidak difilter tanggal.
    const schedules = await prisma.weeklySchedule.findMany({
      where: { periodId, moduleType: module },
      include: { item: true },
      orderBy: [{ weekStartDate: 'asc' }, { weekNumber: 'asc' }],
    });

    // Jumlah kolom minggu (sesuai rancangan: 26 minggu).
    const weekCount = 26;

    // W1 = minggu paling awal yang ada di data (= start date di file import).
    let periodStart: Date | null = null;
    for (const s of schedules) {
      if (!periodStart || s.weekStartDate.getTime() < periodStart.getTime()) {
        periodStart = s.weekStartDate;
      }
    }

    // Kalender kolom minggu, dibangun dari W1 selama 26 minggu. Kolom tetap dibuat
    // walau tidak ada demand di minggu itu supaya header "W1 – 19 Sep" selalu
    // tampil pada posisi yang benar dan tidak bergeser.
    const columns: { weekNumber: number; weekStartDate: string; weekEndDate: string }[] = [];
    if (periodStart) {
      for (let i = 0; i < weekCount; i += 1) {
        const start = new Date(periodStart.getTime() + i * 7 * 86400000);
        columns.push({
          weekNumber: i + 1,
          weekStartDate: start.toISOString(),
          weekEndDate: new Date(start.getTime() + 6 * 86400000).toISOString(),
        });
      }
    }

    // Posisi (1..weekCount) tiap baris = selisih tanggal terhadap W1 dibagi 7 hari.
    const relWeekOf = (start: Date): number => {
      if (!periodStart) return 0;
      const diffDays = Math.round((start.getTime() - periodStart.getTime()) / 86400000);
      const idx = Math.round(diffDays / 7) + 1;
      return idx >= 1 && idx <= weekCount ? idx : 0; // 0 = di luar rentang 26 minggu
    };

    const itemMap: Record<string, any> = {};
    for (const s of schedules) {
      const relW = relWeekOf(s.weekStartDate);
      if (!relW) continue; // di luar rentang W1..W26
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
      // Kalau ada dua baris dengan minggu yang sama, jumlahkan (jaga-jaga).
      const existing = itemMap[s.itemId].weeks[relW];
      if (existing) {
        existing.quantity += s.quantity;
      } else {
        itemMap[s.itemId].weeks[relW] = {
          id: s.id,
          quantity: s.quantity,
          weekStartDate: s.weekStartDate,
          weekEndDate: s.weekEndDate,
        };
      }
      itemMap[s.itemId].total += s.quantity;
    }

    return reply.send({
      data: Object.values(itemMap),
      year: (periodStart ?? new Date()).getUTCFullYear(),
      moduleType: module,
      // Kalender kolom minggu (W1..W26) — dipakai frontend untuk header + badge
      // "Lewat". Terpisah dari data supaya minggu tanpa demand tetap punya kolom.
      weeks: columns,
      periodStart: periodStart ? periodStart.toISOString() : null,
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

      if (saveMode === 'overwrite') {
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
      const existingSchedules = await prisma.weeklySchedule.findMany({
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
        if (newQty <= 0 && saveMode !== 'overwrite') continue;

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
