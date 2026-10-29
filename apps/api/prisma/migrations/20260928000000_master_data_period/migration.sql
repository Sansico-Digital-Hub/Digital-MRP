-- ============================================================================
-- Periode UPLOAD untuk Master Data
-- ============================================================================
-- Sebelumnya pengelompokan "per bulan" di halaman Master Data hanya dihitung di
-- browser dari tanggal DI DALAM data (weekStartDate / date / planReceivedDate).
-- Sekarang setiap baris menyimpan `periodId` = periode saat data di-upload.
--
-- Perubahan:
--   1. Tambah `periodId` (FK -> planning_cycles, ON DELETE CASCADE) ke 5 tabel
--      Master Data: weekly_schedules, wips, hotlists, stock_raw_materials,
--      outstanding_pos.
--   2. Semua kunci unik jadi per periode (diawali periodId).
--   3. Hapus 5 tabel snapshot `cycle_*` (duplikasi — data periode kini dibaca
--      langsung dari tabel Master Data).
--   4. planning_cycles.mrpStartDate / mrpEndDate dibuat NULL-able (periode bisa
--      dibuat dari upload Stock/PO/Hotlist/WIP saja).
--
-- KEPUTUSAN USER (2026-09-28): data lama TIDAK di-backfill — tabel Master Data
-- dikosongkan dan user upload ulang per periode. `items` dan `npof_materials`
-- TIDAK disentuh (NPOF memang dipakai bersama semua periode).
-- ============================================================================

-- ── Langkah 0: kosongkan data lama ──────────────────────────────────────────
-- Urutan: tabel anak dulu, lalu planning_cycles (yang memicu cascade).
DELETE FROM `cycle_audit_logs`;
DELETE FROM `cycle_results`;
DELETE FROM `cycle_source_uploads`;
DELETE FROM `weekly_schedules`;
DELETE FROM `wips`;
DELETE FROM `hotlists`;
DELETE FROM `stock_raw_materials`;
DELETE FROM `outstanding_pos`;
DELETE FROM `planning_cycles`;

-- ── Langkah 1: lepas FK & index lama tabel snapshot ────────────────────────
-- DropForeignKey
ALTER TABLE `cycle_hotlists` DROP FOREIGN KEY `cycle_hotlists_cycleId_fkey`;

-- DropForeignKey
ALTER TABLE `cycle_mrp_weeks` DROP FOREIGN KEY `cycle_mrp_weeks_cycleId_fkey`;

-- DropForeignKey
ALTER TABLE `cycle_outstanding_po` DROP FOREIGN KEY `cycle_outstanding_po_cycleId_fkey`;

-- DropForeignKey
ALTER TABLE `cycle_stock_rm` DROP FOREIGN KEY `cycle_stock_rm_cycleId_fkey`;

-- DropForeignKey
ALTER TABLE `cycle_wips` DROP FOREIGN KEY `cycle_wips_cycleId_fkey`;

-- DropIndex
DROP INDEX `hotlists_partNumber_key` ON `hotlists`;

-- DropIndex
DROP INDEX `weekly_schedules_year_weekNumber_idx` ON `weekly_schedules`;

-- DropIndex
DROP INDEX `weekly_schedules_year_weekNumber_itemId_key` ON `weekly_schedules`;

-- DropIndex
DROP INDEX `wips_date_shift_idx` ON `wips`;

-- DropIndex
DROP INDEX `wips_itemId_location_key` ON `wips`;

-- ── Langkah 2: tambah kolom periodId ───────────────────────────────────────
-- AlterTable
ALTER TABLE `hotlists` ADD COLUMN `periodId` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `outstanding_pos` ADD COLUMN `periodId` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `planning_cycles` MODIFY `mrpStartDate` DATE NULL,
    MODIFY `mrpEndDate` DATE NULL;

-- AlterTable
ALTER TABLE `stock_raw_materials` ADD COLUMN `periodId` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `weekly_schedules` ADD COLUMN `periodId` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `wips` ADD COLUMN `periodId` VARCHAR(191) NOT NULL;

-- ── Langkah 3: hapus tabel snapshot ────────────────────────────────────────
-- DropTable
DROP TABLE `cycle_hotlists`;

-- DropTable
DROP TABLE `cycle_mrp_weeks`;

-- DropTable
DROP TABLE `cycle_outstanding_po`;

-- DropTable
DROP TABLE `cycle_stock_rm`;

-- DropTable
DROP TABLE `cycle_wips`;

-- ── Langkah 4: index baru per periode ──────────────────────────────────────
-- CreateIndex
CREATE INDEX `hotlists_periodId_idx` ON `hotlists`(`periodId`);

-- CreateIndex
CREATE UNIQUE INDEX `hotlists_periodId_partNumber_key` ON `hotlists`(`periodId`, `partNumber`);

-- CreateIndex
CREATE INDEX `outstanding_pos_periodId_idx` ON `outstanding_pos`(`periodId`);

-- CreateIndex
CREATE INDEX `outstanding_pos_periodId_itemDesc_supplierName_idx` ON `outstanding_pos`(`periodId`, `itemDesc`, `supplierName`);

-- CreateIndex
CREATE INDEX `stock_raw_materials_periodId_idx` ON `stock_raw_materials`(`periodId`);

-- CreateIndex
CREATE INDEX `stock_raw_materials_periodId_itemDesc_supplier_idx` ON `stock_raw_materials`(`periodId`, `itemDesc`, `supplier`);

-- CreateIndex
CREATE INDEX `weekly_schedules_periodId_idx` ON `weekly_schedules`(`periodId`);

-- CreateIndex
CREATE INDEX `weekly_schedules_periodId_year_weekNumber_idx` ON `weekly_schedules`(`periodId`, `year`, `weekNumber`);

-- CreateIndex
CREATE UNIQUE INDEX `weekly_schedules_periodId_year_weekNumber_itemId_key` ON `weekly_schedules`(`periodId`, `year`, `weekNumber`, `itemId`);

-- CreateIndex
CREATE INDEX `wips_periodId_idx` ON `wips`(`periodId`);

-- CreateIndex
CREATE INDEX `wips_periodId_date_shift_idx` ON `wips`(`periodId`, `date`, `shift`);

-- CreateIndex
CREATE UNIQUE INDEX `wips_periodId_itemId_location_key` ON `wips`(`periodId`, `itemId`, `location`);

-- ── Langkah 5: FK ke planning_cycles ──────────────────────────────────────
-- AddForeignKey
ALTER TABLE `weekly_schedules` ADD CONSTRAINT `weekly_schedules_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wips` ADD CONSTRAINT `wips_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hotlists` ADD CONSTRAINT `hotlists_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_raw_materials` ADD CONSTRAINT `stock_raw_materials_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `outstanding_pos` ADD CONSTRAINT `outstanding_pos_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
