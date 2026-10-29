import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasourceUrl: 'mysql://root:@localhost:3306/planner_project',
});

const norm = (s: string | null | undefined) => String(s || '').replace(/,/g, '.').toLowerCase();

/** "DUPLEX 450GSM/ 68.5CM" -> 450 ; "450 GSM" -> 450 ; "450" -> 450 */
function parseGsm(text: string | null | undefined): number | null {
  const s = norm(text);
  const m = s.match(/(\d{3,4})\s*gsm/) ?? s.match(/^\s*(\d{3,4})\b/);
  return m ? Number(m[1]) : null;
}

/** Semua angka > 20 yang BUKAN gramatur -> dimensi (cm), urutan dipertahankan */
function parseDims(text: string | null | undefined): number[] {
  const s = norm(text);
  const gsm = parseGsm(text);
  return [...s.matchAll(/(\d+(?:\.\d+)?)/g)]
    .map((m) => parseFloat(m[1]))
    .filter((n) => n > 20 && n !== gsm);
}

async function main() {
  const stocks = await prisma.stockRawMaterial.findMany();
  const pos = await prisma.outstandingPO.findMany();
  const npof = await prisma.npofMaterial.findMany();

  // ── A. Distribusi satuan ────────────────────────────────────────────────
  const stockUnits = new Map<string, { rows: number; total: number }>();
  for (const s of stocks) {
    const k = (s.unit || '(kosong)').toLowerCase();
    const cur = stockUnits.get(k) || { rows: 0, total: 0 };
    cur.rows += 1;
    cur.total += s.qty;
    stockUnits.set(k, cur);
  }
  console.log('=== A1. SATUAN STOK ===');
  console.table([...stockUnits.entries()].map(([unit, v]) => ({ unit, rows: v.rows, totalQty: Math.round(v.total) })));

  const poUnits = new Map<string, { rows: number; total: number }>();
  for (const p of pos) {
    const sisa = p.qtyOrder - p.qtyDelivered;
    if (sisa <= 0) continue;
    const k = (p.qtyOrderUnit || '(kosong)').toLowerCase();
    const cur = poUnits.get(k) || { rows: 0, total: 0 };
    cur.rows += 1;
    cur.total += sisa;
    poUnits.set(k, cur);
  }
  console.log('=== A2. SATUAN PO (hanya sisa > 0) ===');
  console.table([...poUnits.entries()].map(([unit, v]) => ({ unit, rows: v.rows, totalSisa: Math.round(v.total) })));

  // ── B. Item stok: gramatur & lebar terbaca atau tidak ──────────────────
  const stockAgg = new Map<string, { desc: string; supplier: string; kg: number; sheet: number; lots: number }>();
  for (const s of stocks) {
    const key = `${s.itemDesc}||${s.supplier || ''}`;
    const cur = stockAgg.get(key) || { desc: s.itemDesc, supplier: s.supplier || '', kg: 0, sheet: 0, lots: 0 };
    const unit = (s.unit || '').toLowerCase();
    if (unit === 'sheet' || unit === 'sheets') cur.sheet += s.qty;
    else if (unit === 'rim') cur.sheet += s.qty * 500;
    else cur.kg += s.qty;
    cur.lots += 1;
    stockAgg.set(key, cur);
  }

  const stockItems = [...stockAgg.entries()].map(([key, v]) => ({
    key,
    desc: v.desc,
    supplier: v.supplier,
    gsm: parseGsm(v.desc),
    dims: parseDims(v.desc),
    kg: v.kg,
    sheet: v.sheet,
    lots: v.lots,
  }));

  console.log(`=== B. ITEM STOK: ${stockItems.length} grup ===`);
  console.log(`  gramatur terbaca : ${stockItems.filter((s) => s.gsm !== null).length}`);
  console.log(`  lebar terbaca    : ${stockItems.filter((s) => s.dims.length > 0).length}`);
  console.log(`  punya kg         : ${stockItems.filter((s) => s.kg > 0).length}`);
  console.log(`  punya sheet saja : ${stockItems.filter((s) => s.kg === 0 && s.sheet > 0).length}`);
  console.log('\n-- yang gramatur/lebar TIDAK terbaca --');
  console.table(
    stockItems
      .filter((s) => s.gsm === null || s.dims.length === 0)
      .map((s) => ({ itemDesc: s.desc.slice(0, 40), gsm: s.gsm ?? '—', lebar: s.dims[0] ?? '—', kg: Math.round(s.kg) })),
  );

  // ── C. Kebutuhan dari NPOF + uji pencocokan baru ───────────────────────
  const reqs: { partNumber: string; gsm: number; w: number; sheetedSize: string; supplier: string }[] = [];
  for (const n of npof) {
    if (!n.gramatur || !n.sheetedSize) continue;
    const size = String(n.sheetedSize).trim();
    if (!size || size === '-') continue;
    if (/nebeng|satu\s*layout|tidak\s*dihitung/i.test(size)) continue;
    const gsm = Number(String(n.gramatur).replace(',', '.'));
    if (!gsm) continue;
    const dims = parseDims(size);
    if (dims.length === 0) continue;
    reqs.push({ partNumber: n.partNumber, gsm, w: dims[0], sheetedSize: size, supplier: String(n.supplier || '').trim() });
  }

  console.log(`\n=== C. KEBUTUHAN (NPOF ukuran valid): ${reqs.length} ===`);
  console.log('\n-- sensitivitas toleransi (gramatur sama + lebar stok >= kebutuhan) --');
  console.table(
    [0, 1, 2, 3, 5, 10, 999].map((tol) => {
      const hit = reqs.filter((r) =>
        stockItems.some((s) => s.gsm === r.gsm && s.dims[0] !== undefined && s.dims[0] - r.w >= 0 && s.dims[0] - r.w <= tol),
      ).length;
      return {
        toleransi: tol === 999 ? 'tanpa batas' : `+${tol} cm`,
        partDapatStok: hit,
        persen: `${((hit / reqs.length) * 100).toFixed(1)}%`,
      };
    }),
  );

  const TOL = 2;
  const matched = reqs.filter((r) =>
    stockItems.some((s) => s.gsm === r.gsm && s.dims[0] !== undefined && s.dims[0] - r.w >= 0 && s.dims[0] - r.w <= TOL),
  );
  console.log(`\n✅ TARGET MILESTONE 2 → tol +${TOL} cm : ${matched.length} dari ${reqs.length}`);

  // ── C2. Dampak filter supplier ───────────────────────────────────────
  const widthOk = (r: (typeof reqs)[number], s: (typeof stockItems)[number]) =>
    s.gsm === r.gsm && s.dims[0] !== undefined && s.dims[0] - r.w >= 0 && s.dims[0] - r.w <= TOL;

  const supplierOkExact = (stockSup: string, npofSup: string) => {
    const a = stockSup.trim().toLowerCase();
    const b = npofSup.trim().toLowerCase();
    if (!a || !b) return true;
    return a.includes(b) || b.includes(a);
  };
  const supplierOkUnknownFallback = (stockSup: string, npofSup: string) =>
    supplierOkExact(stockSup, npofSup || 'Unknown');

  const matchNoSupplier = reqs.filter((r) => stockItems.some((s) => widthOk(r, s))).length;
  const matchSupplierUnknown = reqs.filter((r) =>
    stockItems.some((s) => widthOk(r, s) && supplierOkUnknownFallback(s.supplier, r.supplier)),
  ).length;
  const matchSupplierExact = reqs.filter((r) =>
    stockItems.some((s) => widthOk(r, s) && supplierOkExact(s.supplier, r.supplier)),
  ).length;

  console.log('\n=== C2. DAMPAK FILTER SUPPLIER PADA JUMLAH PART YANG DAPAT STOK ===');
  console.table([
    { skenario: 'Tanpa filter supplier (angka 29 di rancangan)', part: matchNoSupplier },
    { skenario: 'Supplier wajib sama; NPOF kosong -> "Unknown"', part: matchSupplierUnknown },
    { skenario: 'Supplier wajib sama; NPOF kosong -> bebas', part: matchSupplierExact },
  ]);
  console.log(`NPOF tanpa supplier: ${reqs.filter((r) => !r.supplier).length} dari ${reqs.length}`);
  console.log('Distribusi supplier NPOF:');
  const supCount = new Map<string, number>();
  for (const r of reqs) supCount.set(r.supplier || '(kosong)', (supCount.get(r.supplier || '(kosong)') || 0) + 1);
  console.table([...supCount.entries()].sort((a, b) => b[1] - a[1]).map(([supplier, jumlah]) => ({ supplier, jumlah })));

  // ── D. Berapa item stok dipakai bersama? (dasar Milestone 3) ───────────
  const stockUsage = new Map<string, Set<string>>();
  for (const r of reqs) {
    for (const s of stockItems) {
      if (s.gsm !== r.gsm) continue;
      const w = s.dims[0];
      if (w === undefined) continue;
      const diff = w - r.w;
      if (diff < 0 || diff > TOL) continue;
      const set = stockUsage.get(s.key) || new Set<string>();
      set.add(r.partNumber);
      stockUsage.set(s.key, set);
    }
  }
  const shared = [...stockUsage.entries()].filter(([, p]) => p.size > 1).sort((a, b) => b[1].size - a[1].size);
  console.log(`\n=== D. ITEM STOK DIPAKAI >1 PART: ${shared.length} ===`);
  console.table(
    shared.slice(0, 12).map(([k, parts]) => {
      const st = stockAgg.get(k)!;
      return {
        itemDesc: st.desc.slice(0, 32),
        supplier: st.supplier,
        kg: Math.round(st.kg),
        dipakaiOlehNPart: parts.size,
        kgJikaKeSemuaPart: Math.round(st.kg * parts.size),
      };
    }),
  );
  const doubleCount = shared.reduce((sum, [k, parts]) => sum + stockAgg.get(k)!.kg * (parts.size - 1), 0);
  console.log(`\n⚠️ Potential double-count = ${Math.round(doubleCount).toLocaleString('id-ID')} kg`);
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
