import { PrismaClient } from '@prisma/client';
import {
  allocateSequentially,
  calculatePart,
  getLeadTimeMonths,
  groupKeyOf,
  isTonUnit,
  matchSize,
  parseDims,
  parseGsm,
  poolQtyUnit,
  runMaterialCalculation,
  toKilogram,
  type AllocationConsumption,
  type PoolExclusion,
  type PoolItem,
  type Requirement,
} from './src/lib/materialCalcEngine';
import { canonicalSupplier } from './src/lib/supplierAlias';

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

  check('gramatur sama + lebar sama = exact', matchSize('DUPLEX 450GSM/ 63CM', 450, 63, 2), {
    exact: true,
    delta: 0,
    multiplier: 1,
  });
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

  // Regresi: kolom ukuran NPOF tidak berisi gramatur, jadi angka pertama yang
  // bernilai 3 digit ("100 x 71.5 CM") TIDAK boleh dibaca sebagai gramatur.
  check('ukuran "100 x 71.5 CM" -> gramatur', parseGsm('100 x 71.5 CM'), null);
  check('ukuran "100 x 71.5 CM" -> dimensi', parseDims('100 x 71.5 CM'), [100, 71.5]);
  check('ukuran "120 x 85.5 CM" -> dimensi', parseDims('120 x 85.5 CM'), [120, 85.5]);
  check('gramatur berlabel di deskripsi stok', parseGsm('DUPLEX 450GSM/ 100X71.5CM'), 450);
  check('dimensi dari deskripsi stok + gramatur', parseDims('DUPLEX 450GSM/ 100X71.5CM'), [100, 71.5]);
  check('match exact 100cm dari stok 100X71.5CM', matchSize('DUPLEX 450GSM/ 100X71.5CM', 450, 100, 2)?.exact, true);

  // ── Ukuran KELIPATAN (permintaan user 2026-10-13) ───────────────────────
  // Stok 117 × 92 cm dipakai untuk ukuran 58,5 × 92 cm karena 117 = 2 × 58,5.
  check('KELIPATAN 2: stok 117cm untuk kebutuhan 58.5cm', matchSize('DUPLEX 450GSM/ 117X92CM', 450, 58.5, 2), {
    exact: false,
    delta: 0,
    multiplier: 2,
  });
  check('KELIPATAN 2: ukuran pelanggan 58.8cm (117/2 = 58.5, kurang 0,3) = DITOLAK', matchSize('DUPLEX 450GSM/ 117X92CM', 450, 58.8, 2), null);
  check('KELIPATAN 3: stok 120cm untuk kebutuhan 40cm', matchSize('DUPLEX 450GSM/ 120CM', 450, 40, 2)?.multiplier, 3);
  check('KELIPATAN: 117cm untuk 60cm (58.5 < 60) = DITOLAK', matchSize('DUPLEX 450GSM/ 117CM', 450, 60, 2), null);
  check('ukuran sama tetap menang (multiplier 1)', matchSize('DUPLEX 450GSM/ 58.5CM', 450, 58.5, 2)?.multiplier, 1);
  check('CASUS USER: 117 × 92 untuk 58.5 × 92 = ×2', matchSize('DUPLEX 450GSM/ 117X92CM', 450, 58.5, 2, 92)?.multiplier, 2);
  check('KELIPATAN: panjang beda (92 vs 70.5) = DITOLAK', matchSize('DUPLEX 450GSM/ 117X92CM', 450, 58.5, 2, 70.5), null);
  check('GULUNGAN (1 dimensi) panjangnya bebas', matchSize('DUPLEX 450GSM/ 120CM', 450, 58.5, 2, 92)?.multiplier, 2);
  check('kelipatan dibatasi maxMultiplier (6): 117cm vs 16.7cm butuh ×7 = DITOLAK', matchSize('DUPLEX 450GSM/ 117CM', 450, 16.7, 2), null);
  check('maxMultiplier bisa dinaikkan: ×7 diizinkan', matchSize('DUPLEX 450GSM/ 117CM', 450, 16.7, 2, null, 8)?.multiplier, 7);

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

  // Stok KELIPATAN: 5.000 lbr 117 cm mewakili 10.000 lbr ukuran 58,5 cm.
  // fm part = 0,5 kg/lbr (lihat helper `req`), jadi kapasitas = 5.000 × 0,5 × 2 = 5.000 kg.
  const multiplierConsumptions: AllocationConsumption[] = [];
  const multiplierAlloc = allocateSequentially(
    [{ ...req('M', 0, 5000, 58.5), length: 92 }],
    [
      {
        key: 'stock|duplex-117',
        desc: 'DUPLEX 450GSM/ 117X92CM',
        supplier: 'SUP',
        source: 'stock',
        availableWeek: 0,
        kgRemaining: 0,
        sheetRemaining: 5000,
      },
    ],
    OPTS,
    (c) => multiplierConsumptions.push(c),
  );
  check('STOK KELIPATAN: kebutuhan 5.000 kg terpenuhi penuh oleh 5.000 lbr 117 cm', multiplierAlloc.get('M||0'), 5000);
  check('STOK KELIPATAN: lembar setara ukuran grup (×2 = 10.000)', multiplierConsumptions[0]?.fromSheet, 10000);
  check('STOK KELIPATAN: multiplier tercatat', multiplierConsumptions[0]?.multiplier, 2);

  // Tanpa aturan kelipatan, stok 117 cm tidak akan terpakai sama sekali untuk 58,5 cm.
  check(
    'stok kelipatan TIDAK dipakai kalau ukurannya jauh (117 vs 63)',
    run([req('A', 0, 500, 63)], [{ ...stock('DUPLEX 450GSM/ 117X92CM', 0), sheetRemaining: 1000 }]),
    { A: 0 },
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
    const length = parseDims(size)[1] ?? null;
    valid++;
    if ([...stockItems.values()].some((s) => matchSize(s.desc, gsm, width, 2, length) !== null)) matched++;
  }

  // CATATAN: dua angka di bawah adalah snapshot data NPOF + stok TERKINI di
  // database lokal. Nilai 185/62 diperbarui 2026-10-12 setelah `parseGsm()`
  // tidak lagi membaca angka pertama ukuran sebagai gramatur: 12 part berukuran
  // "100 x 71.5 CM" / "120 x 85.5 CM" jadi punya lebar benar (100/120) dan
  // sekarang benar-benar cocok dengan stok "100X71.5CM" / "120CM".
  // Sebelumnya parser lama hanya menghasilkan 50 part yang dapat stok.
  // 66 diperbarui 2026-10-13 setelah aturan "ukuran KELIPATAN" (58,5 × 92 cm
  // dapat memakai stok 117 × 92 cm, ×2) menambah 4 part: JCY51/JCY52/JCY53-JA10
  // lewat `DUPLEX 450GSM/ 117X92CM` dan JPV23-0941 lewat gulungan 69 cm (×3).
  check('jumlah kebutuhan NPOF dengan ukuran valid', valid, 185);
  check('TARGET MILESTONE 2: part yang dapat stok pada toleransi 2 cm', matched, 66);

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
  // Rumus carry-over: (saldo Hotlist 0 − MRP 1000) ÷ Up 2 = -500 lembar.
  check('matriks: minggu 1 = (saldo Hotlist − MRP) ÷ Up = -500 lbr', matrix.rows[0].weeksSheet[0], -500);
  check('matriks: minggu 2 kosong (saldo di-reset 0, tanpa demand)', matrix.rows[0].weeksSheet[1], 0);
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

  // End Ind harus saldo berjalan yang konsisten.
  // Sejak rumus carry-over, `Total + Allowance` bernilai NEGATIF saat kurang,
  // jadi saldo DITAMBAH (bukan dikurangi) seperti sebelumnya.
  const endIndOk = matrix.summary.endInd.every((value, i) => {
    const prev = i === 0 ? matrix.summary.stockAsOf : matrix.summary.endInd[i - 1];
    return Math.abs(value - (prev + matrix.summary.outstandingPo[i] + matrix.summary.totalPlusAllowance[i])) < 1e-9;
  });
  check('matriks: End Ind konsisten minggu demi minggu', endIndOk, true);

  // Total teralokasi tidak boleh melebihi stok fisik
  check('alokasi tidak melebihi stok fisik (500 kg)', engineResult.totals.allocatedKg <= 500 + 1e-9, true);

  console.log('\n==============================================');
  console.log('BAGIAN E — CARRY-OVER SALDO HOTLIST (2026-10-12)');
  console.log('==============================================');

  // Contoh persis dari permintaan user:
  //   Hotlist = 59.900 pcs, Up = 14, Kg/Lbr = 0,4617
  //   m1 MRP 59.100 → (59.900 − 59.100) ÷ 14 = +57,1428 lbr (sisa stok)
  //   m2 MRP 52.400 → saldo awal 800 pcs → (800 − 52.400) ÷ 14 = -3.685,714 lbr
  //   m3 MRP 28.000 → defisit m2 TIDAK dibawa → saldo awal 0 → -2.000 lbr
  const carry = runMaterialCalculation(
    {
      mrpWeeks: [
        { partNumber: 'C1', description: 'Carry', year: 2026, weekNumber: 1, weekStartDate: new Date('2026-10-10'), weekEndDate: new Date('2026-10-16'), quantity: 59100 },
        { partNumber: 'C1', description: 'Carry', year: 2026, weekNumber: 2, weekStartDate: new Date('2026-10-17'), weekEndDate: new Date('2026-10-23'), quantity: 52400 },
        { partNumber: 'C1', description: 'Carry', year: 2026, weekNumber: 3, weekStartDate: new Date('2026-10-24'), weekEndDate: new Date('2026-10-30'), quantity: 28000 },
      ],
      hotlists: [{ partNumber: 'C1', biTotal: 59900 }],
      stocks: [],
      pos: [],
      wips: [],
      npofs: [
        {
          partNumber: 'C1',
          productName: 'Carry',
          material: 'Paper',
          gramatur: '450',
          supplier: 'SUP',
          sheetedSize: '63 × 89 CM',
          formulaMaterial: '0.4617',
          ups: '14',
        },
      ],
    },
    {
      weekCount: 26,
      periodStartDate: new Date('2026-10-10'),
      toleranceCm: 2,
      sheetsPerRim: 500,
      requireSupplierMatch: false,
    },
  );

  const carryRow = carry.groups[0]?.weeklyMatrix.rows[0];
  const carrySummary = carry.groups[0]?.weeklyMatrix.summary;
  const closeTo = (a: number, b: number) => Math.abs(a - b) < 1e-6;

  check('carry-over: 1 baris part di grup', carry.groups[0]?.details.length, 1);
  check('carry-over: minggu 1 positif (sisa stok 800 pcs ÷ 14)', closeTo(carryRow.weeksSheet[0], 800 / 14), true);
  check('carry-over: Total Req minggu 1 = 0 (positif tidak dijumlahkan)', carrySummary.totalReqSheet[0], 0);
  check('carry-over: Total Req minggu 1 (kg) = 0', carrySummary.totalReq[0], 0);
  check('carry-over: minggu 2 = (800 − 52.400) ÷ 14', closeTo(carryRow.weeksSheet[1], (800 - 52400) / 14), true);
  check('carry-over: Total Req minggu 2 = kekurangan part itu', closeTo(carrySummary.totalReqSheet[1], (800 - 52400) / 14), true);
  check('carry-over: Total Req minggu 2 (kg) negatif', carrySummary.totalReq[1] < 0, true);
  check('carry-over: kg = lbr × Kg/Lbr', closeTo(carryRow.weeks[0], (800 / 14) * 0.4617), true);
  check('carry-over: defisit TIDAK diakumulasi (saldo awal m3 = 0)', closeTo(carryRow.weeksSheet[2], -28000 / 14), true);
  check('carry-over: Total Req m3 = -2.000 lbr', closeTo(carrySummary.totalReqSheet[2], -2000), true);
  check(
    'carry-over: allowance 5% ikut negatif',
    closeTo(carrySummary.allowanceSheet[1], carrySummary.totalReqSheet[1] * 0.05) && carrySummary.allowanceSheet[1] < 0,
    true,
  );
  check(
    'carry-over: Total + Allowance ikut negatif',
    carrySummary.totalPlusAllowanceSheet[2] < carrySummary.totalReqSheet[2],
    true,
  );

  console.log('\n==============================================');
  console.log('BAGIAN F — STOK & OUTSTANDING PO DIPISAH (2026-10-13)');
  console.log('==============================================');

  // Permintaan user: baris `Stock As Of` = STOK SAJA (dengan rincian per lot:
  // gulungan kg/ton vs lembaran), sedangkan baris `Outstanding PO` = angka
  // Master Data (qtyOrder − qtyDelivered) dan TIDAK dipotong alokasi.
  // Fixture: 1 lot gulungan (kg) + 1 lot lembaran + 1 PO kg yang tiba minggu 2.
  const split = runMaterialCalculation(
    {
      mrpWeeks: [
        {
          partNumber: 'S1',
          description: 'Split',
          year: 2026,
          weekNumber: 1,
          weekStartDate: new Date('2026-10-10'),
          weekEndDate: new Date('2026-10-16'),
          quantity: 60000,
        },
      ],
      hotlists: [],
      stocks: [
        { itemDesc: 'DUPLEX 450GSM/ 69CM', supplier: 'MEGA', qty: 10000, unit: 'kg' },
        { itemDesc: 'DUPLEX 450GSM/ 69X67CM', supplier: 'MEGA', qty: 5000, unit: 'sht' },
      ],
      pos: [
        {
          itemDesc: 'DUPLEX 450GSM/ 69CM (27")',
          supplierName: 'MEGA',
          qtyOrder: 1000,
          qtyOrderUnit: 'kg',
          qtyDelivered: 0,
          planReceivedDate: new Date('2026-10-17'),
          poNumber: 'PO-SPLIT-1',
        },
      ],
      wips: [],
      npofs: [
        {
          partNumber: 'S1',
          productName: 'Split',
          material: 'Paper',
          gramatur: '450',
          supplier: 'MEGA',
          sheetedSize: '69 x 67 CM',
          formulaMaterial: '0.20484',
          ups: '6',
        },
      ],
    },
    {
      weekCount: 26,
      periodStartDate: new Date('2026-10-10'),
      toleranceCm: 2,
      sheetsPerRim: 500,
      requireSupplierMatch: false,
    },
  );

  const splitGroup = split.groups[0];
  const splitSummary = splitGroup.weeklyMatrix.summary;
  const splitFm = splitGroup.weeklyMatrix.rows[0].kgPerSheet;
  const splitDetailsSorted = [...splitSummary.stockDetails].sort((a, b) => a.desc.localeCompare(b.desc));

  // Kebutuhan: 60.000 pcs ÷ Up 6 = 10.000 lbr × 1,05 = 10.500 lbr × 0,20484.
  check('split: Stock As Of = STOK SAJA (2.150,82 kg)', closeTo(splitSummary.stockAsOf, 2150.82), true);
  check('split: PO 1.000 kg TIDAK ikut naik ke Stock As Of', splitSummary.stockAsOf < 3000, true);
  check('split: allocatedStockKg part = Stock As Of', closeTo(splitGroup.details[0].allocatedStockKg, 2150.82), true);
  check('split: rincian stok berisi 2 lot', splitSummary.stockDetails.length, 2);
  check(
    'split: lot gulungan dikenali sebagai roll',
    `${splitDetailsSorted[0].desc}|${splitDetailsSorted[0].form}`,
    'DUPLEX 450GSM/ 69CM|roll',
  );
  check(
    'split: lot lembaran dikenali sebagai sheet',
    `${splitDetailsSorted[1].desc}|${splitDetailsSorted[1].form}`,
    'DUPLEX 450GSM/ 69X67CM|sheet',
  );
  check('split: total lot gulungan = 10.000 kg', splitDetailsSorted[0].totalKg, 10000);
  check('split: total lot lembaran = 5.000 lbr', splitDetailsSorted[1].totalSheet, 5000);
  check('split: lot gulungan terpakai seluruh kebutuhan', closeTo(splitDetailsSorted[0].allocatedKg, 2150.82), true);
  check('split: lot lembaran belum terpakai (stok sendiri dipakai dulu)', splitDetailsSorted[1].allocatedSheet, 0);

  check('split: Outstanding PO tampil PENUH di minggu kedatangan', closeTo(splitSummary.outstandingPo[1], 1000), true);
  check('split: Outstanding PO belum muncul di minggu 1', splitSummary.outstandingPo[0], 0);
  check(
    'split: Outstanding PO dalam lembar = 1.000 kg ÷ Kg/Lbr',
    closeTo(splitSummary.outstandingPoSheet[1], 1000 / splitFm),
    true,
  );
  check('split: nomor PO ikut terbaca', splitSummary.outstandingPoNumbers[1], ['PO-SPLIT-1']);
  check('split: rincian PO minggu 1 kosong', splitSummary.outstandingPoDetails[0].length, 0);
  check('split: rincian PO minggu 2 berisi 1 baris', splitSummary.outstandingPoDetails[1].length, 1);
  check(
    'split: rincian PO memuat qty, terpakai, dan sisa',
    Object.keys(splitSummary.outstandingPoDetails[1][0])
      .filter((k) => k.startsWith('qty') || k.startsWith('allocated') || k.startsWith('remaining'))
      .sort(),
    ['allocatedKg', 'allocatedSheet', 'qtyKg', 'qtySheet', 'remainingKg', 'remainingSheet'],
  );
  check(
    'split: angka kg & lbr Outstanding PO selalu sebanding',
    splitSummary.outstandingPo.every((kg, i) => Math.abs(kg - splitSummary.outstandingPoSheet[i] * splitFm) < 1e-9),
    true,
  );

  console.log('\n==============================================');
  console.log('BAGIAN H — STOK UKURAN KELIPATAN (2026-10-13)');
  console.log('==============================================');

  // Permintaan user: kertas 117 × 92 cm (pembelian lama yang tidak dibelah)
  // harus dipakai untuk ukuran 58,5 × 92 cm karena 117 = 2 × 58,5. Stok 5.000
  // lbr 117 cm harus tercatat sebagai 10.000 lbr pada baris `Stock As Of`,
  // dengan keterangan asal lotnya (ukuran 117 cm, stok 5.000 lbr).
  const mult = runMaterialCalculation(
    {
      mrpWeeks: [
        {
          partNumber: 'K1',
          description: 'Kelipatan',
          year: 2026,
          weekNumber: 1,
          weekStartDate: new Date('2026-10-10'),
          weekEndDate: new Date('2026-10-16'),
          quantity: 40000,
        },
      ],
      hotlists: [],
      stocks: [{ itemDesc: 'DUPLEX 450GSM/ 117X92CM', supplier: 'XSD', qty: 5000, unit: 'sht' }],
      pos: [],
      wips: [],
      npofs: [
        {
          partNumber: 'K1',
          productName: 'Kelipatan',
          material: 'Paper',
          gramatur: '450',
          supplier: 'XSD',
          sheetedSize: '58.5 x 92 CM',
          formulaMaterial: '0.24219',
          ups: '4',
        },
      ],
    },
    {
      weekCount: 26,
      periodStartDate: new Date('2026-10-10'),
      toleranceCm: 2,
      sheetsPerRim: 500,
      requireSupplierMatch: false,
    },
  );

  const multSummary = mult.groups[0].weeklyMatrix.summary;
  const multDetail = multSummary.stockDetails[0];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

  // Kebutuhan: 40.000 pcs ÷ Up 4 = 10.000 lbr × 1,05 = 10.500 lbr × 0,24219.
  check('kelipatan: stok 117 × 92 cm dikenali (1 lot)', multSummary.stockDetails.length, 1);
  check('kelipatan: multiplier = 2', multDetail.multiplier, 2);
  check('kelipatan: keterangan ukuran asli 117 × 92 cm', `${multDetail.sourceWidth}x${multDetail.sourceLength}`, '117x92');
  check('kelipatan: stok fisik tetap 5.000 lbr', multDetail.totalSheet, 5000);
  check('kelipatan: setara ukuran grup = 10.000 lbr', multDetail.equivalentSheet, 10000);
  check('kelipatan: terpakai = 10.000 lbr (ukuran grup)', multDetail.allocatedSheet, 10000);
  check(
    'kelipatan: terpakai = 5.000 lbr fisik × 2 × 0,24219 kg',
    near(multDetail.allocatedKg, 5000 * 2 * 0.24219),
    true,
  );
  check('kelipatan: Stock As Of (lbr) = 10.000', near(multSummary.stockAsOfSheet, 10000), true);
  check('kelipatan: kg = lbr × Kg/Lbr grup', near(multSummary.stockAsOf, 10000 * 0.24219), true);
  check(
    'kelipatan: ukuran 117 × 70 cm TIDAK dianggap cocok (panjang beda)',
    matchSize('DUPLEX 450GSM/ 117X70CM', 450, 58.5, 2, 92),
    null,
  );

  console.log('\n==============================================');
  console.log('BAGIAN G — NAMA SUPPLIER DIGABUNG (2026-10-13)');
  console.log('==============================================');

  // Aturan user: PHIL CORPORATION = HANCHANG = HANCHANG PAPER;
  // XSD = HONGKONG PAPER = XSD INTERNASIONAL PAPER;
  // MEGA = PT. MEGA SURYA ERATAMA = MEGA PAPER.
  check('alias: PHIL CORPORATION -> HANCHANG', canonicalSupplier('PHIL CORPORATION'), 'HANCHANG');
  check('alias: Hanchang Paper -> HANCHANG', canonicalSupplier('Hanchang Paper'), 'HANCHANG');
  check('alias: HANCHANG -> HANCHANG', canonicalSupplier('HANCHANG'), 'HANCHANG');
  check('alias: Hanchang Paper, Foshan -> HANCHANG', canonicalSupplier('Hanchang Paper, Foshan'), 'HANCHANG');
  check('alias: Hongkong Paper -> XSD', canonicalSupplier('Hongkong Paper'), 'XSD');
  check(
    'alias: HONGKONG PAPER SOURCES CO.LTD. -> XSD',
    canonicalSupplier('HONGKONG PAPER SOURCES CO.LTD.'),
    'XSD',
  );
  check('alias: XSD Internasional Paper -> XSD', canonicalSupplier('XSD Internasional Paper'), 'XSD');
  check('alias: PT. MEGA SURYA ERATAMA -> MEGA', canonicalSupplier('PT. MEGA SURYA ERATAMA'), 'MEGA');
  check('alias: MEGA PAPER -> MEGA', canonicalSupplier('MEGA PAPER'), 'MEGA');
  check('alias: MEGA SURYA ERATAMA -> MEGA', canonicalSupplier('MEGA SURYA ERATAMA'), 'MEGA');
  check('alias: PT.BOSUNG INDONESIA -> BOSUNG', canonicalSupplier('PT.BOSUNG INDONESIA'), 'BOSUNG');
  check('alias: supplier lain dibiarkan apa adanya', canonicalSupplier('Pulixin'), 'Pulixin');
  check('alias: nama mirip TIDAK digabung (MEGAH JAYA)', canonicalSupplier('MEGAH JAYA'), 'MEGAH JAYA');
  check('alias: kosong tetap kosong', canonicalSupplier(''), '');
  check('alias: lead time MEGA (semua tulisan) = 2 bulan', getLeadTimeMonths('PT. MEGA SURYA ERATAMA'), 2);
  check('alias: lead time PHIL CORPORATION = 3 bulan (Hanchang)', getLeadTimeMonths('PHIL CORPORATION'), 3);
  check(
    'alias: lead time HONGKONG PAPER SOURCES = 3 bulan (XSD)',
    getLeadTimeMonths('HONGKONG PAPER SOURCES CO.LTD.'),
    3,
  );

  // End-to-end: dua part dengan ukuran + gramatur SAMA tetapi supplier ditulis
  // "Hanchang Paper" dan "PHIL CORPORATION" harus jadi SATU grup.
  const aliasMrp = [{ partNumber: 'A1', description: 'Alias A', year: 2026, weekNumber: 1, weekStartDate: new Date('2026-10-10'), weekEndDate: new Date('2026-10-16'), quantity: 60000 }];
  const aliasNpof = (partNumber: string, supplier: string) => ({
    partNumber,
    productName: `Alias ${partNumber}`,
    material: 'Paper',
    gramatur: '450',
    supplier,
    sheetedSize: '63 x 89 CM',
    formulaMaterial: '0.4617',
    ups: '6',
  });
  const aliasMerge = runMaterialCalculation(
    {
      mrpWeeks: [...aliasMrp, { ...aliasMrp[0], partNumber: 'A2', description: 'Alias B' }],
      hotlists: [],
      stocks: [],
      pos: [],
      wips: [],
      npofs: [aliasNpof('A1', 'Hanchang Paper'), aliasNpof('A2', 'PHIL CORPORATION')],
    },
    {
      weekCount: 26,
      periodStartDate: new Date('2026-10-10'),
      toleranceCm: 2,
      sheetsPerRim: 500,
      requireSupplierMatch: false,
    },
  );

  check('alias: 2 tulisan supplier yang sama -> 1 grup', aliasMerge.groups.length, 1);
  check('alias: nama grup memakai nama kanonik', aliasMerge.groups[0]?.supplier, 'HANCHANG');
  check('alias: kedua part tetap ada di grup itu', aliasMerge.groups[0]?.details.length, 2);

  // Pencocokan stok vs kebutuhan saat `requireSupplierMatch=true` juga harus
  // tahan beda tulisan (dipakai kalau MATERIAL_REQUIRE_SUPPLIER diaktifkan).
  const aliasReq: Requirement = {
    partNumber: 'P1',
    weekIndex: 0,
    needKg: 500,
    gsm: 450,
    width: 63,
    supplier: 'MEGA PAPER',
    fm: 0.5,
  };
  const aliasPool = [stock('DUPLEX 450GSM/ 63CM', 1000, 'stock|alias')];
  aliasPool[0].supplier = 'PT. MEGA SURYA ERATAMA';
  check(
    'alias: supplier cocok walau beda tulisan (MEGA PAPER vs PT. MEGA SURYA ERATAMA)',
    allocateSequentially([aliasReq], aliasPool, { ...OPTS, requireSupplierMatch: true }).get('P1||0'),
    500,
  );
  check(
    'alias: supplier yang benar-benar beda tetap tidak dicocokkan',
    allocateSequentially([{ ...aliasReq, supplier: 'XSD' }], aliasPool, {
      ...OPTS,
      requireSupplierMatch: true,
    }).get('P1||0'),
    0,
  );

  console.log('\n==============================================');
  console.log('BAGIAN I — TOLERANSI PEMBULATAN KG (2026-10-13)');
  console.log('==============================================');

  // Kasus NYATA (periode Oktober 2026, grup `100 x 71.5 CM | 450 | XSD`):
  // JRT63/JRT64/JRT65/JRT66-JA10 masing-masing butuh 1.392,17203125 kg dan
  // alokasi stok menutup PERSIS kebutuhan itu, tetapi `allocatedKg` hasil
  // penjumlahan float kurang 1 ULP (±2,27e-13 kg).
  // Dulu: shortageKg > 0 -> isSufficient = false -> ceil(2,27e-13 / 0,32175) = 1
  // lembar per part -> kartu grup menulis "4 sheets / 0 kg" padahal tabel
  // 26 minggu positif semua.
  const ulpInput = {
    demandPcs: 49450,
    ups: 12,
    fm: 0.32175,
    biTotal: 0,
    leadTimeDemandPcs: 0,
    wipSheet: 0,
    wipPcs: 0,
  };
  const need = 1392.17203125; // = 4.326,875 lbr × 0,32175 kg
  const base = calculatePart({ ...ulpInput, allocatedKg: 0 });
  check('toleransi: kebutuhan bersih = 1.392,17203125 kg', near(base.kgNet2, need), true);
  // 1 ULP float pada nilai ~1.392 kg = 2,27e-13 — persis sisa pembulatan nyata.
  const oneUlpBelow = base.kgNet2 - 2.2737367544323206e-13;
  check('toleransi: nilai uji memang kurang 1 ULP (bukan sama)', oneUlpBelow < base.kgNet2, true);
  const ulp = calculatePart({ ...ulpInput, allocatedKg: oneUlpBelow });
  check('toleransi: selisih 1 ULP TIDAK dianggap kurang', ulp.isSufficient, true);
  check('toleransi: shortageKg jadi 0 (dulu 2,27e-13)', ulp.shortageKg, 0);
  check('toleransi: surplusKg 0 (bukan 2,27e-13)', ulp.surplusKg, 0);
  check('toleransi: shortageSheet null (dulu 1 lbr)', ulp.shortageSheet, null);

  // Kekurangan NYATA tetap harus terdeteksi (1 lembar = 0,32175 kg).
  const realShort = calculatePart({ ...ulpInput, allocatedKg: base.kgNet2 - 0.32175 });
  check('toleransi: kurang 1 lembar nyata tetap terdeteksi', realShort.isSufficient, false);
  check('toleransi: kurang 1 lembar -> shortageSheet 1', realShort.shortageSheet, 1);
  check(
    'toleransi: kurang 1 lembar -> shortageKg 0,32175',
    near(realShort.shortageKg, 0.32175),
    true,
  );
  const realShortHalf = calculatePart({ ...ulpInput, allocatedKg: base.kgNet2 - 0.16 });
  check('toleransi: kurang 0,16 kg (separuh lembar) tetap terdeteksi', realShortHalf.isSufficient, false);
  check('toleransi: kurang 0,16 kg -> dibulatkan jadi 1 lembar', realShortHalf.shortageSheet, 1);

  console.log('\n==============================================');
  console.log('BAGIAN J — PENGECUALIAN POOL PER UKURAN (2026-10-14)');
  console.log('==============================================');

  // Permintaan user: material yang TIDAK ikut perhitungan satu ukuran (mis.
  // ukurannya hanya kelipatan, atau sudah dipakai ukuran lain) harus bisa
  // dikeluarkan dari ukuran ITU SAJA — dan otomatis tersedia untuk ukuran lain.
  //
  // Fixture: dua grup ukuran sama (63 x 89 CM/450) tapi supplier beda (XSD & MEGA),
  // stok XSD 1.000 kg. Kebutuhan tiap grup 1.200 pcs ÷ Up 1 × 1,05 × 0,5 = 630 kg.
  const exMrpWeek = {
    year: 2030,
    weekNumber: 1,
    weekStartDate: new Date('2030-01-07'),
    weekEndDate: new Date('2030-01-13'),
    quantity: 1200,
  };
  const exNpof = (partNumber: string, supplier: string) => ({
    partNumber,
    productName: `Ex ${partNumber}`,
    material: 'Paper',
    gramatur: '450',
    supplier,
    sheetedSize: '63 x 89 CM',
    formulaMaterial: '0.5',
    ups: '1',
  });
  const exSource = (exclusions: PoolExclusion[]) => ({
    mrpWeeks: [
      { partNumber: 'EX1', description: 'Ex 1', ...exMrpWeek },
      { partNumber: 'EX2', description: 'Ex 2', ...exMrpWeek },
    ],
    hotlists: [],
    stocks: [{ itemDesc: 'DUPLEX 450GSM/ 63CM', supplier: 'XSD', qty: 1000, unit: 'kg' }],
    pos: [],
    wips: [],
    npofs: [exNpof('EX1', 'XSD'), exNpof('EX2', 'MEGA')],
    exclusions,
  });
  const exOpts = {
    weekCount: 26,
    periodStartDate: new Date('2030-01-07'),
    toleranceCm: 2,
    sheetsPerRim: 500,
    requireSupplierMatch: false,
  };

  const exNone = runMaterialCalculation(exSource([]), exOpts);
  const gXsd = exNone.groups.find((g) => g.supplier === 'XSD')!;
  const gMega = exNone.groups.find((g) => g.supplier === 'MEGA')!;
  check('exclusion: dua ukuran/supplier jadi 2 grup', exNone.groups.length, 2);
  check('exclusion: TANPA pengecualian grup XSD dapat stok 630 kg', gXsd.details[0].allocatedStockKg, 630);
  check('exclusion: TANPA pengecualian grup MEGA hanya sisa 370 kg', gMega.details[0].allocatedStockKg, 370);
  check('exclusion: TANPA pengecualian MEGA kurang', gMega.isSufficient, false);
  check(
    'exclusion: poolRef baris stok = itemDesc||supplier',
    gXsd.weeklyMatrix.summary.stockDetails[0].poolRef,
    'DUPLEX 450GSM/ 63CM||XSD',
  );
  check('exclusion: groupKey hasil engine = groupKeyOf()', gXsd.groupKey, groupKeyOf('63 x 89 CM', '450', 'XSD'));

  const exWith = runMaterialCalculation(
    exSource([
      {
        source: 'stock',
        groupKey: groupKeyOf('63 x 89 CM', '450', 'XSD'),
        poolRef: 'DUPLEX 450GSM/ 63CM||XSD',
        reason: 'sudah dipakai ukuran lain',
      },
    ]),
    exOpts,
  );
  const wXsd = exWith.groups.find((g) => g.supplier === 'XSD')!;
  const wMega = exWith.groups.find((g) => g.supplier === 'MEGA')!;
  check('exclusion: baris stok ditandai excluded', wXsd.weeklyMatrix.summary.stockDetails[0].excluded, true);
  check(
    'exclusion: alasan diteruskan ke rincian',
    wXsd.weeklyMatrix.summary.stockDetails[0].exclusionReason,
    'sudah dipakai ukuran lain',
  );
  check('exclusion: grup XSD tidak dapat stok sama sekali', wXsd.details[0].allocatedStockKg, 0);
  check('exclusion: Stock As Of grup XSD = 0 kg', wXsd.weeklyMatrix.summary.stockAsOf, 0);
  check('exclusion: grup XSD jadi kurang', wXsd.isSufficient, false);
  check('exclusion: materialnya DIPAKAI grup MEGA (630 kg)', wMega.details[0].allocatedStockKg, 630);
  check('exclusion: grup MEGA jadi tercukupi', wMega.isSufficient, true);
  check(
    'exclusion: baris stok grup MEGA TIDAK ditandai excluded',
    wMega.weeklyMatrix.summary.stockDetails[0].excluded,
    false,
  );

  // PO: identitas pool memakai `id` baris Master Data, bukan nomor PO.
  const exPoSource = (exclusions: PoolExclusion[]) => ({
    mrpWeeks: [{ partNumber: 'EX1', description: 'Ex 1', ...exMrpWeek }],
    hotlists: [],
    stocks: [],
    pos: [
      {
        id: 'po-row-1',
        itemDesc: 'DUPLEX 450GSM/ 63CM',
        supplierName: 'XSD',
        qtyOrder: 1000,
        qtyOrderUnit: 'kg',
        qtyDelivered: 0,
        planReceivedDate: new Date('2030-01-07'),
        poNumber: 'PO-EX-1',
      },
    ],
    wips: [],
    npofs: [exNpof('EX1', 'XSD')],
    exclusions,
  });
  const poNone = runMaterialCalculation(exPoSource([]), exOpts);
  check(
    'exclusion PO: tanpa pengecualian PO masuk baris Outstanding PO',
    poNone.groups[0].weeklyMatrix.summary.outstandingPo[0],
    1000,
  );
  const poEx = runMaterialCalculation(
    exPoSource([
      { source: 'po', groupKey: groupKeyOf('63 x 89 CM', '450', 'XSD'), poolRef: 'po-row-1', reason: 'n/a' },
    ]),
    exOpts,
  );
  check(
    'exclusion PO: baris rincian ditandai excluded',
    poEx.groups[0].weeklyMatrix.summary.outstandingPoDetails[0][0].excluded,
    true,
  );
  check(
    'exclusion PO: poolRef = id baris Master Data',
    poEx.groups[0].weeklyMatrix.summary.outstandingPoDetails[0][0].poolRef,
    'po-row-1',
  );
  check(
    'exclusion PO: TIDAK ikut baris Outstanding PO / End Ind',
    poEx.groups[0].weeklyMatrix.summary.outstandingPo[0],
    0,
  );
  check('exclusion PO: grup jadi kurang', poEx.groups[0].isSufficient, false);

  console.log('\n==============================================');
  console.log('BAGIAN K — SATUAN TON, SUPPLIER WAJIB, PENGECUALIAN SEBAGIAN (2026-10-15)');
  console.log('==============================================');

  // ── K1. Satuan ton ──────────────────────────────────────────────────────
  // Master Data Outstanding PO memakai satuan "t" (58 dari 117 baris). Sebelum
  // diperbaiki, baris itu punya kg = 0 DAN lembar = 0 sehingga seluruh PO-nya
  // hilang dari baris `Outstanding PO` (mis. PO HANCHANG 450gsm/120cm 10 t).
  check('ton: "t" dikenali sebagai ton', isTonUnit('t'), true);
  check('ton: "ton" dikenali sebagai ton', isTonUnit('ton'), true);
  check('ton: "kg" BUKAN ton', isTonUnit('kg'), false);
  check('ton: 10 t -> 10.000 kg', toKilogram(10, 't'), 10000);
  check('ton: 2,5 ton -> 2.500 kg', toKilogram(2.5, 'ton'), 2500);
  check('ton: satuan tak dikenal -> 0 kg', toKilogram(5, 'drum'), 0);

  const supMrp = (partNumber: string, quantity: number) => ({
    partNumber,
    description: partNumber,
    year: 2026,
    weekNumber: 1,
    weekStartDate: new Date('2026-10-10'),
    weekEndDate: new Date('2026-10-16'),
    quantity,
  });
  const supNpof = (partNumber: string, supplier: string, size: string, fm: string) => ({
    partNumber,
    productName: partNumber,
    material: 'Paper',
    gramatur: '450',
    supplier,
    sheetedSize: size,
    formulaMaterial: fm,
    ups: '1',
  });

  // Grup HANCHANG (120 x 85.5 CM): kebutuhan 100 pcs × 1,05 × 0,4617 = 48,4785 kg.
  // Kolamnya: PO HANCHANG 10 t (satuan ton) + stok MEGA 5.000 kg +
  // stok XSD 2 t yang ukurannya kelipatan (117 × 92 cm).
  const tonSource = {
    mrpWeeks: [supMrp('K1', 100), supMrp('K2', 4000)],
    hotlists: [],
    stocks: [
      { itemDesc: 'DUPLEX 450GSM/ 117X92CM', supplier: 'XSD', qty: 2, unit: 't' },
      { itemDesc: 'DUPLEX 450GSM/ 120CM', supplier: 'MEGA', qty: 5000, unit: 'kg' },
    ],
    pos: [
      {
        id: 'po-ton-1',
        itemDesc: 'DUPLEX 450GSM/ 120CM',
        supplierName: 'PHIL CORPORATION',
        qtyOrder: 10,
        qtyOrderUnit: 't',
        qtyDelivered: 0,
        planReceivedDate: new Date('2026-10-10'),
        poNumber: 'PO-TON-1',
      },
    ],
    wips: [],
    npofs: [
      supNpof('K1', 'HANCHANG', '120 x 85.5 CM', '0.4617'),
      supNpof('K2', 'XSD', '58.5 x 92 CM', '0.25'),
    ],
  };
  const tonOpts = {
    weekCount: 26,
    periodStartDate: new Date('2026-10-10'),
    toleranceCm: 2,
    sheetsPerRim: 500,
    requireSupplierMatch: true,
  };

  const tonRun = runMaterialCalculation(tonSource, tonOpts);
  const tonGroup = tonRun.groups.find((g) => g.supplier === 'HANCHANG')!;
  const tonSummary = tonGroup.weeklyMatrix.summary;
  check('ton: PO 10 t = 10.000 kg di baris Outstanding PO', tonSummary.outstandingPo[0], 10000);
  check('ton: rincian PO tetap menampilkan satuan aslinya ("t")', tonSummary.outstandingPoDetails[0][0].unit, 't');
  check(
    'ton: supplier "PHIL CORPORATION" dikenali sebagai HANCHANG',
    tonSummary.outstandingPoDetails[0][0].supplier,
    'HANCHANG',
  );

  // ── K2. Supplier wajib (stok DAN PO) ────────────────────────────────────
  // Keputusan user: pencocokan memakai Item Desc + Supplier (spesifikasi §2).
  check(
    'supplier: stok MEGA TIDAK muncul di grup HANCHANG',
    tonSummary.stockDetails.length,
    0,
  );
  check('supplier: stok MEGA tidak dipakai grup HANCHANG', tonGroup.details[0].allocatedStockKg, 0);
  check(
    'supplier: grup HANCHANG memakai PO-nya sendiri (48,4785 kg)',
    closeTo(tonGroup.details[0].allocatedKg, 48.4785),
    true,
  );

  const tonXsd = tonRun.groups.find((g) => g.supplier === 'XSD')!;
  check('ton stok: stok 2 t = 2.000 kg (kelipatan 117 × 92 untuk 58,5 × 92)', tonXsd.weeklyMatrix.summary.stockDetails[0].totalKg, 2000);
  check('ton stok: grup XSD tercukupi dari stok ton', tonXsd.isSufficient, true);
  check(
    'ton stok: kebutuhan 4.000 pcs × 1,05 × 0,25 = 1.050 kg diambil dari stok',
    closeTo(tonXsd.details[0].allocatedStockKg, 1050),
    true,
  );

  // Saklar lama harus tetap bisa mematikan syarat supplier (untuk perbandingan).
  const noSupRun = runMaterialCalculation(tonSource, { ...tonOpts, requireSupplierMatch: false });
  const noSupGroup = noSupRun.groups.find((g) => g.supplier === 'HANCHANG')!;
  check(
    'supplier: dengan MATERIAL_REQUIRE_SUPPLIER=false stok MEGA boleh dipakai',
    noSupGroup.details[0].allocatedStockKg,
    48.4785,
  );

  // Supplier yang DATANYA TIDAK ADA tetap boleh memakai material apa pun.
  const noSupData = runMaterialCalculation(
    {
      ...tonSource,
      npofs: [supNpof('K1', '-', '120 x 85.5 CM', '0.4617'), supNpof('K2', 'XSD', '58.5 x 92 CM', '0.25')],
    },
    tonOpts,
  );
  const unknownGroup = noSupData.groups.find((g) => g.supplier === 'Unknown')!;
  check('supplier: supplier NPOF "-" jadi grup Unknown', unknownGroup.groupKey, '120 x 85.5 CM||450||Unknown');
  check('supplier: grup tanpa data supplier tetap dapat material', unknownGroup.isSufficient, true);

  // ── K3. Pengecualian SEBAGIAN (qty) ─────────────────────────────────────
  check('exclusion sebagian: unit rim/lembar -> sheet', poolQtyUnit('rim'), 'sheet');
  check('exclusion sebagian: unit kg -> kg', poolQtyUnit('kg'), 'kg');
  check('exclusion sebagian: unit t -> kg', poolQtyUnit('t'), 'kg');

  // Fixture: dua grup ukuran sama (63 x 89 CM), stok XSD 1.000 kg, kebutuhan
  // tiap grup 630 kg (1.200 pcs ÷ Up 1 × 1,05 × 0,5). Kebutuhan grup MEGA
  // sengaja di minggu BERIKUTNYA supaya urutan alokasi tidak mengaburkan efek
  // batas: minggu 1 dilayani dulu, baru minggu 2.
  const partMrp = (partNumber: string, quantity: number, weekNumber: number) => ({
    partNumber,
    description: partNumber,
    year: 2026,
    weekNumber,
    weekStartDate: new Date(weekNumber === 1 ? '2026-10-10' : '2026-10-17'),
    weekEndDate: new Date(weekNumber === 1 ? '2026-10-16' : '2026-10-23'),
    quantity,
  });
  const partSource = (exclusions: PoolExclusion[]) => ({
    mrpWeeks: [partMrp('P1', 1200, 1), partMrp('P2', 1200, 2)],
    hotlists: [],
    stocks: [{ itemDesc: 'DUPLEX 450GSM/ 63CM', supplier: 'XSD', qty: 1000, unit: 'kg' }],
    pos: [],
    wips: [],
    npofs: [supNpof('P1', 'XSD', '63 x 89 CM', '0.5'), supNpof('P2', 'MEGA', '63 x 89 CM', '0.5')],
    exclusions,
  });
  const partOpts = {
    weekCount: 26,
    periodStartDate: new Date('2026-10-10'),
    toleranceCm: 2,
    sheetsPerRim: 500,
    requireSupplierMatch: false,
  };
  const groupXsd = groupKeyOf('63 x 89 CM', '450', 'XSD');

  const partial = runMaterialCalculation(
    partSource([
      { source: 'stock', groupKey: groupXsd, poolRef: 'DUPLEX 450GSM/ 63CM||XSD', qty: 500, unit: 'kg', reason: 'sebagian' },
    ]),
    partOpts,
  );
  const pXsd = partial.groups.find((g) => g.supplier === 'XSD')!;
  const pMega = partial.groups.find((g) => g.supplier === 'MEGA')!;
  check('exclusion sebagian: grup XSD dibatasi 500 kg', pXsd.details[0].allocatedStockKg, 500);
  check('exclusion sebagian: grup XSD kurang 130 kg', closeTo(pXsd.totalShortageKg ?? 0, 130), true);
  check('exclusion sebagian: sisanya (500 kg) dipakai grup MEGA', pMega.details[0].allocatedStockKg, 500);
  check('exclusion sebagian: grup MEGA juga kurang 130 kg', closeTo(pMega.totalShortageKg ?? 0, 130), true);
  check('exclusion sebagian: baris stok TIDAK ditandai excluded penuh', pXsd.weeklyMatrix.summary.stockDetails[0].excluded, false);
  check(
    'exclusion sebagian: jumlah yang dikeluarkan tercatat di rincian stok',
    pXsd.weeklyMatrix.summary.stockDetails[0].excludedKg,
    500,
  );
  check(
    'exclusion sebagian: baris stok tetap menampilkan total fisik lot',
    pXsd.weeklyMatrix.summary.stockDetails[0].totalKg,
    1000,
  );

  // qty >= total = sama dengan mengeluarkan seluruhnya (perilaku lama).
  const full = runMaterialCalculation(
    partSource([
      { source: 'stock', groupKey: groupXsd, poolRef: 'DUPLEX 450GSM/ 63CM||XSD', qty: 1000, unit: 'kg' },
    ]),
    partOpts,
  );
  const fXsd = full.groups.find((g) => g.supplier === 'XSD')!;
  const fMega = full.groups.find((g) => g.supplier === 'MEGA')!;
  check('exclusion sebagian: qty = total -> grup XSD tidak dapat apa pun', fXsd.details[0].allocatedStockKg, 0);
  check('exclusion sebagian: qty = total -> ditandai excluded penuh', fXsd.weeklyMatrix.summary.stockDetails[0].excluded, true);
  check('exclusion sebagian: qty = total -> seluruh lot jadi milik grup MEGA', fMega.details[0].allocatedStockKg, 630);

  // PO: baris `Outstanding PO` menghitung hanya bagian milik ukuran ini.
  const poPartial = runMaterialCalculation(
    {
      ...tonSource,
      exclusions: [
        { source: 'po' as const, groupKey: groupKeyOf('120 x 85.5 CM', '450', 'HANCHANG'), poolRef: 'po-ton-1', qty: 4000, unit: 'kg' },
      ],
    },
    tonOpts,
  );
  const poPartialGroup = poPartial.groups.find((g) => g.supplier === 'HANCHANG')!;
  const poPartialSummary = poPartialGroup.weeklyMatrix.summary;
  check('exclusion sebagian PO: baris Outstanding PO = 10.000 − 4.000', poPartialSummary.outstandingPo[0], 6000);
  check(
    'exclusion sebagian PO: qty Master Data tetap penuh di rincian',
    poPartialSummary.outstandingPoDetails[0][0].qtyKg,
    10000,
  );
  check(
    'exclusion sebagian PO: bagian yang dikeluarkan tercatat',
    poPartialSummary.outstandingPoDetails[0][0].excludedKg,
    4000,
  );
  check(
    'exclusion sebagian PO: sisa = qty − dikeluarkan − terpakai',
    closeTo(poPartialSummary.outstandingPoDetails[0][0].remainingKg, 6000 - 48.4785),
    true,
  );

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
