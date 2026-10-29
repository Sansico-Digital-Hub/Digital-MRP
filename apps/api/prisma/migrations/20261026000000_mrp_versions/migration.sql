-- ============================================================================
-- Riwayat upload MRP (versioning mingguan) + perbandingan antar versi
-- ============================================================================
-- Sebelumnya "Save Overwrite" MENGHAPUS seluruh data MRP periode+modul lalu
-- menulis batch baru, sehingga riwayat upload minggu sebelumnya hilang.
--
-- Sekarang setiap upload disimpan sebagai snapshot penuh:
--   mrp_versions      = satu baris per upload (nomor versi, waktu, uploader, file,
--                       ringkasan). Tepat satu baris `isCurrent` per periode+modul.
--   mrp_version_rows  = detail part x minggu milik snapshot tersebut.
--
-- `weekly_schedules` TIDAK berubah: tetap menjadi data AKTIF yang dibaca modul
-- lain (Material Calculation, planning, dll).
--
-- Backfill: data MRP yang sudah ada dicatat sebagai "Upload ke-1" (source =
-- BACKFILL) supaya upload berikutnya punya pembanding.
-- ============================================================================

CREATE TABLE `mrp_versions` (
    `id` VARCHAR(191) NOT NULL,
    `periodId` VARCHAR(191) NOT NULL,
    `moduleType` ENUM('PRODUCTION', 'MATERIAL') NOT NULL,
    `versionNumber` INTEGER NOT NULL,
    `isCurrent` BOOLEAN NOT NULL DEFAULT false,
    `currentKey` VARCHAR(191) NULL,
    `source` ENUM('UPLOAD', 'BACKFILL') NOT NULL DEFAULT 'UPLOAD',
    `fileName` VARCHAR(191) NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `uploadedBy` VARCHAR(191) NULL,
    `uploadedByName` VARCHAR(191) NULL,
    `itemCount` INTEGER NOT NULL DEFAULT 0,
    `rowCount` INTEGER NOT NULL DEFAULT 0,
    `totalQty` DOUBLE NOT NULL DEFAULT 0,
    `weekStartDate` DATE NULL,
    `weekCount` INTEGER NOT NULL DEFAULT 26,
    `clientRequestId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `mrp_versions_currentKey_key`(`currentKey`),
    UNIQUE INDEX `mrp_versions_clientRequestId_key`(`clientRequestId`),
    UNIQUE INDEX `mrp_versions_periodId_moduleType_versionNumber_key`(`periodId`, `moduleType`, `versionNumber`),
    INDEX `mrp_versions_periodId_moduleType_isCurrent_idx`(`periodId`, `moduleType`, `isCurrent`),
    INDEX `mrp_versions_uploadedAt_idx`(`uploadedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `mrp_version_rows` (
    `id` VARCHAR(191) NOT NULL,
    `versionId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `partNumber` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `weekNumber` INTEGER NOT NULL,
    `weekStartDate` DATE NOT NULL,
    `weekEndDate` DATE NOT NULL,
    `quantity` DOUBLE NOT NULL DEFAULT 0,

    INDEX `mrp_version_rows_versionId_partNumber_idx`(`versionId`, `partNumber`),
    INDEX `mrp_version_rows_versionId_weekStartDate_idx`(`versionId`, `weekStartDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `mrp_versions`
    ADD CONSTRAINT `mrp_versions_periodId_fkey`
    FOREIGN KEY (`periodId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `mrp_version_rows`
    ADD CONSTRAINT `mrp_version_rows_versionId_fkey`
    FOREIGN KEY (`versionId`) REFERENCES `mrp_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill snapshot dari data MRP yang sudah ada ──────────────────────────
-- UTC_TIMESTAMP dipakai (bukan NOW) karena Prisma menyimpan/membaca DATETIME
-- sebagai UTC; NOW() akan menggeser waktu upload sebesar offset zona server.
INSERT INTO `mrp_versions` (
    `id`, `periodId`, `moduleType`, `versionNumber`, `isCurrent`, `currentKey`, `source`,
    `fileName`, `uploadedAt`, `uploadedBy`, `uploadedByName`,
    `itemCount`, `rowCount`, `totalQty`, `weekStartDate`, `weekCount`, `notes`, `createdAt`
)
SELECT
    CONCAT('mrv', REPLACE(UUID(), '-', '')),
    ws.`periodId`,
    ws.`moduleType`,
    1,
    true,
    CONCAT(ws.`periodId`, ':', ws.`moduleType`),
    'BACKFILL',
    '(data awal sebelum fitur riwayat)',
    UTC_TIMESTAMP(3),
    NULL,
    'Sistem (migrasi)',
    COUNT(DISTINCT ws.`itemId`),
    COUNT(*),
    COALESCE(SUM(ws.`quantity`), 0),
    MIN(ws.`weekStartDate`),
    COUNT(DISTINCT ws.`weekStartDate`),
    'Snapshot otomatis dari data MRP yang sudah ada saat fitur riwayat MRP diperkenalkan.',
    UTC_TIMESTAMP(3)
FROM `weekly_schedules` ws
GROUP BY ws.`periodId`, ws.`moduleType`;

INSERT INTO `mrp_version_rows` (
    `id`, `versionId`, `itemId`, `partNumber`, `description`,
    `weekNumber`, `weekStartDate`, `weekEndDate`, `quantity`
)
SELECT
    CONCAT('mrrow', REPLACE(UUID(), '-', '')),
    v.`id`,
    ws.`itemId`,
    i.`partNumber`,
    i.`itemName`,
    ws.`weekNumber`,
    ws.`weekStartDate`,
    ws.`weekEndDate`,
    ws.`quantity`
FROM `weekly_schedules` ws
JOIN `mrp_versions` v
    ON v.`periodId` = ws.`periodId`
   AND v.`moduleType` = ws.`moduleType`
   AND v.`versionNumber` = 1
   AND v.`source` = 'BACKFILL'
JOIN `items` i ON i.`id` = ws.`itemId`;
