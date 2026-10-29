/**
 * Verifikasi `buildStockUsage` (monitoring pemakaian stok raw material).
 *
 * Memakai data SINTETIS, jadi tidak butuh database dan bisa dijalankan kapan saja:
 *   pnpm --filter @pdits/api verify:stock-usage
 *
 * Yang dibuktikan:
 *   1. Lot lembaran yang dipakai ukuran lain (multiplier 2) melaporkan lembar
 *      FISIK yang benar, bukan lembar ukuran grup.
 *   2. Pemakaian satu lot di BEBERAPA ukuran dijumlahkan.
 *   3. Material yang tidak muncul di hasil perhitungan tetap tampil (0 terpakai).
 *   4. Konversi satuan rim / ton / satuan tak dikenal.
 */

import { buildStockUsage, type StockUsageItem } from './src/lib/stockUsage';

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  OK   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`, detail === undefined ? '' : detail);
  }
}

function close(actual: number, expected: number, tolerance = 1e-6): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function findItem(items: StockUsageItem[], itemDesc: string, supplier: string): StockUsageItem {
  const item = items.find((i) => i.itemDesc === itemDesc && i.supplier === supplier);
  if (!item) throw new Error(`item tidak ditemukan: ${itemDesc} / ${supplier}`);
  return item;
}

// ── Kasus 1: lot lembaran 117 cm dipakai ukuran 58,5 cm (multiplier 2) ──────
// Satu lot dipakai DUA ukuran, jadi pemakaiannya harus dijumlahkan.
console.log('Kasus 1 — lot lembaran, multiplier 2, dipakai 2 ukuran');
{
  const desc = 'DUPLEX 450GSM/ 117X92CM';
  const supplier = 'PT. MEGA SURYA ERATAMA';
  const snapshot = {
    groups: [
      {
        ukuran: '58.5 x 92 CM',
        gramatur: '450',
        supplier: 'MEGA',
        details: [{ partNumber: 'PART-A', fm: 0.13 }],
        weeklyMatrix: {
          summary: {
            stockDetails: [
              {
                desc,
                supplier,
                form: 'sheet',
                totalKg: 0,
                totalSheet: 100,
                multiplier: 2,
                allocatedKg: 6.5,
                allocatedSheet: 50,
                excludedKg: 0,
                wasteKg: 0.1,
              },
            ],
          },
        },
      },
      {
        ukuran: '58.5 x 92 CM',
        gramatur: '450',
        supplier: 'MEGA',
        details: [{ partNumber: 'PART-B', fm: 0.13 }],
        weeklyMatrix: {
          summary: {
            stockDetails: [
              {
                desc,
                supplier,
                form: 'sheet',
                totalKg: 0,
                totalSheet: 100,
                multiplier: 2,
                allocatedKg: 3.25,
                allocatedSheet: 25,
                excludedKg: 1,
                wasteKg: 0.05,
              },
            ],
          },
        },
      },
    ],
  };

  const usage = buildStockUsage({
    rows: [{ itemDesc: desc, supplier, qty: 100, unit: 'sht' }],
    resultSnapshot: snapshot,
    sheetsPerRim: 500,
  });

  const item = findItem(usage.items, desc, 'MEGA');
  const kgPerSheet = (117 * 92 * 450) / 1e7; // 0.48438 kg
  check('key memakai supplier kanonik', item.key === `${desc}||MEGA`, item.key);
  check('kg/lembar dari dimensi + gramatur', close(item.kgPerSheet ?? 0, kgPerSheet), item.kgPerSheet);
  check('kapasitas kg = 100 lembar × kg/lembar', close(item.capacityKg, 100 * kgPerSheet), item.capacityKg);
  check('terpakai kg = jumlah 2 ukuran', close(item.usedKg, 9.75), item.usedKg);
  check('terpakai lembar FISIK (50/2 + 25/2)', close(item.usedSheet, 37.5), item.usedSheet);
  check('sisa lembar', close(item.remainingSheet, 62.5), item.remainingSheet);
  check('excluded kg dijumlahkan', close(item.excludedKg, 1), item.excludedKg);
  check('waste kg dijumlahkan', close(item.wasteKg, 0.15), item.wasteKg);
  check('matchKeys memuat supplier mentah', item.matchKeys.includes(`${desc}||${supplier}`), item.matchKeys);
  check('2 alokasi tercatat', item.allocations.length === 2, item.allocations.length);
  check('alokasi urut kg terbesar', item.allocations[0].allocatedKg === 6.5, item.allocations[0]);
  check('part number ikut terbawa', item.allocations[0].parts.includes('PART-A'), item.allocations[0].parts);
  check('persen terpakai wajar (0..1)', item.usedPct !== null && item.usedPct > 0 && item.usedPct < 1, item.usedPct);
}

// ── Kasus 2: material yang tidak muncul di hasil perhitungan ────────────────
console.log('Kasus 2 — material tidak cocok ukuran mana pun');
{
  const usage = buildStockUsage({
    rows: [
      { itemDesc: 'KRAFT 120GSM/ 90CM', supplier: 'HANCHANG', qty: 2, unit: 't' },
      { itemDesc: 'KRAFT 120GSM/ 90CM', supplier: 'HANCHANG', qty: 3, unit: 'rim' },
    ],
    resultSnapshot: { groups: [] },
    sheetsPerRim: 500,
  });
  const item = findItem(usage.items, 'KRAFT 120GSM/ 90CM', 'HANCHANG');
  check('ton dikonversi ke kg', close(item.totalKg, 2000), item.totalKg);
  check('rim dikonversi ke lembar', close(item.totalSheet, 1500), item.totalSheet);
  check('belum terpakai', close(item.usedKg, 0) && close(item.usedSheet, 0), item);
  check('ditandai belum ada di hasil', item.seenInResult === false, item.seenInResult);
  check('persen terpakai 0', item.usedPct === 0, item.usedPct);
  check('total belum terpakai dihitung', usage.totals.unusedMaterials === 1, usage.totals);
}

// ── Kasus 3: satuan tak dikenal + pemakaian melebihi stok ───────────────────
console.log('Kasus 3 — satuan tak dikenal & pemakaian melebihi stok');
{
  const desc = 'DUPLEX 300GSM/ 65X90CM';
  const snapshot = {
    groups: [
      {
        ukuran: '65 x 90 CM',
        gramatur: '300',
        supplier: 'XSD',
        details: [{ partNumber: 'PART-C', fm: 0.2 }],
        weeklyMatrix: {
          summary: {
            stockDetails: [
              {
                desc,
                supplier: 'XSD',
                form: 'mixed',
                multiplier: 1,
                allocatedKg: 50,
                allocatedSheet: 0,
                excludedKg: 0,
                wasteKg: 0,
              },
            ],
          },
        },
      },
    ],
  };
  const usage = buildStockUsage({
    rows: [{ itemDesc: desc, supplier: 'XSD', qty: 10, unit: 'box' }],
    resultSnapshot: snapshot,
    sheetsPerRim: 500,
  });
  const item = findItem(usage.items, desc, 'XSD');
  check('satuan tak dikenal dilaporkan', item.unknownUnits.includes('box'), item.unknownUnits);
  check('pemakaian melebihi stok ditandai', item.overAllocated === true, item);
  check('sisa tidak negatif', item.remainingKg === 0, item.remainingKg);
  check('persen dibatasi 100%', item.usedPct === 1, item.usedPct);
  check('dihitung sebagai material habis', usage.totals.usedUpMaterials === 1, usage.totals);
}

// ── Kasus 4: tanpa data ─────────────────────────────────────────────────────
console.log('Kasus 4 — periode kosong');
{
  const usage = buildStockUsage({ rows: [], resultSnapshot: null, sheetsPerRim: 500 });
  check('tidak ada item', usage.items.length === 0, usage.items);
  check('total kapasitas 0', usage.totals.capacityKg === 0, usage.totals);
  check('persen 0', usage.totals.usedPct === 0, usage.totals);
}

console.log('');
if (failures > 0) {
  console.error(`${failures} pemeriksaan GAGAL`);
  process.exit(1);
}
console.log('Semua pemeriksaan lulus.');
