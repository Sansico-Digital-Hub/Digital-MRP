import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { isUserRole, USER_ROLES } from '../lib/permissions';

export default async function usersRoutes(server: FastifyInstance) {
  // Get all users (Super Admin only)
  server.get(
    '/api/v1/users',
    { preValidation: [authenticate, requireRole(['SUPER_ADMIN'])] },
    async (request, reply) => {
      const users = await prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      });
      return reply.send({ data: users });
    }
  );

  // Create user (Super Admin only)
  server.post(
    '/api/v1/users',
    { preValidation: [authenticate, requireRole(['SUPER_ADMIN'])] },
    async (request, reply) => {
      const { name, email, password, role } = request.body as any;

      if (!name || !email || !password) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Name, email, and password are required' });
      }

      // Validasi role SEBELUM menyentuh Prisma. Tanpa ini, nilai tak dikenal
      // (mis. dari versi frontend lama) meledak jadi error 500 Prisma:
      // "Invalid value for argument `role`. Expected UserRole."
      if (role !== undefined && role !== null && !isUserRole(role)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: `Role tidak valid. Pilihan yang tersedia: ${USER_ROLES.join(', ')}`,
        });
      }

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return reply.code(409).send({ error: 'Conflict', message: 'Email already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const newUser = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: role || 'USER',
        },
        select: { id: true, name: true, email: true, role: true, isActive: true },
      });

      return reply.code(201).send({ data: newUser });
    }
  );

  // Update user (Super Admin only)
  server.put(
    '/api/v1/users/:id',
    { preValidation: [authenticate, requireRole(['SUPER_ADMIN'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { name, email, role, isActive } = request.body as any;

      if (role !== undefined && role !== null && !isUserRole(role)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: `Role tidak valid. Pilihan yang tersedia: ${USER_ROLES.join(', ')}`,
        });
      }

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        return reply.code(404).send({ error: 'Not Found', message: 'User not found' });
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: {
          name: name || undefined,
          email: email || undefined,
          role: role || undefined,
          isActive: isActive !== undefined ? isActive : undefined,
        },
        select: { id: true, name: true, email: true, role: true, isActive: true },
      });

      return reply.send({ data: updatedUser });
    }
  );

  // Delete user
  //
  // User yang sudah punya RIWAYAT (audit log, stok FG, WIP, hasil perhitungan)
  // TIDAK bisa dihapus karena foreign key `restrict` — dulu ini meledak jadi
  // HTTP 500 `P2003 Foreign key constraint violated: userId`. Sekarang diperiksa
  // lebih dulu dan dijawab 409 dengan saran menonaktifkan user (kolom `isActive`),
  // supaya jejak audit tetap utuh.
  server.delete(
    '/api/v1/users/:id',
    { preValidation: [authenticate, requireRole(['SUPER_ADMIN'])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        return reply.code(404).send({ error: 'Not Found', message: 'User tidak ditemukan.' });
      }

      if (user.id === request.user!.id) {
        return reply
          .code(409)
          .send({ error: 'Conflict', message: 'Anda tidak bisa menghapus akun yang sedang dipakai.' });
      }

      const [auditLogs, cycleAuditLogs, fgStocks, fgStockHistory, wips, calculationHistories] =
        await Promise.all([
          prisma.auditLog.count({ where: { userId: id } }),
          prisma.cycleAuditLog.count({ where: { userId: id } }),
          prisma.fGStock.count({ where: { updatedBy: id } }),
          prisma.fGStockHistory.count({ where: { createdBy: id } }),
          prisma.wIP.count({ where: { updatedBy: id } }),
          prisma.calculationHistory.count({ where: { savedBy: id } }),
        ]);

      const blockers = [
        auditLogs > 0 ? `${auditLogs} audit log` : null,
        cycleAuditLogs > 0 ? `${cycleAuditLogs} riwayat periode` : null,
        fgStocks > 0 ? `${fgStocks} stok FG` : null,
        fgStockHistory > 0 ? `${fgStockHistory} riwayat stok FG` : null,
        wips > 0 ? `${wips} data WIP` : null,
        calculationHistories > 0 ? `${calculationHistories} hasil perhitungan` : null,
      ].filter(Boolean) as string[];

      if (blockers.length > 0) {
        return reply.code(409).send({
          error: 'Conflict',
          message:
            `User "${user.name}" tidak bisa dihapus karena masih terhubung ke data lain: ${blockers.join(', ')}. ` +
            'Nonaktifkan saja user ini (isActive = false) supaya riwayat tetap utuh.',
        });
      }

      await prisma.user.delete({ where: { id } });
      return reply.send({ message: 'User deleted successfully' });
    }
  );
}
