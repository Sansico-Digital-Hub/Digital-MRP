import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES } from '../lib/permissions';

export default async function dailyScheduleRoutes(server: FastifyInstance) {
  // Get all daily schedules
  server.get('/api/v1/daily-schedule', { preValidation: [authenticate] }, async (request, reply) => {
    const { date, shift } = request.query as { date?: string; shift?: string };
    
    const whereClause: any = {};
    if (date) whereClause.date = new Date(date);
    if (shift) whereClause.shift = parseInt(shift);

    const schedules = await prisma.dailySchedule.findMany({
      where: whereClause,
      include: { item: true },
      orderBy: [{ date: 'asc' }, { shift: 'asc' }],
    });
    
    // Fetch related MasterCarton and Toy Name mapping
    const itemCodes = [...new Set(schedules.map(s => s.item.partNumber))];
    const masterCartons = await prisma.masterCarton.findMany({
      where: { partNumberCode: { in: itemCodes } },
      include: { toyNameItem: true },
    });

    const mcMap = new Map<string, any>();
    for (const mc of masterCartons) {
      mcMap.set(mc.partNumberCode, mc);
    }

    const enhancedSchedules = schedules.map(s => {
      const mc = mcMap.get(s.item.partNumber);
      return {
        ...s,
        masterCarton: mc ? mc.cartonCode : undefined,
        toyName: mc && mc.toyNameItem ? mc.toyNameItem.itemName : s.item.itemName,
      };
    });
    
    return reply.send({ data: enhancedSchedules });
  });

  // Create or Update daily schedule (single record)
  server.post(
    '/api/v1/daily-schedule',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.production)] },
    async (request, reply) => {
      const { date, shift, itemId, itemCode, partNumber, quantity, saveMode } = request.body as any;

      if (!date || !shift || (!itemId && !itemCode && !partNumber) || quantity === undefined) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Missing required fields' });
      }

      const scheduleDate = new Date(date);

      // Resolve itemId from itemCode/partNumber if needed
      let finalItemId = itemId;
      const codeToUse = partNumber || itemCode;
      if (!finalItemId && codeToUse) {
        let item = await prisma.item.findUnique({ where: { partNumber: codeToUse } });
        if (!item) {
          item = await prisma.item.create({
            data: { partNumber: codeToUse, itemName: codeToUse, unit: 'PCS' },
          });
        }
        finalItemId = item.id;
      }

      const existingSchedule = await prisma.dailySchedule.findUnique({
        where: {
          date_shift_itemId: {
            date: scheduleDate,
            shift: parseInt(shift),
            itemId: finalItemId,
          },
        },
      });

      let schedule;
      if (existingSchedule) {
        const newQuantity = saveMode === 'add'
          ? existingSchedule.quantity + parseFloat(quantity)
          : parseFloat(quantity);

        schedule = await prisma.dailySchedule.update({
          where: { id: existingSchedule.id },
          data: { quantity: newQuantity },
        });

        await prisma.auditLog.create({
          data: {
            userId: request.user!.id,
            action: 'UPDATE',
            entityType: 'DailySchedule',
            entityId: schedule.id,
            dataBefore: existingSchedule as any,
            dataAfter: schedule as any,
          },
        });
      } else {
        schedule = await prisma.dailySchedule.create({
          data: {
            date: scheduleDate,
            shift: parseInt(shift),
            itemId: finalItemId,
            quantity: parseFloat(quantity),
          },
        });

        await prisma.auditLog.create({
          data: {
            userId: request.user!.id,
            action: 'CREATE',
            entityType: 'DailySchedule',
            entityId: schedule.id,
            dataAfter: schedule as any,
          },
        });
      }

      return reply.code(200).send({ data: schedule });
    }
  );

  // Bulk upsert daily schedules
  server.post(
    '/api/v1/daily-schedule/bulk',
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

        const scopeMap = new Map<string, { date: Date; shift: number; itemIds: Set<string> }>();
        for (const r of records) {
          const code = r.partNumber || r.itemCode;
          if (!r.date || !r.shift || !code || r.quantity === undefined) continue;
          const date = new Date(r.date);
          const shift = parseInt(r.shift);
          const key = `${date.getTime()}_${shift}`;
          
          if (!scopeMap.has(key)) {
            scopeMap.set(key, { date, shift, itemIds: new Set() });
          }
          if (itemCodeToId[code]) {
            scopeMap.get(key)!.itemIds.add(itemCodeToId[code]);
          }
        }

        for (const scope of scopeMap.values()) {
          await prisma.dailySchedule.deleteMany({
            where: {
              date: scope.date,
              shift: scope.shift,
              itemId: { notIn: Array.from(scope.itemIds) }
            }
          });
        }
      }

      const results = [];
      for (const record of records) {
        const { date, shift, itemCode, partNumber, toyName, masterCarton, quantity } = record;
        const codeToUse = partNumber || itemCode;
        if (!date || !shift || !codeToUse || quantity === undefined) continue;

        // Find or create Part Number Item
        let item = await prisma.item.findUnique({ where: { partNumber: codeToUse } });
        if (!item) {
          item = await prisma.item.create({
            data: { partNumber: codeToUse, itemName: codeToUse, unit: 'PCS' },
          });
        }

        // Handle Toy Name and Master Carton relationship
        if (toyName && masterCarton) {
          // Find or create Toy Name item (using toyName as both code and name)
          const toyNameCode = toyName.replace(/\s+/g, '_').toUpperCase();
          let toyNameItem = await prisma.item.findUnique({ where: { partNumber: toyNameCode } });
          if (!toyNameItem) {
            toyNameItem = await prisma.item.create({
              data: { partNumber: toyNameCode, itemName: toyName, unit: 'SET' },
            });
          }

          // Create or update Master Carton record
          let masterCartonRecord = await prisma.masterCarton.findUnique({ where: { cartonCode: masterCarton } });
          if (!masterCartonRecord) {
            masterCartonRecord = await prisma.masterCarton.create({
              data: {
                cartonCode: masterCarton,
                toyNameItemId: toyNameItem.id,
                partNumberCode: itemCode,
              },
            });
          } else if (masterCartonRecord.partNumberCode !== itemCode || masterCartonRecord.toyNameItemId !== toyNameItem.id) {
            // Update if relationship changed
            masterCartonRecord = await prisma.masterCarton.update({
              where: { cartonCode: masterCarton },
              data: {
                toyNameItemId: toyNameItem.id,
                partNumberCode: itemCode,
              },
            });
          }
        }

        const scheduleDate = new Date(date);
        const shiftNum = parseInt(shift);
        const qty = parseFloat(quantity);

        if (qty <= 0) continue; // Skip zero-quantity entries

        const existingSchedule = await prisma.dailySchedule.findUnique({
          where: {
            date_shift_itemId: {
              date: scheduleDate,
              shift: shiftNum,
              itemId: item.id,
            },
          },
        });

        let schedule;
        if (existingSchedule) {
          const newQuantity = saveMode === 'add'
            ? existingSchedule.quantity + qty
            : qty;

          schedule = await prisma.dailySchedule.update({
            where: { id: existingSchedule.id },
            data: { quantity: newQuantity },
          });
        } else {
          schedule = await prisma.dailySchedule.create({
            data: {
              date: scheduleDate,
              shift: shiftNum,
              itemId: item.id,
              quantity: qty,
            },
          });
        }

        await prisma.auditLog.create({
          data: {
            userId: request.user!.id,
            action: existingSchedule ? 'UPDATE' : 'CREATE',
            entityType: 'DailySchedule',
            entityId: schedule.id,
            notes: 'Bulk upserted Daily Schedule',
          },
        });

        results.push(schedule);
      }

      return reply.code(200).send({ data: results, count: results.length });
    }
  );

  // Update daily schedule by ID
  server.put(
    '/api/v1/daily-schedule/:id',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.production)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { date, shift, itemCode, partNumber, quantity } = request.body as any;
      const codeToUse = partNumber || itemCode;

      const scheduleDate = new Date(date);
      
      let finalItemId = undefined;
      if (codeToUse) {
        let item = await prisma.item.findUnique({ where: { partNumber: codeToUse } });
        if (!item) {
          item = await prisma.item.create({
            data: { partNumber: codeToUse, itemName: codeToUse, unit: 'PCS' },
          });
        }
        finalItemId = item.id;
      }

      const existingSchedule = await prisma.dailySchedule.findUnique({ where: { id } });
      if (!existingSchedule) {
        return reply.code(404).send({ error: 'Not Found', message: 'Daily schedule not found' });
      }

      const updateData: any = {
        date: scheduleDate,
        shift: parseInt(shift),
        quantity: parseFloat(quantity),
      };
      if (finalItemId) {
        updateData.itemId = finalItemId;
      }

      const schedule = await prisma.dailySchedule.update({
        where: { id },
        data: updateData,
      });

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'UPDATE',
          entityType: 'DailySchedule',
          entityId: schedule.id,
          dataBefore: existingSchedule as any,
          dataAfter: schedule as any,
        },
      });

      return reply.send({ data: schedule });
    }
  );

  // Delete multiple daily schedules
  server.delete(
    '/api/v1/daily-schedule/bulk',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.production)] },
    async (request, reply) => {
      const { ids } = request.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No ids provided' });
      }

      await prisma.dailySchedule.deleteMany({
        where: { id: { in: ids } },
      });

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'DELETE',
          entityType: 'DailySchedule',
          entityId: 'bulk',
          notes: `Bulk deleted ${ids.length} records`,
        },
      });

      return reply.send({ success: true, count: ids.length });
    }
  );

  // Delete daily schedule
  server.delete(
    '/api/v1/daily-schedule/:id',
    { preValidation: [authenticate, requireRole(EDIT_ROLES.production)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const existingSchedule = await prisma.dailySchedule.findUnique({ where: { id } });
      if (!existingSchedule) {
        return reply.code(404).send({ error: 'Not Found', message: 'Daily schedule not found' });
      }

      await prisma.dailySchedule.delete({ where: { id } });

      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'DELETE',
          entityType: 'DailySchedule',
          entityId: id,
          dataBefore: existingSchedule as any,
        },
      });

      return reply.send({ success: true });
    }
  );
}
