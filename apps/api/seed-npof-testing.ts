import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * ============================================================================
 * DATA UJI NPOF MATERIALS (SEMENTARA / TESTING) — BUKAN DATA PRODUKSI
 * ============================================================================
 *
 * Sumber: file kerja user. Kolom sumber:
 *   Part Number | Nama Produk | Material | Gramatur | Supplier
 *   | Width | Length | Ups | Formula Material
 *
 * Konversi ke tabel `npof_materials`:
 *   partNumber      <- Part Number
 *   productName     <- Nama Produk
 *   material        <- Material
 *   gramatur        <- Gramatur
 *   supplier        <- Supplier
 *   sheetedSize     <- `${Width} x ${Length} CM`   (digabung, format sama dengan
 *                      data NPOF asli; dibaca `parseDims()` di materialCalcEngine)
 *   ups             <- Ups           (string, sesuai tipe kolom DB)
 *   formulaMaterial <- Formula Material (kg per lembar, mis. 0.24219)
 *                      → engine membacanya via `parseMaterialNumber()` sebagai `fm`
 *
 * ---------------------------------------------------------------------------
 * KENAPA npofId 900001..900958 (penanda)?
 * ---------------------------------------------------------------------------
 *   - NPOF adalah sumber GLOBAL: tidak terikat periode, dibaca semua periode
 *     Material Calculation. Jadi data uji WAJIB bisa dihapus kembali dengan
 *     SATU perintah tanpa menyentuh data asli.
 *   - Rentang 999001-999002 SENGAJA TIDAK DIPAKAI — itu milik
 *     `verify-npof-coverage.ts` (bentrok = tes itu gagal).
 *
 * ---------------------------------------------------------------------------
 * PART YANG BENTROK DENGAN NPOF ASLI — IKUT DITIMPA (keputusan user)
 * ---------------------------------------------------------------------------
 *   1. Engine mengambil NPOF per `partNumber` dengan aturan "baris PERTAMA
 *      menang" (materialCalcEngine.ts L623-625, TANPA orderBy). Jadi partNumber
 *      yang SUDAH punya baris asli tidak akan memakai baris uji baru.
 *   2. Karena itu baris ASLI untuk partNumber yang bentrok ikut DITIMPA —
 *      SEMUA baris milik part tersebut, supaya baris mana pun yang menang
 *      hasilnya sama. Field yang ditimpa: productName, material, gramatur,
 *      supplier, sheetedSize, formulaMaterial, ups. `id` & `npofId` TIDAK diubah.
 *   3. Nilai asli disimpan dulu ke berkas `.npof-testing-backup.json`
 *      (folder apps/api). `--delete` memulihkan baris asli dari berkas itu.
 *   4. Setelah insert/hapus, angka Material Calculation periode mana pun bisa
 *      berubah → klik "Hitung Ulang" pada periode yang ingin dilihat.
 *
 * ---------------------------------------------------------------------------
 * CARA PAKAI (dari folder apps/api)
 * ---------------------------------------------------------------------------
 *   npx tsx seed-npof-testing.ts            # PREVIEW — tidak menulis apa pun
 *   npx tsx seed-npof-testing.ts --apply    # backup + timpa baris asli + insert baru
 *   npx tsx seed-npof-testing.ts --delete   # hapus baris uji + pulihkan baris asli
 */

const NPOF_ID_MIN = 900001;
const NPOF_ID_RANGE = { gte: NPOF_ID_MIN, lt: 901000 };

/** Nilai ASLI baris NPOF yang ditimpa, disimpan supaya bisa dipulihkan. */
const BACKUP_FILE = path.resolve(__dirname, '.npof-testing-backup.json');

interface BackupRow {
  id: string;
  npofId: number;
  partNumber: string;
  productName: string;
  material: string | null;
  gramatur: string | null;
  supplier: string | null;
  sheetedSize: string | null;
  formulaMaterial: string | null;
  ups: string | null;
  isEdited: boolean;
  lastSyncedAt: string | null;
}

function toBackupRow(row: Record<string, unknown>): BackupRow {
  const date = row.lastSyncedAt as Date | null;
  return {
    id: String(row.id),
    npofId: Number(row.npofId),
    partNumber: String(row.partNumber),
    productName: String(row.productName),
    material: (row.material ?? null) as string | null,
    gramatur: (row.gramatur ?? null) as string | null,
    supplier: (row.supplier ?? null) as string | null,
    sheetedSize: (row.sheetedSize ?? null) as string | null,
    formulaMaterial: (row.formulaMaterial ?? null) as string | null,
    ups: (row.ups ?? null) as string | null,
    isEdited: Boolean(row.isEdited),
    lastSyncedAt: date ? new Date(date).toISOString() : null,
  };
}

function readBackup(): BackupRow[] | null {
  if (!fs.existsSync(BACKUP_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8')) as BackupRow[];
  } catch {
    console.error(`Berkas backup rusak / tidak bisa dibaca: ${BACKUP_FILE}`);
    return null;
  }
}

/** [partNumber, productName, material, gramatur, supplier, width, length, ups, formulaMaterial] */
type Row = [string, string, string, string, string, number, number, number, number];

const ROWS: Row[] = [
  // ── IND CARTON 19A — XSD, 58.5 x 92 cm, ups 4 ───────────────────────────
  ['JCY51-JA10', 'IND CARTON 19A', 'Paper', '450', 'XSD', 58.5, 92, 4, 0.24219],
  ['JCY52-JA10', 'IND CARTON 19A', 'Paper', '450', 'XSD', 58.5, 92, 4, 0.24219],
  ['JCY53-JA10', 'IND CARTON 19A', 'Paper', '450', 'XSD', 58.5, 92, 4, 0.24219],

  // ── BLISTER CARD — HANCHANG, 61 x 93 cm, ups 6 ──────────────────────────
  ['JPL13-4B10', 'BLISTER CARD 4LB', 'Paper', '450', 'HANCHANG', 61, 93, 6, 0.25529],
  ['JPL13-MA10', 'BLISTER CARD 21A', 'Paper', '450', 'HANCHANG', 61, 93, 6, 0.25529],
  ['JPL14-4B10', 'BLISTER CARD 4LB', 'Paper', '450', 'HANCHANG', 61, 93, 6, 0.25529],
  ['JPL14-MA10', 'BLISTER CARD 21A', 'Paper', '450', 'HANCHANG', 61, 93, 6, 0.25529],
  ['JPL16-4B10', 'BLISTER CARD 4LB', 'Paper', '450', 'HANCHANG', 61, 93, 6, 0.25529],
  ['JPL16-MA10', 'BLISTER CARD 21A', 'Paper', '450', 'HANCHANG', 61, 93, 6, 0.25529],
  ['JPL17-4B10', 'BLISTER CARD 4LB', 'Paper', '450', 'HANCHANG', 61, 93, 6, 0.25529],
  ['JPL17-MA10', 'BLISTER CARD 21A', 'Paper', '450', 'HANCHANG', 61, 93, 6, 0.25529],
  ['JPL18-4B10', 'BLISTER CARD 4LB', 'Paper', '450', 'HANCHANG', 61, 93, 6, 0.25529],
  ['JPL18-MA10', 'BLISTER CARD 21A', 'Paper', '450', 'HANCHANG', 61, 93, 6, 0.25529],

  // ── XSD, 61 x 93 cm ─────────────────────────────────────────────────────
  ['JJY39-JA10', 'IND CARTON 19A', 'Paper', '450', 'XSD', 61, 93, 2, 0.25529],
  ['JJY40-JA10', 'IND CARTON 19A', 'Paper', '450', 'XSD', 61, 93, 2, 0.25529],
  ['JHL52-JA10', 'IND CARTON 19A', 'Paper', '450', 'XSD', 61, 93, 4, 0.25529],
  ['JHL53-JA10', 'IND CARTON 19A', 'Paper', '450', 'XSD', 61, 93, 4, 0.25529],
  ['JHL54-JA10', 'IND CARTON 19A', 'Paper', '450', 'XSD', 61, 93, 4, 0.25529],
  ['JBG05-4B10', 'IND CARTON 4LB', 'Paper', '450', 'XSD', 61, 93, 4, 0.25529],
  ['JBG06-4B10', 'IND CARTON 4LB', 'Paper', '450', 'XSD', 61, 93, 4, 0.25529],
  ['JBG07-4B10', 'IND CARTON 4LB', 'Paper', '450', 'XSD', 61, 93, 4, 0.25529],
  ['JBG05-JA10', 'IND CARTON 19A', 'Paper', '450', 'XSD', 61, 93, 4, 0.25529],
  ['JBG06-JA10', 'IND CARTON 19A', 'Paper', '450', 'XSD', 61, 93, 4, 0.25529],
  ['JBG07-JA10', 'IND CARTON 19A', 'Paper', '450', 'XSD', 61, 93, 4, 0.25529],

  // ── MEGA, 69 x 67 cm, ups 6 ─────────────────────────────────────────────
  ['JFR17-JA10', 'BLISTER CARD 19A', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW03-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW04-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW05-4B13', 'BLSTR CARD 4LB REFRH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW06-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW07-4B10', 'ISRT CRTN 4LB', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW07-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW08-4B10', 'ISRT CRTN 4LB', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW08-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW09-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW10-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW11-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW12-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW13-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW14-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLX22-JA11', 'BLSTR CARD 19A RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HPG68-GM13', 'BLSTR CARD 16M RFRSH', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW50-4B10', 'ISRT CRTN 4LB', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW47-JA10', 'ISRT CRTN 19A REBRND', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW48-JA10', 'ISRT CRTN 19A REBRND', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW49-JA10', 'ISRT CRTN 19A REBRAN', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],
  ['HLW50-JA10', 'ISRT CRTN 19A REBRND', 'Paper', '450', 'MEGA', 69, 67, 6, 0.20484],

  // ── XSD, 100 x 71.5 cm, ups 12 ──────────────────────────────────────────
  ['JJN91-JA10', 'INSERT CART 19A', 'Paper', '450', 'XSD', 100, 71.5, 12, 0.32175],
  ['JJN92-JA10', 'INSERT CART 19A', 'Paper', '450', 'XSD', 100, 71.5, 12, 0.32175],
  ['JJN93-JA10', 'INSERT CART 19A', 'Paper', '450', 'XSD', 100, 71.5, 12, 0.32175],
  ['JJN94-JA10', 'INSERT CART 19A', 'Paper', '450', 'XSD', 100, 71.5, 12, 0.32175],
  ['JJN95-JA10', 'INSERT CART 19A', 'Paper', '450', 'XSD', 100, 71.5, 12, 0.32175],
  ['JJN96-JA10', 'INSERT CART 19A', 'Paper', '450', 'XSD', 100, 71.5, 12, 0.32175],
  ['JRT63-JA10', 'INSERT CART 19A', 'Paper', '450', 'XSD', 100, 71.5, 12, 0.32175],
  ['JRT64-JA10', 'INSERT CART 19A', 'Paper', '450', 'XSD', 100, 71.5, 12, 0.32175],
  ['JRT65-JA10', 'INSERT CART 19A', 'Paper', '450', 'XSD', 100, 71.5, 12, 0.32175],
  ['JRT66-JA10', 'INSERT CART 19A', 'Paper', '450', 'XSD', 100, 71.5, 12, 0.32175],

  // ── HANCHANG, 120 x 85.5 cm, ups 14 ─────────────────────────────────────
  ['K5904-T0005', 'IND CARTON K5904', 'Paper', '450', 'HANCHANG', 120, 85.5, 14, 0.4617],
  ['K5904-T0006', 'IND CARTON K5904', 'Paper', '450', 'HANCHANG', 120, 85.5, 14, 0.4617],
];

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL ?? 'mysql://root:@localhost:3306/planner_project',
});

function buildData() {
  return ROWS.map(([partNumber, productName, material, gramatur, supplier, width, length, ups, fm], i) => ({
    npofId: NPOF_ID_MIN + i,
    partNumber,
    productName,
    material,
    gramatur,
    supplier,
    sheetedSize: `${width} x ${length} CM`,
    formulaMaterial: String(fm),
    ups: String(ups),
  }));
}

async function preview() {
  const data = buildData();

  console.log(`Rencana insert: ${data.length} baris  (npofId ${NPOF_ID_MIN}..${NPOF_ID_MIN + data.length - 1})\n`);
  console.log('  npofId    partNumber     productName             material gramatur supplier  sheetedSize       ups  formulaMaterial');
  console.log('  ' + '-'.repeat(112));
  for (const d of data) {
    console.log(
      '  ' +
        String(d.npofId).padEnd(9) +
        d.partNumber.padEnd(15) +
        d.productName.padEnd(24) +
        d.material.padEnd(9) +
        d.gramatur.padEnd(9) +
        d.supplier.padEnd(10) +
        d.sheetedSize.padEnd(18) +
        d.ups.padEnd(5) +
        d.formulaMaterial,
    );
  }

  const total = await prisma.npofMaterial.count();
  const inRange = await prisma.npofMaterial.count({ where: { npofId: NPOF_ID_RANGE } });
  console.log(`\nNPOF di database sekarang : ${total} baris`);
  console.log(`Baris di rentang uji      : ${inRange} baris ${inRange > 0 ? '(akan DIHAPUS lalu ditulis ulang saat --apply)' : ''}`);
  // ── Baris NPOF ASLI yang akan DITIMPA (partNumber yang sama) ─────────────
  const partNumbers = data.map((d) => d.partNumber);
  const byPart = new Map(data.map((d) => [d.partNumber, d]));
  const clashes = await prisma.npofMaterial.findMany({
    where: { partNumber: { in: partNumbers }, npofId: { lt: NPOF_ID_MIN } },
    orderBy: [{ partNumber: 'asc' }, { npofId: 'asc' }],
  });
  if (clashes.length === 0) {
    console.log('\n[OK] Tidak ada partNumber yang bentrok dengan NPOF asli — semua 58 baris masuk sebagai baris baru.');
  } else {
    console.log(`\n[!] ${clashes.length} baris NPOF ASLI akan DITIMPA (partNumber yang sama):`);
    for (const c of clashes) {
      const d = byPart.get(c.partNumber)!;
      console.log(
        `   npofId ${String(c.npofId).padEnd(4)} ${c.partNumber.padEnd(13)} ` +
          `asli: ${(c.sheetedSize ?? '-').padEnd(20)} ups=${(c.ups ?? '-').padEnd(3)} fm=${(c.formulaMaterial || '(kosong)').slice(0, 24).padEnd(24)}` +
          `->  uji: ${d.sheetedSize.padEnd(20)} ups=${d.ups.padEnd(3)} fm=${d.formulaMaterial}`,
      );
    }
    console.log(`   Baris asli disalin ke ${path.basename(BACKUP_FILE)} sebelum ditimpa; pulihkan dengan --delete.`);
    console.log(`   Sisa ${data.length - new Set(clashes.map((c) => c.partNumber)).size} baris masuk sebagai baris BARU (npofId ${NPOF_ID_MIN}+).`);
  }

  // ── Cek kewajaran transkripsi: part harus dikenal `items` ATAU NPOF asli ──
  //    (part yang cuma ada di NPOF saja sah — NPOF memang lebih luas dari items)
  const itemRows = await prisma.item.findMany({
    where: { partNumber: { in: partNumbers } },
    select: { partNumber: true },
  });
  const knownItems = new Set(itemRows.map((r) => r.partNumber));
  const knownNpof = new Set(clashes.map((c) => c.partNumber));
  const suspect = data
    .filter((d) => !knownItems.has(d.partNumber) && !knownNpof.has(d.partNumber))
    .map((d) => d.partNumber);

  console.log(`\nCek transkripsi: ${data.length - suspect.length}/${data.length} partNumber dikenal (ada di items atau NPOF asli).`);
  if (suspect.length === 0) {
    console.log('[OK] Tidak ada partNumber yang mencurigakan.');
  } else {
    console.log(`[?] ${suspect.length} partNumber TIDAK dikenal di mana pun — kemungkinan SALAH KETIK:`);
    for (const p of suspect) {
      const base = p.includes('-') ? p.slice(0, p.indexOf('-')) : p;
      const near = await prisma.item.findMany({
        where: { partNumber: { startsWith: base } },
        select: { partNumber: true, itemName: true },
        orderBy: { partNumber: 'asc' },
        take: 14,
      });
      console.log(`    ${p}`);
      console.log(
        `       di items yang berawalan "${base}": ${
          near.length ? near.map((n) => `${n.partNumber} (${n.itemName})`).join(', ') : '(tidak ada)'
        }`,
      );
    }
  }

  const backupLama = readBackup();
  if (backupLama) {
    console.log(`\n[i] Berkas backup dari apply sebelumnya masih ada (${backupLama.length} baris). --apply akan MENAMBAH baris asli baru ke berkas ini (yang lama tidak ditulis ulang).`);
  }

  const ids = await prisma.npofMaterial.findMany({ where: { npofId: NPOF_ID_RANGE }, select: { id: true } });
  if (ids.length > 0) {
    console.log(`\n${ids.length} baris uji masih ada di DB (npofId ${NPOF_ID_MIN}+). Bersihkan: npx tsx seed-npof-testing.ts --delete`);
  }

  console.log('\n(PREVIEW saja — tidak ada perubahan di database.)');
  console.log('Jalankan `npx tsx seed-npof-testing.ts --apply` untuk menulis.');
}

async function apply() {
  const data = buildData();
  const partNumbers = data.map((d) => d.partNumber);
  const byPart = new Map(data.map((d) => [d.partNumber, d]));
  const before = await prisma.npofMaterial.count();

  // 1) Baris asli yang harus ditimpa
  const realRows = await prisma.npofMaterial.findMany({
    where: { partNumber: { in: partNumbers }, npofId: { lt: NPOF_ID_MIN } },
  });

  // 2) Backup — kumpulkan SEMUA baris asli yang pernah ditimpa. Baris yang sudah
  //    ada di berkas backup TIDAK ditulis ulang (kalau ditimpa-tulis, backup akan
  //    berisi nilai uji dan restore jadi salah); baris BARU ditambahkan.
  if (realRows.length > 0) {
    const existing = readBackup() ?? [];
    const sudahAda = new Set(existing.map((r) => r.id));
    const baru = realRows.filter((r) => !sudahAda.has(r.id)).map((r) => toBackupRow(r as unknown as Record<string, unknown>));
    if (baru.length === 0) {
      console.log(`Backup sudah lengkap (${existing.length} baris) — tidak ditulis ulang: ${path.basename(BACKUP_FILE)}`);
    } else {
      const merged = [...existing, ...baru];
      fs.writeFileSync(BACKUP_FILE, JSON.stringify(merged, null, 2), 'utf8');
      console.log(
        `Backup: +${baru.length} baris asli baru (total ${merged.length} baris) -> ${path.basename(BACKUP_FILE)}` +
          `\n   baris baru: ${baru.map((b) => `${b.partNumber}(npofId ${b.npofId})`).join(', ')}`,
      );
    }
  }

  // 3) Timpa SELURUH baris milik partNumber yang bentrok (bukan hanya satu),
  //    supaya baris mana pun yang dipilih engine hasilnya identik.
  let overwritten = 0;
  for (const row of realRows) {
    const d = byPart.get(row.partNumber)!;
    await prisma.npofMaterial.update({
      where: { id: row.id },
      data: {
        productName: d.productName,
        material: d.material,
        gramatur: d.gramatur,
        supplier: d.supplier,
        sheetedSize: d.sheetedSize,
        formulaMaterial: d.formulaMaterial,
        ups: d.ups,
      },
    });
    overwritten++;
  }

  // 4) Insert baris BARU untuk part yang belum ada di NPOF asli.
  const clashingParts = new Set(realRows.map((r) => r.partNumber));
  const toInsert = data.filter((d) => !clashingParts.has(d.partNumber));
  const removed = await prisma.npofMaterial.deleteMany({ where: { npofId: NPOF_ID_RANGE } });
  const created = toInsert.length > 0 ? await prisma.npofMaterial.createMany({ data: toInsert }) : { count: 0 };
  const after = await prisma.npofMaterial.count();

  console.log(`\nBaris uji lama dihapus     : ${removed.count}`);
  console.log(`Baris NPOF asli ditimpa    : ${overwritten}`);
  console.log(`Baris BARU diinsert        : ${created.count}`);
  console.log(`Total npof_materials       : ${before} -> ${after}`);
  console.log('\nLangkah lanjut: buka Material Calculation, lalu klik "Hitung Ulang" pada periode yang ingin diuji.');
  console.log('Bersihkan kembali dengan   : npx tsx seed-npof-testing.ts --delete');
}

async function remove() {
  const removed = await prisma.npofMaterial.deleteMany({ where: { npofId: NPOF_ID_RANGE } });
  console.log(`Baris uji dihapus          : ${removed.count} (npofId ${NPOF_ID_MIN}..${NPOF_ID_RANGE.lt - 1})`);

  const backup = readBackup();
  if (!backup) {
    console.log('Tidak ada berkas backup — baris NPOF asli tidak diubah.');
  } else {
    let restored = 0;
    let missing = 0;
    for (const r of backup) {
      const exists = await prisma.npofMaterial.findUnique({ where: { id: r.id } });
      if (!exists) {
        missing++;
        console.log(`   ! id ${r.id} (${r.partNumber}) tidak ditemukan, dilewati`);
        continue;
      }
      await prisma.npofMaterial.update({
        where: { id: r.id },
        data: {
          productName: r.productName,
          material: r.material,
          gramatur: r.gramatur,
          supplier: r.supplier,
          sheetedSize: r.sheetedSize,
          formulaMaterial: r.formulaMaterial,
          ups: r.ups,
          isEdited: r.isEdited,
          lastSyncedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt) : null,
        },
      });
      restored++;
    }
    fs.unlinkSync(BACKUP_FILE);
    console.log(`Baris NPOF asli dipulihkan : ${restored}${missing > 0 ? ` (${missing} dilewati)` : ''}`);
    console.log(`Berkas backup dihapus      : ${path.basename(BACKUP_FILE)}`);
  }

  const after = await prisma.npofMaterial.count();
  console.log(`Total npof_materials       : ${after} baris`);
}

async function main() {
  const arg = process.argv[2];
  console.log('='.repeat(114));
  console.log('DATA UJI NPOF MATERIALS (SEMENTARA) — npofId 900001.. / timpa baris asli yang bentrok');
  console.log('='.repeat(114) + '\n');

  if (arg === '--apply') await apply();
  else if (arg === '--delete' || arg === '--restore') await remove();
  else if (arg) {
    console.error(`Argumen tidak dikenal: ${arg}`);
    console.error('Pakai: (tanpa argumen) = preview | --apply | --delete');
    process.exitCode = 1;
  } else await preview();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
