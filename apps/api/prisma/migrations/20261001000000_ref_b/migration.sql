-- ============================================================================
-- Kolom referensi customer `refB` pada Stock Raw Material & Outstanding PO
-- ============================================================================
-- Kedua file Excel punya SATU kolom referensi yang sebelumnya belum terbaca:
--   - Outstanding PO      -> header Excel `PR Ref-B`   -> disimpan sebagai `refB`
--   - Stock Raw Material  -> header Excel `Ref_B_PO`   -> disimpan sebagai `refB`
--
-- Satu field SERAGAM (`refB`) dipakai kedua tabel. Hanya baris yang nilainya
-- mengandung "MTL" (case-insensitive, toleran spasi) yang boleh diimpor; baris
-- lain dilewati di parser (lihat apps/api/src/lib/excelRef.ts).
--
-- Nullable: data lama tidak punya referensi, jadi sengaja dibiarkan NULL.
-- ============================================================================

-- AlterTable
ALTER TABLE `stock_raw_materials` ADD COLUMN `refB` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `outstanding_pos` ADD COLUMN `refB` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `stock_raw_materials_periodId_refB_idx` ON `stock_raw_materials`(`periodId`, `refB`);

-- CreateIndex
CREATE INDEX `outstanding_pos_periodId_refB_idx` ON `outstanding_pos`(`periodId`, `refB`);
