import prisma from './prisma';

/**
 * Auto-cleanup module
 *
 * Removes:
 *  - DailySchedule records whose date < today - 14 days
 *  - WeeklySchedule records whose weekEndDate < today - 14 days
 *
 * Runs on server startup, then every 24 hours.
 */

const RETENTION_DAYS = 14;
const RETENTION_MONTHS = 13;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function get14DaysCutoffDate(): Date {
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setTime(cutoff.getTime() - RETENTION_DAYS * ONE_DAY_MS);
  return cutoff;
}

function get13MonthsCutoffDate(): Date {
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  return cutoff;
}

export async function cleanupOldRecords(): Promise<{
  dailyDeleted: number;
  weeklyDeleted: number;
  hotlistDeleted: number;
  stockDeleted: number;
  wipDeleted: number;
}> {
  const cutoff14Days = get14DaysCutoffDate();
  const cutoff13Months = get13MonthsCutoffDate();

  try {
    // ⚠️ SEJAK 2026-09-28: tabel `weekly_schedules`, `hotlists`,
    // `stock_raw_materials`, dan `wips` adalah DATA PERIODE (punya `periodId`).
    // Menghapusnya berdasarkan tanggal DI DALAM data akan merusak periode lama
    // secara diam-diam (dan tanpa menandai hasil hitungnya tidak valid).
    // Retensi tabel-tabel itu sekarang HANYA lewat `cleanupOldCycles()`
    // (berbasis periode, 18 bulan, dengan notifikasi). Yang tetap di sini hanya
    // `daily_schedules` karena bukan data periode.
    const [dailyResult] = await Promise.all([
      prisma.dailySchedule.deleteMany({
        where: { date: { lt: cutoff14Days } },
      }),
    ]);

    // Tetap dihitung agar bentuk respons tidak berubah bagi pemanggil lama.
    const weeklyResult = { count: 0 };
    const hotlistResult = { count: 0 };
    const stockResult = { count: 0 };
    const wipResult = { count: 0 };
    void cutoff13Months;
    void get13MonthsCutoffDate;

    const total = dailyResult.count;
    if (total > 0) {
      console.log(
        `[Cleanup] Removed records: ${dailyResult.count} daily (14d), ${weeklyResult.count} weekly, ${hotlistResult.count} hotlist, ${stockResult.count} stock, ${wipResult.count} wip (13m)`,
      );
    } else {
      console.log(`[Cleanup] No old records to remove.`);
    }

    return {
      dailyDeleted: dailyResult.count,
      weeklyDeleted: weeklyResult.count,
      hotlistDeleted: hotlistResult.count,
      stockDeleted: stockResult.count,
      wipDeleted: wipResult.count,
    };
  } catch (err) {
    console.error('[Cleanup] Failed to remove old records:', err);
    throw err;
  }
}

let cleanupInterval: NodeJS.Timeout | null = null;

// ============================================
// RETENSI PERIODE MATERIAL PLANNING (18 bulan)
// ============================================
// Fungsi ini TERPISAH dari cleanupOldRecords(). Yang dihapus hanya periode
// (PlanningCycle) beserta turunannya lewat onDelete: Cascade.
// `npof_materials` TIDAK pernah disentuh karena bersifat global, bukan milik periode.

const CYCLE_RETENTION_MONTHS = 18;
const CYCLE_REMINDER_DAYS = 30;

export async function cleanupOldCycles(): Promise<{
  deleted: number;
  pendingConfirmation: number;
  reminded: number;
}> {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - CYCLE_RETENTION_MONTHS);
  const reminderCutoff = new Date(now.getTime() - CYCLE_REMINDER_DAYS * ONE_DAY_MS);

  let deleted = 0;
  let pendingConfirmation = 0;
  let reminded = 0;

  try {
    // Kriteria memakai tanggal UPLOAD (createdAt / retentionDueAt),
    // BUKAN mrpStartDate — konsisten dengan prinsip identitas periode.
    const expired = await prisma.planningCycle.findMany({
      where: {
        OR: [{ retentionDueAt: { lt: now } }, { retentionDueAt: null, createdAt: { lt: cutoff } }],
      },
      include: { results: { where: { isSaved: true }, select: { id: true } } },
    });

    if (expired.length === 0) return { deleted: 0, pendingConfirmation: 0, reminded: 0 };

    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
      select: { id: true },
    });

    for (const cycle of expired) {
      if (cycle.results.length === 0) {
        // Tidak ada hasil tersimpan -> aman dihapus otomatis.
        await prisma.planningCycle.delete({ where: { id: cycle.id } });
        deleted += 1;
        continue;
      }

      pendingConfirmation += 1;

      // Ada hasil tersimpan -> JANGAN hapus. Beri tahu user dulu.
      const lastNotified = cycle.retentionNotifiedAt;
      const shouldNotify = !lastNotified || lastNotified < reminderCutoff;
      if (!shouldNotify) continue;

      await prisma.planningCycle.update({
        where: { id: cycle.id },
        data: { retentionNotifiedAt: now },
      });

      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map((a) => ({
            userId: a.id,
            type: 'INFO' as const,
            title: 'Periode material melewati retensi 18 bulan',
            message:
              `Periode "${cycle.label}" sudah melewati batas retensi 18 bulan dan punya ` +
              `${cycle.results.length} hasil perhitungan tersimpan. Data TIDAK dihapus otomatis. ` +
              'Buka halaman Material Calculation untuk memilih: tetap simpan (dengan durasi) atau hapus.',
            itemCode: cycle.uploadMonth,
          })),
        });
      }
      reminded += 1;
    }

    if (deleted > 0 || reminded > 0) {
      console.log(
        `[Cleanup] Periode: ${deleted} dihapus, ${pendingConfirmation} menunggu konfirmasi, ${reminded} notifikasi dikirim.`,
      );
    }

    return { deleted, pendingConfirmation, reminded };
  } catch (err) {
    console.error('[Cleanup] Gagal memproses retensi periode:', err);
    return { deleted, pendingConfirmation, reminded };
  }
}

export function startCleanupSchedule(): void {
  // Run once on startup (non-blocking)
  cleanupOldRecords().catch((err) =>
    console.error('[Cleanup] Initial run failed:', err),
  );

  // Retensi periode dijalankan terpisah supaya kegagalannya tidak
  // menghentikan cleanup tabel Production Planning.
  cleanupOldCycles().catch((err) =>
    console.error('[Cleanup] Initial cycle retention run failed:', err),
  );

  // Run daily
  if (cleanupInterval) clearInterval(cleanupInterval);
  cleanupInterval = setInterval(() => {
    cleanupOldRecords().catch((err) =>
      console.error('[Cleanup] Scheduled run failed:', err),
    );
    cleanupOldCycles().catch((err) =>
      console.error('[Cleanup] Scheduled cycle retention run failed:', err),
    );
  }, ONE_DAY_MS);
}

export function stopCleanupSchedule(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
