/**
 * Verifikasi fitur "Rekomendasi Ukuran Material & Waste".
 *
 * Fokus pengujian:
 *  1. Kelebihan ukuran (trim) & waste per lembar dihitung dari geometri.
 *  2. Waste pembelian (shortage) dan waste produksi (kebutuhan penuh) memakai
 *     rumus yang sama dengan Q berbeda.
 *  3. Pembulatan lembar ikut terhitung, dan dipisahkan dari trim.
 *  4. Modul TIDAK memutasi data pool milik pemanggil.
 *
 * Jalankan: pnpm --filter @pdits/api verify:size-recommendation
 */

import {
  buildGroupRecommendation,
  sizeRatio,
  wasteOfUsage,
  type RecommendationPoolInput,
  type RecommendationInput,
} from './src/lib/materialSizeRecommendation';
import { runMaterialCalculation, type MaterialCalcSource } from './src/lib/materialCalcEngine';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK  ' : 'GAGAL'} | ${label} -> ${JSON.stringify(actual)}${ok ? '' : `  (harusnya ${JSON.stringify(expected)})`}`);
}

function checkClose(label: string, actual: number | null | undefined, expected: number, eps = 0.01) {
  const value = typeof actual === 'number' ? actual : NaN;
  const ok = Number.isFinite(value) && Math.abs(value - expected) <= eps;
  if (!ok) failures += 1;
  console.log(`${ok ? 'OK  ' : 'GAGAL'} | ${label} -> ${value}${ok ? '' : `  (harusnya ${expected} ± ${eps})`}`);
}

const pool = (
  desc: string,
  kg: number,
  sheet: number,
  extra: Partial<RecommendationPoolInput> = {},
): RecommendationPoolInput => ({
  key: `stock|${desc}`,
  poolRef: desc,
  desc,
  supplier: 'HANCHANG',
  source: 'stock',
  availableWeek: 0,
  kgRemaining: kg,
  sheetRemaining: sheet,
  poNumber: null,
  excluded: false,
  excludedKg: 0,
  excludedSheet: 0,
  ...extra,
});

function run(overrides: Partial<RecommendationInput>): ReturnType<typeof buildGroupRecommendation> {
  const input: RecommendationInput = {
    groupKey: 'TEST',
    ukuran: '59 x 60 CM',
    gramatur: '450',
    supplier: 'HANCHANG',
    parts: [
      {
        partNumber: 'P1',
        fm: 0.15,
        sheetsNet2: 10000,
        shortageSheet: 0,
        firstNeedWeek: 0,
      },
    ],
    pool: [],
    consumptions: [],
    npofSizes: [],
    options: {
      toleranceCm: 2,
      requireSupplierMatch: true,
      maxOptions: 8,
      maxMultiplier: 6,
      includeNpof: false,
      standardSizes: [],
    },
    ...overrides,
  };
  return buildGroupRecommendation(input);
}

console.log('=== Kasus 1: kebutuhan 59 x 60 cm, roll stok 60 cm (contoh user) ===');
{
  const poolItems = [pool('DUPLEX 450GSM/ 60CM', 2500, 0)];
  const result = run({ pool: poolItems });
  const best = result.best;

  check('best ukuran', best?.size, '60 cm');
  check('multiplier', best?.multiplier, 1);
  check('trim lebar (cm)', best?.trimWidthCm, 1);
  checkClose('waste % per lembar', best?.wastePctPerSheet, 1 / 60, 1e-6);
  checkClose('waste pembelian (tidak ada pembelian)', best?.purchase.wasteKg, 0, 1e-6);
  checkClose('kg material produksi', best?.production.kgMaterial, 1525.42, 0.01);
  checkClose('kg terpakai produksi', best?.production.kgUsed, 1500, 0.01);
  checkClose('waste produksi (kg)', best?.production.wasteKg, 25.42, 0.01);
  check('tersedia sekarang', best?.availableNow, true);
  check('layak dipakai', best?.feasible, true);
  check('catatan trim belum diperhitungkan', best?.notes.includes('trim-not-applied'), true);
  check('baseline waste nol', result.baseline?.production.wasteKg, 0);
  check(
    'pool TIDAK dimutasi',
    poolItems[0].kgRemaining,
    2500,
  );
}

console.log('\n=== Kasus 2: 58,5 x 92 cm, stok 117 x 92 cm (2 potong) ===');
{
  const result = run({
    ukuran: '58.5 x 92 CM',
    supplier: 'HANCHANG',
    parts: [
      {
        partNumber: 'P1',
        fm: 0.119002,
        sheetsNet2: 10000,
        shortageSheet: 10000,
        firstNeedWeek: 0,
      },
    ],
    pool: [pool('DUPLEX 450GSM/ 117X92CM', 0, 100000)],
  });
  const best = result.best;
  check('best ukuran', best?.size, '117 × 92 cm');
  check('multiplier', best?.multiplier, 2);
  check('trim lebar', best?.trimWidthCm, 0);
  check('waste % per lembar', best?.wastePctPerSheet, 0);
  checkClose('waste pembelian (kg)', best?.purchase.wasteKg, 0, 1e-6);
  check('lembar material', best?.purchase.stockUnits, 5000);
}

console.log('\n=== Kasus 3: 58,5 x 92 cm, stok 120 x 92 cm (trim 3 cm) ===');
{
  const result = run({
    ukuran: '58.5 x 92 CM',
    parts: [
      {
        partNumber: 'P1',
        fm: 0.119002,
        sheetsNet2: 10000,
        shortageSheet: 10000,
        firstNeedWeek: 0,
      },
    ],
    pool: [pool('DUPLEX 450GSM/ 120X92CM', 0, 100000)],
  });
  const best = result.best;
  check('trim lebar', best?.trimWidthCm, 3);
  checkClose('waste % per lembar', best?.wastePctPerSheet, 0.025, 1e-6);
  checkClose('kg material', best?.purchase.kgMaterial, 1220.53, 0.05);
  checkClose('waste pembelian (kg)', best?.purchase.wasteKg, 30.51, 0.05);
}

console.log('\n=== Kasus 4: pembulatan lembar (10.001 lembar, 117 x 92) ===');
{
  const result = run({
    ukuran: '58.5 x 92 CM',
    parts: [
      {
        partNumber: 'P1',
        fm: 0.119002,
        sheetsNet2: 10001,
        shortageSheet: 10001,
        firstNeedWeek: 0,
      },
    ],
    pool: [pool('DUPLEX 450GSM/ 117X92CM', 0, 100000)],
  });
  const best = result.best;
  check('lembar material (dibulatkan ke atas)', best?.purchase.stockUnits, 5001);
  checkClose('waste pembulatan (kg)', best?.purchase.roundingWasteKg, 0.119002, 0.0001);
  checkClose('waste trim (kg)', best?.purchase.trimWasteKg, 0, 1e-6);
}

console.log('\n=== Kasus 5: ukuran standar 180 cm untuk kebutuhan 59 cm ===');
{
  const result = run({
    options: {
      toleranceCm: 2,
      requireSupplierMatch: true,
      maxOptions: 8,
      maxMultiplier: 6,
      includeNpof: false,
      standardSizes: [180],
    },
  });
  const best = result.best;
  check('best ukuran', best?.size, '180 cm');
  check('multiplier', best?.multiplier, 3);
  check('trim lebar', best?.trimWidthCm, 3);
  checkClose('waste % per lembar', best?.wastePctPerSheet, 1 - 177 / 180, 1e-6);
  check('belum tersedia', best?.availableNow, false);
  check('perlu beli baru', best?.notes.includes('new-purchase'), true);
}

console.log('\n=== Kasus 6: PO tiba melewati kebutuhan pertama ===');
{
  const result = run({
    parts: [
      {
        partNumber: 'P1',
        fm: 0.15,
        sheetsNet2: 10000,
        shortageSheet: 10000,
        firstNeedWeek: 1,
      },
    ],
    pool: [
      pool('DUPLEX 450GSM/ 60CM', 2500, 0, {
        key: 'po|1',
        source: 'po',
        availableWeek: 5,
        poNumber: 'PO-001',
      }),
    ],
  });
  const best = result.best;
  check('tidak layak (tiba terlambat)', best?.feasible, false);
  check('catatan tiba terlambat', best?.notes.includes('arrives-late'), true);
  check('minggu kedatangan', best?.arrivalWeek, 5);
}

console.log('\n=== Kasus 7: material dikeluarkan user ===');
{
  const result = run({
    pool: [pool('DUPLEX 450GSM/ 60CM', 2500, 0, { excluded: true })],
  });
  check('tidak ada kandidat', result.best, null);
  check('alasan', result.emptyReason, 'no-candidate');
}

console.log('\n=== Kasus 8: ukuran nebeng tidak dihitung ===');
{
  const result = run({ ukuran: 'NEBENG 59 x 60 CM' });
  check('alasan', result.emptyReason, 'nebeng');
  check('tanpa rekomendasi', result.best, null);
}

console.log('\n=== Kasus 9: supplier berbeda tidak masuk kandidat ===');
{
  const result = run({
    pool: [pool('DUPLEX 450GSM/ 60CM', 2500, 0, { supplier: 'MEGA' })],
  });
  check('tidak ada kandidat', result.best, null);
}

console.log('\n=== Kasus 10: grup tercukupi (tanpa pembelian) ===');
{
  const result = run({
    parts: [
      {
        partNumber: 'P1',
        fm: 0.15,
        sheetsNet2: 10000,
        shortageSheet: null,
        firstNeedWeek: 0,
      },
    ],
    pool: [pool('DUPLEX 450GSM/ 60CM', 2500, 0)],
  });
  check('qty pembelian', result.purchaseQtySheet, 0);
  checkClose('waste pembelian', result.best?.purchase.wasteKg, 0, 1e-6);
  checkClose('waste produksi tetap dihitung', result.best?.production.wasteKg, 25.42, 0.01);
}

console.log('\n=== Kasus 11: urutan rekomendasi (waste 0% lebih dulu) ===');
{
  const result = run({
    parts: [
      {
        partNumber: 'P1',
        fm: 0.15,
        sheetsNet2: 10000,
        shortageSheet: 10000,
        firstNeedWeek: 0,
      },
    ],
    pool: [
      pool('DUPLEX 450GSM/ 60CM', 2500, 0),
      pool('DUPLEX 450GSM/ 118CM', 2500, 0),
    ],
  });
  check('pilihan pertama', result.options[0]?.size, '118 cm');
  check('waste pilihan pertama', result.options[0]?.wastePctPerSheet, 0);
}

console.log('\n=== Kasus 12: integrasi engine — angka inti tidak berubah ===');
{
  const start = new Date('2026-01-05T00:00:00Z');
  const source: MaterialCalcSource = {
    mrpWeeks: Array.from({ length: 26 }, (_, i) => ({
      partNumber: 'P1',
      description: 'Produk Uji',
      year: 2026,
      weekNumber: i + 1,
      weekStartDate: new Date(start.getTime() + i * 7 * 86400000),
      weekEndDate: new Date(start.getTime() + (i * 7 + 6) * 86400000),
      quantity: i === 0 ? 10000 : 0,
    })),
    hotlists: [],
    stocks: [{ itemDesc: 'DUPLEX 450GSM/ 60CM', supplier: 'HANCHANG', qty: 2500, unit: 'kg' }],
    pos: [],
    wips: [],
    npofs: [
      {
        partNumber: 'P1',
        productName: 'Produk Uji',
        gramatur: '450',
        supplier: 'HANCHANG',
        sheetedSize: '59 x 60 CM',
        formulaMaterial: '0.15',
        ups: '1',
      },
    ],
  };

  const result = runMaterialCalculation(source, {
    weekCount: 26,
    periodStartDate: start,
    toleranceCm: 2,
    sheetsPerRim: 500,
    requireSupplierMatch: true,
    recommendation: { standardSizes: [] },
  });

  const group = result.groups[0];
  const detail = group?.details[0];

  check('jumlah grup', result.groups.length, 1);
  check('kebutuhan produksi bersih (lbr)', detail?.sheetsNet2, 10500);
  check('tercukupi oleh stok', detail?.isSufficient, true);
  check('tidak ada kekurangan', detail?.shortageKg, 0);
  checkClose('Stock As Of (kg)', group?.weeklyMatrix.summary.stockAsOf, 1575, 0.01);
  check('rekomendasi tersedia', group?.sizeRecommendation !== undefined, true);
  check('ukuran rekomendasi', group?.sizeRecommendation?.best?.size, '60 cm');
  check('qty pembelian 0', group?.sizeRecommendation?.purchaseQtySheet, 0);
  checkClose(
    'waste produksi (kg)',
    group?.sizeRecommendation?.best?.production.wasteKg,
    26.69,
    0.01,
  );

  // Waste dari PEMAKAIAN NYATA (lot stok yang terpakai grup ini).
  checkClose('waste lot stok (kg)', group?.weeklyMatrix.summary.stockWasteKg, 26.69, 0.01);
  checkClose('waste % lot stok', (group?.weeklyMatrix.summary.stockWastePct ?? 0) * 100, 1.6667, 0.001);
  checkClose('waste di rincian lot stok (kg)', group?.weeklyMatrix.summary.stockDetails[0]?.wasteKg, 26.69, 0.01);
  checkClose(
    'trim lebar di rincian lot stok (cm)',
    group?.weeklyMatrix.summary.stockDetails[0]?.trimWidthCm,
    1,
    0.0001,
  );
}

console.log('\n=== Kasus 13: helper waste pemakaian nyata ===');
{
  // Roll 60 cm untuk kebutuhan 59 cm: 1 kg produk butuh 60/59 kg material.
  checkClose('sizeRatio gulungan', sizeRatio(60, null, 59, 60), 60 / 59, 1e-9);
  checkClose('sizeRatio lembaran', sizeRatio(120, 92, 58.5, 92), 120 / 58.5, 1e-9);
  checkClose('waste 1.575 kg produk (kg)', wasteOfUsage(1575, 60 / 59, 1).wasteKg, 26.69, 0.01);
  checkClose('waste pct', wasteOfUsage(1575, 60 / 59, 1).wastePct, 1 / 60, 1e-6);
  check('waste 0 bila ukuran kelipatan pas', wasteOfUsage(1000, 2, 2).wasteKg, 0);
  // Deskripsi nyata `DUPLEX 450GSM/ 69CM (27")`: 27 adalah inci, bukan panjang.
  check('sizeRatio abaikan angka inci', sizeRatio(69, 27, 69, 67), 1);
  check('waste tidak pernah negatif', wasteOfUsage(15000, sizeRatio(69, 27, 69, 67), 1).wasteKg, 0);
}

console.log(`\n${failures === 0 ? 'SEMUA LULUS' : `${failures} GAGAL`}`);
process.exit(failures === 0 ? 0 : 1);
