import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES } from '../lib/permissions';
import { resolveUploadPeriod, recordPeriodChange, touchPeriod } from '../lib/periodScope';
import * as xlsx from 'xlsx';

export default async function hotlistRoutes(server: FastifyInstance) {
  // Get all hotlist items. Bisa difilter per periode: ?periodId=...
  server.get('/api/v1/hotlist', { preValidation: [authenticate] }, async (request, reply) => {
    const { periodId } = request.query as { periodId?: string };
    const data = await prisma.hotlist.findMany({
      where: periodId ? { periodId } : undefined,
      orderBy: { date: 'desc' },
    });
    return reply.send({ data });
  });

  // Upload Excel
  server.post('/api/v1/hotlist/upload', { preValidation: [authenticate, requireRole(EDIT_ROLES.material)] }, async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No file uploaded' });
      }

      // Read file buffer
      const buffer = await data.toBuffer();
      
      // Parse excel
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      
      let partNumberIdx = -1;
      let biTotalIdx = -1;
      let headerRowIdx = -1;

      // Find the headers
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        const row = rows[i];
        if (!row) continue;
        for (let j = 0; j < row.length; j++) {
          const cell = String(row[j] || '').toLowerCase().trim();
          
          if (cell.includes('kode barang')) {
            partNumberIdx = j;
            headerRowIdx = i;
          }
          
          // Check for "BI TOTAL" either in one cell, or "BI" in row i-1 and "TOTAL" in row i
          if (cell.includes('bi total') || cell.includes('bitotal')) {
            biTotalIdx = j;
          } else if (cell.includes('total') && i > 0) {
            const cellAbove = String(rows[i-1]?.[j] || '').toLowerCase().trim();
            if (cellAbove.includes('bi')) {
              biTotalIdx = j;
            }
          }
        }
        
        if (partNumberIdx !== -1 && biTotalIdx !== -1) {
          if (headerRowIdx === -1) headerRowIdx = i;
          break; // Found both headers
        }
      }

      if (partNumberIdx === -1 || biTotalIdx === -1) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Could not find "Kode Barang" or "BI TOTAL" columns in the file.' });
      }

      const recordsToInsert = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Parse data after header
      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const partNumber = String(row[partNumberIdx] || '').trim();
        const biTotalStr = String(row[biTotalIdx] || '').trim();
        const biTotal = parseFloat(biTotalStr);

        // Valid if part number is present, even if biTotal is 0
        if (partNumber && !isNaN(biTotal)) {
          recordsToInsert.push({
            partNumber,
            date: today,
            biTotal: biTotal * 1000,
          });
        }
      }

      if (recordsToInsert.length === 0) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No valid data found in Excel.' });
      }

      // Return preview data instead of saving
      return reply.code(200).send({ 
        message: 'File parsed successfully',
        data: recordsToInsert
      });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to process file' });
    }
  });

  // Import (Save) dengan mode Add atau Overwrite — WAJIB menyertakan periode.
  server.post('/api/v1/hotlist/import', { preValidation: [authenticate, requireRole(EDIT_ROLES.material)] }, async (request, reply) => {
    const body = (request.body || {}) as {
      data?: { partNumber: string; date: string | Date; biTotal: number }[];
      mode?: 'add' | 'overwrite';
      periodId?: string;
      periodMonth?: string;
      periodLabel?: string;
      fileName?: string;
    };
    const data = body.data;

    if (!data || !Array.isArray(data) || data.length === 0) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Valid data array is required' });
    }

    const resolved = await resolveUploadPeriod(body as Record<string, unknown>, request.user!.id);
    if (!resolved.ok) {
      return reply.code(resolved.code).send({ error: 'Bad Request', message: resolved.message });
    }
    const { periodId } = resolved;
    const mode: 'add' | 'overwrite' = body.mode === 'add' ? 'add' : 'overwrite';

    try {
      const previousCount = await prisma.hotlist.count({ where: { periodId } });
      let added = 0;
      let updated = 0;

      if (mode === 'overwrite') {
        // HANYA periode ini yang dikosongkan. Periode lain tidak tersentuh.
        await prisma.$transaction(
          async (tx) => {
            await tx.hotlist.deleteMany({ where: { periodId } });
            for (let i = 0; i < data.length; i += 1000) {
              await tx.hotlist.createMany({
                data: data.slice(i, i + 1000).map((record) => ({
                  periodId,
                  partNumber: record.partNumber,
                  date: new Date(record.date),
                  biTotal: record.biTotal,
                })),
              });
            }
          },
          { timeout: 180000, maxWait: 30000 },
        );
        added = data.length;
      } else {
        for (const record of data) {
          const existing = await prisma.hotlist.findUnique({
            where: { periodId_partNumber: { periodId, partNumber: record.partNumber } },
          });

          if (existing) {
            await prisma.hotlist.update({
              where: { id: existing.id },
              data: {
                biTotal: existing.biTotal + record.biTotal,
                previousDate: existing.date,
                date: new Date(record.date),
              },
            });
            updated++;
          } else {
            await prisma.hotlist.create({
              data: {
                periodId,
                partNumber: record.partNumber,
                date: new Date(record.date),
                biTotal: record.biTotal,
              },
            });
            added++;
          }
        }
      }

      await recordPeriodChange({
        periodId,
        userId: request.user!.id,
        sourceType: 'HOTLIST',
        rowCount: mode === 'overwrite' ? data.length : added + updated,
        replaced: previousCount,
        fileName: body.fileName ?? null,
        mode,
      });

      return reply.code(201).send({
        message:
          mode === 'overwrite'
            ? `Periode "${resolved.label}" ditimpa dengan ${data.length} baris.`
            : `Ditambahkan ${added} baris, ${updated} baris diperbarui di periode "${resolved.label}".`,
        count: mode === 'overwrite' ? data.length : added + updated,
        periodId,
        label: resolved.label,
        replaced: previousCount,
        created: resolved.created,
      });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to import data' });
    }
  });

  // Add Manual — WAJIB menyertakan periode.
  server.post('/api/v1/hotlist', { preValidation: [authenticate, requireRole(EDIT_ROLES.material)] }, async (request, reply) => {
    const body = (request.body || {}) as any;
    const { partNumber, date, biTotal } = body;

    if (!partNumber || !date || biTotal === undefined) {
      return reply.code(400).send({ error: 'Bad Request', message: 'partNumber, date, and biTotal are required' });
    }

    const resolved = await resolveUploadPeriod(body, request.user!.id);
    if (!resolved.ok) {
      return reply.code(resolved.code).send({ error: 'Bad Request', message: resolved.message });
    }
    const { periodId } = resolved;

    const existing = await prisma.hotlist.findUnique({
      where: { periodId_partNumber: { periodId, partNumber } },
    });

    let result;
    if (existing) {
      result = await prisma.hotlist.update({
        where: { id: existing.id },
        data: {
          biTotal: existing.biTotal + parseFloat(biTotal),
          previousDate: existing.date,
          date: new Date(date),
        },
      });
    } else {
      result = await prisma.hotlist.create({
        data: {
          periodId,
          partNumber,
          date: new Date(date),
          biTotal: parseFloat(biTotal),
        },
      });
    }

    await touchPeriod(periodId, request.user!.id);
    return reply.code(201).send({ data: result });
  });

  // Update
  server.put('/api/v1/hotlist/:id', { preValidation: [authenticate, requireRole(EDIT_ROLES.material)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { partNumber, date, biTotal } = request.body as any;

    const existingHotlist = await prisma.hotlist.findUnique({ where: { id } });
    if (!existingHotlist) {
      return reply.code(404).send({ error: 'Not Found', message: 'Hotlist record not found' });
    }

    const updatedHotlist = await prisma.hotlist.update({
      where: { id },
      data: {
        ...(partNumber && { partNumber }),
        ...(date && { date: new Date(date) }),
        ...(biTotal !== undefined && { biTotal: parseFloat(biTotal) }),
      },
    });

    await touchPeriod(existingHotlist.periodId, request.user!.id);
    return reply.send({ data: updatedHotlist });
  });

  // Delete
  server.delete('/api/v1/hotlist/:id', { preValidation: [authenticate, requireRole(EDIT_ROLES.material)] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existingHotlist = await prisma.hotlist.findUnique({ where: { id } });
    if (!existingHotlist) {
      return reply.code(404).send({ error: 'Not Found', message: 'Hotlist record not found' });
    }

    await prisma.hotlist.delete({ where: { id } });

    await touchPeriod(existingHotlist.periodId, request.user!.id);
    return reply.send({ message: 'Hotlist record deleted successfully' });
  });

  // Bulk Delete
  server.post('/api/v1/hotlist/bulk-delete', { preValidation: [authenticate, requireRole(EDIT_ROLES.material)] }, async (request, reply) => {
    const { ids } = request.body as { ids: string[] };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Valid ids array is required' });
    }

    try {
      const affected = await prisma.hotlist.findMany({
        where: { id: { in: ids } },
        select: { periodId: true },
      });
      const result = await prisma.hotlist.deleteMany({
        where: {
          id: {
            in: ids,
          },
        },
      });

      for (const pid of [...new Set(affected.map((r) => r.periodId))]) await touchPeriod(pid, request.user!.id);

      return reply.send({ message: `Successfully deleted ${result.count} records.`, count: result.count });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to delete records' });
    }
  });
}
