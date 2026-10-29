import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES } from '../lib/permissions';

export default async function fgStockRoutes(server: FastifyInstance) {
  // Get all FG stocks
  server.get('/api/v1/fg-stock', { preValidation: [authenticate] }, async (request, reply) => {
    const stocks = await prisma.fGStock.findMany({
      include: { item: true, user: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return reply.send({ data: stocks });
  });

  // Upsert FG stock
  server.post(
    '/api/v1/fg-stock',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.production)] },
    async (request, reply) => {
      const { itemId, itemCode, partNumber, quantity, date, notes, saveMode, unit } = request.body as any;
      const codeToUse = partNumber || itemCode;

      if ((!itemId && !codeToUse) || quantity === undefined || !date) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Missing required fields' });
      }

      let finalItemId = itemId;
      if (!finalItemId && codeToUse) {
        let item = await prisma.item.findUnique({ where: { partNumber: codeToUse } });
        if (!item) {
          item = await prisma.item.create({
            data: { partNumber: codeToUse, itemName: codeToUse, unit: unit || 'pcs' },
          });
        } else if (unit) {
          item = await prisma.item.update({
            where: { id: item.id },
            data: { unit },
          });
        }
        finalItemId = item.id;
      } else if (finalItemId && unit) {
        await prisma.item.update({
          where: { id: finalItemId },
          data: { unit },
        });
      }

      const existingStock = await prisma.fGStock.findUnique({
        where: { itemId: finalItemId },
      });

      const updatedStock = await prisma.fGStock.upsert({
        where: { itemId: finalItemId },
        update: {
          quantity: saveMode === 'add' ? { increment: parseFloat(quantity) } : parseFloat(quantity),
          date: new Date(date),
          notes,
          updatedBy: request.user!.id,
        },
        create: {
          itemId: finalItemId,
          quantity: parseFloat(quantity),
          date: new Date(date),
          notes,
          updatedBy: request.user!.id,
        },
      });

      // Audit Log
      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: existingStock ? 'UPDATE' : 'CREATE',
          entityType: 'FGStock',
          entityId: updatedStock.id,
          dataBefore: existingStock ? (existingStock as any) : null,
          dataAfter: updatedStock as any,
          notes: 'Upserted FG Stock',
        },
      });

      return reply.code(200).send({ data: updatedStock });
    }
  );
  // Bulk Upsert FG stock
  server.post(
    '/api/v1/fg-stock/bulk',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.production)] },
    async (request, reply) => {
      const { records, saveMode } = request.body as any;
      if (!Array.isArray(records) || records.length === 0) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No records provided' });
      }

      if (saveMode === 'overwrite') {
        const uniqueCodes = [...new Set(records.map((r: any) => (r.partNumber || r.itemCode) as string).filter(Boolean))];
        const existingItems = await prisma.item.findMany({ where: { partNumber: { in: uniqueCodes } } });
        const itemCodeToId: Record<string, string> = {};
        for (const item of existingItems) itemCodeToId[item.partNumber] = item.id;

        const scopeMap = new Map<string, { date: Date; itemIds: Set<string> }>();
        for (const r of records) {
          const code = r.partNumber || r.itemCode;
          if (!code || r.quantity === undefined || !r.date) continue;
          const date = new Date(r.date);
          const key = date.getTime().toString();
          
          if (!scopeMap.has(key)) {
            scopeMap.set(key, { date, itemIds: new Set() });
          }
          if (itemCodeToId[code]) {
            scopeMap.get(key)!.itemIds.add(itemCodeToId[code]);
          }
        }

        for (const scope of scopeMap.values()) {
          await prisma.fGStock.deleteMany({
            where: {
              date: scope.date,
              itemId: { notIn: Array.from(scope.itemIds) }
            }
          });
        }
      }

      const results = [];
      for (const record of records) {
        const { itemCode, partNumber, quantity, date, unit } = record;
        const codeToUse = partNumber || itemCode;
        if (!codeToUse || quantity === undefined || !date) continue;

        let item = await prisma.item.findUnique({ where: { partNumber: codeToUse } });
        if (!item) {
          item = await prisma.item.create({
            data: { partNumber: codeToUse, itemName: codeToUse, unit: unit || 'pcs' },
          });
        } else if (unit) {
          item = await prisma.item.update({
            where: { id: item.id },
            data: { unit },
          });
        }

        const existingStock = await prisma.fGStock.findUnique({
          where: { itemId: item.id },
        });

        const updatedStock = await prisma.fGStock.upsert({
          where: { itemId: item.id },
          update: {
            quantity: saveMode === 'add' ? { increment: parseFloat(quantity) } : parseFloat(quantity),
            date: new Date(date),
            updatedBy: request.user!.id,
          },
          create: {
            itemId: item.id,
            quantity: parseFloat(quantity),
            date: new Date(date),
            updatedBy: request.user!.id,
          },
        });

        await prisma.auditLog.create({
          data: {
            userId: request.user!.id,
            action: existingStock ? 'UPDATE' : 'CREATE',
            entityType: 'FGStock',
            entityId: updatedStock.id,
            notes: 'Bulk upserted FG Stock',
          },
        });
        results.push(updatedStock);
      }

      return reply.code(200).send({ data: results });
    }
  );

  // Update FG stock by ID
  server.put(
    '/api/v1/fg-stock/:id',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.production)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { quantity, date, notes } = request.body as any;

      const existingStock = await prisma.fGStock.findUnique({ where: { id } });
      if (!existingStock) {
        return reply.code(404).send({ error: 'Not Found', message: 'FG stock not found' });
      }

      const updatedStock = await prisma.fGStock.update({
        where: { id },
        data: {
          quantity: parseFloat(quantity),
          date: new Date(date),
          notes,
          updatedBy: request.user!.id,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'UPDATE',
          entityType: 'FGStock',
          entityId: updatedStock.id,
          dataBefore: existingStock as any,
          dataAfter: updatedStock as any,
          notes: 'Updated FG Stock',
        },
      });

      return reply.send({ data: updatedStock });
    }
  );

  // Bulk Delete FG stock
  server.delete(
    '/api/v1/fg-stock/bulk',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.production)] },
    async (request, reply) => {
      const { ids } = request.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No ids provided' });
      }

      await prisma.fGStock.deleteMany({
        where: { id: { in: ids } },
      });

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'DELETE',
          entityType: 'FGStock',
          entityId: 'bulk',
          notes: `Bulk deleted ${ids.length} records`,
        },
      });

      return reply.send({ success: true, count: ids.length });
    }
  );

  // Delete FG stock by ID
  server.delete(
    '/api/v1/fg-stock/:id',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.production)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const existingStock = await prisma.fGStock.findUnique({ where: { id } });
      if (!existingStock) {
        return reply.code(404).send({ error: 'Not Found', message: 'FG stock not found' });
      }

      await prisma.fGStock.delete({ where: { id } });

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'DELETE',
          entityType: 'FGStock',
          entityId: id,
          dataBefore: existingStock as any,
          notes: 'Deleted FG Stock',
        },
      });

      return reply.send({ success: true });
    }
  );
}
