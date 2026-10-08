import * as xlsx from 'xlsx';
import { PrismaClient } from '@prisma/client';

/**
 * VERIFIKASI KOLOM REFERENSI "REF-B" + FILTER "MTL".
 *
 * Fokus: file **Stock Raw Material** (sheet `StockOnhandByLot`, kolom
 * `Ref_B_PO`). File Outstanding PO (`PR Ref-B`) sudah diuji di
 * `verify-po-number.ts`.
 *
 * Yang diuji lewat HTTP API asli:
 *   1. Kolom `Ref_B_PO` dibaca berdasarkan NAMA HEADER (bukan posisi), toleran
 *      huruf besar/kecil dan spasi di awal/akhir.
 *   1b. Nama SHEET tidak di-hardcode: sheet data stok dicari otomatis di seluruh
 *      sheet (nama sheet ekspor ERP bisa berubah antar file).
 *   2. Hanya baris yang nilainya mengandung "MTL" (contains, tidak
 *      case-sensitive) yang masuk. Kosong/null dilewati.
 *   3. Ringkasan: total baris di file / masuk / dilewati.
 *   4. Kolom `Ref_B_PO` hilang -> HTTP 400 (proses dihentikan, bukan impor
 *      tanpa filter).
 *   5. Nilai `refB` ikut tersimpan lewat /stock-raw-material/import, dan
 *      import menolak baris tanpa "MTL".
 *
 * Periode uji dibuat sintetis lalu DIHAPUS lagi di akhir.
 */

const API = 'http://localhost:3001/api/v1';
const EMAIL = 'admin@pdits.com';
const PASSWORD = 'password123';

/** Bulan upload khusus uji; diberi nama jelas supaya tidak tertukar data produksi. */
const TEST_MONTH = '2030-08';

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

/** Nama sheet ASLI dari ekspor ERP (tetap dipakai sebagai kasus utama). */
const STOCK_SHEET = 'StockOnhandByLot';

function toBuffer(rows: unknown[][], sheetName: string = STOCK_SHEET): Buffer {
  const sheet = xlsx.utils.aoa_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, sheet, sheetName);
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Workbook dengan sheet "sampah" di depan -> sheet stok harus tetap ditemukan. */
function multiSheetWorkbook(): Buffer {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([['Parameter'], ['Company ID', 180]]), 'Parameter');
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(stockHeader()), 'Data Stok 2026');
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([['P', 'HANCHANG']]), 'BP');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function uploadExcel(buffer: Buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), 'stock-test.xlsx');
  const res = await fetch(`${API}/stock-raw-material/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Header normal + 6 baris campuran (3 mengandung MTL, 3 tidak). */
function stockHeader(refLabel = 'Ref_B_PO'): unknown[][] {
  return [
    ['Nama Item', 'Trx Date', 'Lot No', 'Digit1_Lot', 'Unit', refLabel, 'Total'],
    // Item Desc & Trx Date hanya di baris pertama grup (pivot fill-down).
    // `Digit1_Lot` = KODE SUPPLIER 1 huruf (X -> XSD), bukan nomor lot.
    ['DUPLEX 300GSM/ 60CM', 46000, 'X073050021BC23005429', 'X', 'kg', 'MTL/JUL 26/RP11.000', 1000], // MASUK
    ['', '', 'X062060003BC23005429', 'X', 'sht', 'mtl-002', 500], // MASUK (huruf kecil)
    ['', '', 'X132050006BC23005847', 'X', 'kg', '  PT MTL  ', 300], // MASUK (contains + spasi)
    ['DUPLEX 400GSM/ 70CM', 46001, 'X132050010BC23005847', 'M', 'kg', 'C08/2MPL', 700], // DILEWATI
    ['', '', 'X132050011BC23005847', 'M', 'kg', '', 900], // DILEWATI (kosong)
    ['', '', 'X012050002BC23008543', 'M', 'rim', 'C08/REF PO#91-92', 50], // DILEWATI
  ];
}

/** Fixture TANPA kolom Ref_B_PO -> upload harus 400. */
function missingRefWorkbook(): Buffer {
  return toBuffer([
    ['Nama Item', 'Trx Date', 'Lot No', 'Digit1_Lot', 'Unit', 'Total'],
    ['DUPLEX 300GSM/ 60CM', 46000, 'X073050021BC23005429', 'X', 'kg', 1000],
  ]);
}

async function main() {
  console.log('==================================================');
  console.log('VERIFIKASI KOLOM "REF-B" + FILTER "MTL" — STOCK RM');
  console.log('==================================================\n');

  const login = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status !== 200 || !login.json?.accessToken) {
    console.error('Gagal login:', login.status, login.json);
    process.exitCode = 1;
    return;
  }
  token = login.json.accessToken;

  // Bersihkan sisa periode uji dari run sebelumnya (aman kalau belum ada).
  const stale = await prisma.planningCycle.findUnique({ where: { uploadMonth: TEST_MONTH } });
  if (stale && stale.id) {
    await prisma.stockRawMaterial.deleteMany({ where: { periodId: stale.id } });
    await prisma.planningCycle.delete({ where: { id: stale.id } });
  }

  const created = await api('POST', '/material-planning/cycles', {
    uploadMonth: TEST_MONTH,
    notes: 'periode uji refB stock',
  });
  if (created.status !== 201) {
    console.error('Gagal membuat periode uji:', created.status, created.json);
    process.exitCode = 1;
    return;
  }
  const periodId: string = created.json.data.id;

  try {
    // ────────────────────────────────────────────────────────────────
    console.log('--- A. BACA KOLOM Ref_B_PO + FILTER "MTL" ---');
    const a = await uploadExcel(toBuffer(stockHeader()));
    const rowsA: any[] = a.json?.data ?? [];
    check('upload sukses (200)', a.status, 200);
    check('hanya 3 baris mengandung MTL yang masuk', rowsA.length, 3);
    check('semua baris masuk mengandung "MTL"', rowsA.every((r) => /mtl/i.test(String(r.refB || ''))), true);
    check('ringkasan: total baris di file = 6', a.json?.summary?.totalRows, 6);
    check('ringkasan: masuk (MTL) = 3', a.json?.summary?.included, 3);
    check('ringkasan: dilewati (tanpa MTL) = 3', a.json?.summary?.skippedNoMtl, 3);
    check('refB huruf kecil ikut masuk', rowsA[1]?.refB, 'mtl-002');
    check('refB "  PT MTL  " di-trim', rowsA[2]?.refB, 'PT MTL');
    check('baris "C08/2MPL" TIDAK masuk', rowsA.some((r) => String(r.refB || '').includes('C08')), false);
    check('baris ref kosong TIDAK masuk (unit rim juga tidak ikut)', rowsA.some((r) => r.qty === 900 || r.qty === 50), false);
    check('fill-down Item Desc tetap jalan', rowsA[1]?.itemDesc, 'DUPLEX 300GSM/ 60CM');
    check('kode supplier dari Digit1_Lot: X -> XSD', rowsA[0]?.supplier, 'XSD');

    // ────────────────────────────────────────────────────────────────
    console.log('\n--- B. TOLERANSI NAMA HEADER (huruf besar/kecil + spasi) ---');
    const b = await uploadExcel(toBuffer(stockHeader('  ref_b_po  ')));
    const rowsB: any[] = b.json?.data ?? [];
    check('header "  ref_b_po  " tetap terbaca (200)', b.status, 200);
    check('hasil sama dengan header normal', rowsB.length, 3);
    check('ringkasan dilewati sama = 3', b.json?.summary?.skippedNoMtl, 3);

    // Nama sheet TIDAK lagi di-hardcode: sheet stok boleh bernama lain dan
    // berada di tengah workbook (didahului sheet "Parameter" / "BP" seperti
    // file ekspor ERP yang nyata).
    const b2 = await uploadExcel(multiSheetWorkbook());
    check('sheet stok bernama lain tetap ditemukan (200)', b2.status, 200);
    check('baris dari sheet bernama lain ikut terbaca', (b2.json?.data ?? []).length, 3);

    // Workbook TANPA sheet data stok -> pesan harus menyebut kolom wajib + daftar sheet.
    const b3 = await uploadExcel(
      toBuffer([['Parameter'], ['Company ID', 180]], 'Parameter'),
    );
    check('workbook tanpa data stok ditolak (400)', b3.status, 400);
    check('pesan menyebut kolom wajib "Nama Item"', /Nama Item/.test(String(b3.json?.message || '')), true);
    check('pesan menyebut sheet yang diperiksa', /Sheet yang diperiksa/.test(String(b3.json?.message || '')), true);

    // ────────────────────────────────────────────────────────────────
    console.log('\n--- C. KOLOM Ref_B_PO HILANG -> proses dihentikan ---');
    const c = await uploadExcel(missingRefWorkbook());
    check('upload ditolak (400)', c.status, 400);
    check('pesan error menyebut "Ref_B_PO"', /Ref_B_PO/.test(String(c.json?.message || '')), true);

    // ────────────────────────────────────────────────────────────────
    console.log('\n--- D. SIMPAN KE PERIODE + PENJAGA SAAT IMPORT ---');
    const goodImport = await api('POST', '/stock-raw-material/import', {
      periodId,
      mode: 'overwrite',
      data: rowsA,
    });
    check('import 3 baris berhasil (201)', goodImport.status, 201);
    check('3 baris tersimpan', goodImport.json?.count, 3);

    const list = await api('GET', `/stock-raw-material?periodId=${periodId}`);
    const listRows: any[] = list.json?.data ?? [];
    check('list berisi 3 baris', listRows.length, 3);
    check('refB tersimpan untuk semua baris', listRows.every((r) => String(r.refB || '').toUpperCase().includes('MTL')), true);

    const importNoMtl = await api('POST', '/stock-raw-material/import', {
      periodId,
      mode: 'add',
      data: [{ ...rowsA[0], refB: 'C08/2MPL' }],
    });
    check('import baris TANPA "MTL" ditolak (400)', importNoMtl.status, 400);

    // ────────────────────────────────────────────────────────────────
    console.log('\n--- E. ADD MANUAL / EDIT wajib Ref-B mengandung "MTL" ---');
    const manualNoMtl = await api('POST', '/stock-raw-material', {
      periodId,
      itemDesc: 'TESTMANUAL DUPLEX 300GSM/ 60CM',
      supplier: 'XSD',
      unit: 'kg',
      qty: 10,
      date: '2026-07-01',
      refB: 'C08/2MPL',
    });
    check('manual Ref-B tanpa "MTL" ditolak (400)', manualNoMtl.status, 400);

    const manual = await api('POST', '/stock-raw-material', {
      periodId,
      itemDesc: 'TESTMANUAL DUPLEX 300GSM/ 60CM',
      supplier: 'XSD',
      unit: 'kg',
      qty: 10,
      date: '2026-07-01',
      refB: '  mtl-manual  ',
    });
    check('manual Ref-B mengandung "MTL" tersimpan (201)', manual.status, 201);
    check('Ref-B manual di-trim', manual.json?.data?.refB, 'mtl-manual');
    const manualId: string = manual.json?.data?.id;

    const clearRefEdit = await api('PUT', `/stock-raw-material/${manualId}`, { refB: 'C08/2MPL' });
    check('edit Ref-B tanpa "MTL" ditolak (400)', clearRefEdit.status, 400);

    const editOk = await api('PUT', `/stock-raw-material/${manualId}`, { qty: 25 });
    check('edit kolom lain (Ref-B lama tetap MTL) berhasil (200)', editOk.status, 200);
    check('nilai qty terbarui', editOk.json?.data?.qty, 25);
  } finally {
    // Penjaga: JANGAN pernah deleteMany tanpa periodId yang valid.
    if (typeof periodId === 'string' && periodId.length > 0) {
      await prisma.stockRawMaterial.deleteMany({ where: { periodId } });
      await prisma.planningCycle.delete({ where: { id: periodId } });
    }
    await prisma.$disconnect();
    console.log('\nPeriode uji dibersihkan.');
  }

  console.log('\n==================================================');
  console.log(failures === 0 ? 'SEMUA PEMERIKSAAN LULUS' : `${failures} PEMERIKSAAN GAGAL`);
  console.log('==================================================');
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
