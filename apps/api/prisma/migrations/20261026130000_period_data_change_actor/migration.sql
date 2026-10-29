-- ============================================================================
-- Pelaku & jenis perubahan DATA AKTIF terakhir per periode
-- ============================================================================
-- Tab "Data Aktif" perlu menampilkan kapan data aktif terakhir diperbarui dan
-- oleh siapa. `lastDataChangeAt` sudah ada, tapi tidak menyimpan pelaku maupun
-- sumber perubahannya.
--
--   lastDataChangeBy   = userId pelaku perubahan terakhir
--   lastDataChangeKind = UPLOAD | EDIT | ROLLBACK
--
-- ROLLBACK dipakai saat versi aktif dihapus: data aktif diganti isi versi
-- sebelumnya (atau dikosongkan bila tidak ada versi tersisa).
-- ============================================================================

ALTER TABLE `planning_cycles`
    ADD COLUMN `lastDataChangeBy` VARCHAR(191) NULL,
    ADD COLUMN `lastDataChangeKind` VARCHAR(191) NULL;
