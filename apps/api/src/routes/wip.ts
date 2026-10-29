import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES, canWriteModule, forbiddenModuleMessage, requireModuleAccess } from '../lib/permissions';
import {
  resolveUploadPeriod,
  recordPeriodChange,
  touchPeriod,
  requireModuleType,
  parseModuleType,
} from '../lib/periodScope';

export default async function wipRoutes(server: FastifyInstance) {
  // Get all WIPs. Bisa difilter per periode + modul:
  //   ?periodId=...&moduleType=PRODUCTION|MATERIAL
  // Tanpa `moduleType` kedua modul dibaca (hanya untuk daftar referensi seperti
  // nama lokasi di Master Item). Konsumen data wajib mengirim `moduleType`.
  server.get('/api/v1/wip', { preValidation: [authenticate] }, async (request, reply) => {
    const { periodId, moduleType } = request.query as { periodId?: string; moduleType?: string };
    const module = parseModuleType(moduleType);
    const where: any = {};
    if (periodId) where.periodId = periodId;
    if (module) where.moduleType = module;

    const wips = await prisma.wIP.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      include: { item: true, user: { select: { name: true } } },
    });
    return reply.send({ data: wips });
  });

  // Upsert WIP
  server.post(
    '/api/v1/wip',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared), requireModuleAccess()] },
    async (request, reply) => {
      const body = (request.body || {}) as any;
      const { itemId, location, quantity, progressPercent, date, shift, status, notes, saveMode } = body;

      if (!itemId || !location || quantity === undefined || !date || !shift) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Missing required fields' });
      }

      const resolved = await resolveUploadPeriod(body, request.user!.id);
      if (!resolved.ok) {
        return reply.code(resolved.code).send({ error: 'Bad Request', message: resolved.message });
      }
      const { periodId } = resolved;

      // Data WIP dipisah per modul — WAJIB, tidak ada default.
      const moduleRes = requireModuleType(body.moduleType, 'Simpan WIP');
      if (!moduleRes.ok) {
        return reply.code(moduleRes.code).send({ error: 'Bad Request', message: moduleRes.message });
      }
      const { moduleType } = moduleRes;

      const existingWip = await prisma.wIP.findUnique({
        where: {
          periodId_moduleType_itemId_location: { periodId, moduleType, itemId, location },
        },
      });

      const updatedWip = await prisma.wIP.upsert({
        where: {
          periodId_moduleType_itemId_location: { periodId, moduleType, itemId, location },
        },
        update: {
          quantity: saveMode === 'add' ? (existingWip?.quantity || 0) + parseFloat(quantity) : parseFloat(quantity),
          progressPercent: parseInt(progressPercent || 0),
          date: new Date(date),
          shift: parseInt(shift),
          status: status || 'IN_PROGRESS',
          notes,
          updatedBy: request.user!.id,
        },
        create: {
          periodId,
          moduleType,
          itemId,
          location,
          quantity: parseFloat(quantity),
          progressPercent: parseInt(progressPercent || 0),
          date: new Date(date),
          shift: parseInt(shift),
          status: status || 'IN_PROGRESS',
          notes,
          updatedBy: request.user!.id,
        },
      });

      await touchPeriod(periodId, request.user!.id);
      // Audit Log
      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: existingWip ? 'UPDATE' : 'CREATE',
          entityType: 'WIP',
          entityId: updatedWip.id,
          dataBefore: existingWip ? (existingWip as any) : null,
          dataAfter: updatedWip as any,
        },
      });

      return reply.code(200).send({ data: updatedWip });
    }
  );

  // Bulk Upsert WIP
  server.post(
    '/api/v1/wip/bulk',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared), requireModuleAccess()] },
    async (request, reply) => {
      const body = (request.body || {}) as any;
      const { records, saveMode } = body;
      if (!Array.isArray(records) || records.length === 0) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No records provided' });
      }

      const resolved = await resolveUploadPeriod(body, request.user!.id);
      if (!resolved.ok) {
        return reply.code(resolved.code).send({ error: 'Bad Request', message: resolved.message });
      }
      const { periodId } = resolved;

      // Data WIP dipisah per modul — WAJIB, tidak ada default.
      const moduleRes = requireModuleType(body.moduleType, 'Upload WIP');
      if (!moduleRes.ok) {
        return reply.code(moduleRes.code).send({ error: 'Bad Request', message: moduleRes.message });
      }
      const { moduleType } = moduleRes;

      // Hitungan & penimpaan SELALU dibatasi ke periode + modul ini saja.
      const previousCount = await prisma.wIP.count({ where: { periodId, moduleType } });

      if (saveMode === 'overwrite') {
        const uniqueCodes = [...new Set(records.map((r: any) => (r.partNumber || r.itemCode) as string).filter(Boolean))];
        const existingItems = await prisma.item.findMany({ where: { partNumber: { in: uniqueCodes } } });
        const itemCodeToId: Record<string, string> = {};
        for (const item of existingItems) itemCodeToId[item.partNumber] = item.id;

        const scopeMap = new Map<string, { date: Date; itemsToKeep: { itemId: string, location: string }[] }>();
        for (const r of records) {
          const code = r.partNumber || r.itemCode;
          if (!code || !r.location || r.quantity === undefined || !r.date) continue;
          const date = new Date(r.date);
          const key = date.getTime().toString();
          
          if (!scopeMap.has(key)) {
            scopeMap.set(key, { date, itemsToKeep: [] });
          }
          if (itemCodeToId[code]) {
            scopeMap.get(key)!.itemsToKeep.push({ itemId: itemCodeToId[code], location: r.location });
          }
        }

        for (const scope of scopeMap.values()) {
          const keepSet = new Set(scope.itemsToKeep.map(i => `${i.itemId}_${i.location}`));
          
          const wips = await prisma.wIP.findMany({
            where: { periodId, moduleType, date: scope.date },
            select: { id: true, itemId: true, location: true }
          });
          
          const idsToDelete = wips
            .filter(w => !keepSet.has(`${w.itemId}_${w.location}`))
            .map(w => w.id);
            
          if (idsToDelete.length > 0) {
            await prisma.wIP.deleteMany({
              where: { id: { in: idsToDelete } }
            });
          }
        }
      }

      const results = [];
      for (const record of records) {
        const { itemCode, partNumber, location, quantity, date } = record;
        const codeToUse = partNumber || itemCode;
        if (!codeToUse || !location || quantity === undefined || !date) continue;

        let item = await prisma.item.findUnique({ where: { partNumber: codeToUse } });
        if (!item) {
          item = await prisma.item.create({
            data: { partNumber: codeToUse, itemName: codeToUse, unit: 'pcs' },
          });
        }

        const existingWip = await prisma.wIP.findUnique({
          where: {
            periodId_moduleType_itemId_location: { periodId, moduleType, itemId: item.id, location },
          },
        });

        const updatedWip = await prisma.wIP.upsert({
          where: {
            periodId_moduleType_itemId_location: { periodId, moduleType, itemId: item.id, location },
          },
          update: {
            quantity: saveMode === 'add' ? (existingWip?.quantity || 0) + parseFloat(quantity) : parseFloat(quantity),
            date: new Date(date),
            updatedBy: request.user!.id,
          },
          create: {
            periodId,
            moduleType,
            itemId: item.id,
            location,
            quantity: parseFloat(quantity),
            progressPercent: 0,
            date: new Date(date),
            shift: 1,
            status: 'IN_PROGRESS',
            updatedBy: request.user!.id,
          },
        });

        await prisma.auditLog.create({
          data: {
            userId: request.user!.id,
            action: existingWip ? 'UPDATE' : 'CREATE',
            entityType: 'WIP',
            entityId: updatedWip.id,
            notes: 'Bulk upserted WIP',
          },
        });
        results.push(updatedWip);
      }

      await recordPeriodChange({
        periodId,
        userId: request.user!.id,
        sourceType: 'WIP',
        moduleType,
        rowCount: results.length,
        replaced: previousCount,
        mode: saveMode === 'add' ? 'add' : 'overwrite',
      });

      return reply.code(200).send({ data: results, moduleType });
    }
  );

  // Update WIP by ID
  server.put(
    '/api/v1/wip/:id',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { quantity, progressPercent, date, shift, status, notes } = request.body as any;

      const existingWip = await prisma.wIP.findUnique({ where: { id } });
      if (!existingWip) {
        return reply.code(404).send({ error: 'Not Found', message: 'WIP not found' });
      }

      // Planner hanya boleh menyentuh baris milik modulnya sendiri.
      if (!canWriteModule(request.user?.role, existingWip.moduleType)) {
        return reply.code(403).send({ error: 'Forbidden', message: forbiddenModuleMessage(request.user?.role) });
      }

      const updatedWip = await prisma.wIP.update({
        where: { id },
        data: {
          quantity: parseFloat(quantity),
          progressPercent: parseInt(progressPercent || 0),
          date: new Date(date),
          shift: parseInt(shift),
          status: status || 'IN_PROGRESS',
          notes,
          updatedBy: request.user!.id,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'UPDATE',
          entityType: 'WIP',
          entityId: updatedWip.id,
          dataBefore: existingWip as any,
          dataAfter: updatedWip as any,
          notes: 'Updated WIP',
        },
      });

      await touchPeriod(existingWip.periodId, request.user!.id);
      return reply.send({ data: updatedWip });
    }
  );

  // Bulk Delete WIP
  server.delete(
    '/api/v1/wip/bulk',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared)] },
    async (request, reply) => {
      const ids = (request.body as { ids: string[] }).ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No ids provided' });
      }

      // Tandai semua periode yang datanya ikut terhapus.
      const affected = await prisma.wIP.findMany({
        where: { id: { in: ids } },
        select: { periodId: true, moduleType: true },
      });

      // Planner tidak boleh menghapus data modul planner lain.
      if (affected.some((w) => !canWriteModule(request.user?.role, w.moduleType))) {
        return reply.code(403).send({ error: 'Forbidden', message: forbiddenModuleMessage(request.user?.role) });
      }

      const periodIds = [...new Set(affected.map((w) => w.periodId))];

      await prisma.wIP.deleteMany({
        where: { id: { in: ids } },
      });

      for (const periodId of periodIds) await touchPeriod(periodId, request.user!.id);

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'DELETE',
          entityType: 'WIP',
          entityId: 'bulk',
          notes: `Bulk deleted ${ids.length} records`,
        },
      });

      return reply.send({ success: true, count: ids.length });
    }
  );

  // Delete WIP by ID
  server.delete(
    '/api/v1/wip/:id',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const existingWip = await prisma.wIP.findUnique({ where: { id } });
      if (!existingWip) {
        return reply.code(404).send({ error: 'Not Found', message: 'WIP not found' });
      }

      // Planner hanya boleh menyentuh baris milik modulnya sendiri.
      if (!canWriteModule(request.user?.role, existingWip.moduleType)) {
        return reply.code(403).send({ error: 'Forbidden', message: forbiddenModuleMessage(request.user?.role) });
      }

      await prisma.wIP.delete({ where: { id } });

      await touchPeriod(existingWip.periodId, request.user!.id);

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'DELETE',
          entityType: 'WIP',
          entityId: id,
          dataBefore: existingWip as any,
          notes: 'Deleted WIP',
        },
      });

      return reply.send({ success: true });
    }
  );
}
