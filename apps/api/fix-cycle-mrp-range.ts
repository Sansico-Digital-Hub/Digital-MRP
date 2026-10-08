import { PrismaClient } from '@prisma/client';

/**
 * Perbaiki `PlanningCycle.mrpStartDate/mrpEndDate` yang tidak cocok dengan data MRP.
 *
 * Sebab: sebelum perbaikan 2026-10-06, rentang diambil dari min/max BATCH UPLOAD
 * TERAKHIR. Satu upload sebagian (atau data uji) bisa menggeser rentang secara
 * permanen — pernah terjadi di periode September 2026: tersimpan 5–11 Jan 2032
 * padahal datanya 19 Sep 2026 – 13 Mar 2027. Akibatnya `periodStartDate`
 * kalkulasi salah dan SEMUA PO dianggap tiba di minggu 1.
 *
 * Skrip ini menghitung ulang rentang dari SELURUH baris MRP modul MATERIAL.
 * Aman dijalankan berulang (idempoten) dan hanya MENYENTUH kolom rentang.
 *
 * Jalankan: npx tsx fix-cycle-mrp-range.ts
 */

const prisma = new PrismaClient({
  datasourceUrl: 'mysql://root:@localhost:3306/planner_project',
});

const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—');

async function main() {
  const cycles = await prisma.planningCycle.findMany({ orderBy: { uploadMonth: 'asc' } });
  console.log(`Memeriksa ${cycles.length} periode...\n`);

  let fixed = 0;
  for (const c of cycles) {
    const [minAgg, maxAgg, rows] = await Promise.all([
      prisma.weeklySchedule.aggregate({
        where: { periodId: c.id, moduleType: 'MATERIAL' },
        _min: { weekStartDate: true },
      }),
      prisma.weeklySchedule.aggregate({
        where: { periodId: c.id, moduleType: 'MATERIAL' },
        _max: { weekEndDate: true },
      }),
      prisma.weeklySchedule.count({ where: { periodId: c.id, moduleType: 'MATERIAL' } }),
    ]);

    const start = minAgg._min.weekStartDate ?? null;
    const end = maxAgg._max.weekEndDate ?? null;

    const same =
      (c.mrpStartDate?.getTime() ?? null) === (start?.getTime() ?? null) &&
      (c.mrpEndDate?.getTime() ?? null) === (end?.getTime() ?? null);

    if (same) {
      console.log(`OK    | ${c.label} (${rows} baris) -> ${fmt(start)} .. ${fmt(end)}`);
      continue;
    }

    console.log(
      `DIPERBAIKI | ${c.label} (${rows} baris)\n           lama: ${fmt(c.mrpStartDate)} .. ${fmt(c.mrpEndDate)}\n           baru: ${fmt(start)} .. ${fmt(end)}`,
    );
    await prisma.planningCycle.update({
      where: { id: c.id },
      data: { mrpStartDate: start, mrpEndDate: end },
    });
    fixed += 1;
  }

  console.log(`\nSelesai. ${fixed} periode diperbaiki.`);
  if (fixed > 0) {
    console.log('⚠️  Periode yang sudah dihitung sebaiknya dihitung ULANG dari UI Material Calculation.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
