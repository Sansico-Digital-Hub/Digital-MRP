import Fastify from 'fastify';
import prisma from './src/lib/prisma';
import printingRoutes from './src/routes/printing';
import { generateAccessToken } from './src/lib/jwt';
import { planCalendar } from './src/lib/printing';
import { buildLayout, planMachines, schedule } from '@pdits/shared';

/**
 * TEST MODUL PRINTING (KBA) — tahap 1: mesin cetak & kalender produksi.
 *
 * Menguji lewat `fastify.inject` (tidak perlu server jalan):
 *  - hak akses: tanpa token 401, role USER hanya lihat (403 saat ubah),
 *    PRODUCTION_PLANNER boleh ubah
 *  - validasi input + optimistic locking (`version` basi → 409)
 *  - hari libur unik per tanggal, maintenance maks 31 hari
 *  - jam dinding WIB tidak bergeser: maintenance 14:00 disimpan & dibaca 14:00,
 *    lalu engine `@pdits/shared` menjadwalkan job SETELAH maintenance itu
 *  - setiap perubahan tercatat di `audit_logs`
 *
 * Skrip ini MENGUBAH kalender & kapasitas mesin, jadi hanya mau jalan di
 * database uji (nama database mengandung "test"), mis.:
 *   DATABASE_URL=mysql://root:@localhost:3306/pdits_test_printing \
 *   DISABLE_REDIS=true pnpm --filter @pdits/api verify:printing
 * Siapkan database uji dulu dengan `prisma migrate deploy`.
 */

const dbName = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? '')?.[1] ?? '';
if (!/test/i.test(dbName)) {
  console.error(`Batal: "${dbName || '(DATABASE_URL kosong)'}" bukan database uji. Pakai database yang namanya mengandung "test".`);
  process.exit(1);
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'OK   ' : 'GAGAL'} | ${label} -> ${JSON.stringify(actual)}${ok ? '' : `  (harusnya ${JSON.stringify(expected)})`}`,
  );
}

const app = Fastify();
const stamp = Date.now();

async function main() {
  await app.register(printingRoutes);
  await app.ready();

  const planner = await prisma.user.create({
    data: { email: `printing.planner.${stamp}@example.invalid`, password: '-', name: 'Printing Planner', role: 'PRODUCTION_PLANNER' },
  });
  const viewer = await prisma.user.create({
    data: { email: `printing.viewer.${stamp}@example.invalid`, password: '-', name: 'Printing Viewer', role: 'USER' },
  });
  const tokens = {
    planner: generateAccessToken(planner.id, planner.role),
    viewer: generateAccessToken(viewer.id, viewer.role),
  };
  const call = async (who: keyof typeof tokens | null, method: string, url: string, payload?: unknown) => {
    const res = await app.inject({
      method: method as any,
      url,
      headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
      ...(payload === undefined ? {} : { payload: payload as any }),
    });
    return { status: res.statusCode, json: res.json() as any };
  };

  const machinesBefore = await prisma.printingMachine.findMany();
  const shiftsBefore = await prisma.printingShift.findMany({ orderBy: { sortOrder: 'asc' } });

  try {
    // ---------- Hak akses ----------
    check('tanpa token → 401', (await call(null, 'GET', '/api/v1/printing/machines')).status, 401);
    const list = await call('viewer', 'GET', '/api/v1/printing/machines');
    check('USER boleh lihat mesin', list.status, 200);
    check('urutan mesin', list.json.data.map((m: any) => m.id), ['kba1', 'kba2', 'kba3', 'kba4', 'genius']);
    check('spesifikasi KBA 1 dari engine', list.json.data[0].spec, '4 colours · 51×38 – 85×72 cm · no special ink');
    const kba1 = list.json.data[0];
    check(
      'USER tidak boleh ubah kapasitas → 403',
      (await call('viewer', 'PUT', '/api/v1/printing/machines/kba1', { ...kba1, speed: 9 })).status,
      403,
    );

    // ---------- Kapasitas mesin ----------
    const put = (body: object) => call('planner', 'PUT', '/api/v1/printing/machines/kba1', body);
    const saved = await put({ speed: 5, setupHours: 1, effectiveHours: 22.5, version: kba1.version });
    check('planner ubah kapasitas KBA 1', [saved.status, saved.json.data.speed, saved.json.data.version], [200, 5, kba1.version + 1]);
    check('updatedBy berisi nama user', saved.json.data.updatedBy, 'Printing Planner');
    check('versi basi → 409', (await put({ speed: 6, setupHours: 1, effectiveHours: 22.5, version: kba1.version })).status, 409);
    check('jam efektif > 24 → 400', (await put({ speed: 6, setupHours: 1, effectiveHours: 25, version: kba1.version + 1 })).status, 400);
    check('mesin tidak dikenal → 404', (await call('planner', 'PUT', '/api/v1/printing/machines/kba9', { speed: 1, setupHours: 1, effectiveHours: 20, version: 1 })).status, 404);

    // ---------- Shift ----------
    const cal = await call('viewer', 'GET', '/api/v1/printing/calendar');
    check('3 shift bawaan', cal.json.data.shifts.map((s: any) => `${s.breakStart}-${s.breakEnd}`), ['12:00-12:30', '18:30-19:00', '03:00-03:30']);
    const v = cal.json.data.shiftsVersion;
    const shifts = cal.json.data.shifts.map((s: any) => ({ ...s }));
    shifts[0].breakEnd = '12:45';
    const putShifts = (body: object) => call('planner', 'PUT', '/api/v1/printing/calendar/shifts', body);
    const s1 = await putShifts({ version: v, shifts });
    check('simpan shift', [s1.status, s1.json.data.shiftsVersion, s1.json.data.shifts[0].breakEnd], [200, v + 1, '12:45']);
    check('shift versi basi → 409', (await putShifts({ version: v, shifts })).status, 409);
    check('jam shift salah → 400', (await putShifts({ version: v + 1, shifts: [{ ...shifts[0], start: '7:00' }] })).status, 400);
    check('istirahat > 3 jam → 400', (await putShifts({ version: v + 1, shifts: [{ ...shifts[0], breakStart: '08:00', breakEnd: '12:00' }] })).status, 400);
    check('0 shift → 400', (await putShifts({ version: v + 1, shifts: [] })).status, 400);

    // ---------- Hari libur ----------
    const addHoliday = (body: object) => call('planner', 'POST', '/api/v1/printing/calendar/holidays', body);
    const h1 = await addHoliday({ date: '2099-12-25', name: 'Natal' });
    const holiday = h1.json.data?.holidays?.find((h: any) => h.date === '2099-12-25');
    check('tambah hari libur', [h1.status, holiday?.name, holiday?.createdBy], [201, 'Natal', 'Printing Planner']);
    check('tanggal sama dua kali → 409', (await addHoliday({ date: '2099-12-25', name: 'Natal lagi' })).status, 409);
    check('tanggal tidak ada (30 Feb) → 400', (await addHoliday({ date: '2026-02-30', name: 'X' })).status, 400);
    check('nama kosong → 400', (await addHoliday({ date: '2099-12-26', name: ' ' })).status, 400);
    check('USER tidak boleh tambah libur → 403', (await call('viewer', 'POST', '/api/v1/printing/calendar/holidays', { date: '2099-12-31', name: 'X' })).status, 403);

    // ---------- Maintenance ----------
    const addMaint = (body: object) => call('planner', 'POST', '/api/v1/printing/maintenance', body);
    const m1 = await addMaint({ machineId: 'kba1', start: '2026-10-05T14:00', end: '2026-10-05T16:00', reason: 'Roller' });
    const maint = m1.json.data?.maintenance?.find((m: any) => m.reason === 'Roller');
    check('tambah maintenance, jam WIB tidak bergeser', [m1.status, maint?.start, maint?.end], [201, '2026-10-05T14:00', '2026-10-05T16:00']);
    check('selesai sebelum mulai → 400', (await addMaint({ machineId: 'kba1', start: '2026-10-05T16:00', end: '2026-10-05T14:00', reason: 'X' })).status, 400);
    check('lebih dari 31 hari → 400', (await addMaint({ machineId: 'kba1', start: '2026-10-01T07:00', end: '2026-11-05T07:00', reason: 'X' })).status, 400);
    check('mesin tidak dikenal → 400', (await addMaint({ machineId: 'kba9', start: '2026-10-05T14:00', end: '2026-10-05T16:00', reason: 'X' })).status, 400);
    check('waktu bukan jam dinding → 400', (await addMaint({ machineId: 'kba1', start: '2026-10-05 14:00', end: '2026-10-05T16:00', reason: 'X' })).status, 400);

    // ---------- Kalender DB → engine ----------
    // 10 ÷ 4 + 1 jam setup = 3.5 jam mulai 13:00 akan menabrak maintenance 14:00 → mulai 16:00.
    const calendar = await planCalendar({ sunday: false, holidays: false });
    check('kalender plan: hari libur ikut', calendar.holidays.map((h) => h.date).includes('2099-12-25'), true);
    const layout = buildLayout({ layout: 'HLW03-JA11', up: 1, size: '69 x 67', colour: 'CMYK' })!;
    const job = schedule(
      [{ id: 'a', code: 'HLW03-JA11', customer: 'MJD', shortage: 10, due: null }],
      [layout],
      { a: { include: true, layout: 'HLW03-JA11', machine: 'kba1', qty: 10, priority: 1 } },
      {},
      '2026-10-05T13:00',
      planMachines({}, calendar),
    ).kba1[0];
    check('engine menggeser job ke setelah maintenance', [job.start, job.end], ['2026-10-05T16:00', '2026-10-05T20:00']);

    const upd = (body: object) => call('planner', 'PUT', `/api/v1/printing/maintenance/${maint.id}`, body);
    const m2 = await upd({ machineId: 'kba1', start: '2026-10-05T14:00', end: '2026-10-05T17:00', reason: 'Roller', version: maint.version });
    const maint2 = m2.json.data?.maintenance?.find((m: any) => m.id === maint.id);
    check('ubah maintenance', [m2.status, maint2?.end, maint2?.version], [200, '2026-10-05T17:00', maint.version + 1]);
    check('maintenance versi basi → 409', (await upd({ machineId: 'kba1', start: '2026-10-05T14:00', end: '2026-10-05T18:00', reason: 'Roller', version: maint.version })).status, 409);
    check('hapus maintenance versi basi → 409', (await call('planner', 'DELETE', `/api/v1/printing/maintenance/${maint.id}?version=${maint.version}`)).status, 409);
    check('hapus maintenance', (await call('planner', 'DELETE', `/api/v1/printing/maintenance/${maint.id}?version=${maint.version + 1}`)).status, 200);
    check('hapus hari libur', (await call('planner', 'DELETE', `/api/v1/printing/calendar/holidays/${holiday.id}`)).status, 200);
    check('hari libur sudah hilang → 404', (await call('planner', 'DELETE', `/api/v1/printing/calendar/holidays/${holiday.id}`)).status, 404);

    // ---------- Audit ----------
    const audit = await prisma.auditLog.groupBy({
      by: ['entityType', 'action'],
      where: { userId: planner.id },
      _count: { _all: true },
    });
    check(
      'jejak audit per perubahan',
      audit.map((a) => `${a.entityType}:${a.action}:${a._count._all}`).sort(),
      [
        'PrintingHoliday:CREATE:1',
        'PrintingHoliday:DELETE:1',
        'PrintingMachine:UPDATE:1',
        'PrintingMaintenance:CREATE:1',
        'PrintingMaintenance:DELETE:1',
        'PrintingMaintenance:UPDATE:1',
        'PrintingShift:UPDATE:1',
      ],
    );
  } finally {
    // Kembalikan kondisi awal, lalu hapus user & jejak uji.
    for (const m of machinesBefore) {
      await prisma.printingMachine.update({
        where: { id: m.id },
        data: { speed: m.speed, setupHours: m.setupHours, effectiveHours: m.effectiveHours, version: m.version, updatedBy: m.updatedBy },
      });
    }
    await prisma.printingShift.deleteMany({});
    await prisma.printingShift.createMany({ data: shiftsBefore });
    await prisma.printingMaintenance.deleteMany({ where: { createdBy: planner.id } });
    await prisma.printingHoliday.deleteMany({ where: { createdBy: planner.id } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [planner.id, viewer.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [planner.id, viewer.id] } } });
  }

  console.log(failures ? `\n${failures} pemeriksaan GAGAL` : '\nSemua pemeriksaan OK');
}

main()
  .catch((error) => {
    failures++;
    console.error(error);
  })
  .finally(async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(failures ? 1 : 0);
  });
