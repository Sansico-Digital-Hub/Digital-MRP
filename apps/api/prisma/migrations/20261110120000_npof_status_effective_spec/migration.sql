-- ============================================================================
-- NPOF: status approval + effective_spec dari Integration API SNF terbaru
-- ============================================================================
-- Endpoint /npof/integration/materials sekarang mengirim SEMUA status NPOF
-- (Draft / Waiting for Approval / Completed). Baris yang belum approved tetap
-- ditampilkan, tetapi TIDAK dihitung ke total UPS/ekspor.
--
-- Kolom baru:
--   statusLabel = status_label dari SNF
--   isApproved  = is_approved
--   upsCounted  = ups_counted (true hanya untuk baris yang ikut dihitung)
--   specSource  = spec_source ("own" / "parent" / "none")
--   rawSpec     = spec.* mentah untuk tooltip saat spec mewarisi induk
--
-- Endpoint legacy /npof/process-a/materials TIDAK lagi dipakai, sehingga
-- `specSourceNpofId` (asal merge legacy) dihapus.
-- ============================================================================

ALTER TABLE `npof_materials`
    ADD COLUMN `statusLabel` VARCHAR(64) NULL,
    ADD COLUMN `isApproved` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `upsCounted` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `specSource` VARCHAR(32) NULL,
    ADD COLUMN `rawSpec` JSON NULL,
    DROP COLUMN `specSourceNpofId`;

CREATE INDEX `npof_materials_plantId_statusLabel_idx`
    ON `npof_materials`(`plantId`, `statusLabel`);
