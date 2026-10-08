import { PrismaClient } from '@prisma/client';

/**
 * TEST ISOLASI ANTAR PERIODE (Fase 10).
 *
 * Membuktikan janji utama rancangan: mengupload / mengubah data di satu periode
 * TIDAK boleh mengubah periode lain.
 *
 * Diuji lewat HTTP API yang asli (bukan memanggil fungsi internal), supaya
 * route, hak akses, query, dan constraint database ikut teruji.
 *
 * Perbandingan angka memakai TOLERANSI, bukan kecocokan persis, karena kolom
 * JSON MySQL merapikan notasi bilangan (mis. 0.30000000000000004 menjadi 0.3).
 * Selisihnya ~1e-16 dan tidak berarti; yang penting jumlah part, flag
 * kecukupan, dan nilai kg tidak berubah secara nyata.
 *
 * Periode uji dibuat lalu DIHAPUS lagi di akhir, jadi tidak meninggalkan sampah.
 */

// ── DIPERBARUI 2026-09-28 (arsitektur "periode ada di Master Data") ──────────
//
// Data TIDAK lagi disalin ke tabel snapshot. Kelima tabel Master Data
// (weekly_schedules, wips, hotlists, stock_raw_materials, outstanding_pos)
// menyimpan `periodId` secara langsung, sehingga upload memakai endpoint
// halaman Master Data:
//   MRP            -> POST /weekly-schedule/bulk       { records, saveMode, periodId, moduleType }
//   WIP            -> POST /wip/bulk                   { records, saveMode, periodId, moduleType }
//   HOTLIST        -> POST /hotlist/import             { data, mode, periodId }
//   STOCK_RM       -> POST /stock-raw-material/import  { data, mode, periodId }
//   OUTSTANDING_PO -> POST /outstanding-po/import      { data, mode, periodId }
//
// Sejak 2026-09-29 MRP & WIP juga WAJIB menyertakan `moduleType`
// (PRODUCTION | MATERIAL) — data kedua modul disimpan terpisah.
// Tes ini memakai modul MATERIAL karena hasil perhitungan yang dibandingkan
// adalah hasil Material Calculation.
//
// Sejak 2026-10-01 STOCK_RM & OUTSTANDING_PO juga wajib punya `refB` yang
// mengandung "MTL" — baris tanpa MTL ditolak import.
//
// Fixture dibuat SINTETIS (3 part x 4 minggu) supaya tes ini jalan juga di
// database kosong dan tidak bergantung pada data produksi. Item uji dibuat
// kalau belum ada, lalu dihapus lagi di akhir.
const API = 'http://localhost:3001/api/v1';
const EMAIL = 'admin@pdits.com';
const PASSWORD = 'password123';

const TEST_PARTS = ['TESTISO-P1', 'TESTISO-P2', 'TESTISO-P3'];
const TEST_LOCATION = 'TESTISO-LOC';
const TEST_SUPPLIER = 'TESTISO SUPPLIER';
const TEST_ITEM_DESC = 'TESTISO DUPLEX 300GSM/ 60CM';
/** Senin 7 Jan 2030 = awal minggu 1. Tetap, tidak bergantung waktu mesin. */
const WEEK1 = Date.UTC(2030, 0, 7);
const WEEK_COUNT = 4;
const MS_DAY = 24 * 60 * 60 * 1000;

/** Awal minggu ke-w (1-based). */
function weekStart(w: number): Date {
  return new Date(WEEK1 + (w - 1) * 7 * MS_DAY);
}
/** Akhir minggu ke-w (7 hari setelah awal). */
function weekEnd(w: number): Date {
  return new Date(WEEK1 + (w - 1) * 7 * MS_DAY + 6 * MS_DAY);
}

/**
 * Upload SATU sumber ke SATU periode lewat endpoint Master Data yang benar.
 * Semua panggilan WAJIB menyertakan `periodId` supaya penimpaan hanya terjadi
 * di dalam periode itu.
 */
async function uploadSource(periodId: string, source: string, data: unknown[]) {
  switch (source) {
    case 'MRP':
      return api('POST', '/weekly-schedule/bulk', {
        records: data,
        saveMode: 'overwrite',
        periodId,
        moduleType: 'MATERIAL',
      });
    case 'WIP':
      return api('POST', '/wip/bulk', {
        records: data,
        saveMode: 'overwrite',
        periodId,
        moduleType: 'MATERIAL',
      });
    case 'HOTLIST':
      return api('POST', '/hotlist/import', { data, mode: 'overwrite', periodId });
    case 'STOCK_RM':
      return api('POST', '/stock-raw-material/import', { data, mode: 'overwrite', periodId });
    case 'OUTSTANDING_PO':
      return api('POST', '/outstanding-po/import', { data, mode: 'overwrite', periodId });
    default:
      throw new Error(`Sumber tidak dikenal: ${source}`);
  }
}

/** Semua sumber sekaligus, urut sesuai SOURCE_TYPES. */
async function uploadAll(periodId: string, fixtures: Record<string, unknown[]>) {
  const results: { source: string; status: number; json: any }[] = [];
  for (const source of ['MRP', 'HOTLIST', 'STOCK_RM', 'OUTSTANDING_PO', 'WIP']) {
    const r = await uploadSource(periodId, source, fixtures[source]);
    results.push({ source, status: r.status, json: r.json });
  }
  return results;
}

/** Benar untuk semua status 2xx — tiap endpoint Master Data memakai kode sendiri. */
function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Toleransi perbandingan kg. 1e-6 kg = 1 mikrogram. */
const TOL = 1e-6;

const prisma = new PrismaClient({
  datasourceUrl: 'mysql://root:@localhost:3306/planner_project',
});

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'OK   ' : 'GAGAL'} | ${label} -> ${JSON.stringify(actual)}${ok ? '' : `  (harusnya ${JSON.stringify(expected)})`}`,
  );
}

let token = '';
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      // Content-Type hanya dikirim kalau memang ada body. Kalau tidak,
      // Fastify menolak dengan "Body cannot be empty".
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

interface Row {
  kgNet2: number;
  allocatedKg: number;
  shortageKg: number;
  isSufficient: boolean;
}

/** Ubah hasil menjadi peta partNumber -> angka pentingnya. */
function rowMapOf(result: any): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const g of result?.groups ?? []) {
    for (const d of g.details ?? []) {
      out.set(String(d.partNumber), {
        kgNet2: Number(d.kgNet2 ?? 0),
        allocatedKg: Number(d.allocatedKg ?? 0),
        shortageKg: Number(d.shortageKg ?? 0),
        isSufficient: Boolean(d.isSufficient),
      });
    }
  }
  return out;
}

/** Bandingkan dua hasil dengan toleransi; laporkan penyimpangan terbesar. */
function compareResults(label: string, expected: any, actual: any) {
  const a = rowMapOf(expected);
  const b = rowMapOf(actual);

  const missing = [...a.keys()].filter((k) => !b.has(k));
  const extra = [...b.keys()].filter((k) => !a.has(k));
  let maxDelta = 0;
  let flagDiff = 0;
  let overTol = 0;

  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) continue;
    const delta = Math.max(
      Math.abs(va.kgNet2 - vb.kgNet2),
      Math.abs(va.allocatedKg - vb.allocatedKg),
      Math.abs(va.shortageKg - vb.shortageKg),
    );
    if (delta > maxDelta) maxDelta = delta;
    if (va.isSufficient !== vb.isSufficient) flagDiff += 1;
    if (delta > TOL) overTol += 1;
  }

  const ok = missing.length === 0 && extra.length === 0 && flagDiff === 0 && overTol === 0;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'OK   ' : 'GAGAL'} | ${label} -> ${a.size} part, selisih maks ${maxDelta.toExponential(2)} kg` +
      `${ok ? '' : `  (hilang=${missing.length} tambahan=${extra.length} beda-flag=${flagDiff} lewat-toleransi=${overTol})`}`,
  );
}

/** Apakah dua hasil berbeda secara nyata (dipakai untuk membuktikan perubahan). */
function resultsDiffer(x: any, y: any): boolean {
  const a = rowMapOf(x);
  const b = rowMapOf(y);
  if (a.size !== b.size) return true;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) return true;
    if (va.isSufficient !== vb.isSufficient) return true;
    if (Math.abs(va.kgNet2 - vb.kgNet2) > TOL) return true;
    if (Math.abs(va.allocatedKg - vb.allocatedKg) > TOL) return true;
  }
  return false;
}

async function main() {
  console.log('==================================================');
  console.log('TEST ISOLASI ANTAR PERIODE');
  console.log('==================================================\n');

  const login = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status !== 200 || !login.json?.accessToken) {
    console.error('Gagal login:', login.status, login.json);
    process.exitCode = 1;
    return;
  }
  token = login.json.accessToken;
  console.log('Login berhasil.\n');

  // ── Siapkan item uji: pakai yang sudah ada, buat yang belum ──────────────
  // Hanya item ber-partNumber TESTISO-* yang dibuat, dan hanya itu yang
  // dihapus lagi di akhir. Data produksi tidak disentuh sama sekali.
  const existingItems = await prisma.item.findMany({ where: { partNumber: { in: TEST_PARTS } } });
  const existingCodes = new Set(existingItems.map((i) => i.partNumber));
  const createdItemIds: string[] = [];
  for (const code of TEST_PARTS) {
    if (existingCodes.has(code)) continue;
    const created = await prisma.item.create({
      data: { partNumber: code, itemName: `Part uji isolasi ${code}`, unit: 'PCS' },
    });
    createdItemIds.push(created.id);
  }

  // ── Fixture sintetis: 3 part x 4 minggu ──────────────────────────
  interface MrpRow {
    itemCode: string;
    description: string;
    year: number;
    weekNumber: number;
    weekStartDate: Date;
    weekEndDate: Date;
    quantity: number;
  }
  const mrpFixtureA: MrpRow[] = [];
  for (const [pIdx, code] of TEST_PARTS.entries()) {
    for (let w = 1; w <= WEEK_COUNT; w += 1) {
      mrpFixtureA.push({
        itemCode: code,
        description: `Part uji isolasi ${code}`,
        year: 2030,
        weekNumber: w,
        weekStartDate: weekStart(w),
        weekEndDate: weekEnd(w),
        quantity: 100 * (pIdx + 1) + w * 10,
      });
    }
  }
  /** Periode B: kebutuhan dibagi dua supaya hasilnya PASTI berbeda dari A. */
  const mrpFixtureB = mrpFixtureA.map((r) => ({ ...r, quantity: r.quantity / 2 }));
  /** Perubahan data di periode A (dipakai pemeriksaan 4a). */
  const mrpFixtureAQuarter = mrpFixtureA.map((r) => ({ ...r, quantity: r.quantity / 4 }));

  const hotlistFixture = TEST_PARTS.map((partNumber) => ({
    partNumber,
    date: weekStart(1),
    biTotal: 50,
  }));

  const stockFixture = [
    {
      itemDesc: TEST_ITEM_DESC,
      supplier: TEST_SUPPLIER,
      qty: 1000,
      unit: 'kg',
      date: weekStart(1),
      // Import menolak baris tanpa "MTL" pada refB (filter wajib).
      refB: 'MTL/TEST/ISO',
    },
  ];

  const poFixture = [
    {
      poNumber: 'TESTISO-PO-1',
      itemDesc: TEST_ITEM_DESC,
      supplierName: TEST_SUPPLIER,
      qtyOrder: 500,
      qtyOrderUnit: 'kg',
      qtyDelivered: 0,
      qtyDeliveredUnit: 'kg',
      planReceivedDate: weekStart(2),
      // Import menolak baris tanpa "MTL" pada refB (filter wajib).
      refB: 'MTL/TEST/ISO',
    },
  ];

  const wipFixture = TEST_PARTS.map((partNumber) => ({
    partNumber,
    location: TEST_LOCATION,
    quantity: 25,
    date: weekStart(1),
  }));

  const fixtures: Record<string, unknown[]> = {
    MRP: mrpFixtureA as unknown[],
    HOTLIST: hotlistFixture as unknown[],
    STOCK_RM: stockFixture as unknown[],
    OUTSTANDING_PO: poFixture as unknown[],
    WIP: wipFixture as unknown[],
  };
  const fixturesB: Record<string, unknown[]> = { ...fixtures, MRP: mrpFixtureB as unknown[] };

  console.log(
    `Fixture: MRP ${mrpFixtureA.length} baris (${TEST_PARTS.length} part x ${WEEK_COUNT} minggu), ` +
      `WIP ${wipFixture.length}, HOTLIST ${hotlistFixture.length}, ` +
      `STOCK_RM ${stockFixture.length}, OS PO ${poFixture.length}` +
      `${createdItemIds.length > 0 ? ` (+${createdItemIds.length} item uji dibuat)` : ''}\n`,
  );

  const createdIds: string[] = [];
  const cleanup = async () => {
    for (const id of createdIds) await api('DELETE', `/material-planning/cycles/${id}`);
  };

  /** NPOF adalah sumber GLOBAL: jumlahnya tidak boleh berubah sama sekali. */
  const npofBefore = await prisma.npofMaterial.count();

  try {
    // ── 1. Periode A ──────────────────────────────────────────────────────
    const createA = await api('POST', '/material-planning/cycles', {
      uploadMonth: '2030-01',
      notes: 'periode uji isolasi A',
    });
    if (createA.status !== 201) {
      console.error('Gagal membuat periode A:', createA.status, createA.json);
      process.exitCode = 1;
      return;
    }
    const cycleA = createA.json.data.id;
    createdIds.push(cycleA);

    const uploadsA = await uploadAll(cycleA, fixtures);
    const failedA = uploadsA.find((u) => !isOk(u.status));
    if (failedA) {
      console.error(`Gagal upload ${failedA.source}:`, failedA.status, failedA.json);
      process.exitCode = 1;
      return;
    }

    const detailA1 = await api('GET', `/material-planning/cycles/${cycleA}`);
    const countsA1 = detailA1.json.data.rowCounts;
    check('1a. Jumlah baris periode A sesuai fixture', countsA1, {
      MRP: mrpFixtureA.length,
      HOTLIST: hotlistFixture.length,
      STOCK_RM: stockFixture.length,
      OUTSTANDING_PO: poFixture.length,
      WIP: wipFixture.length,
    });

    const calcA1 = await api('POST', `/material-planning/cycles/${cycleA}/calculate`);
    if (calcA1.status !== 201) {
      console.error('Gagal menghitung periode A:', calcA1.status, calcA1.json);
      process.exitCode = 1;
      return;
    }
    console.log('── Periode A (2030-01) dibuat & dihitung ──');
    console.log(`   baris: MRP=${countsA1.MRP} WIP=${countsA1.WIP} HOTLIST=${countsA1.HOTLIST}`);
    console.log(`   hasil: ${calcA1.json.data.totals.partCount} part, ${calcA1.json.data.totals.partsWithStock} dapat stok\n`);

    // ── 2. Periode B dengan data berbeda ──────────────────────────────────
    const createB = await api('POST', '/material-planning/cycles', {
      uploadMonth: '2030-02',
      notes: 'periode uji isolasi B',
    });
    if (createB.status !== 201) {
      console.error('Gagal membuat periode B:', createB.status, createB.json);
      process.exitCode = 1;
      return;
    }
    const cycleB = createB.json.data.id;
    createdIds.push(cycleB);

    const uploadsB = await uploadAll(cycleB, fixturesB);
    const failedB = uploadsB.find((u) => !isOk(u.status));
    if (failedB) {
      console.error(`Gagal upload ${failedB.source} ke periode B:`, failedB.status, failedB.json);
      process.exitCode = 1;
      return;
    }
    const calcB1 = await api('POST', `/material-planning/cycles/${cycleB}/calculate`);
    console.log('── Periode B (2030-02) dibuat dengan MRP berbeda ──');
    console.log(`   hasil: ${calcB1.json.data.totals.partCount} part\n`);

    // ── 3. Cek ulang A: TIDAK BOLEH berubah ───────────────────────────────
    const detailA2 = await api('GET', `/material-planning/cycles/${cycleA}`);
    check('3a. Baris data periode A tidak berubah setelah periode B dibuat', detailA2.json.data.rowCounts, countsA1);

    const resultA2 = await api('GET', `/material-planning/cycles/${cycleA}/results`);
    const currentA2 = resultA2.json.data.find((r: any) => r.isCurrent);
    const fullA2 = await api('GET', `/material-planning/cycles/${cycleA}/results/${currentA2.id}`);
    compareResults('3b. Hasil periode A tetap sama', calcA1.json.data, fullA2.json.data.resultSnapshot);
    check('3c. Hasil periode B berbeda dari A (data memang beda)', resultsDiffer(calcA1.json.data, calcB1.json.data), true);

    // ── 4. Ubah data di A, hitung ulang: B TIDAK BOLEH berubah ────────────
    await uploadSource(cycleA, 'MRP', mrpFixtureAQuarter as unknown[]);
    const calcA3 = await api('POST', `/material-planning/cycles/${cycleA}/calculate`);
    check('4a. Hasil periode A BERUBAH setelah datanya diubah', resultsDiffer(calcA1.json.data, calcA3.json.data), true);

    const resultB2 = await api('GET', `/material-planning/cycles/${cycleB}/results`);
    const currentB2 = resultB2.json.data.find((r: any) => r.isCurrent);
    const fullB2 = await api('GET', `/material-planning/cycles/${cycleB}/results/${currentB2.id}`);
    compareResults('4b. Hasil periode B TIDAK berubah setelah periode A diubah', calcB1.json.data, fullB2.json.data.resultSnapshot);

    const detailB2 = await api('GET', `/material-planning/cycles/${cycleB}`);
    check('4c. Baris data periode B tidak tersentuh', detailB2.json.data.rowCounts.MRP, mrpFixtureB.length);

    // ── 5. Re-upload menimpa, bukan menambah ──────────────────────────────
    const detailA3 = await api('GET', `/material-planning/cycles/${cycleA}`);
    check('5a. Re-upload MRP MENIMPA (tidak menumpuk)', detailA3.json.data.rowCounts.MRP, mrpFixtureA.length);

    // ── 6. Tanda STALE ────────────────────────────────────────────────
    await uploadSource(cycleA, 'HOTLIST', hotlistFixture as unknown[]);
    const list = await api('GET', '/material-planning/cycles');
    const rowA = list.json.data.find((c: any) => c.id === cycleA);
    check('6a. Periode A ditandai STALE setelah data berubah', rowA.isStale, true);

    // ── 7. Jejak upload & audit ───────────────────────────────────────────
    const audit = await api('GET', `/material-planning/cycles/${cycleA}/audit`);
    check('7a. Audit log periode A terisi', audit.json.data.length > 0, true);
    const sources = await api('GET', `/material-planning/cycles/${cycleA}/sources`);
    check('7b. Kelengkapan 5 sumber terbaca', sources.json.data.length, 5);
    const mrpSource = sources.json.data.find((s: any) => s.sourceType === 'MRP');
    check('7c. Jumlah baris MRP di periode A dibaca benar', mrpSource?.rowCount, mrpFixtureA.length);

    // ── 8. Siklus hidup hasil ─────────────────────────────────────────────
    const resultsA = await api('GET', `/material-planning/cycles/${cycleA}/results`);
    check('8a. Hanya ada SATU hasil current di periode A', resultsA.json.data.filter((r: any) => r.isCurrent).length, 1);
    check('8b. Hasil lama yang tidak disimpan ikut dibersihkan', resultsA.json.data.length, 1);

    // ── 9. NPOF tidak boleh terhapus bersama periode ──────────────────────
    const npofCount = await prisma.npofMaterial.count();
    check('9a. NPOF (sumber global) tidak berubah sedikit pun', npofCount, npofBefore);
  } finally {
    await cleanup();
    const leftovers = await prisma.planningCycle.count({ where: { uploadMonth: { in: ['2030-01', '2030-02'] } } });
    console.log(`\nPembersihan: periode uji tersisa = ${leftovers}`);
    check('10. Periode uji terhapus bersih', leftovers, 0);

    // Item uji hanya item yang kami buat sendiri; baris periode-nya sudah
    // terhapus lewat cascade sehingga tidak ada FK yang menahan.
    if (createdItemIds.length > 0) {
      await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
      console.log(`Item uji dihapus: ${createdItemIds.length}`);
    }
  }

  console.log('\n==================================================');
  console.log(failures === 0 ? 'SEMUA PEMERIKSAAN ISOLASI LULUS' : `${failures} PEMERIKSAAN GAGAL`);
  console.log('==================================================');
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
