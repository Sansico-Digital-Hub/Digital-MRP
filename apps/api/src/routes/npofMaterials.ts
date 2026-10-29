import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/auth';
import { EDIT_ROLES } from '../lib/permissions';
import { config } from '../config';

export default async function npofMaterialsRoutes(server: FastifyInstance) {
  // Get all NPOF Materials
  server.get('/api/v1/npof-materials', { preValidation: [authenticate] }, async (request, reply) => {
    const data = await prisma.npofMaterial.findMany({
      orderBy: [
        { npofId: 'asc' },
        { partNumber: 'asc' }
      ],
    });
    return reply.send({ data });
  });

  // Sync from External API
  server.post('/api/v1/npof-materials/sync', { preValidation: [authenticate, requireRole(EDIT_ROLES.material)] }, async (request, reply) => {
    try {
      let externalData: any[] = [];

      try {
        const response = await fetch(`${config.npofApi.url}/npof/process-a/materials`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': config.npofApi.key
          }
        });

        if (!response.ok) {
          const errBody = (await response.json().catch(() => ({}))) as any;
          const detailMsg = errBody?.detail || errBody?.message || response.statusText;
          return reply.code(response.status).send({ 
            error: 'External API Error', 
            message: `Failed to fetch data from NPOF API: ${detailMsg}` 
          });
        }

        const result = (await response.json()) as any;
        
        if (result.status !== 'success' || !Array.isArray(result.data)) {
          return reply.code(400).send({
            error: 'Invalid Data',
            message: 'Received invalid data format from NPOF API'
          });
        }
        
        externalData = result.data;
      } catch (fetchError: any) {
        server.log.error(`Failed to connect to NPOF API: ${fetchError.message}`);
        return reply.code(502).send({
          error: 'Bad Gateway',
          message: 'Failed to connect to NPOF API. Please ensure the external server is running.'
        });
      }

      let syncCount = 0;
      let skippedCount = 0;

      // Process each item
      for (const item of externalData) {
        const { npof_id, product_name, part_number, material, sheeted_size, formula_material, ups } = item;
        const rawGramatur = item.gramatur ?? item.gramature ?? item.gramasi ?? item.gsm ?? item.gramatur_material;
        const rawSupplier = item.supplier ?? item.vendor ?? item.supplier_name ?? item.vendor_name;

        const cleanNpofId = typeof npof_id === 'number' ? npof_id : parseInt(String(npof_id || 0), 10);
        const cleanPartNumber = (part_number != null && part_number !== 'null') ? String(part_number) : '-';
        const cleanProductName = (product_name != null && product_name !== 'null') ? String(product_name) : '-';
        const cleanMaterial = (material != null && material !== 'null') ? String(material) : '';
        const cleanGramatur = (rawGramatur != null && rawGramatur !== 'null') ? String(rawGramatur) : '';
        const cleanSupplier = (rawSupplier != null && rawSupplier !== 'null') ? String(rawSupplier) : '';
        const cleanSheetedSize = (sheeted_size != null && sheeted_size !== 'null') ? String(sheeted_size) : '';
        const cleanFormulaMaterial = (formula_material != null && formula_material !== 'null') ? String(formula_material) : '';
        const cleanUps = (ups != null && ups !== 'null') ? String(ups) : '';
        
        // Find existing record
        const existing = await prisma.npofMaterial.findUnique({
          where: {
            npofId_partNumber: {
              npofId: cleanNpofId,
              partNumber: cleanPartNumber
            }
          }
        });

        // If it exists and is edited locally, DO NOT overwrite (Option A)
        if (existing && existing.isEdited) {
          skippedCount++;
          continue;
        }

        // Upsert data
        await prisma.npofMaterial.upsert({
          where: {
            npofId_partNumber: {
              npofId: cleanNpofId,
              partNumber: cleanPartNumber
            }
          },
          update: {
            productName: cleanProductName,
            material: cleanMaterial,
            gramatur: cleanGramatur,
            supplier: cleanSupplier,
            sheetedSize: cleanSheetedSize,
            formulaMaterial: cleanFormulaMaterial,
            ups: cleanUps,
            lastSyncedAt: new Date()
          },
          create: {
            npofId: cleanNpofId,
            partNumber: cleanPartNumber,
            productName: cleanProductName,
            material: cleanMaterial,
            gramatur: cleanGramatur,
            supplier: cleanSupplier,
            sheetedSize: cleanSheetedSize,
            formulaMaterial: cleanFormulaMaterial,
            ups: cleanUps,
            lastSyncedAt: new Date()
          }
        });

        syncCount++;
      }

      return reply.code(200).send({
        message: 'Sync completed successfully',
        syncCount,
        skippedCount,
        totalProcessed: externalData.length
      });

    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ 
        error: 'Internal Server Error', 
        message: 'Failed to sync with NPOF API' 
      });
    }
  });

  // Edit (Update) Manual
  server.put('/api/v1/npof-materials/:id', { preValidation: [authenticate, requireRole(EDIT_ROLES.material)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { partNumber, productName, material, gramatur, supplier, sheetedSize, formulaMaterial, ups } = request.body as any;

    const existing = await prisma.npofMaterial.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Record not found' });
    }

    const updated = await prisma.npofMaterial.update({
      where: { id },
      data: {
        ...(partNumber && { partNumber }),
        ...(productName && { productName }),
        ...(material && { material }),
        ...(gramatur !== undefined && { gramatur }),
        ...(supplier !== undefined && { supplier }),
        ...(sheetedSize && { sheetedSize }),
        ...(formulaMaterial && { formulaMaterial }),
        ...(ups !== undefined && { ups: String(ups) }),
        isEdited: true // Mark as edited so it won't be overwritten by sync
      },
    });

    return reply.send({ data: updated });
  });

  // Delete
  server.delete('/api/v1/npof-materials/:id', { preValidation: [authenticate, requireRole(EDIT_ROLES.material)] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.npofMaterial.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Record not found' });
    }

    await prisma.npofMaterial.delete({ where: { id } });

    return reply.send({ message: 'Record deleted successfully' });
  });

  // Bulk Delete
  server.post('/api/v1/npof-materials/bulk-delete', { preValidation: [authenticate, requireRole(EDIT_ROLES.material)] }, async (request, reply) => {
    const { ids } = request.body as { ids: string[] };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Valid ids array is required' });
    }

    try {
      const result = await prisma.npofMaterial.deleteMany({
        where: { id: { in: ids } },
      });

      return reply.send({ message: `Successfully deleted ${result.count} records.`, count: result.count });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to delete records' });
    }
  });
}
