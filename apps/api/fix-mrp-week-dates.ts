import { PrismaClient } from '@prisma/client';

/**
 * Normalisasi tanggal baris MRP (`weekly_schedules`) yang tahunnya menyimpang.
 *
 * Sebab: kolom minggu pernah disimpan mengikuti tanggal header Excel apa adanya.
 * Pada file Okt-2026 s.d. Apr-2027, kolom Januari tertulis tahun 2026 sehingga
 * baris minggu 13-17 tersimpan 2026-01-02 … 2026-01-30 (bukan 2027), dan kolom
 * terakhir sempat tertulis 2027-03-27 dua kali. Akibatnya W1 halaman 26-Week
 * Demand Plan ikut mulai dari 2 Januari dan minggu Okt-Des keluar dari jendela
 * 26 minggu.
 *
 * Skrip ini menyusun ulang tanggal tiap baris dari jangkar minggu pertama
 * (`weekNumber` terkecil) dengan penambahan tepat 7 hari, lalu menyelaraskan
 * kolom `year` supaya kunci unik (periode, modul, tahun, minggu, item) tetap
 * konsisten. Idempoten — aman dijalankan berulang.
 *
 * Jalankan: npx tsx fix-mrp-week-dates.ts
 */

const prisma = new PrismaClient();
const fmt = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const weekMs = 7 * 86400000;

async function main() {
  const scopes = await prisma.weeklySchedule.groupBy({
    by: ['periodId', 'moduleType'],
    _count: { _all: true },
  });
  console.log(`Memeriksa ${scopes.length} kombinasi periode/modul...\n`);

  let updated = 0;
  let removed = 0;

  for (const scope of scopes) {
    const rows = await prisma.weeklySchedule.findMany({
      where: { periodId: scope.periodId, moduleType: scope.moduleType },
      select: {
        id: true,
        itemId: true,
        year: true,
        weekNumber: true,
        weekStartDate: true,
        weekEndDate: true,
        period: { select: { label: true } },
      },
      orderBy: [{ weekNumber: 'asc' }, { weekStartDate: 'asc' }],
    });
    if (rows.length === 0) continue;

    const firstWeekNumber = rows[0].weekNumber;
    const anchor = new Date(rows[0].weekStartDate);
    anchor.setUTCHours(0, 0, 0, 0);

    const byKey = new Map<string, string>();
    for (const row of rows) {
      byKey.set(`${row.year}_${row.weekNumber}_${row.itemId}`, row.id);
    }

    for (const row of rows) {
      const expectedStart = new Date(anchor.getTime() + (row.weekNumber - firstWeekNumber) * weekMs);
      const expectedEnd = new Date(expectedStart.getTime() + 6 * 86400000);
      const expectedYear = expectedStart.getUTCFullYear();
      const sameYear = row.year === expectedYear;
      const sameStart = row.weekStartDate.getTime() === expectedStart.getTime();
      const sameEnd = row.weekEndDate.getTime() === expectedEnd.getTime();
      if (sameYear && sameStart && sameEnd) continue;

      const key = `${expectedYear}_${row.weekNumber}_${row.itemId}`;
      const conflictingId = byKey.get(key);
      if (conflictingId && conflictingId !== row.id) {
        await prisma.weeklySchedule.delete({ where: { id: row.id } });
        removed += 1;
        console.log(
          `HAPUS DUPLIKAT | ${scope.moduleType} ${rows[0].period.label} W${row.weekNumber} ${fmt(row.weekStartDate)} (baris ganda)`,
        );
        continue;
      }

      await prisma.weeklySchedule.update({
        where: { id: row.id },
        data: { year: expectedYear, weekStartDate: expectedStart, weekEndDate: expectedEnd },
      });
      byKey.delete(`${row.year}_${row.weekNumber}_${row.itemId}`);
      byKey.set(key, row.id);
      updated += 1;
      console.log(
        `DIPERBAIKI | ${scope.moduleType} ${rows[0].period.label} W${row.weekNumber} ${fmt(row.weekStartDate)} -> ${fmt(expectedStart)}`,
      );
    }
  }

  // Rentang MRP periode dipakai Material Calculation sebagai periodStartDate.
  const cycles = await prisma.planningCycle.findMany({ orderBy: { uploadMonth: 'asc' } });
  let rangeFixed = 0;
  for (const cycle of cycles) {
    const agg = await prisma.weeklySchedule.aggregate({
      where: { periodId: cycle.id, moduleType: 'MATERIAL' },
      _min: { weekStartDate: true },
      _max: { weekEndDate: true },
    });
    if (!agg._min.weekStartDate) continue;
    const start = agg._min.weekStartDate;
    const end = agg._max.weekEndDate;
    if (cycle.mrpStartDate?.getTime() === start?.getTime() && cycle.mrpEndDate?.getTime() === end?.getTime()) {
      continue;
    }
    console.log(
      `RENTANG MRP  | ${cycle.label}: ${fmt(cycle.mrpStartDate)} .. ${fmt(cycle.mrpEndDate)} -> ${fmt(start)} .. ${fmt(end)}`,
    );
    await prisma.planningCycle.update({
      where: { id: cycle.id },
      data: { mrpStartDate: start, mrpEndDate: end },
    });
    rangeFixed += 1;
  }

  console.log(`\nSelesai. ${updated} baris tanggal diperbaiki, ${removed} duplikat dihapus, ${rangeFixed} rentang periode disegarkan.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
