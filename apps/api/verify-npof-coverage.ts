import { PrismaClient } from '@prisma/client';

/**
 * TEST "PART MRP TANPA / KURANG DATA NPOF" (endpoint npof-coverage).
 *
 * Membuktikan:
 *  - part yang tidak punya baris NPOF diklasifikasi MISSING (semua field kurang)
 *  - part yang punya baris NPOF tapi kolomnya kosong diklasifikasi INCOMPLETE
 *    dengan daftar field yang benar
 *  - part dengan data NPOF lengkap TIDAK muncul di daftar
 *  - jumlah minggu yang punya demand dihitung benar
 *  - periode tanpa data MRP tidak menimbulkan error
 *
 * Semua fixture SINTETIS dan 100% dibersihkan di akhir (termasuk baris NPOF
 * sementara yang dibuat khusus untuk tes ini — NPOF adalah sumber GLOBAL).
 */

const API = 'http://localhost:3001/api/v1';
const EMAIL = 'admin@pdits.com';
const PASSWORD = 'password123';

const PART_COMPLETE = 'TESTNP-COMPLETE';
const PART_PARTIAL = 'TESTNP-PARTIAL';
const PART_MISSING = 'TESTNP-NONPOF';
const TEST_PARTS = [PART_COMPLETE, PART_PARTIAL, PART_MISSING];
const TEST_NPOF_IDS = [999001, 999002];
const TEST_MONTH = '2030-03';
const TEST_MONTH_EMPTY = '2030-04';

/** Senin 7 Jan 2030 = awal minggu 1. Tetap, tidak bergantung waktu mesin. */
const WEEK1 = Date.UTC(2030, 0, 7);
const WEEK_COUNT = 2;
const MS_DAY = 24 * 60 * 60 * 1000;

function weekStart(w: number): Date {
  return new Date(WEEK1 + (w - 1) * 7 * MS_DAY);
}
function weekEnd(w: number): Date {
  return new Date(WEEK1 + (w - 1) * 7 * MS_DAY + 6 * MS_DAY);
}

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

async function main() {
  console.log('==================================================');
  console.log('TEST CAKUPAN NPOF (part MRP tanpa / kurang NPOF)');
  console.log('==================================================\n');

  const login = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status !== 200 || !login.json?.accessToken) {
    console.error('Gagal login:', login.status, login.json);
    process.exitCode = 1;
    return;
  }
  token = login.json.accessToken;
  console.log('Login berhasil.\n');

  // ── Penjaga: fixture TIDAK boleh bertabrakan dengan data nyata ──────────
  const existingNpof = await prisma.npofMaterial.count({
    where: { OR: [{ partNumber: { in: TEST_PARTS } }, { npofId: { in: TEST_NPOF_IDS } }] },
  });
  if (existingNpof > 0) {
    console.error('Fixture bentrok dengan data NPOF yang sudah ada. Batalkan.');
    process.exitCode = 1;
    return;
  }
  const existingItems = await prisma.item.findMany({ where: { partNumber: { in: TEST_PARTS } } });
  if (existingItems.length > 0) {
    console.error('Item uji sudah ada di database. Batalkan.');
    process.exitCode = 1;
    return;
  }

  const createdItemIds: string[] = [];
  const createdNpofIds: string[] = [];
  const createdCycleIds: string[] = [];

  const cleanup = async () => {
    for (const id of createdCycleIds) await api('DELETE', `/material-planning/cycles/${id}`);
    if (createdNpofIds.length > 0) {
      await prisma.npofMaterial.deleteMany({ where: { id: { in: createdNpofIds } } });
    }
    if (createdItemIds.length > 0) {
      await prisma.item.deleteMany({ where: { id: { in: createdItemIds } } });
    }
  };

  try {
    // ── 1. Fixture item ───────────────────────────────────────────────────
    for (const code of TEST_PARTS) {
      const created = await prisma.item.create({
        data: { partNumber: code, itemName: `Part uji cakupan NPOF ${code}`, unit: 'PCS' },
      });
      createdItemIds.push(created.id);
    }

    // ── 2. Fixture NPOF ───────────────────────────────────────────────────
    // Lengkap: semua kolom terisi.
    const npofComplete = await prisma.npofMaterial.create({
      data: {
        npofId: TEST_NPOF_IDS[0],
        partNumber: PART_COMPLETE,
        productName: 'NPOF - part lengkap',
        material: 'Paper',
        gramatur: '300',
        supplier: 'MEGA PAPER',
        sheetedSize: '60 x 90 CM',
        formulaMaterial: '0.25',
        ups: '3',
      },
    });
    createdNpofIds.push(npofComplete.id);

    // Tidak lengkap: gramatur '-' dan formula kosong (ups ada).
    const npofPartial = await prisma.npofMaterial.create({
      data: {
        npofId: TEST_NPOF_IDS[1],
        partNumber: PART_PARTIAL,
        productName: 'NPOF - part kurang',
        material: 'Paper',
        gramatur: '-',
        supplier: 'MEGA PAPER',
        sheetedSize: '60 x 90 CM',
        formulaMaterial: null,
        ups: '2',
      },
    });
    createdNpofIds.push(npofPartial.id);
    // PART_MISSING sengaja TIDAK dibuat barisnya.

    // ── 3. Periode + MRP sintetis ─────────────────────────────────────────
    const create = await api('POST', '/material-planning/cycles', {
      uploadMonth: TEST_MONTH,
      notes: 'periode uji cakupan NPOF',
    });
    if (create.status !== 201) {
      console.error('Gagal membuat periode uji:', create.status, create.json);
      process.exitCode = 1;
      return;
    }
    const cycleId = create.json.data.id;
    createdCycleIds.push(cycleId);

    const mrpRecords: unknown[] = [];
    for (const code of TEST_PARTS) {
      for (let w = 1; w <= WEEK_COUNT; w += 1) {
        mrpRecords.push({
          itemCode: code,
          description: `Part uji cakupan NPOF ${code}`,
          year: 2030,
          weekNumber: w,
          weekStartDate: weekStart(w),
          weekEndDate: weekEnd(w),
          quantity: 100 * w,
        });
      }
    }
    const upload = await api('POST', '/weekly-schedule/bulk', {
      records: mrpRecords,
      saveMode: 'overwrite',
      periodId: cycleId,
      moduleType: 'MATERIAL',
    });
    if (upload.status !== 200) {
      console.error('Gagal upload MRP:', upload.status, upload.json);
      process.exitCode = 1;
      return;
    }

    // ── 4. Endpoint cakupan NPOF ──────────────────────────────────────────
    const cov = await api('GET', `/material-planning/cycles/${cycleId}/npof-coverage`);
    check('1a. Endpoint menjawab 200', cov.status, 200);

    const summary = cov.json?.data?.summary ?? {};
    const rows: any[] = cov.json?.data?.rows ?? [];

    check('1b. Part di MRP periode ini = 3', summary.mrpPartCount, 3);
    check('1c. Tidak ada di NPOF = 1', summary.missingNpofCount, 1);
    check('1d. Ada di NPOF tapi data kurang = 1', summary.incompleteNpofCount, 1);
    check('1e. Data NPOF lengkap = 1', summary.completeNpofCount, 1);
    check('1f. Hanya part bermasalah yang dikirim (2 baris)', rows.length, 2);

    const rowMissing = rows.find((r) => r.partNumber === PART_MISSING);
    const rowPartial = rows.find((r) => r.partNumber === PART_PARTIAL);

    check('2a. Part tanpa NPOF berstatus MISSING', rowMissing?.status, 'MISSING');
    check('2b. Part tanpa NPOF dianggap kritikal (estimasi)', rowMissing?.critical, true);
    check(
      '2c. Semua field NPOF ditandai kurang',
      rowMissing?.missingFields,
      ['gramatur', 'ukuran', 'formula', 'ups', 'material', 'supplier'],
    );
    check('2d. Jumlah minggu demand dihitung (2 minggu)', rowMissing?.demandWeekCount, 2);
    check('2e. Part tanpa NPOF tidak punya npofId', rowMissing?.npofId, null);

    check('3a. Part NPOF kurang berstatus INCOMPLETE', rowPartial?.status, 'INCOMPLETE');
    check('3b. Field kurang hanya gramatur + formula', rowPartial?.missingFields, ['gramatur', 'formula']);
    check('3c. Part NPOF kurang tetap kritikal (formula kosong)', rowPartial?.critical, true);
    check('3d. Jenis material ikut dilaporkan', rowPartial?.materialType, 'Paper');
    check('3e. Supplier ikut dilaporkan', rowPartial?.supplier, 'MEGA PAPER');
    check('3f. npofId asli dilaporkan', rowPartial?.npofId, TEST_NPOF_IDS[1]);

    check(
      '4a. Part dengan data NPOF lengkap TIDAK muncul',
      rows.some((r) => r.partNumber === PART_COMPLETE),
      false,
    );

    // ── 5. Periode tanpa data MRP ─────────────────────────────────────────
    const createEmpty = await api('POST', '/material-planning/cycles', {
      uploadMonth: TEST_MONTH_EMPTY,
      notes: 'periode uji cakupan NPOF (kosong)',
    });
    if (createEmpty.status !== 201) {
      console.error('Gagal membuat periode kosong:', createEmpty.status, createEmpty.json);
      process.exitCode = 1;
      return;
    }
    createdCycleIds.push(createEmpty.json.data.id);
    const covEmpty = await api('GET', `/material-planning/cycles/${createEmpty.json.data.id}/npof-coverage`);
    check('5a. Periode tanpa MRP tetap menjawab 200', covEmpty.status, 200);
    check('5b. Periode tanpa MRP: 0 part', covEmpty.json?.data?.summary?.mrpPartCount, 0);
    check('5c. Periode tanpa MRP: daftar kosong', covEmpty.json?.data?.rows?.length, 0);

    // ── 6. Periode tidak dikenal ──────────────────────────────────────────
    const cov404 = await api('GET', '/material-planning/cycles/tidak-ada/npof-coverage');
    check('6a. Periode tidak dikenal -> 404', cov404.status, 404);
  } finally {
    await cleanup();
    const leftoverCycles = await prisma.planningCycle.count({
      where: { uploadMonth: { in: [TEST_MONTH, TEST_MONTH_EMPTY] } },
    });
    const leftoverNpof = await prisma.npofMaterial.count({ where: { npofId: { in: TEST_NPOF_IDS } } });
    const leftoverItems = await prisma.item.count({ where: { partNumber: { in: TEST_PARTS } } });
    console.log(
      `\nPembersihan: periode=${leftoverCycles} npof=${leftoverNpof} item=${leftoverItems}`,
    );
    check('7a. Periode uji terhapus bersih', leftoverCycles, 0);
    check('7b. Baris NPOF uji terhapus bersih', leftoverNpof, 0);
    check('7c. Item uji terhapus bersih', leftoverItems, 0);
  }

  console.log('\n==================================================');
  console.log(failures === 0 ? 'SEMUA PEMERIKSAAN CAKUPAN NPOF LULUS' : `${failures} PEMERIKSAAN GAGAL`);
  console.log('==================================================');
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('ERROR:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
