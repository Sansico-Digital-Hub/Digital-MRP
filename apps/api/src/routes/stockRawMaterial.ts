import { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma';
import { config } from '../config';
import { authenticate } from '../middleware/auth';
import { resolveUploadPeriod, recordPeriodChange, touchPeriod } from '../lib/periodScope';
import { normalizeHeaderName, matchesMtl } from '../lib/excelRef';
import { canonicalSupplier, supplierOk } from '../lib/supplierAlias';
import { matchSize, parseDims, parseGsm } from '../lib/materialSizeMatch';
import { sizeRatio, wasteOfUsage } from '../lib/materialSizeRecommendation';
import { buildStockUsage } from '../lib/stockUsage';
import * as xlsx from 'xlsx';

export default async function stockRawMaterialRoutes(server: FastifyInstance) {
  // Get all stock raw materials. Bisa difilter per periode: ?periodId=...
  server.get('/api/v1/stock-raw-material', { preValidation: [authenticate] }, async (request, reply) => {
    const { periodId } = request.query as { periodId?: string };
    const data = await prisma.stockRawMaterial.findMany({
      where: periodId ? { periodId } : undefined,
      orderBy: { date: 'desc' },
    });
    return reply.send({ data });
  });

  /**
   * Ringkasan stok: total per itemDesc + supplier, beserta JUMLAH LOT.
   *
   * Tabel stok menyimpan satu baris per lot, sehingga tampilan lama membuat
   * user mengira jumlahnya sedikit. Endpoint ini memperlihatkan total sebenarnya
   * sekaligus berapa lot yang menyusunnya (rancangan §8.6).
   */
  server.get('/api/v1/stock-raw-material/summary', { preValidation: [authenticate] }, async (request, reply) => {
    // Ringkasan WAJIB per periode — tanpa ini stok beberapa bulan akan tercampur.
    const { periodId } = request.query as { periodId?: string };
    if (!periodId) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Parameter periodId wajib diisi. Pilih periode dulu.',
      });
    }

    const stocks = await prisma.stockRawMaterial.findMany({
      where: { periodId },
      select: { itemDesc: true, supplier: true, qty: true, unit: true, date: true },
    });

    const map = new Map<
      string,
      {
        itemDesc: string;
        supplier: string;
        kg: number;
        sheet: number;
        rim: number;
        lots: number;
        firstDate: Date | null;
        lastDate: Date | null;
        unknownUnits: Set<string>;
      }
    >();

    const SHEET_UNIT_LIST = ['sheet', 'sheets', 'sht', 'lbr', 'lembar'];
    const RIM_UNIT_LIST = ['rim', 'ream'];

    for (const s of stocks) {
      // Supplier dinormalisasi (lihat `supplierAlias.ts`): "MEGA SURYA ERATAMA"
      // dan "MEGA" dianggap satu supplier, jadi lotnya ikut digabung.
      const supplier = canonicalSupplier(s.supplier);
      const key = `${s.itemDesc}||${supplier}`;
      const agg =
        map.get(key) ||
        {
          itemDesc: s.itemDesc,
          supplier,
          kg: 0,
          sheet: 0,
          rim: 0,
          lots: 0,
          firstDate: null as Date | null,
          lastDate: null as Date | null,
          unknownUnits: new Set<string>(),
        };

      const rawUnit = String(s.unit || '').trim();
      const unit = rawUnit.toLowerCase();
      if (SHEET_UNIT_LIST.includes(unit)) {
        agg.sheet += s.qty;
      } else if (RIM_UNIT_LIST.includes(unit)) {
        agg.rim += s.qty;
        agg.sheet += s.qty * config.materialCalc.sheetsPerRim;
      } else if (unit === 'kg') {
        agg.kg += s.qty;
      } else {
        // Satuan kosong / tidak dikenal. Sementara diperlakukan sebagai kg
        // (meniru perilaku lama), TAPI dilaporkan lewat `unknownUnits` supaya
        // user sadar ada baris yang satuannya perlu dibetulkan.
        agg.kg += s.qty;
        agg.unknownUnits.add(rawUnit === '' ? '(kosong)' : rawUnit);
      }

      agg.lots += 1;
      const d = new Date(s.date);
      if (!agg.firstDate || d < agg.firstDate) agg.firstDate = d;
      if (!agg.lastDate || d > agg.lastDate) agg.lastDate = d;
      map.set(key, agg);
    }

    const data = [...map.values()]
      .map((a) => ({
        itemDesc: a.itemDesc,
        supplier: a.supplier,
        lots: a.lots,
        totalKg: a.kg,
        totalSheet: a.sheet,
        totalRim: a.rim,
        primaryUnit: a.kg > 0 ? ('kg' as const) : ('sheet' as const),
        firstDate: a.firstDate,
        lastDate: a.lastDate,
        /** Satuan yang tidak dikenali pada grup ini; angkanya sementara dihitung sebagai kg. */
        unknownUnits: [...a.unknownUnits],
        hasUnknownUnit: a.unknownUnits.size > 0,
      }))
      .sort((x, y) => y.totalKg + y.totalSheet - (x.totalKg + x.totalSheet));

    return reply.send({ data, sheetsPerRim: config.materialCalc.sheetsPerRim });
  });

  /**
   * Monitoring PEMAKAIAN stok per ukuran: berapa yang sudah dipakai hasil
   * perhitungan dan berapa yang belum.
   *
   * Tidak ada tabel baru — "terpakai" diambil dari snapshot hasil perhitungan
   * aktif (`CycleResult.isCurrent`), "stok" dari Master Data periode ini.
   * Karena itu angkanya WAJIB dibaca bersama `result.isStale`: kalau stok diedit
   * setelah perhitungan, pemakaian bisa melebihi stok (`overAllocated`).
   */
  server.get('/api/v1/stock-raw-material/usage', { preValidation: [authenticate] }, async (request, reply) => {
    const { periodId } = request.query as { periodId?: string };
    if (!periodId) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Parameter periodId wajib diisi. Pilih periode dulu.',
      });
    }

    const [rows, result] = await Promise.all([
      prisma.stockRawMaterial.findMany({
        where: { periodId },
        select: { itemDesc: true, supplier: true, qty: true, unit: true },
      }),
      prisma.cycleResult.findFirst({
        where: { cycleId: periodId, isCurrent: true },
        select: {
          id: true,
          runNumber: true,
          calculatedAt: true,
          dataVersionAt: true,
          resultSnapshot: true,
          cycle: { select: { lastDataChangeAt: true } },
        },
      }),
    ]);

    const usage = buildStockUsage({
      rows,
      resultSnapshot: result?.resultSnapshot ?? null,
      sheetsPerRim: config.materialCalc.sheetsPerRim,
    });

    return reply.send({
      data: {
        periodId,
        sheetsPerRim: config.materialCalc.sheetsPerRim,
        result: result
          ? {
              id: result.id,
              runNumber: result.runNumber,
              calculatedAt: result.calculatedAt,
              dataVersionAt: result.dataVersionAt,
              // Stok/hotlist/NPOF berubah setelah perhitungan -> angka pemakaian
              // sudah tidak mencerminkan data terbaru.
              isStale: result.cycle.lastDataChangeAt.getTime() > result.dataVersionAt.getTime(),
            }
          : null,
        ...usage,
      },
    });
  });

  /** Detail per lot untuk satu itemDesc + supplier. */
  server.get('/api/v1/stock-raw-material/lots', { preValidation: [authenticate] }, async (request, reply) => {
    const { itemDesc, supplier, periodId } = request.query as {
      itemDesc?: string;
      supplier?: string;
      periodId?: string;
    };
    if (!itemDesc) {
      return reply.code(400).send({ error: 'Bad Request', message: 'itemDesc wajib diisi' });
    }
    if (!periodId) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Parameter periodId wajib diisi. Pilih periode dulu.',
      });
    }

    // `supplier` kosong harus cocok dengan baris NULL **maupun** string kosong,
    // karena data nyata memakai keduanya. Kalau parameter tidak dikirim sama
    // sekali, tampilkan semua lot untuk item tersebut.
    //
    // PENTING: supplier di sini datang dari endpoint `/summary` yang sudah
    // memakai NAMA KANONIK, sedangkan kolom di DB masih nama asli. Jadi lot
    // diambil per itemDesc lalu disaring di JS dengan pembanding kanonik.
    const data = (
      await prisma.stockRawMaterial.findMany({
        where: { periodId, itemDesc },
        orderBy: { date: 'desc' },
      })
    ).filter((row) => supplier === undefined || canonicalSupplier(row.supplier) === supplier);

    return reply.send({
      data,
      lots: data.length,
      total: data.reduce((sum, r) => sum + r.qty, 0),
    });
  });

  /**
   * Rekomendasi alokasi untuk SATU item stok: part number mana saja yang bisa
   * memakai material ini, beserta estimasi waste dari pemakaian tersebut.
   *
   * Sumber daftar part = snapshot hasil perhitungan periode ini (tidak
   * menghitung ulang, jadi angkanya konsisten dengan halaman Material
   * Calculation). Read-only: tidak mengubah stok maupun hasil perhitungan.
   */
  server.get(
    '/api/v1/stock-raw-material/allocation-recommendation',
    { preValidation: [authenticate] },
    async (request, reply) => {
      const { periodId, itemDesc, supplier } = request.query as {
        periodId?: string;
        itemDesc?: string;
        supplier?: string;
      };
      if (!periodId || !itemDesc) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Parameter periodId dan itemDesc wajib diisi.',
        });
      }

      // ── 1. Stok lot ini (semua baris dengan itemDesc + supplier sama) ──
      const rows = (
        await prisma.stockRawMaterial.findMany({
          where: { periodId, itemDesc },
          orderBy: { date: 'desc' },
        })
      ).filter((row) => supplier === undefined || canonicalSupplier(row.supplier) === supplier);

      const SHEET_UNITS = ['sheet', 'sheets', 'sht', 'lbr', 'lembar'];
      const RIM_UNITS = ['rim', 'ream'];
      let totalKg = 0;
      let totalSheet = 0;
      for (const row of rows) {
        const unit = String(row.unit || '').trim().toLowerCase();
        if (SHEET_UNITS.includes(unit)) totalSheet += row.qty;
        else if (RIM_UNITS.includes(unit)) totalSheet += row.qty * config.materialCalc.sheetsPerRim;
        else if (unit === 't' || unit === 'ton') totalKg += row.qty * 1000;
        else totalKg += row.qty;
      }

      const dims = parseDims(itemDesc);
      const lotWidth = dims[0] ?? null;
      const lotLength = dims[1] ?? null;
      const lotGsm = parseGsm(itemDesc);
      const lotSupplier = supplier ?? canonicalSupplier(rows[0]?.supplier);

      const base = {
        itemDesc,
        supplier: lotSupplier,
        lots: rows.length,
        totalKg,
        totalSheet,
        lotWidth,
        lotLength,
        lotGsm,
        hasResult: false,
        calculatedAt: null as string | null,
        candidates: [] as Array<Record<string, unknown>>,
      };

      if (rows.length === 0) return reply.send({ data: base });
      if (lotGsm === null || lotWidth === null) {
        return reply.send({ data: { ...base, reason: 'no-dimension' as const } });
      }

      // ── 2. Snapshot hasil perhitungan periode ini ───────────────────────
      const result = await prisma.cycleResult.findFirst({
        where: { cycleId: periodId, isCurrent: true },
        select: { resultSnapshot: true, calculatedAt: true },
      });
      if (!result) return reply.send({ data: base });

      const groups = ((result.resultSnapshot as Record<string, unknown>)?.groups ?? []) as Array<
        Record<string, any>
      >;

      // ── 3. Cocokkan material ini ke setiap ukuran/part di hasil ────────
      const candidates: Array<Record<string, unknown>> = [];
      for (const group of groups) {
        const ukuran = String(group.ukuran ?? '');
        const gramatur = String(group.gramatur ?? '');
        const groupSupplier = String(group.supplier ?? '');
        const needGsm = parseGsm(gramatur);
        const groupDims = parseDims(ukuran);
        const needWidth = groupDims[0] ?? null;
        const needLength = groupDims[1] ?? null;
        if (needGsm === null || needWidth === null) continue;
        if (!supplierOk(lotSupplier, groupSupplier, config.materialCalc.requireSupplierMatch)) continue;

        const match = matchSize(
          itemDesc,
          needGsm,
          needWidth,
          config.materialCalc.sizeToleranceCm,
          needLength,
        );
        if (match === null) continue;

        const ratio = sizeRatio(lotWidth, lotLength, needWidth, needLength);
        const wastePct = Math.max(0, 1 - match.multiplier / ratio);
        const trimWidthCm = Math.max(0, lotWidth - match.multiplier * needWidth);

        // Bagian lot ini yang SUDAH terpakai grup tersebut (dari snapshot).
        const alreadyByGroup = new Map<string, number>();
        for (const d of ((group.weeklyMatrix?.summary?.stockDetails ?? []) as Array<Record<string, any>>)) {
          const key = String(d.poolRef ?? `${d.desc}||${canonicalSupplier(d.supplier)}`);
          alreadyByGroup.set(key, Number(d.allocatedKg) || 0);
        }
        const alreadyAllocatedKg = alreadyByGroup.get(`${itemDesc}||${lotSupplier}`) ?? 0;

        for (const detail of (group.details ?? []) as Array<Record<string, any>>) {
          const fm = Number(detail.fm) || 0;
          if (fm <= 0) continue;
          const needSheet = Math.max(0, Number(detail.sheetsNet2) || 0);
          const needKg = needSheet * fm;
          // Kapasitas lot ini dinyatakan dalam kg produk untuk part tersebut:
          // 1 lembar lot menyediakan `ratio / multiplier` lembar kebutuhan.
          const lotCapacityKg = totalKg + totalSheet * ((fm * ratio) / match.multiplier);
          const allocatableKg = Math.max(0, Math.min(lotCapacityKg, needKg));
          const waste = wasteOfUsage(allocatableKg, ratio, match.multiplier);

          candidates.push({
            partNumber: detail.partNumber,
            productName: detail.productName,
            ukuran,
            gramatur,
            groupSupplier,
            materialType: detail.materialType ?? null,
            demandPcs: Number(detail.demandPcs) || 0,
            needSheet,
            needKg,
            shortageSheet: detail.shortageSheet ?? null,
            isSufficient: Boolean(detail.isSufficient),
            multiplier: match.multiplier,
            trimWidthCm,
            trimLengthCm:
              lotLength !== null && needLength !== null ? Math.max(0, lotLength - needLength) : 0,
            wastePct,
            lotCapacityKg,
            allocatableKg,
            wasteKg: waste.wasteKg,
            alreadyAllocatedKg,
          });
        }
      }

      candidates.sort(
        (a, b) =>
          Number(a.wastePct) - Number(b.wastePct) ||
          Number(b.allocatableKg) - Number(a.allocatableKg) ||
          String(a.partNumber).localeCompare(String(b.partNumber)),
      );

      return reply.send({
        data: {
          ...base,
          hasResult: true,
          calculatedAt: result.calculatedAt.toISOString(),
          candidates,
        },
      });
    },
  );

  // Upload Excel
  server.post('/api/v1/stock-raw-material/upload', { preValidation: [authenticate] }, async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No file uploaded' });
      }

      const buffer = await data.toBuffer();
      const workbook = xlsx.read(buffer, { type: 'buffer' });

      /**
       * Pencocokan header TIDAK peduli huruf besar/kecil, spasi di awal/akhir,
       * serta pemisah spasi/underscore/hyphen (`lib/excelRef.ts`).
       * Contoh: "Ref_B_PO" == "ref_b_po" == " Ref_B_PO " == "Ref B PO".
       *
       * PENTING: nama sheet TIDAK di-hardcode lagi. Nama sheet hasil ekspor ERP
       * bisa berbeda antar file, jadi sheet dipilih dengan mencari baris HEADER
       * DATA STOK di seluruh sheet.
       */
      type StockCols = {
        namaItem: number;
        trxDate: number;
        digit1Lot: number;
        total: number;
        unit: number;
        refB: number;
      };

      const STOCK_HEADER_FIELDS: Record<string, keyof StockCols> = {
        NAMAITEM: 'namaItem',
        ITEMNAME: 'namaItem',
        ITEMDESC: 'namaItem',
        TRXDATE: 'trxDate',
        TANGGAL: 'trxDate',
        DIGIT1LOT: 'digit1Lot',
        DIGITLOT: 'digit1Lot',
        TOTAL: 'total',
        QTY: 'total',
        UNIT: 'unit',
        SATUAN: 'unit',
        // Referensi customer. Nama aslinya "Ref_B_PO", varian lain tetap diterima.
        REFBPO: 'refB',
        REFB: 'refB',
      };

      /** Baris header dengan kolom dikenali terbanyak di SATU sheet. */
      const scanSheet = (sheetRows: unknown[][]) => {
        let best: { rowIdx: number; cols: StockCols; headers: string[] } | null = null;
        let bestScore = 0;
        for (let i = 0; i < Math.min(25, sheetRows.length); i++) {
          const row = sheetRows[i];
          if (!row) continue;

          const cols: StockCols = { namaItem: -1, trxDate: -1, digit1Lot: -1, total: -1, unit: -1, refB: -1 };
          for (let j = 0; j < row.length; j++) {
            const field = STOCK_HEADER_FIELDS[normalizeHeaderName(row[j])];
            if (field && cols[field] === -1) cols[field] = j;
          }

          const score = Object.values(cols).filter((v) => v !== -1).length;
          if (score > bestScore) {
            bestScore = score;
            best = {
              rowIdx: i,
              cols,
              headers: row.map((c) => String(c ?? '').trim()).filter(Boolean),
            };
          }
        }
        return best;
      };

      const coreCount = (c: StockCols) =>
        [c.namaItem, c.trxDate, c.digit1Lot, c.total, c.unit].filter((v) => v !== -1).length;

      let sheetName = '';
      let rows: unknown[][] = [];
      let headerRowIdx = -1;
      let scan: { rowIdx: number; cols: StockCols; headers: string[] } | null = null;
      const sheetReport: string[] = [];
      let closest: { sheetName: string; headers: string[]; core: number } | null = null;

      for (const name of workbook.SheetNames) {
        const candidateSheet = workbook.Sheets[name];
        const candidateRows = xlsx.utils.sheet_to_json(candidateSheet, { header: 1 }) as unknown[][];
        const found = scanSheet(candidateRows);
        const core = found ? coreCount(found.cols) : 0;
        sheetReport.push(`${name} (${core}/5 kolom inti)`);
        if (found && (!closest || core > closest.core)) {
          closest = { sheetName: name, headers: found.headers, core };
        }
        if (found && core === 5) {
          sheetName = name;
          rows = candidateRows;
          headerRowIdx = found.rowIdx;
          scan = found;
          break;
        }
      }

      if (!scan) {
        return reply.code(400).send({
          error: 'Bad Request',
          message:
            'Tidak menemukan sheet data stok di file ini. Kolom yang wajib ada: ' +
            '"Nama Item", "Trx Date", "Digit1_Lot", "Unit", "Total", dan "Ref_B_PO". ' +
            `Sheet yang diperiksa: ${sheetReport.join('; ')}.` +
            (closest
              ? ` Header terdekat ada di sheet "${closest.sheetName}": ${closest.headers.slice(0, 15).join(', ')}.`
              : ''),
        });
      }

      const {
        namaItem: namaItemIdx,
        trxDate: trxDateIdx,
        digit1Lot: digit1LotIdx,
        total: totalIdx,
        unit: unitIdx,
        refB: refBPOIdx,
      } = scan.cols;

      // Kolom referensi customer WAJIB ada. Tanpa kolom ini filter "MTL" tidak
      // bisa dijalankan, jadi proses DIHENTIKAN — jangan impor data tanpa filter.
      if (refBPOIdx === -1) {
        const headerText = (rows[headerRowIdx] || [])
          .map((c) => String(c ?? '').trim())
          .filter(Boolean)
          .slice(0, 15)
          .join(', ');
        return reply.code(400).send({
          error: 'Bad Request',
          message:
            `Kolom "Ref_B_PO" tidak ditemukan di sheet "${sheetName}". ` +
            'Kolom ini dipakai untuk memfilter data (hanya baris yang mengandung "MTL" yang diimpor), ' +
            'sehingga proses dihentikan. Tambahkan kolom "Ref_B_PO" lalu ulangi upload. ' +
            `Header yang terbaca: ${headerText}.`,
        });
      }

      const recordsToInsert = [];
      
      const parseExcelDate = (excelDate: any) => {
        if (!excelDate) return new Date();
        if (typeof excelDate === 'number') {
          return new Date(Math.round((excelDate - 25569) * 86400 * 1000));
        }
        const parsed = new Date(excelDate);
        return isNaN(parsed.getTime()) ? new Date() : parsed;
      };

      const getSupplierName = (code: string) => {
        const map: Record<string, string> = {
          'P': 'HANCHANG',
          'M': 'MEGA SURYA ERATAMA',
          'X': 'XSD',
          'F': 'FAJAR',
          'H': 'HANSOL',
          'TX': 'HANCHANG ORDERED FROM XSD',
          'SF': 'FAJAR OREDERED FROM SONA',
          'CH': 'HANSOL ORDERED FROM CATUR',
          'CX': 'XSD ORDERED FROM CINJOE',
          'SM': 'MEGA ORDERED FROM SONA'
        };
        return map[code.toUpperCase()] || code;
      };

      let currentItemDesc = '';
      let currentDate = new Date();
      /** Baris yang dilewati karena kolom "Ref_B_PO" tidak mengandung "MTL". */
      let skippedNoMtl = 0;
      /** Baris kosong / baris TOTAL / baris tanpa nilai angka. */
      let skippedNonData = 0;

      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) {
          skippedNonData++;
          continue;
        }

        const rawItem = row[namaItemIdx];
        if (rawItem !== undefined && rawItem !== null && String(rawItem).trim() !== '') {
          currentItemDesc = String(rawItem).trim();
        }

        if (!currentItemDesc || currentItemDesc.toUpperCase().includes('TOTAL')) {
          skippedNonData++;
          continue;
        }

        const rawDate = row[trxDateIdx];
        if (rawDate !== undefined && rawDate !== null && String(rawDate).trim() !== '') {
          currentDate = parseExcelDate(rawDate);
        }

        const digit1Lot = String(row[digit1LotIdx] || '').trim();
        const totalRaw = String(row[totalIdx] || '').replace(/,/g, '').trim();
        const unit = String(row[unitIdx] || '').trim();

        if (totalRaw === '' || isNaN(parseFloat(totalRaw))) {
          skippedNonData++;
          continue;
        }

        // Nilai referensi dibaca PER BARIS dari kolom "Ref_B_PO" (tanpa
        // fill-down) supaya baris tanpa referensi tidak ikut terbawa nilai
        // baris di atasnya. Nilai kosong/NaN dianggap tidak mengandung MTL.
        const refB = String(row[refBPOIdx] ?? '').trim();
        if (!matchesMtl(refB)) {
          skippedNoMtl++;
          continue;
        }

        const qty = parseFloat(totalRaw);
        const supplier = getSupplierName(digit1Lot);

        recordsToInsert.push({
          itemDesc: currentItemDesc,
          date: currentDate,
          supplier,
          qty,
          unit,
          refB,
        });
      }

      // "Total baris di file" = semua baris data kandidat (punya nilai angka).
      const totalRows = recordsToInsert.length + skippedNoMtl;
      const summary = {
        totalRows,
        included: recordsToInsert.length,
        skippedNoMtl,
        failed: 0,
        skippedNonData,
        total: totalRows + skippedNonData,
        valid: recordsToInsert.length,
      };

      if (recordsToInsert.length === 0) {
        return reply.code(400).send({
          error: 'Bad Request',
          message:
            skippedNoMtl > 0
              ? `Tidak ada baris yang mengandung "MTL" pada kolom "Ref_B_PO". ` +
                `${totalRows} baris data dibaca, semuanya dilewati.`
              : 'No valid data found in Excel.',
          summary,
        });
      }

      return reply.code(200).send({ 
        message: `File dibaca: ${recordsToInsert.length} baris mengandung "MTL" siap diimpor, ${skippedNoMtl} baris dilewati (tidak mengandung "MTL").`,
        data: recordsToInsert,
        summary,
      });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to process file' });
    }
  });

  // Import (Save) dengan mode Add atau Overwrite — WAJIB menyertakan periode.
  server.post('/api/v1/stock-raw-material/import', { preValidation: [authenticate] }, async (request, reply) => {
    const body = (request.body || {}) as {
      data?: { itemDesc: string; supplier: string; qty: number; unit: string; date: string | Date; refB?: string | null }[];
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

    // ── FILTER "MTL" (penjaga kedua) ──────────────────────────────────────
    // Parser Excel sudah menyaring baris tanpa "MTL", tapi endpoint import juga
    // memeriksanya supaya tidak ada jalur yang bisa menyimpan data non-MTL.
    const mtlRows = data.filter((record) => matchesMtl((record as { refB?: unknown })?.refB));
    const skippedNoMtl = data.length - mtlRows.length;
    if (mtlRows.length === 0) {
      return reply.code(400).send({
        error: 'Bad Request',
        message:
          'Tidak ada baris yang mengandung "MTL" pada kolom "Ref_B_PO". ' +
          'Semua data ditolak dan tidak ada yang disimpan.',
        summary: { totalRows: data.length, included: 0, skippedNoMtl, failed: 0 },
      });
    }

    try {
      const previousCount = await prisma.stockRawMaterial.count({ where: { periodId } });

      const recordsToInsert = mtlRows.map((record) => ({
        periodId,
        itemDesc: record.itemDesc,
        supplier: record.supplier || null,
        qty: Number(record.qty) || 0,
        unit: record.unit,
        date: new Date(record.date),
        refB: record.refB ?? null,
      }));

      await prisma.$transaction(
        async (tx) => {
          if (mode === 'overwrite') {
            // HANYA periode ini yang dikosongkan.
            await tx.stockRawMaterial.deleteMany({ where: { periodId } });
          }
          for (let i = 0; i < recordsToInsert.length; i += 1000) {
            await tx.stockRawMaterial.createMany({ data: recordsToInsert.slice(i, i + 1000) });
          }
        },
        { timeout: 180000, maxWait: 30000 },
      );

      await recordPeriodChange({
        periodId,
        userId: request.user!.id,
        sourceType: 'STOCK_RM',
        rowCount: recordsToInsert.length,
        replaced: previousCount,
        fileName: body.fileName ?? null,
        mode,
      });

      return reply.code(201).send({
        message:
          (mode === 'overwrite'
            ? `Periode "${resolved.label}" ditimpa dengan ${recordsToInsert.length} baris stok.`
            : `Ditambahkan ${recordsToInsert.length} baris stok ke periode "${resolved.label}".`) +
          (skippedNoMtl > 0
            ? ` ${skippedNoMtl} baris dilewati karena kolom "Ref_B_PO" tidak mengandung "MTL".`
            : ''),
        count: recordsToInsert.length,
        skippedNoMtl,
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
  server.post('/api/v1/stock-raw-material', { preValidation: [authenticate] }, async (request, reply) => {
    const body = (request.body || {}) as any;
    const { itemDesc, supplier, unit, qty, date, refB } = body;

    if (!itemDesc || !unit || qty === undefined || !date) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Required fields are missing' });
    }
    // Ref-B WAJIB dan harus mengandung "MTL" — aturan yang SAMA dengan import.
    if (!matchesMtl(refB)) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Kolom "Ref_B_PO" wajib diisi dan harus mengandung "MTL".',
      });
    }

    const resolved = await resolveUploadPeriod(body, request.user!.id);
    if (!resolved.ok) {
      return reply.code(resolved.code).send({ error: 'Bad Request', message: resolved.message });
    }

    const result = await prisma.stockRawMaterial.create({
      data: {
        periodId: resolved.periodId,
        itemDesc,
        supplier: supplier || null,
        unit,
        qty: parseFloat(qty),
        date: new Date(date),
        refB: String(refB).trim(),
      },
    });

    await touchPeriod(resolved.periodId, request.user!.id);
    return reply.code(201).send({ data: result });
  });

  // Update
  server.put('/api/v1/stock-raw-material/:id', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { itemDesc, supplier, unit, qty, date, refB } = request.body as any;

    const existing = await prisma.stockRawMaterial.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Record not found' });
    }

    // Kolom "Ref_B_PO" juga divalidasi saat EDIT: nilai akhir (baru atau yang
    // sudah tersimpan) WAJIB mengandung "MTL". Baris lama yang refB-nya masih
    // kosong jadi harus dilengkapi saat diedit.
    const effectiveRefB = refB !== undefined ? refB : existing.refB;
    if (!matchesMtl(effectiveRefB)) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Kolom "Ref_B_PO" wajib diisi dan harus mengandung "MTL".',
      });
    }

    const updated = await prisma.stockRawMaterial.update({
      where: { id },
      data: {
        ...(itemDesc && { itemDesc }),
        ...(supplier !== undefined && { supplier }),
        ...(unit && { unit }),
        ...(qty !== undefined && { qty: parseFloat(qty) }),
        ...(date && { date: new Date(date) }),
        refB: String(effectiveRefB).trim(),
      },
    });

    await touchPeriod(existing.periodId, request.user!.id);
    return reply.send({ data: updated });
  });

  // Delete
  server.delete('/api/v1/stock-raw-material/:id', { preValidation: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await prisma.stockRawMaterial.findUnique({ where: { id } });
    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Record not found' });
    }

    await prisma.stockRawMaterial.delete({ where: { id } });

    await touchPeriod(existing.periodId, request.user!.id);
    return reply.send({ message: 'Record deleted successfully' });
  });

  // Bulk Delete
  server.post('/api/v1/stock-raw-material/bulk-delete', { preValidation: [authenticate] }, async (request, reply) => {
    const { ids } = request.body as { ids: string[] };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Valid ids array is required' });
    }

    try {
      const affected = await prisma.stockRawMaterial.findMany({
        where: { id: { in: ids } },
        select: { periodId: true },
      });
      const result = await prisma.stockRawMaterial.deleteMany({
        where: { id: { in: ids } },
      });

      for (const pid of [...new Set(affected.map((r) => r.periodId))]) await touchPeriod(pid, request.user!.id);

      return reply.send({ message: `Successfully deleted ${result.count} records.`, count: result.count });
    } catch (error) {
      server.log.error(error);
      return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to delete records' });
    }
  });
}
