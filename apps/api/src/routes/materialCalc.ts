import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';
import { config } from '../config';
import { authenticate } from '../middleware/auth';
import {
  runMaterialCalculation,
  type MaterialCalcEngineResult,
  type MaterialCalcSource,
} from '../lib/materialCalcEngine';

/**
 * Route Material Calculation mode LIVE (tabel operasional).
 *
 * Sejak Fase 3, perhitungan selalu mencakup MRP PENUH (26 minggu), bukan lagi
 * satu bulan yang dipilih. Ini sesuai permintaan: hitungan dibuat langsung
 * dalam 1 MRP penuh. Parameter `startDate`/`endDate` masih diterima supaya
 * pemanggil lama tidak error, tapi TIDAK lagi mempersempit perhitungan.
 */
export default async function materialCalcRoutes(server: FastifyInstance) {
  // ── Riwayat perhitungan (dipertahankan untuk migrasi data lama) ──────────
  server.get('/api/v1/material-calculation/history', { preValidation: [authenticate] }, async (_request, reply) => {
    const histories = await prisma.calculationHistory.findMany({
      orderBy: { savedAt: 'desc' },
      select: {
        id: true,
        monthKey: true,
        periodStartDate: true,
        periodEndDate: true,
        periodWeeks: true,
        calculatedAt: true,
        savedAt: true,
        user: { select: { name: true } },
        sources: { select: { sourceType: true } },
      },
    });
    return reply.send({ data: histories });
  });

  server.post('/api/v1/material-calculation/history', { preValidation: [authenticate] }, async (request, reply) => {
    const body = request.body as {
      periodStartDate?: string;
      periodEndDate?: string;
      periodWeeks?: number;
      calculatedAt?: string;
      groups?: unknown[];
      sourceData?: Record<string, unknown>;
    };

    if (!body.periodStartDate || !body.periodEndDate || !body.groups || !body.sourceData) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Calculation result and source snapshots are required' });
    }

    const periodStartDate = new Date(body.periodStartDate);
    const periodEndDate = new Date(body.periodEndDate);
    if (isNaN(periodStartDate.getTime()) || isNaN(periodEndDate.getTime())) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Invalid calculation period dates' });
    }

    const sourceEntries = Object.entries(body.sourceData);
    const history = await prisma.calculationHistory.create({
      data: {
        monthKey: periodStartDate.toISOString().slice(0, 7),
        periodStartDate,
        periodEndDate,
        periodWeeks: body.periodWeeks || 0,
        calculatedAt: body.calculatedAt ? new Date(body.calculatedAt) : new Date(),
        savedBy: request.user!.id,
        resultSnapshot: {
          calculatedAt: body.calculatedAt || new Date().toISOString(),
          periodStartDate: body.periodStartDate,
          periodEndDate: body.periodEndDate,
          periodWeeks: body.periodWeeks || 0,
          groups: body.groups,
        } as any,
        sources: {
          create: sourceEntries.map(([sourceType, dataSnapshot]) => ({
            sourceType,
            dataSnapshot: dataSnapshot as any,
          })),
        },
      },
      include: { sources: { select: { sourceType: true } } },
    });

    return reply.code(201).send({ data: history });
  });

  server.get('/api/v1/material-calculation/history/:id', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const history = await prisma.calculationHistory.findUnique({
      where: { id },
      include: { sources: true, user: { select: { name: true } } },
    });
    if (!history) return reply.code(404).send({ error: 'Not Found', message: 'Calculation history not found' });
    return reply.send({ data: history });
  });

  server.put('/api/v1/material-calculation/history/:id', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { periodStartDate?: string; periodEndDate?: string };
    const existing = await prisma.calculationHistory.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Not Found', message: 'Calculation history not found' });

    const periodStartDate = body.periodStartDate ? new Date(body.periodStartDate) : existing.periodStartDate;
    const periodEndDate = body.periodEndDate ? new Date(body.periodEndDate) : existing.periodEndDate;
    if (isNaN(periodStartDate.getTime()) || isNaN(periodEndDate.getTime()) || periodEndDate <= periodStartDate) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Invalid calculation period' });
    }

    const updated = await prisma.calculationHistory.update({
      where: { id },
      data: {
        periodStartDate,
        periodEndDate,
        periodWeeks: Math.max(1, Math.ceil((periodEndDate.getTime() - periodStartDate.getTime()) / (7 * 86400000))),
        monthKey: periodStartDate.toISOString().slice(0, 7),
      },
    });
    return reply.send({ data: updated });
  });

  server.delete('/api/v1/material-calculation/history/:id', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.calculationHistory.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: 'Not Found', message: 'Calculation history not found' });
    await prisma.calculationHistory.delete({ where: { id } });
    return reply.send({ success: true });
  });

  // ── Perhitungan live DIHENTIKAN (2026-09-28) ────────────────────────────
  // Dulu endpoint ini menghitung dari tabel Master Data TANPA filter periode,
  // sehingga data beberapa bulan tercampur. Sekarang setiap perhitungan HARUS
  // lewat satu periode (PlanningCycle):
  //   POST /api/v1/material-planning/cycles/:id/calculate
  //   GET  /api/v1/material-planning/cycles/:id/results/:resultId
  server.get('/api/v1/material-calculation', { preValidation: [authenticate] }, async (_request, reply) => {
    return reply.code(410).send({
      error: 'Gone',
      message:
        'Perhitungan tanpa periode sudah tidak dipakai. Pilih periode di halaman Material Calculation ' +
        '(POST /material-planning/cycles/:id/calculate).',
    });
  });
}
