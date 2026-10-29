-- ============================================================================
-- PEMISAHAN MODUL: Production Planning vs Material Planning
-- ============================================================================
-- MASALAH: 26-Week Demand (MRP) dan WIP disimpan di SATU tabel yang sama untuk
-- kedua modul (`weekly_schedules` dan `wips`). Akibatnya upload/edit/hapus di
-- Production Planning mengubah data Material Planning, dan sebaliknya.
--
-- SOLUSI (discriminator kolom): tambahkan `moduleType`
--   ENUM('PRODUCTION','MATERIAL') ke `weekly_schedules` dan `wips`, lalu jadikan
--   bagian dari KUNCI UNIK + semua index pencarian. Setiap baris sekarang milik
--   tepat satu modul dan tidak mungkin tertukar di level database.
--
-- KEPUTUSAN USER (2026-09-29): data lama BOLEH DIHAPUS, tanpa migrasi data.
--   Jadi MRP & WIP dikosongkan; user upload ulang file terpisah per modul.
--   `items` dan `npof_materials` TIDAK disentuh.
--
-- CATATAN: hasil perhitungan lama (`cycle_results`) dihapus karena dihitung dari
--   data BERSAMA yang kini tidak ada. Periode dikembalikan ke status DRAFT.
-- ============================================================================

-- ── Langkah 0: kosongkan data lama (kolom moduleType belum ada) ─────────────
DELETE FROM `weekly_schedules`;
DELETE FROM `wips`;

-- Hasil perhitungan lama tidak valid lagi (sumbernya sudah kosong / berubah
-- makna). Termasuk hasil yang ditandai isSaved.
DELETE FROM `cycle_results`;

UPDATE `planning_cycles`
SET `status`             = 'DRAFT',
    `calculatedAt`       = NULL,
    `calculatedBy`       = NULL,
    `calculatedRunCount` = 0;

-- ── Langkah 1: tambah kolom moduleType ─────────────────────────────────────
-- Ditambahkan dengan DEFAULT supaya ALTER TABLE aman, lalu DEFAULT-nya DIBUANG
-- (Langkah 3) agar aplikasi WAJIB mengirim moduleType secara eksplisit.
ALTER TABLE `weekly_schedules`
    ADD COLUMN `moduleType` ENUM('PRODUCTION', 'MATERIAL') NOT NULL DEFAULT 'PRODUCTION';

ALTER TABLE `wips`
    ADD COLUMN `moduleType` ENUM('PRODUCTION', 'MATERIAL') NOT NULL DEFAULT 'PRODUCTION';

-- ── Langkah 2: ganti index lama -> index yang menyertakan moduleType ───────
-- weekly_schedules
DROP INDEX `weekly_schedules_periodId_year_weekNumber_itemId_key` ON `weekly_schedules`;
DROP INDEX `weekly_schedules_periodId_year_weekNumber_idx` ON `weekly_schedules`;

CREATE INDEX `weekly_schedules_periodId_moduleType_idx`
    ON `weekly_schedules`(`periodId`, `moduleType`);

CREATE INDEX `weekly_schedules_periodId_moduleType_year_weekNumber_idx`
    ON `weekly_schedules`(`periodId`, `moduleType`, `year`, `weekNumber`);

CREATE UNIQUE INDEX `weekly_schedules_periodId_moduleType_year_weekNumber_itemId_key`
    ON `weekly_schedules`(`periodId`, `moduleType`, `year`, `weekNumber`, `itemId`);

-- wips
DROP INDEX `wips_periodId_itemId_location_key` ON `wips`;
DROP INDEX `wips_periodId_date_shift_idx` ON `wips`;

CREATE INDEX `wips_periodId_moduleType_idx`
    ON `wips`(`periodId`, `moduleType`);

CREATE INDEX `wips_periodId_moduleType_date_shift_idx`
    ON `wips`(`periodId`, `moduleType`, `date`, `shift`);

CREATE UNIQUE INDEX `wips_periodId_moduleType_itemId_location_key`
    ON `wips`(`periodId`, `moduleType`, `itemId`, `location`);

-- ── Langkah 3: buang DEFAULT (moduleType WAJIB eksplisit dari aplikasi) ────
ALTER TABLE `weekly_schedules` ALTER COLUMN `moduleType` DROP DEFAULT;
ALTER TABLE `wips` ALTER COLUMN `moduleType` DROP DEFAULT;
