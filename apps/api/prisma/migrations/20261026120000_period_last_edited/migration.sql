-- ============================================================================
-- Jejak EDIT MANUAL terakhir per periode
-- ============================================================================
-- Folder periode (26-Week Demand, WIP, Hot List, Stock Raw Material, Outstanding
-- PO) perlu menampilkan:
--   - kapan data diupload terakhir + siapa (sudah tercatat di `cycle_source_uploads`)
--   - kapan terakhir DIEDIT manual + siapa (belum tercatat sebelumnya)
--
-- `PlanningCycle` sebelumnya hanya punya `lastDataChangeAt` (berubah karena upload
-- MAUPUN edit, tanpa siapa). Dua kolom di bawah menyimpan aktor edit manual saja,
-- diisi oleh `touchPeriod()` pada setiap endpoint ubah/hapus data periode.
--
-- NULL = periode belum pernah diedit manual sejak kolom ini ada.
-- ============================================================================

ALTER TABLE `planning_cycles`
    ADD COLUMN `lastEditedAt` DATETIME(3) NULL,
    ADD COLUMN `lastEditedBy` VARCHAR(191) NULL;
