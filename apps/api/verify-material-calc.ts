import { PrismaClient } from '@prisma/client';
import {
  allocateSequentially,
  matchSize,
  parseDims,
  parseGsm,
  runMaterialCalculation,
  type PoolItem,
  type Requirement,
} from './src/lib/materialCalcEngine';

const prisma = new PrismaClient({
  datasourceUrl: 'mysql://root:@localhost:3306/planner_project',
});

const OPTS = { toleranceCm: 2, requireSupplierMatch: false };

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'GAGAL'} | ${label} -> ${JSON.stringify(actual)}${ok ? '' : `  (harusnya ${JSON.stringify(expected)})`}`);
}

const stock = (desc: string, kg: number, key = desc): PoolItem => ({
  key,
  desc,
  supplier: 'SUP',
  source: 'stock',
  availableWeek: 0,
  kgRemaining: kg,
  sheetRemaining: 0,
});

const req = (
  partNumber: string,
  weekIndex: number,
  needKg: number,
  width: number,
  gsm = 450,
): Requirement => ({ partNumber, weekIndex, needKg, width, gsm, supplier: 'SUP', fm: 0.5 });

/** Jalankan alokasi, kembalikan peta partNumber -> kg teralokasi. */
function run(requirements: Requirement[], pool: PoolItem[]) {
  const alloc = allocateSequentially(requirements, pool, OPTS);
  const byPart = new Map<string, number>();
  for (const [k, kg] of alloc.entries()) {
    const pn = k.slice(0, k.lastIndexOf('||'));
    byPart.set(pn, (byPart.get(pn) || 0) + kg);
  }
  return Object.fromEntries([...byPart.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

async function main() {
  console.log('==============================================');
  console.log('BAGIAN A — ATURAN PENCOCOKAN UKURAN');
  console.log('==============================================');

  check('gramatur sama + lebar sama = exact', matchSize('DUPLEX 450GSM/ 63CM', 450, 63, 2), { exact: true, delta: 0 });
  check('lebar lebih besar 2 cm persis = lolos', matchSize('DUPLEX 450GSM/ 63CM', 450, 61, 2)?.delta, 2);
  check('lebar lebih besar 2,5 cm = DITOLAK', matchSize('DUPLEX 450GSM/ 63CM', 450, 60.5, 2), null);
  check('lebar lebih KECIL = DITOLAK', matchSize('DUPLEX 450GSM/ 60CM', 450, 63, 2), null);
  check('gramatur beda = DITOLAK', matchSize('DUPLEX 400GSM/ 63CM', 450, 63, 2), null);
  check('dua dimensi: pakai dimensi pertama', matchSize('DUPLEX 450GSM/ 88X95CM', 450, 88, 2)?.exact, true);
  check('dua dimensi: 88 vs 86 = lolos delta 2', matchSize('DUPLEX 450GSM/ 88X95CM', 450, 86, 2)?.delta, 2);
  check('satuan sht tetap terbaca', matchSize('DUPLEX 350GSM/ 83X106CM', 350, 83, 2)?.exact, true);
  check('gramatur tanpa kata GSM ("450")', parseGsm('450'), 450);
  check('dimensi "63.5 x 89 CM"', parseDims('63.5 x 89 CM'), [63.5, 89]);
  check('angka <= 20 dibuang (bukan dimensi)', parseDims('DUPLEX 270GSM/ 6CM'), []);

  console.log('\n==============================================');
  console.log('BAGIAN B — ALOKASI BERURUTAN');
  console.log('==============================================');

  // Contoh persis dari user
  check(
    'CONTOH USER: stok 1000kg/60cm; B(750kg, minggu 0) & A(500kg, minggu 3)',
    run([req('A', 3, 500, 60), req('B', 0, 750, 59.5)], [stock('DUPLEX 450GSM/ 60CM', 1000)]),
    { A: 250, B: 750 },
  );

  // Situasi A — yang bisa ditutup penuh didahulukan
  check(
    'SITUASI A: minggu sama; A(4000, bisa penuh) vs B(15000, tidak)',
    run([req('A', 0, 4000, 60), req('B', 0, 15000, 60)], [stock('DUPLEX 450GSM/ 60CM', 10000)]),
    { A: 4000, B: 6000 },
  );

  // Situasi B — ukuran paling pas didahulukan
  check(
    'SITUASI B: minggu sama; A butuh 63cm (sama persis) vs B 61.5cm',
    run([req('A', 0, 4000, 63), req('B', 0, 4000, 61.5)], [stock('DUPLEX 450GSM/ 63CM', 8000)]),
    { A: 4000, B: 4000 },
  );

  // Kasus tabrakan -> PILIHAN X (ukuran sama persis menang, walau tidak bisa penuh)
  check(
    'PILIHAN X: A butuh 63cm (exact, 15000) menang atas B 61.5cm (bisa penuh, 4000)',
    run([req('A', 0, 15000, 63), req('B', 0, 4000, 61.5)], [stock('DUPLEX 450GSM/ 63CM', 10000)]),
    { A: 10000, B: 0 },
  );

  // Tidak boleh over-alokasi
  const over = run([req('A', 0, 800, 60), req('B', 0, 800, 60)], [stock('DUPLEX 450GSM/ 60CM', 1000)]);
  const overTotal = Object.values(over).reduce((s, v) => s + v, 0);
  check('total teralokasi tidak melebihi stok fisik 1000', overTotal, 1000);

  // PO baru masuk mulai minggu kedatangannya
  check(
    'PO baru tersedia di minggu kedatangan (minggu 2)',
    run(
      [req('X', 0, 1200, 60), req('Y', 4, 700, 60)],
      [
        stock('DUPLEX 450GSM/ 60CM', 500, 'stock|a'),
        { key: 'po|1', desc: 'DUPLEX 450GSM/ 60CM', supplier: 'SUP', source: 'po', availableWeek: 2, kgRemaining: 1000, sheetRemaining: 0 },
      ],
    ),
    { X: 500, Y: 700 },
  );

  // Stok bersatuan lembar dikonversi memakai fm part
  check(
    'stok bersatuan lembar dikonversi via fm',
    run([req('A', 0, 200, 60)], [{ ...stock('DUPLEX 450GSM/ 60CM', 0), sheetRemaining: 1000 }]),
    { A: 200 },
  );

  console.log('\n==============================================');
  console.log('BAGIAN C — UJI KE DATA NYATA (pakai fungsi asli)');
  console.log('==============================================');

  const npof = await prisma.npofMaterial.findMany();
  const stocks = await prisma.stockRawMaterial.findMany();

  const stockItems = new Map<string, { desc: string; supplier: string; kg: number; sheet: number }>();
  for (const s of stocks) {
    const key = `${s.itemDesc}||${s.supplier || ''}`;
    const cur = stockItems.get(key) || { desc: s.itemDesc, supplier: s.supplier || '', kg: 0, sheet: 0 };
    const unit = String(s.unit || '').trim().toLowerCase();
    if (unit === 'sht' || unit === 'sheet' || unit === 'sheets' || unit === 'lbr') cur.sheet += s.qty;
    else if (unit === 'rim') cur.sheet += s.qty * 500;
    else cur.kg += s.qty;
    stockItems.set(key, cur);
  }

  let valid = 0;
  let matched = 0;
  for (const n of npof) {
    if (!n.gramatur || !n.sheetedSize) continue;
    const size = String(n.sheetedSize).trim();
    if (!size || size === '-') continue;
    if (/nebeng|satu\s*layout|tidak\s*dihitung/i.test(size)) continue;
    const gsm = Number(String(n.gramatur).replace(',', '.'));
    if (!gsm) continue;
    const width = parseDims(size)[0];
    if (width === undefined) continue;
    valid++;
    if ([...stockItems.values()].some((s) => matchSize(s.desc, gsm, width, 2) !== null)) matched++;
  }

  // CATATAN: dua angka di bawah adalah snapshot data NPOF + stok TERKINI di
  // database lokal (diperbarui 2026-09-28 setelah data master di-upload ulang ke
  // tabel periode). Fungsi `matchSize` yang diuji TIDAK berubah — yang berubah
  // hanya isi tabel `npof_materials` / `stock_raw_materials`, sehingga
  // hitungannya bergeser dari 98/29 ke 108/31.
  check('jumlah kebutuhan NPOF dengan ukuran valid', valid, 108);
  check('TARGET MILESTONE 2: part yang dapat stok pada toleransi 2 cm', matched, 31);

  // Total kapasitas stok nyata (kg) — jadi patokan "tidak boleh dilampaui"
  const totalStockKg = [...stockItems.values()].reduce((sum, s) => sum + s.kg, 0);
  const totalStockSheet = [...stockItems.values()].reduce((sum, s) => sum + s.sheet, 0);
  console.log(`\nInfo: kapasitas stok fisik = ${Math.round(totalStockKg).toLocaleString('id-ID')} kg + ${Math.round(totalStockSheet).toLocaleString('id-ID')} lembar`);

  console.log('\n==============================================');
  console.log('BAGIAN D — TABEL MINGGUAN 26 KOLOM');
  console.log('==============================================');

  const engineResult = runMaterialCalculation(
    {
      mrpWeeks: [
        { partNumber: 'P1', description: 'Part 1', year: 2026, weekNumber: 1, weekStartDate: new Date('2026-09-19'), weekEndDate: new Date('2026-09-25'), quantity: 1000 },
        { partNumber: 'P1', description: 'Part 1', year: 2026, weekNumber: 3, weekStartDate: new Date('2026-10-03'), weekEndDate: new Date('2026-10-09'), quantity: 500 },
      ],
      hotlists: [],
      stocks: [{ itemDesc: 'DUPLEX 450GSM/ 63CM', supplier: 'SUP', qty: 500, unit: 'kg' }],
      pos: [
        {
          itemDesc: 'DUPLEX 450GSM/ 63CM',
          supplierName: 'SUP',
          qtyOrder: 100,
          qtyOrderUnit: 'kg',
          qtyDelivered: 0,
          planReceivedDate: new Date('2026-10-01'),
          poNumber: 'PO-TEST-1',
        },
      ],
      wips: [],
      npofs: [
        {
          partNumber: 'P1',
          productName: 'Part 1',
          material: 'Paper',
          gramatur: '450',
          supplier: 'SUP',
          sheetedSize: '63 × 89 CM',
          formulaMaterial: '0.5',
          ups: '2',
        },
      ],
    },
    {
      weekCount: 26,
      periodStartDate: new Date('2026-09-19'),
      toleranceCm: 2,
      sheetsPerRim: 500,
      requireSupplierMatch: false,
    },
  );

  check('kolom minggu berjumlah 26', engineResult.weeks.length, 26);
  check('terbentuk 1 grup', engineResult.groups.length, 1);
  check('jenis material terbaca dari NPOF', engineResult.groups[0]?.materialType, 'Paper');

  const matrix = engineResult.groups[0].weeklyMatrix;
  check('matriks: 26 kolom', matrix.columns.length, 26);
  check('matriks: 1 baris part', matrix.rows.length, 1);
  check('matriks: array summary panjangnya 26', matrix.summary.totalReq.length, 26);
  check('matriks: minggu 1 ada kebutuhan lembar', matrix.rows[0].weeksSheet[0] > 0, true);
  check('matriks: minggu 2 kosong (tidak ada demand)', matrix.rows[0].weeksSheet[1], 0);
  check(
    'matriks: allowance = 5% dari Total Req',
    Math.abs(matrix.summary.allowanceSheet[0] - matrix.summary.totalReqSheet[0] * 0.05) < 1e-9,
    true,
  );
  check('matriks: baris part memakai kg (fm ada)', matrix.rows[0].hasKg, true);
  check('matriks: kg per lembar terisi', matrix.rows[0].kgPerSheet, 0.5);

  // PO 100 kg dengan planReceivedDate 2026-10-01 -> 12 hari dari awal periode -> minggu ke-2
  check('matriks: PO belum masuk di minggu 1', matrix.summary.outstandingPo[0], 0);
  check('matriks: PO masuk di minggu kedatangannya (minggu 2)', matrix.summary.outstandingPo[1], 100);
  // PO bersatuan kg TIDAK punya angka lembar, jadi dikonversi ke lembar lewat
  // Kg/Lbr grup. Tanpa ini baris "Outstanding PO" tampil "0 lbr / 0 kg"
  // padahal PO-nya ada (kasus nyata: PO L1G001066 = 5.000 kg).
  check('matriks: PO kg dikonversi ke lembar (100 kg / 0,5 = 200 lbr)', matrix.summary.outstandingPoSheet[1], 200);
  check('matriks: PO kg tetap kosong di minggu lain', matrix.summary.outstandingPoSheet[0], 0);
  check('matriks: nomor PO muncul di minggu kedatangan', matrix.summary.outstandingPoNumbers[1], ['PO-TEST-1']);
  check('matriks: minggu tanpa PO kosong', matrix.summary.outstandingPoNumbers[0], []);
  check(
    'matriks: panjang outstandingPoNumbers = jumlah kolom',
    matrix.summary.outstandingPoNumbers.length,
    26,
  );

  // End Ind harus saldo berjalan yang konsisten
  const endIndOk = matrix.summary.endInd.every((value, i) => {
    const prev = i === 0 ? matrix.summary.stockAsOf : matrix.summary.endInd[i - 1];
    return Math.abs(value - (prev + matrix.summary.outstandingPo[i] - matrix.summary.totalPlusAllowance[i])) < 1e-9;
  });
  check('matriks: End Ind konsisten minggu demi minggu', endIndOk, true);

  // Total teralokasi tidak boleh melebihi stok fisik
  check('alokasi tidak melebihi stok fisik (500 kg)', engineResult.totals.allocatedKg <= 500 + 1e-9, true);

  console.log('\n==============================================');
  if (failures === 0) console.log('SEMUA PEMERIKSAAN LULUS');
  else console.log(`${failures} PEMERIKSAAN GAGAL`);
  console.log('==============================================');
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
