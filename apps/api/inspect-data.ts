import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasourceUrl: 'mysql://root:@localhost:3306/planner_project',
});

const fmt = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : '-';

async function main() {
  // ── 1. Row counts ────────────────────────────────────────────────────────
  const [items, npof, weekly, daily, hotlists, wips, stocks, pos, histories, sources] =
    await Promise.all([
      prisma.item.count(),
      prisma.npofMaterial.count(),
      prisma.weeklySchedule.count(),
      prisma.dailySchedule.count(),
      prisma.hotlist.count(),
      prisma.wIP.count(),
      prisma.stockRawMaterial.count(),
      prisma.outstandingPO.count(),
      prisma.calculationHistory.count(),
      prisma.calculationSourceSnapshot.count(),
    ]);

  console.log('=== ROW COUNTS ===');
  console.table({
    items,
    npofMaterials: npof,
    weeklySchedule: weekly,
    dailySchedule: daily,
    hotlists,
    wip: wips,
    stockRawMaterial: stocks,
    outstandingPO: pos,
    calculationHistory: histories,
    calculationSourceSnapshot: sources,
  });

  // ── 2. MRP: sebaran tahun / minggu ───────────────────────────────────────
  const weekAgg = await prisma.weeklySchedule.aggregate({
    _min: { weekStartDate: true, weekEndDate: true, year: true, weekNumber: true },
    _max: { weekStartDate: true, weekEndDate: true, year: true, weekNumber: true },
  });
  console.log('=== MRP (weekly_schedule) RANGE ===');
  console.log('tahun         :', weekAgg._min.year, '→', weekAgg._max.year);
  console.log('weekNumber    :', weekAgg._min.weekNumber, '→', weekAgg._max.weekNumber);
  console.log('weekStartDate :', fmt(weekAgg._min.weekStartDate), '→', fmt(weekAgg._max.weekStartDate));

  const yearGroups = await prisma.weeklySchedule.groupBy({
    by: ['year'],
    _count: { _all: true },
    _min: { weekNumber: true },
    _max: { weekNumber: true },
    orderBy: { year: 'asc' },
  });
  console.log('--- per tahun ---');
  console.table(
    yearGroups.map((g) => ({
      year: g.year,
      rows: g._count._all,
      weekMin: g._min.weekNumber,
      weekMax: g._max.weekNumber,
      totalWeeks: (g._max.weekNumber ?? 0) - (g._min.weekNumber ?? 0) + 1,
    })),
  );

  const distinctWeeks = await prisma.weeklySchedule.findMany({
    distinct: ['year', 'weekNumber'],
    select: { year: true, weekNumber: true, weekStartDate: true, weekEndDate: true },
    orderBy: [{ year: 'asc' }, { weekNumber: 'asc' }],
  });
  console.log(`--- ${distinctWeeks.length} minggu unik ---`);
  console.table(
    distinctWeeks.map((w) => ({
      year: w.year,
      week: w.weekNumber,
      start: fmt(w.weekStartDate),
      end: fmt(w.weekEndDate),
    })),
  );

  const distinctPartsInMrp = await prisma.weeklySchedule.findMany({
    distinct: ['itemId'],
    select: { itemId: true },
  });
  console.log('Part number unik di MRP:', distinctPartsInMrp.length);

  // ── 3. Sample tiap tabel ─────────────────────────────────────────────────
  console.log('\n=== HOTLIST (sample 5) ===');
  console.table(
    (
      await prisma.hotlist.findMany({
        take: 5,
        select: { partNumber: true, date: true, previousDate: true, biTotal: true },
      })
    ).map((h) => ({
      partNumber: h.partNumber,
      date: fmt(h.date),
      prevDate: fmt(h.previousDate),
      biTotal: h.biTotal,
    })),
  );
  const hotlistDates = await prisma.hotlist.findMany({
    distinct: ['date'],
    select: { date: true },
    orderBy: { date: 'asc' },
  });
  console.log('Hotlist tanggal unik:', hotlistDates.map((h) => fmt(h.date)).join(', '));

  console.log('\n=== WIP (sample 8) ===');
  console.table(
    (
      await prisma.wIP.findMany({
        take: 8,
        select: { location: true, quantity: true, date: true, shift: true, status: true },
      })
    ).map((w) => ({
      location: w.location,
      qty: w.quantity,
      date: fmt(w.date),
      shift: w.shift,
      status: w.status,
    })),
  );
  const wipLoc = await prisma.wIP.groupBy({
    by: ['location'],
    _count: { _all: true },
    orderBy: { _count: { location: 'desc' } },
  });
  console.log('--- lokasi WIP ---');
  console.table(wipLoc.map((l) => ({ location: l.location, rows: l._count._all })));

  console.log('\n=== STOCK RAW MATERIAL (sample 5) ===');
  console.table(
    (
      await prisma.stockRawMaterial.findMany({
        take: 5,
        orderBy: { date: 'desc' },
        select: { itemDesc: true, supplier: true, qty: true, unit: true, date: true },
      })
    ).map((s) => ({
      itemDesc: s.itemDesc?.slice(0, 45),
      supplier: s.supplier,
      qty: s.qty,
      unit: s.unit,
      date: fmt(s.date),
    })),
  );
  const stockAgg = await prisma.stockRawMaterial.aggregate({
    _min: { date: true },
    _max: { date: true },
  });
  console.log('Stock tanggal:', fmt(stockAgg._min.date), '→', fmt(stockAgg._max.date));

  console.log('\n=== OUTSTANDING PO (sample 5) ===');
  console.table(
    (
      await prisma.outstandingPO.findMany({
        take: 5,
        select: {
          itemDesc: true,
          supplierName: true,
          qtyOrder: true,
          qtyOrderUnit: true,
          qtyDelivered: true,
          planReceivedDate: true,
        },
      })
    ).map((p) => ({
      itemDesc: p.itemDesc?.slice(0, 40),
      supplier: p.supplierName,
      order: p.qtyOrder,
      unit: p.qtyOrderUnit,
      delivered: p.qtyDelivered,
      planDate: fmt(p.planReceivedDate),
    })),
  );

  console.log('\n=== CALCULATION HISTORY ===');
  const hist = await prisma.calculationHistory.findMany({
    select: {
      id: true,
      monthKey: true,
      periodStartDate: true,
      periodEndDate: true,
      periodWeeks: true,
      savedAt: true,
      sources: { select: { sourceType: true } },
    },
    orderBy: { savedAt: 'desc' },
  });
  console.table(
    hist.map((h) => ({
      monthKey: h.monthKey,
      start: fmt(h.periodStartDate),
      end: fmt(h.periodEndDate),
      weeks: h.periodWeeks,
      sources: h.sources.map((s) => s.sourceType).join('|'),
    })),
  );

  // ── 4. NPOF sebaran material ─────────────────────────────────────────────
  const matGroups = await prisma.npofMaterial.groupBy({
    by: ['material'],
    _count: { _all: true },
    orderBy: { _count: { material: 'desc' } },
  });
  console.log('\n=== NPOF per jenis material ===');
  console.table(matGroups.map((m) => ({ material: m.material ?? '(null)', rows: m._count._all })));

  // ── 5. Part number yang ada di MRP tapi tidak ada di NPOF ────────────────
  const mrpItems = await prisma.weeklySchedule.findMany({
    distinct: ['itemId'],
    include: { item: { select: { partNumber: true } } },
  });
  const npofParts = new Set((await prisma.npofMaterial.findMany({ select: { partNumber: true } })).map((n) => n.partNumber));
  const missingNpof = mrpItems.filter((m) => !npofParts.has(m.item.partNumber));
  console.log(`\nPart di MRP tanpa data NPOF: ${missingNpof.length} dari ${mrpItems.length}`);
  console.log(missingNpof.slice(0, 20).map((m) => m.item.partNumber).join(', '));
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
