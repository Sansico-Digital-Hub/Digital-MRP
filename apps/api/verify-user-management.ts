import { PrismaClient } from '@prisma/client';

/**
 * TEST MANAJEMEN USER (role planner + hapus user).
 *
 * Menguji dua bug 500 yang pernah terjadi di `routes/users.ts`:
 *
 * 1. POST /users dengan role yang TIDAK dikenal enum `UserRole` (mis. dari
 *    frontend lama, atau peran yang belum ditambahkan) dulu meledak jadi
 *    HTTP 500 `PrismaClientValidationError: Invalid value for argument 'role'`.
 *    Sekarang harus dijawab **400** dengan daftar role yang tersedia.
 *    Ini juga penjaga agar enum Prisma Client tidak pernah ketinggalan dari
 *    schema (Prisma Client yang basi = semua role baru ditolak).
 *
 * 2. DELETE /users/:id untuk user yang sudah punya RIWAYAT (audit log, WIP,
 *    stok FG, hasil perhitungan) dulu meledak jadi HTTP 500
 *    `P2003 Foreign key constraint violated: userId`. Sekarang harus dijawab
 *    **409** + saran menonaktifkan user, supaya jejak audit tetap utuh.
 *
 * User uji dibuat lalu DIHAPUS sendiri di akhir (aman dijalankan di DB nyata).
 */

const API = 'http://localhost:3001/api/v1';
const p = new PrismaClient({ datasourceUrl: 'mysql://root:@localhost:3306/planner_project' });

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

const stamp = Date.now();
const emailA = `del.a.${stamp}@example.invalid`;
const emailB = `del.b.${stamp}@example.invalid`;
const emailRole = `role.${stamp}@example.invalid`;

async function main() {
  const login = await api('POST', '/auth/login', { email: 'admin@pdits.com', password: 'password123' });
  if (login.status !== 200 || !login.json?.accessToken) {
    console.error('Gagal login:', login.status, login.json);
    process.exitCode = 1;
    return;
  }
  token = login.json.accessToken;

  console.log('\n── Role planner ──');
  for (const role of ['PRODUCTION_PLANNER', 'MATERIAL_PLANNER'] as const) {
    const created = await api('POST', '/users', {
      name: `Uji ${role}`,
      email: `role.${role}.${stamp}@example.invalid`,
      password: 'password123',
      role,
    });
    check(`role ${role} diterima`, [created.status, created.json?.data?.role], [201, role]);
  }

  const badRole = await api('POST', '/users', {
    name: 'Bad Role',
    email: emailRole,
    password: 'password123',
    role: 'SUPERVISOR',
  });
  check('role tak dikenal ditolak 400 (dulu 500)', badRole.status, 400);
  check(
    'pesan menyebut daftar role yang tersedia',
    typeof badRole.json?.message === 'string' && badRole.json.message.includes('PRODUCTION_PLANNER'),
    true,
  );

  console.log('\n── Hapus user ──');
  // Tanpa riwayat -> terhapus.
  const a = await api('POST', '/users', { name: 'Del A', email: emailA, password: 'password123', role: 'USER' });
  const delA = await api('DELETE', `/users/${a.json.data.id}`);
  check('user tanpa riwayat terhapus (200)', delA.status, 200);

  // Punya riwayat -> 409 dengan pesan yang bisa ditindaklanjuti.
  const b = await api('POST', '/users', { name: 'Del B', email: emailB, password: 'password123', role: 'USER' });
  const idB = b.json.data.id;
  await p.auditLog.create({
    data: { userId: idB, action: 'CREATE', entityType: 'Test', entityId: 'x', notes: 'riwayat uji hapus user' },
  });
  const delB = await api('DELETE', `/users/${idB}`);
  check('user dengan riwayat ditolak 409 (dulu 500)', delB.status, 409);
  check(
    'pesan menyebut penyebab + saran nonaktifkan',
    typeof delB.json?.message === 'string' && delB.json.message.includes('Nonaktifkan'),
    true,
  );

  // Hapus akun sendiri -> 409.
  const me = (await api('GET', '/users')).json.data.find((u: any) => u.email === 'admin@pdits.com');
  const delMe = await api('DELETE', `/users/${me.id}`);
  check('hapus akun sendiri ditolak 409', delMe.status, 409);

  // ── Pembersihan ───────────────────────────────────────────────────────────
  await p.auditLog.deleteMany({ where: { userId: idB } });
  const testEmails = [
    emailA,
    emailB,
    emailRole,
    `role.PRODUCTION_PLANNER.${stamp}@example.invalid`,
    `role.MATERIAL_PLANNER.${stamp}@example.invalid`,
  ];
  const leftovers = await p.user.findMany({ where: { email: { in: testEmails } } });
  for (const u of leftovers) {
    await p.auditLog.deleteMany({ where: { userId: u.id } });
    await p.cycleAuditLog.deleteMany({ where: { userId: u.id } });
    await p.notification.deleteMany({ where: { userId: u.id } });
    await p.user.delete({ where: { id: u.id } });
  }
  check('tidak ada user uji tersisa', await p.user.count({ where: { email: { in: testEmails } } }), 0);

  console.log(`\n${failures === 0 ? '✅ SEMUA PEMERIKSAAN LULUS' : `❌ ${failures} PEMERIKSAAN GAGAL`}\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
