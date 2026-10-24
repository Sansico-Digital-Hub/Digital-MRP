-- ============================================================================
-- Modul Printing (KBA): mesin cetak, shift, hari libur, maintenance
-- ============================================================================
-- Tahap 1 integrasi aplikasi Printing Planning (repo Production-Planning) ke
-- PlannerProject. Tabel baru saja — tidak ada tabel lama yang diubah.
--
-- Waktu printing = jam dinding WIB disimpan apa adanya (lihat schema.prisma).
-- Data awal di bawah sama dengan default aplikasi asal:
--   - kapasitas mesin dari PLANNING_MACHINES (setup 1 jam, 22.5 jam efektif =
--     24 jam − 3 istirahat shift @30 menit)
--   - 3 shift pabrik (Okt 2026) dengan istirahat 30 menit
-- ============================================================================

-- CreateTable
CREATE TABLE `printing_machines` (
    `id` VARCHAR(20) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `speed` DOUBLE NOT NULL,
    `setupHours` DOUBLE NOT NULL DEFAULT 1,
    `effectiveHours` DOUBLE NOT NULL DEFAULT 22.5,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `printing_shifts` (
    `id` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `start` VARCHAR(5) NOT NULL,
    `end` VARCHAR(5) NOT NULL,
    `breakStart` VARCHAR(5) NOT NULL,
    `breakEnd` VARCHAR(5) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `printing_shifts_sortOrder_idx`(`sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `printing_holidays` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `printing_holidays_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `printing_maintenance` (
    `id` VARCHAR(191) NOT NULL,
    `machineId` VARCHAR(20) NOT NULL,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdBy` VARCHAR(191) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `printing_maintenance_machineId_startAt_idx`(`machineId`, `startAt`),
    INDEX `printing_maintenance_startAt_idx`(`startAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `printing_maintenance` ADD CONSTRAINT `printing_maintenance_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `printing_machines`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data awal
INSERT INTO `printing_machines` (`id`, `name`, `speed`, `setupHours`, `effectiveHours`, `updatedAt`) VALUES
    ('kba1', 'KBA 1', 4, 1, 22.5, CURRENT_TIMESTAMP(3)),
    ('kba2', 'KBA 2', 5, 1, 22.5, CURRENT_TIMESTAMP(3)),
    ('kba3', 'KBA 3', 6, 1, 22.5, CURRENT_TIMESTAMP(3)),
    ('kba4', 'KBA 4', 3, 1, 22.5, CURRENT_TIMESTAMP(3)),
    ('genius', 'GENIUS', 1, 1, 22.5, CURRENT_TIMESTAMP(3));

INSERT INTO `printing_shifts` (`id`, `sortOrder`, `name`, `start`, `end`, `breakStart`, `breakEnd`, `updatedAt`) VALUES
    ('printing-shift-1', 1, 'Shift 1', '07:00', '15:00', '12:00', '12:30', CURRENT_TIMESTAMP(3)),
    ('printing-shift-2', 2, 'Shift 2', '15:00', '23:00', '18:30', '19:00', CURRENT_TIMESTAMP(3)),
    ('printing-shift-3', 3, 'Shift 3', '23:00', '07:00', '03:00', '03:30', CURRENT_TIMESTAMP(3));
