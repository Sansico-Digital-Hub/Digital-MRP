import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES } from '../lib/permissions';

export default async function itemsRoutes(server: FastifyInstance) {
  // Get all items
  server.get('/api/v1/items', { preValidation: [authenticate] }, async (request, reply) => {
    const items = await prisma.item.findMany({
      orderBy: { itemName: 'asc' },
    });
    return reply.send({ data: items });
  });

  // Get all master cartons
  server.get('/api/v1/master-cartons', { preValidation: [authenticate] }, async (request, reply) => {
    const mcs = await prisma.masterCarton.findMany({
      orderBy: { cartonCode: 'asc' },
    });
    return reply.send({ data: mcs });
  });

  // Create master carton
  server.post(
    '/api/v1/master-cartons',
    { preValidation: [authenticate, requireRole(['SUPER_ADMIN', 'ADMIN'])] },
    async (request, reply) => {
      const { cartonCode, toyNameItemId, partNumberCode } = request.body as any;

      if (!cartonCode || !toyNameItemId || !partNumberCode) {
        return reply.code(400).send({ error: 'Bad Request', message: 'cartonCode, toyNameItemId, and partNumberCode are required' });
      }

      const existingMc = await prisma.masterCarton.findUnique({ where: { cartonCode } });
      if (existingMc) {
        return reply.code(409).send({ error: 'Conflict', message: 'Master Carton code already exists' });
      }

      const newMc = await prisma.masterCarton.create({
        data: { cartonCode, toyNameItemId, partNumberCode },
      });

      // Audit Log
      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'CREATE',
          entityType: 'MasterCarton',
          entityId: newMc.id,
          dataAfter: newMc as any,
        },
      });

      return reply.code(201).send({ data: newMc });
    }
  );

  // Update master carton
  server.put(
    '/api/v1/master-cartons/:id',
    { preValidation: [authenticate, requireRole(['SUPER_ADMIN', 'ADMIN'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { cartonCode, toyNameItemId, partNumberCode } = request.body as any;

      const existingMc = await prisma.masterCarton.findUnique({ where: { id } });
      if (!existingMc) {
        return reply.code(404).send({ error: 'Not Found', message: 'Master Carton not found' });
      }

      if (cartonCode && cartonCode !== existingMc.cartonCode) {
        const mcExists = await prisma.masterCarton.findUnique({ where: { cartonCode } });
        if (mcExists) {
          return reply.code(409).send({ error: 'Conflict', message: 'Master Carton code already exists' });
        }
      }

      const updatedMc = await prisma.masterCarton.update({
        where: { id },
        data: { cartonCode, toyNameItemId, partNumberCode },
      });

      // Audit Log
      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'UPDATE',
          entityType: 'MasterCarton',
          entityId: updatedMc.id,
          dataBefore: existingMc as any,
          dataAfter: updatedMc as any,
        },
      });

      return reply.send({ data: updatedMc });
    }
  );

  // Delete master carton
  server.delete(
    '/api/v1/master-cartons/:id',
    { preValidation: [authenticate, requireRole(['SUPER_ADMIN', 'ADMIN'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const existingMc = await prisma.masterCarton.findUnique({ where: { id } });
      if (!existingMc) {
        return reply.code(404).send({ error: 'Not Found', message: 'Master Carton not found' });
      }

      await prisma.masterCarton.delete({ where: { id } });

      // Audit Log
      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'DELETE',
          entityType: 'MasterCarton',
          entityId: id,
          dataBefore: existingMc as any,
        },
      });

      return reply.send({ message: 'Master Carton deleted successfully' });
    }
  );

  // Search items
  server.get('/api/v1/items/search', { preValidation: [authenticate] }, async (request, reply) => {
    const { q } = request.query as { q?: string };
    if (!q || q.length < 2) {
      return reply.send({ data: [] });
    }

    const items = await prisma.item.findMany({
      where: {
        OR: [
          { partNumber: { contains: q } },
          { itemName: { contains: q } }
        ]
      },
      take: 20,
    });
    return reply.send({ data: items });
  });

  // Get single item
  server.get('/api/v1/items/:id', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = await prisma.item.findUnique({ where: { id } });

    if (!item) {
      return reply.code(404).send({ error: 'Not Found', message: 'Item not found' });
    }

    return reply.send({ data: item });
  });

  // Create item
  server.post(
    '/api/v1/items',
    // Item dipakai bersama oleh kedua modul, dan halaman MRP/WIP/FG membuat
    // part number BARU langsung dari form (inline). Jadi planner perlu boleh
    // membuat item. Ubah/hapus item tetap Admin & Super Admin saja.
    { preValidation: [authenticate, requireRole(EDIT_ROLES.shared)] },
    async (request, reply) => {
      const body = request.body as any;
      const partNumber = body.partNumber || body.itemCode;
      const { itemName, unit } = body;

      if (!partNumber || !itemName || !unit) {
        return reply.code(400).send({ error: 'Bad Request', message: 'partNumber, itemName, and unit are required' });
      }

      const existingItem = await prisma.item.findUnique({ where: { partNumber } });
      if (existingItem) {
        return reply.code(409).send({ error: 'Conflict', message: 'Part number already exists' });
      }

      const newItem = await prisma.item.create({
        data: { partNumber, itemName, unit },
      });

      // Audit Log
      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'CREATE',
          entityType: 'Item',
          entityId: newItem.id,
          dataAfter: newItem as any,
        },
      });

      return reply.code(201).send({ data: newItem });
    }
  );

  // Update item
  server.put(
    '/api/v1/items/:id',
    { preValidation: [authenticate, requireRole(['SUPER_ADMIN', 'ADMIN'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const partNumber = body.partNumber || body.itemCode;
      const { itemName, unit } = body;

      const existingItem = await prisma.item.findUnique({ where: { id } });
      if (!existingItem) {
        return reply.code(404).send({ error: 'Not Found', message: 'Item not found' });
      }

      if (partNumber && partNumber !== existingItem.partNumber) {
        const codeExists = await prisma.item.findUnique({ where: { partNumber } });
        if (codeExists) {
          return reply.code(409).send({ error: 'Conflict', message: 'Part number already exists' });
        }
      }

      const updatedItem = await prisma.item.update({
        where: { id },
        data: {
          ...(partNumber && { partNumber }),
          ...(itemName && { itemName }),
          ...(unit && { unit }),
        },
      });

      // Audit Log
      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'UPDATE',
          entityType: 'Item',
          entityId: updatedItem.id,
          dataBefore: existingItem as any,
          dataAfter: updatedItem as any,
        },
      });

      return reply.send({ data: updatedItem });
    }
  );

  // Delete item
  server.delete(
    '/api/v1/items/:id',
    { preValidation: [authenticate, requireRole(['SUPER_ADMIN', 'ADMIN'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const existingItem = await prisma.item.findUnique({ where: { id } });
      if (!existingItem) {
        return reply.code(404).send({ error: 'Not Found', message: 'Item not found' });
      }

      await prisma.item.delete({ where: { id } });

      // Audit Log
      await prisma.auditLog.create({
        data: {
          userId: request.user!.id,
          action: 'DELETE',
          entityType: 'Item',
          entityId: id,
          dataBefore: existingItem as any,
        },
      });

      return reply.send({ message: 'Item deleted successfully' });
    }
  );
}
