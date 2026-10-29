/**
 * Analisis cakupan NPOF untuk satu periode Material Planning.
 *
 * Pertanyaan yang dijawab: "Part number mana yang ada di MRP tetapi TIDAK ADA
 * di NPOF?" — sekaligus menandai part yang ADA di NPOF tapi datanya TIDAK
 * LENGKAP (gramatur / ukuran sheet / formula material / ups / jenis material /
 * supplier kosong), karena mesin kalkulasi memperlakukan keduanya sebagai
 * "estimasi" (lihat `noNpofData` di materialCalcEngine.ts).
 *
 * Fungsi ini MURNI: tidak menyentuh database, tidak memakai `new Date()`.
 */

import {
  NEBENG_PATTERN,
  getMaterialFamily,
  normalizeNpofText,
  parseMaterialNumber,
} from './materialCalcEngine';
import { canonicalSupplier } from './supplierAlias';

export type NpofCoverageStatus = 'MISSING' | 'INCOMPLETE' | 'COMPLETE';

/** Urutan field yang ditampilkan di UI saat data NPOF kurang. */
export const NPOF_REQUIRED_FIELDS = ['gramatur', 'ukuran', 'formula', 'ups', 'material', 'supplier'] as const;
export type NpofRequiredField = (typeof NPOF_REQUIRED_FIELDS)[number];

export interface NpofCoverageRow {
  partNumber: string;
  productName: string;
  status: 'MISSING' | 'INCOMPLETE';
  /**
   * true = mesin kalkulasi pasti memakai nilai default (formula material / ups
   * tidak ada), sehingga kebutuhan kg part ini hanya estimasi.
   */
  critical: boolean;
  /** Jumlah minggu MRP yang punya demand > 0 untuk part ini. */
  demandWeekCount: number;
  npofId: number | null;
  material: string | null;
  materialType: string | null;
  supplier: string | null;
  gramatur: string | null;
  ukuran: string | null;
  /** Field yang kosong pada baris NPOF (kode dari NPOF_REQUIRED_FIELDS). */
  missingFields: NpofRequiredField[];
  /** true = ukuran/formula NPOF menyebut "nebeng" (dicetak pada part lain). */
  isNebeng: boolean;
}

export interface NpofCoverageSummary {
  /** Jumlah part number unik yang muncul di MRP periode ini. */
  mrpPartCount: number;
  missingNpofCount: number;
  incompleteNpofCount: number;
  completeNpofCount: number;
  /** Part tanpa NPOF atau tanpa formula/ups — kg-nya hanya estimasi. */
  criticalCount: number;
}

export interface NpofCoverageResult {
  summary: NpofCoverageSummary;
  rows: NpofCoverageRow[];
}

export interface NpofCoverageInput {
  mrpWeeks: Array<{
    partNumber: string;
    description?: string | null;
    weekNumber: number;
    quantity: number;
  }>;
  npofs: Array<{
    npofId: number;
    partNumber: string;
    productName?: string | null;
    material?: string | null;
    gramatur?: string | null;
    supplier?: string | null;
    sheetedSize?: string | null;
    formulaMaterial?: string | null;
    ups?: string | null;
  }>;
}

/**
 * Bandingkan part MRP dengan data NPOF global.
 *
 * Catatan: NPOF sengaja TIDAK difilter per periode — NPOF adalah referensi
 * bersama semua periode (lihat materialPlanning.ts).
 */
export function analyzeNpofCoverage(input: NpofCoverageInput): NpofCoverageResult {
  // ── 1. Ringkas demand MRP per part (minggu mana saja yang ada demand) ──
  const demandByPart = new Map<string, { productName: string; weeks: Set<number> }>();
  for (const row of input.mrpWeeks) {
    const entry = demandByPart.get(row.partNumber) ?? {
      productName: String(row.description || '').trim() || row.partNumber,
      weeks: new Set<number>(),
    };
    if (!entry.productName || entry.productName === row.partNumber) {
      const name = String(row.description || '').trim();
      if (name) entry.productName = name;
    }
    if ((Number(row.quantity) || 0) > 0) entry.weeks.add(row.weekNumber);
    demandByPart.set(row.partNumber, entry);
  }

  // ── 2. NPOF per part (baris pertama menang, sama seperti engine) ───────
  const npofByPart = new Map<string, NpofCoverageInput['npofs'][number]>();
  for (const m of input.npofs) {
    if (!npofByPart.has(m.partNumber)) npofByPart.set(m.partNumber, m);
  }

  const rows: NpofCoverageRow[] = [];
  let missingNpofCount = 0;
  let incompleteNpofCount = 0;
  let completeNpofCount = 0;
  let criticalCount = 0;

  for (const [partNumber, demand] of demandByPart.entries()) {
    const npof = npofByPart.get(partNumber);

    if (!npof) {
      // Tidak ada baris NPOF sama sekali.
      missingNpofCount += 1;
      criticalCount += 1;
      rows.push({
        partNumber,
        productName: demand.productName,
        status: 'MISSING',
        critical: true,
        demandWeekCount: demand.weeks.size,
        npofId: null,
        material: null,
        materialType: null,
        supplier: null,
        gramatur: null,
        ukuran: null,
        missingFields: [...NPOF_REQUIRED_FIELDS],
        isNebeng: false,
      });
      continue;
    }

    // `normalizeNpofText(..., '')` -> '' berarti field kosong / '-' / 'null'.
    const gramatur = normalizeNpofText(npof.gramatur, '');
    const ukuran = normalizeNpofText(npof.sheetedSize, '');
    const material = normalizeNpofText(npof.material, '');
    const supplier = normalizeNpofText(npof.supplier, '');
    const formulaMaterial = normalizeNpofText(npof.formulaMaterial, '');
    const upsText = normalizeNpofText(npof.ups, '');
    const fm = parseMaterialNumber(npof.formulaMaterial);
    const ups = parseMaterialNumber(npof.ups);
    const isNebeng =
      NEBENG_PATTERN.test(ukuran) || NEBENG_PATTERN.test(formulaMaterial) || NEBENG_PATTERN.test(upsText);

    const missingFields: NpofRequiredField[] = [];
    if (!gramatur) missingFields.push('gramatur');
    if (!ukuran) missingFields.push('ukuran');
    if (fm <= 0) missingFields.push('formula');
    if (ups <= 0) missingFields.push('ups');
    if (!material) missingFields.push('material');
    if (!supplier) missingFields.push('supplier');

    const critical = fm <= 0 || ups <= 0;

    if (missingFields.length === 0) {
      completeNpofCount += 1;
      if (critical) criticalCount += 1;
      continue;
    }

    incompleteNpofCount += 1;
    if (critical) criticalCount += 1;

    rows.push({
      partNumber,
      productName: npof.productName?.trim() || demand.productName,
      status: 'INCOMPLETE',
      critical,
      demandWeekCount: demand.weeks.size,
      npofId: npof.npofId,
      material: material || null,
      materialType: material ? getMaterialFamily(material) : null,
      // Ditampilkan dengan nama kanonik (HANCHANG / MEGA / XSD) supaya cocok
      // dengan nama supplier di halaman Material Calculation.
      supplier: supplier ? canonicalSupplier(supplier) : null,
      gramatur: gramatur || null,
      ukuran: ukuran || null,
      missingFields,
      isNebeng,
    });
  }

  // Part tanpa NPOF lebih mendesak -> urutkan MISSING dulu, lalu nama part.
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'MISSING' ? -1 : 1;
    return a.partNumber.localeCompare(b.partNumber, 'id');
  });

  return {
    summary: {
      mrpPartCount: demandByPart.size,
      missingNpofCount,
      incompleteNpofCount,
      completeNpofCount,
      criticalCount,
    },
    rows,
  };
}
