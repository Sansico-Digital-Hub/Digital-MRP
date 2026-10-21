-- ============================================================================
-- Material Calculation: pengecualian pool per ukuran (grup)
-- ============================================================================
-- Permintaan user (2026-10-14): material yang muncul di rincian `Stock As Of`
-- / `Outstanding PO` harus bisa dikeluarkan dari perhitungan SATU ukuran saja,
-- kalau ternyata material itu tidak ikut karena sudah dipakai ukuran lain (atau
-- karena ukurannya hanya kelipatan / ukuran di atasnya dengan sisa buangan).
--
-- Keputusan user:
--   1. Pengecualian berlaku PER UKURAN (grup), bukan global.
--   2. Setelah diubah, angka langsung DIHITUNG ULANG otomatis.
--   3. Boleh dilakukan Super Admin, Admin, dan Material Planner.
--   4. Yang bisa diedit hanya catatan alasan; identitas barisnya tetap.
--
-- Identitas grup (`groupKey`) HARUS sama dengan `groupKey` di
-- materialCalcEngine.ts: `${ukuran}||${gramatur}||${supplier}` (supplier kanonik).
-- Identitas pool (`poolRef`):
--   - STOCK -> `${itemDesc}||${supplier}` (hasil agregasi lot, sama dengan kunci
--     yang dipakai engine saat membangun kolam stok)
--   - PO    -> `id` baris `outstanding_pos` (stabil walau urutan/kolom berubah)
-- ============================================================================

-- CreateTable
CREATE TABLE `material_calc_exclusions` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `kind` ENUM('STOCK', 'PO') NOT NULL,
    `groupKey` VARCHAR(191) NOT NULL,
    `poolRef` VARCHAR(191) NOT NULL,
    `groupLabel` VARCHAR(191) NOT NULL,
    `poolLabel` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `material_calc_exclusions_cycleId_groupKey_idx`(`cycleId`, `groupKey`),
    UNIQUE INDEX `material_calc_exclusions_cycleId_kind_groupKey_poolRef_key`(`cycleId`, `kind`, `groupKey`, `poolRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `material_calc_exclusions` ADD CONSTRAINT `material_calc_exclusions_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
