content = '''import { FastifyInstance } from \\'fastify\\';
import prisma from \\'../lib/prisma\\';
import { authenticate } from \\'../middleware/auth\\';
import * as xlsx from \\'xlsx\\';

export default async function stockRawMaterialRoutes(server: FastifyInstance) {
  // Get all stock raw materials
  server.get(\\'/api/v1/stock-raw-material\\', { preValidation: [authenticate] }, async (request, reply) => {
    const data = await prisma.stockRawMaterial.findMany({
      orderBy: { date: \\'desc\\' },
    });
    return reply.send({ data });
  });

  // Upload Excel
  server.post(\\'/api/v1/stock-raw-material/upload\\', { preValidation: [authenticate] }, async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: \\'Bad Request\\', message: \\'No file uploaded\\' });
      }

      const buffer = await data.toBuffer();
      const workbook = xlsx.read(buffer, { type: \\'buffer\\' });
      
      const sheetName = \\'StockOnhandByLot\\';
      if (!workbook.Sheets[sheetName]) {
        return reply.code(400).send({ error: \\'Bad Request\\', message: \\'Sheet "StockOnhandByLot" not found in the Excel file\\' });
      }
      const sheet = workbook.Sheets[sheetName];
      
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
      
      let namaItemIdx = -1;
      let trxDateIdx = -1;
      let digit1LotIdx = -1;
      let totalIdx = -1;
      let unitIdx = -1;
      let headerRowIdx = -1;

      // Find the headers
      for (let i = 0; i < Math.min(20, rows.length); i++) {
        const row = rows[i];
        if (!row) continue;
        
        for (let j = 0; j < row.length; j++) {
          const cell = String(row[j] || \\'\\').trim();
          
          if (cell === \\'Nama Item\\') namaItemIdx = j;
          else if (cell === \\'Trx Date\\') trxDateIdx = j;
          else if (cell === \\'Digit1_Lot\\') digit1LotIdx = j;
          else if (cell === \\'Total\\') totalIdx = j;
          else if (cell === \\'Unit\\') unitIdx = j;
        }
        
        if (namaItemIdx !== -1 && trxDateIdx !== -1 && digit1LotIdx !== -1 && totalIdx !== -1 && unitIdx !== -1) {
          headerRowIdx = i;
          break; // Found all headers
        }
      }

      if (headerRowIdx === -1) {
        return reply.code(400).send({ error: \\'Bad Request\\', message: \\'Could not find required columns in the file.\\' });
      }

      const recordsToInsert = [];
      
      const parseExcelDate = (excelDate: any) => {
        if (!excelDate) return new Date();
        if (typeof excelDate === \\'number\\') {
          return new Date(Math.round((excelDate - 25569) * 86400 * 1000));
        }
        const parsed = new Date(excelDate);
        return isNaN(parsed.getTime()) ? new Date() : parsed;
      };

      const getSupplierName = (code: string) => {
        const map: Record<string, string> = {
          \\'P\\': \\'HANCHANG\\',
          \\'M\\': \\'MEGA SURYA ERATAMA\\',
          \\'X\\': \\'XSD\\',
          \\'F\\': \\'FAJAR\\',
          \\'H\\': \\'HANSOL\\',
          \\'TX\\': \\'HANCHANG ORDERED FROM XSD\\',
          \\'SF\\': \\'FAJAR OREDERED FROM SONA\\', // typo kept as requested if needed, or FAJAR ORDERED FROM SONA
          \\'CH\\': \\'HANSOL ORDERED FROM CATUR\\',
          \\'CX\\': \\'XSD ORDERED FROM CINJOE\\',
          \\'SM\\': \\'MEGA ORDERED FROM SONA\\'
        };
        // The user wrote 'SF = FAJAR OREDERED FROM SONA'
        return map[code.toUpperCase()] || code;
      };

      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const itemDesc = String(row[namaItemIdx] || \\'\\').trim();
        if (!itemDesc || itemDesc.toUpperCase().includes(\\'TOTAL\\')) continue;
        
        const dateRaw = row[trxDateIdx];
        const date = parseExcelDate(dateRaw);
        
        const digit1Lot = String(row[digit1LotIdx] || \\'\\').trim();
        const supplier = getSupplierName(digit1Lot);
        
        const totalRaw = String(row[totalIdx] || \\'\\').replace(/,/g, \\'\\').trim();
        const qty = parseFloat(totalRaw) || 0;
        
        const unit = String(row[unitIdx] || \\'\\').trim();

        recordsToInsert.push({
          itemDesc,
          date,
          supplier,
          qty,
          unit,
        });
      }

      if (recordsToInsert.length === 0) {
        return reply.code(400).send({ error: \\'Bad Request\\', message: \\'No valid data found in Excel.\\' });
      }

      return reply.code(200).send({ 
        message: \\'File parsed successfully\\',
        data: recordsToInsert
      });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: \\'Internal Server Error\\', message: \\'Failed to process file\\' });
    }
  });

  // Import (Save) with Add or Overwrite mode
  server.post(\\'/api/v1/stock-raw-material/import\\', { preValidation: [authenticate] }, async (request, reply) => {
    const { data, mode } = request.body as { 
      data: { itemDesc: string; supplier: string; qty: number; unit: string; date: string | Date }[];
      mode: \\'add\\' | \\'overwrite\\';
    };

    if (!data || !Array.isArray(data) || data.length === 0) {
      return reply.code(400).send({ error: \\'Bad Request\\', message: \\'Valid data array is required\\' });
    }

    try {
      if (mode === \\'overwrite\\') {
        await prisma.stockRawMaterial.deleteMany({});
        const recordsToInsert = data.map((record) => ({
          ...record,
          date: new Date(record.date),
        }));
        await prisma.stockRawMaterial.createMany({
          data: recordsToInsert,
        });
        return reply.code(201).send({
          message: \Successfully overwritten with \ records.\,
          count: recordsToInsert.length,
        });
      } else {
        const recordsToInsert = data.map((record) => ({
          ...record,
          date: new Date(record.date),
        }));
        await prisma.stockRawMaterial.createMany({
          data: recordsToInsert,
        });
        return reply.code(201).send({
          message: \Successfully added \ records.\,
          count: recordsToInsert.length,
        });
      }
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: \\'Internal Server Error\\', message: \\'Failed to import data\\' });
    }
  });

  // Add Manual
  server.post(\\'/api/v1/stock-raw-material\\', { preValidation: [authenticate] }, async (request, reply) => {
    const { itemDesc, supplier, unit, qty, date } = request.body as any;

    if (!itemDesc || !unit || qty === undefined || !date) {
      return reply.code(400).send({ error: \\'Bad Request\\', message: \\'Required fields are missing\\' });
    }

    const result = await prisma.stockRawMaterial.create({
      data: {
        itemDesc,
        supplier,
        unit,
        qty: parseFloat(qty),
        date: new Date(date),
      },
    });

    return reply.code(201).send({ data: result });
  });

  // Update
  server.put(\\'/api/v1/stock-raw-material/:id\\', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { itemDesc, supplier, unit, qty, date } = request.body as any;

    const existing = await prisma.stockRawMaterial.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: \\'Not Found\\', message: \\'Record not found\\' });
    }

    const updated = await prisma.stockRawMaterial.update({
      where: { id },
      data: {
        ...(itemDesc && { itemDesc }),
        ...(supplier !== undefined && { supplier }),
        ...(unit && { unit }),
        ...(qty !== undefined && { qty: parseFloat(qty) }),
        ...(date && { date: new Date(date) }),
      },
    });

    return reply.send({ data: updated });
  });

  // Delete
  server.delete(\\'/api/v1/stock-raw-material/:id\\', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.stockRawMaterial.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: \\'Not Found\\', message: \\'Record not found\\' });
    }

    await prisma.stockRawMaterial.delete({ where: { id } });

    return reply.send({ message: \\'Record deleted successfully\\' });
  });

  // Bulk Delete
  server.post(\\'/api/v1/stock-raw-material/bulk-delete\\', { preValidation: [authenticate] }, async (request, reply) => {
    const { ids } = request.body as { ids: string[] };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: \\'Bad Request\\', message: \\'Valid ids array is required\\' });
    }

    try {
      const result = await prisma.stockRawMaterial.deleteMany({
        where: { id: { in: ids } },
      });

      return reply.send({ message: \Successfully deleted \ records.\, count: result.count });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: \\'Internal Server Error\\', message: \\'Failed to delete records\\' });
    }
  });
}
'''
with open(r'apps\api\src\routes\stockRawMaterial.ts', 'w', encoding='utf-8') as f:
    f.write(content)
