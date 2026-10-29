import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasourceUrl: 'mysql://root:@localhost:3306/planner_project',
});

const fmt = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '-');

async function main() {
  // ── A. Sebaran demand per minggu (26 minggu) ─────────────────────────────
  const weeks = await prisma.weeklySchedule.findMany({
    distinct: ['weekNumber'],
    select: { weekNumber: true, weekStartDate: true },
    orderBy: { weekNumber: 'asc' },
  });
  const weekKeyOf = new Map(weeks.map((w) => [w.weekNumber, fmt(w.weekStartDate)]));

  const all = await prisma.weeklySchedule.findMany({
    include: { item: { select: { partNumber: true } } },
  });

  const weekly = new Map<number, { rows: number; qty: number; parts: Set<string> }>();
  for (const r of all) {
    const cur = weekly.get(r.weekNumber) || { rows: 0, qty: 0, parts: new Set<string>() };
    cur.rows += 1;
    cur.qty += r.quantity;
    cur.parts.add(r.item.partNumber);
    weekly.set(r.weekNumber, cur);
  }
  console.log('=== DEMAND PER MINGGU (26 minggu) ===');
  console.table(
    [...weekly.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([wk, v]) => ({
        week: wk,
        start: weekKeyOf.get(wk),
        rows: v.rows,
        partsWithDemand: v.parts.size,
        totalQty: Math.round(v.qty),
      })),
  );

  // ── B. Distribusi demand per part: full 26w vs bulan Des (W12-W15) ───────
  const totalByPartAll = new Map<string, number>();
  const totalByPartDec = new Map<string, number>();
  for (const r of all) {
    const pn = r.item.partNumber;
    totalByPartAll.set(pn, (totalByPartAll.get(pn) || 0) + r.quantity);
    if (r.weekNumber >= 12 && r.weekNumber <= 15) {
      totalByPartDec.set(pn, (totalByPartDec.get(pn) || 0) + r.quantity);
    }
  }
  const nonZeroAll = [...totalByPartAll.values()].filter((v) => v > 0).length;
  const nonZeroDec = [...totalByPartDec.values()].filter((v) => v > 0).length;
  console.log('\n=== PART DENGAN DEMAND > 0 ===');
  console.table({
    partUnikTotal: totalByPartAll.size,
    partDemandPositif_ALL26w: nonZeroAll,
    partDemandPositif_DES_W12_15: nonZeroDec,
  });

  // ── C. Overlap NPOF vs MRP part number ──────────────────────────────────
  const npof = await prisma.npofMaterial.findMany({ select: { partNumber: true, material: true } });
  const npofSet = new Set(npof.map((n) => n.partNumber));
  const mrpParts = [...totalByPartAll.keys()];
  const matched = mrpParts.filter((p) => npofSet.has(p));
  console.log('\n=== OVERLAP NPOF ↔ MRP ===');
  console.table({
    npofPartNumber: npofSet.size,
    mrpPartNumber: mrpParts.length,
    matched: matched.length,
    mrpTanpaNpof: mrpParts.length - matched.length,
  });
  console.log('Contoh part MRP tanpa NPOF (20):', mrpParts.filter((p) => !npofSet.has(p)).slice(0, 20).join(', '));
  console.log('Contoh part NPOF (10):', [...npofSet].slice(0, 10).join(', '));

  // Cek kemiripan pola (apakah cuma beda suffix/format)
  const npofList = [...npofSet];
  const sample = mrpParts.filter((p) => !npofSet.has(p)).slice(0, 5);
  for (const s of sample) {
    const base = s.split('-')[0];
    const similar = npofList.filter((n) => n.startsWith(base)).slice(0, 3);
    console.log(`  ${s} → mirip di NPOF: ${similar.length ? similar.join(', ') : '(tidak ada)'}`);
  }

  // ── D. Cek duplikasi lot di Stock RM ────────────────────────────────────
  const stocks = await prisma.stockRawMaterial.findMany({ orderBy: { date: 'desc' } });
  const stockGroups = new Map<string, { rows: number; dates: Set<string>; qtySum: number; qtyFirst: number }>();
  for (const s of stocks) {
    const key = `${s.itemDesc}||${s.supplier || ''}`;
    const cur = stockGroups.get(key) || { rows: 0, dates: new Set<string>(), qtySum: 0, qtyFirst: s.qty };
    cur.rows += 1;
    cur.dates.add(fmt(s.date));
    cur.qtySum += s.qty;
    stockGroups.set(key, cur);
    if (cur.rows === 1) cur.qtyFirst = s.qty;
  }
  const multiLot = [...stockGroups.entries()].filter(([, v]) => v.rows > 1);
  console.log('\n=== STOCK RM: POTENSI UNDER-COUNT ===');
  console.table({
    totalRows: stocks.length,
    itemSupplierUnik: stockGroups.size,
    grupDenganBanyakLot: multiLot.length,
  });
  console.log('Contoh 8 grup dengan lot terbanyak:');
  console.table(
    multiLot
      .sort((a, b) => b[1].rows - a[1].rows)
      .slice(0, 8)
      .map(([k, v]) => ({
        itemDesc: k.split('||')[0].slice(0, 40),
        supplier: k.split('||')[1],
        rows: v.rows,
        tanggalUnik: v.dates.size,
        qtyTerhitungSekarang: Math.round(v.qtyFirst),
        qtyJikaDijumlah: Math.round(v.qtySum),
      })),
  );

  // ── E. WIP: cakupan item ────────────────────────────────────────────────
  const wipItems = await prisma.wIP.findMany({
    distinct: ['itemId'],
    select: { itemId: true },
  });
  const wipNonZero = await prisma.wIP.count({ where: { quantity: { gt: 0 } } });
  console.log('\n=== WIP ===');
  console.table({
    totalRows: 16304,
    itemUnik: wipItems.length,
    rowQtyPositif: wipNonZero,
  });

  // ── F. Hotlist: cakupan & nilai ─────────────────────────────────────────
  const hot = await prisma.hotlist.findMany();
  const hotNonZero = hot.filter((h) => h.biTotal > 0).length;
  const hotInMrp = hot.filter((h) => totalByPartAll.has(h.partNumber)).length;
  console.log('\n=== HOTLIST ===');
  console.table({
    rows: hot.length,
    biTotalPositif: hotNonZero,
    matchDenganMRP: hotInMrp,
  });

  // ── G. Outstanding PO: unit ─────────────────────────────────────────────
  const poUnit = await prisma.outstandingPO.groupBy({ by: ['qtyOrderUnit'], _count: { _all: true } });
  const poSupplier = await prisma.outstandingPO.groupBy({ by: ['supplierName'], _count: { _all: true } });
  console.log('\n=== OUTSTANDING PO ===');
  console.table(poUnit.map((u) => ({ unit: u.qtyOrderUnit, rows: u._count._all })));
  console.table(poSupplier.map((s) => ({ supplier: s.supplierName, rows: s._count._all })));

  // ── H. NPOF: kelengkapan field ──────────────────────────────────────────
  const npofRaw = await prisma.npofMaterial.findMany();
  const empty = (v: string | null | undefined) => !v || String(v).trim() === '' || String(v).trim() === '-';
  console.log('\n=== KELENGKAPAN DATA NPOF (357 baris) ===');
  console.table({
    sheetedSizeKosong: npofRaw.filter((n) => empty(n.sheetedSize)).length,
    gramaturKosong: npofRaw.filter((n) => empty(n.gramatur)).length,
    formulaMaterialKosong: npofRaw.filter((n) => empty(n.formulaMaterial)).length,
    upsKosong: npofRaw.filter((n) => empty(n.ups)).length,
    supplierKosong: npofRaw.filter((n) => empty(n.supplier)).length,
    materialKosong: npofRaw.filter((n) => empty(n.material)).length,
  });
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
