import { PrismaClient } from '@prisma/client';

/**
 * TEST ISOLASI ANTAR MODUL (Production Planning vs Material Planning).
 *
 * Membuktikan perbaikan utama 2026-09-29: MRP 26 Weeks (weekly_schedules) dan
 * WIP (wips) yang DULU dipakai bersama sekarang TERPISAH lewat kolom
 * `moduleType` (PRODUCTION | MATERIAL).
 *
 * Yang diuji lewat HTTP API asli:
 *   1. Upload MRP/WIP ke modul PRODUCTION hanya membuat baris PRODUCTION.
 *   2. Part + minggu + lokasi yang SAMA boleh ada di kedua modul (kunci unik
 *      kini per modul, bukan per periode saja).
 *   3. Edit baris PRODUCTION tidak mengubah baris MATERIAL.
 *   4. Hapus baris PRODUCTION tidak mengubah baris MATERIAL.
 *   5. Upload TANPA `moduleType` ditolak (400), supaya tidak ada data yang
 *      "diam-diam" masuk ke modul yang salah.
 *   6. Endpoint pembacaan (list + summary) memfilter sesuai modul.
 *
 * Periode & item uji dibuat lalu DIHAPUS sendiri di akhir.
 */

const API = 'http://localhost:3001/api/v1';
const EMAIL = 'admin@pdits.com';
const PASSWORD = 'password123';

const TEST_UPLOAD_MONTH = '2031-02';
const TEST_PARTS = ['TESTMOD-P1', 'TESTMOD-P2'];
const TEST_LOCATION = 'TESTMOD-LOC';
/** Senin 5 Jan 2032 = awal minggu 1. Tetap, tidak bergantung waktu mesin. */
const WEEK1 = Date.UTC(2032, 0, 5);
const WEEK_COUNT = 3;
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

type Module = 'PRODUCTION' | 'MATERIAL';

function mrpFixture(qty: number) {
  const records: any[] = [];
  for (const itemCode of TEST_PARTS) {
    for (let w = 1; w <= WEEK_COUNT; w++) {
      records.push({
        year: 2032,
        weekNumber: w,
        weekStartDate: weekStart(w).toISOString().slice(0, 10),
        weekEndDate: weekEnd(w).toISOString().slice(0, 10),
        itemCode,
        description: `Uji modul ${itemCode}`,
        quantity: qty,
      });
    }
  }
  return records;
}

function wipFixture(qty: number) {
  return TEST_PARTS.map((partNumber) => ({
    partNumber,
    location: TEST_LOCATION,
    quantity: qty,
    date: weekStart(1).toISOString().slice(0, 10),
  }));
}

async function uploadMrp(periodId: string, moduleType: Module, qty: number) {
  return api('POST', '/weekly-schedule/bulk', {
    records: mrpFixture(qty),
    saveMode: 'overwrite',
    periodId,
    moduleType,
  });
}

async function uploadWip(periodId: string, moduleType: Module, qty: number) {
  return api('POST', '/wip/bulk', {
    records: wipFixture(qty),
    saveMode: 'overwrite',
    periodId,
    moduleType,
  });
}

/** (partNumber|weekNumber|quantity) terurut — untuk membandingkan himpunan baris. */
function mrpRows(rows: any[]): string[] {
  return rows
    .map((r) => `${r.item?.partNumber ?? r.itemCode ?? r.partNumber}|${r.weekNumber}|${r.quantity}`)
    .sort();
}
/** (partNumber|location|quantity) terurut. */
function wipRows(rows: any[]): string[] {
  return rows
    .map((w) => `${w.item?.partNumber ?? w.partNumber ?? w.itemCode}|${w.location}|${w.quantity}`)
    .sort();
}

async function fetchMrp(periodId: string, moduleType: Module) {
  const r = await api('GET', `/weekly-schedule?periodId=${periodId}&moduleType=${moduleType}`);
  return r.json?.data ?? [];
}
async function fetchWip(periodId: string, moduleType: Module) {
  const r = await api('GET', `/wip?periodId=${periodId}&moduleType=${moduleType}`);
  return r.json?.data ?? [];
}

async function main() {
  // ── Login ────────────────────────────────────────────────────────────────
  const login = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status !== 200 || !login.json?.accessToken) {
    console.error('Gagal login:', login.status, login.json);
    process.exitCode = 1;
    return;
  }
  token = login.json.accessToken;

  console.log(
    `\nUji isolasi modul: periode ${TEST_UPLOAD_MONTH}, ${TEST_PARTS.length} part x ${WEEK_COUNT} minggu\n`,
  );

  const createdCycleIds: string[] = [];
  /** PENTING: penjaga supaya deleteMany tidak pernah menghapus SELURUH tabel. */
  const safeDeleteCycles = async () => {
    for (const id of createdCycleIds) {
      if (typeof id !== 'string' || id.length === 0) continue;
      await api('DELETE', `/material-planning/cycles/${id}`);
    }
  };

  const npofBefore = await prisma.npofMaterial.count();
  const itemsBefore = await prisma.item.count({ where: { partNumber: { in: TEST_PARTS } } });

  try {
    // ── 0. Bersihkan sisa periode uji sebelumnya ──────────────────────────
    const stale = await prisma.planningCycle.findMany({ where: { uploadMonth: TEST_UPLOAD_MONTH } });
    for (const c of stale) createdCycleIds.push(c.id);
    await safeDeleteCycles();
    createdCycleIds.length = 0;

    // ── 1. Buat periode uji ───────────────────────────────────────────────
    const create = await api('POST', '/material-planning/cycles', {
      uploadMonth: TEST_UPLOAD_MONTH,
      notes: 'periode uji isolasi modul',
    });
    if (create.status !== 201) {
      console.error('Gagal membuat periode uji:', create.status, create.json);
      process.exitCode = 1;
      return;
    }
    const periodId: string = create.json.data.id;
    createdCycleIds.push(periodId);

    // ── 2. Upload MRP: PRODUCTION qty 100, MATERIAL qty 999 ───────────────
    const upProd = await uploadMrp(periodId, 'PRODUCTION', 100);
    const upMat = await uploadMrp(periodId, 'MATERIAL', 999);
    check('2a. Upload MRP PRODUCTION diterima', upProd.status, 200);
    check('2b. Upload MRP MATERIAL diterima', upMat.status, 200);

    const mrpProd = await fetchMrp(periodId, 'PRODUCTION');
    const mrpMat = await fetchMrp(periodId, 'MATERIAL');
    check('2c. Baris MRP PRODUCTION = fixture (qty 100)', mrpRows(mrpProd), mrpRows(mrpFixture(100)));
    check('2d. Baris MRP MATERIAL = fixture (qty 999)', mrpRows(mrpMat), mrpRows(mrpFixture(999)));
    check(
      '2e. Jumlah baris MRP PRODUCTION terpisah dari MATERIAL',
      [mrpProd.length, mrpMat.length],
      [TEST_PARTS.length * WEEK_COUNT, TEST_PARTS.length * WEEK_COUNT],
    );

    // ── 3. Part + minggu yang SAMA boleh ada di kedua modul (kunci per modul)
    const dbDup = await prisma.weeklySchedule.groupBy({
      by: ['moduleType'],
      where: { periodId },
      _count: { _all: true },
    });
    check(
      '3. Kunci unik berlaku per modul (kedua modul punya baris identik)',
      dbDup.map((d) => [d.moduleType, d._count._all]).sort(),
      [
        ['MATERIAL', TEST_PARTS.length * WEEK_COUNT],
        ['PRODUCTION', TEST_PARTS.length * WEEK_COUNT],
      ],
    );

    // ── 4. Upload WIP: PRODUCTION qty 10, MATERIAL qty 20 (lokasi SAMA) ───
    const wipProdUp = await uploadWip(periodId, 'PRODUCTION', 10);
    const wipMatUp = await uploadWip(periodId, 'MATERIAL', 20);
    check('4a. Upload WIP PRODUCTION diterima', wipProdUp.status, 200);
    check('4b. Upload WIP MATERIAL diterima', wipMatUp.status, 200);

    const wipProd = await fetchWip(periodId, 'PRODUCTION');
    const wipMat = await fetchWip(periodId, 'MATERIAL');
    check('4c. WIP PRODUCTION = fixture (qty 10)', wipRows(wipProd), wipRows(wipFixture(10)));
    check('4d. WIP MATERIAL = fixture (qty 20)', wipRows(wipMat), wipRows(wipFixture(20)));

    // ── 5. Edit baris PRODUCTION -> MATERIAL tidak boleh berubah ──────────
    const targetProd = mrpProd[0];
    const editRes = await api('PUT', `/weekly-schedule/${targetProd.id}`, { quantity: 55 });
    check('5a. Edit baris MRP PRODUCTION diterima', editRes.status, 200);

    const mrpProdAfter = await fetchMrp(periodId, 'PRODUCTION');
    const mrpMatAfter = await fetchMrp(periodId, 'MATERIAL');
    check('5b. Baris PRODUCTION berubah jadi 55', 
      mrpProdAfter.filter((r: any) => r.id === targetProd.id).map((r: any) => r.quantity), [55]);
    check('5c. MATERIAL TIDAK berubah setelah edit PRODUCTION', mrpRows(mrpMatAfter), mrpRows(mrpMat));

    // ── 6. Upload ulang MATERIAL -> PRODUCTION tidak boleh berubah ────────
    await uploadMrp(periodId, 'MATERIAL', 777);
    const mrpProdAfter2 = await fetchMrp(periodId, 'PRODUCTION');
    const mrpMatAfter2 = await fetchMrp(periodId, 'MATERIAL');
    check('6a. Upload ulang MATERIAL tidak mengubah PRODUCTION', mrpRows(mrpProdAfter2), mrpRows(mrpProdAfter));
    check('6b. MATERIAL terupdate jadi 777', mrpRows(mrpMatAfter2), mrpRows(mrpFixture(777)));

    // ── 7. Hapus baris PRODUCTION -> MATERIAL tidak boleh berubah ─────────
    const prodIds = mrpProdAfter2.map((r: any) => r.id);
    const delRes = await api('DELETE', '/weekly-schedule/bulk', { ids: prodIds });
    check('7a. Hapus baris MRP PRODUCTION diterima', delRes.status, 200);
    check('7b. MRP PRODUCTION sekarang kosong', (await fetchMrp(periodId, 'PRODUCTION')).length, 0);
    check('7c. MRP MATERIAL tetap utuh setelah PRODUCTION dihapus',
      mrpRows(await fetchMrp(periodId, 'MATERIAL')), mrpRows(mrpFixture(777)));

    // ── 8. Hapus WIP PRODUCTION -> WIP MATERIAL tidak boleh berubah ───────
    const wipProdIds = wipProd.map((w: any) => w.id);
    const delWip = await api('DELETE', '/wip/bulk', { ids: wipProdIds });
    check('8a. Hapus WIP PRODUCTION diterima', delWip.status, 200);
    check('8b. WIP PRODUCTION sekarang kosong', (await fetchWip(periodId, 'PRODUCTION')).length, 0);
    check('8c. WIP MATERIAL tetap utuh setelah PRODUCTION dihapus',
      wipRows(await fetchWip(periodId, 'MATERIAL')), wipRows(wipFixture(20)));

    // ── 9. Upload tanpa moduleType DITOLAK ───────────────────────────────
    const noModuleMrp = await api('POST', '/weekly-schedule/bulk', {
      records: mrpFixture(1),
      saveMode: 'overwrite',
      periodId,
    });
    const noModuleWip = await api('POST', '/wip/bulk', {
      records: wipFixture(1),
      saveMode: 'overwrite',
      periodId,
    });
    check('9a. Bulk MRP tanpa moduleType ditolak (400)', noModuleMrp.status, 400);
    check('9b. Bulk WIP tanpa moduleType ditolak (400)', noModuleWip.status, 400);
    check('9c. moduleType tidak valid ditolak (400)',
      (await api('POST', '/weekly-schedule/bulk', {
        records: mrpFixture(1),
        saveMode: 'overwrite',
        periodId,
        moduleType: 'SEMUA',
      })).status,
      400);

    // ── 10. Summary per modul ─────────────────────────────────────────────
    await uploadMrp(periodId, 'MATERIAL', 123);
    const sumProd = await api('GET', `/weekly-schedule/summary?periodId=${periodId}&moduleType=PRODUCTION`);
    const sumMat = await api('GET', `/weekly-schedule/summary?periodId=${periodId}&moduleType=MATERIAL`);
    check('10a. Summary PRODUCTION kosong', (sumProd.json?.data ?? []).length, 0);
    check('10b. Summary MATERIAL berisi part fixture', (sumMat.json?.data ?? []).length, TEST_PARTS.length);

    // ── 11. Hitungan per modul di /periods ────────────────────────────────
    const periods = await api('GET', '/material-planning/periods');
    const mine = (periods.json?.data ?? []).find((p: any) => p.id === periodId);
    check('11. /periods memberi moduleCounts terpisah', mine?.moduleCounts, {
      PRODUCTION: { MRP: 0, WIP: 0 },
      MATERIAL: { MRP: TEST_PARTS.length * WEEK_COUNT, WIP: TEST_PARTS.length },
    });

    // ── 12. NPOF (sumber global) tidak tersentuh ──────────────────────────
    check('12. npof_materials tidak berubah', await prisma.npofMaterial.count(), npofBefore);
  } finally {
    // ── Pembersihan ───────────────────────────────────────────────────────
    await safeDeleteCycles();

    const leftoverCycles = await prisma.planningCycle.count({
      where: { uploadMonth: TEST_UPLOAD_MONTH },
    });
    // Item uji hanya dihapus kalau memang dibuat oleh tes ini.
    if (itemsBefore === 0) {
      await prisma.item.deleteMany({ where: { partNumber: { in: TEST_PARTS } } });
    }
    const leftoverItems = await prisma.item.count({ where: { partNumber: { in: TEST_PARTS } } });
    check('13a. Periode uji terhapus', leftoverCycles, 0);
    check('13b. Tidak ada item uji tersisa (kalau tes membuatnya)', leftoverItems, itemsBefore);
  }

  console.log(
    `\n${failures === 0 ? '✅ SEMUA PEMERIKSAAN LULUS' : `❌ ${failures} PEMERIKSAAN GAGAL`}\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
