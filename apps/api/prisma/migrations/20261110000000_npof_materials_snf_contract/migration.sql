-- ============================================================================
-- NPOF Materials mengikuti kontrak Integration API SNF terbaru
-- ============================================================================
-- Perubahan utama:
--   1. Identitas baris menjadi (plantId, partNumberNorm, scenario) — bukan
--      (npofId, partNumber). Part number disimpan mentah untuk display dan
--      dinormalisasi untuk dedup/upsert.
--   2. `scenario` memisahkan "main" dan "alt" supaya UPS keduanya tidak
--      dijumlahkan.
--   3. Kolom baru untuk badge/status grup gang print, revisi, konflik, dan
--      detail payload SNF.
--   4. Spesifikasi hasil merge endpoint legacy disimpan per baris, termasuk
--      penanda `specAvailable`.
--   5. `isActive` untuk soft delete (baris yang hilang dari respons sync).
--
-- Backfill:
--   - plantId = 2 (PP2) untuk semua baris lama.
--   - partNumberNorm dihitung dari partNumber (UPPER + trim + tab/newline).
--   - Bila beberapa baris lama menjadi kunci yang sama, baris dengan
--     updatedAt terbaru dipertahankan (yang lain dihapus) sebelum unique index
--     baru dibuat. Sync berikutnya akan menulis ulang data dari SNF.
-- ============================================================================

ALTER TABLE `npof_materials`
    ADD COLUMN `plantId` INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN `partNumberNorm` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `partName` VARCHAR(191) NULL,
    ADD COLUMN `npofTitle` TEXT NULL,
    ADD COLUMN `scenario` VARCHAR(16) NOT NULL DEFAULT 'main',
    ADD COLUMN `selectedRev` VARCHAR(64) NULL,
    ADD COLUMN `removedInLatestRev` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `isGangPrint` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `isGangPrintParent` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `gangPrintParent` VARCHAR(191) NULL,
    ADD COLUMN `gangPrintGroupId` INTEGER NULL,
    ADD COLUMN `groupStatus` VARCHAR(32) NULL,
    ADD COLUMN `hasAlt` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `altPossiblyStale` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `newerRevPendingApproval` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `hasConflict` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `conflicts` JSON NULL,
    ADD COLUMN `groupMembers` JSON NULL,
    ADD COLUMN `pendingNpofs` JSON NULL,
    ADD COLUMN `sourceNpofs` JSON NULL,
    ADD COLUMN `sheetedSizeRaw` VARCHAR(191) NULL,
    ADD COLUMN `lengthCm` DOUBLE NULL,
    ADD COLUMN `widthCm` DOUBLE NULL,
    ADD COLUMN `sheetedSizeNote` VARCHAR(191) NULL,
    ADD COLUMN `specSourceNpofId` INTEGER NULL,
    ADD COLUMN `specAvailable` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `upsOriginal` INTEGER NULL,
    ADD COLUMN `upsCombined` INTEGER NULL,
    ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `npof_materials`
    MODIFY COLUMN `npofId` INTEGER NULL;

UPDATE `npof_materials`
SET `partNumberNorm` = UPPER(
        TRIM(
            REPLACE(
                REPLACE(
                    REPLACE(`partNumber`, CHAR(9), ' '),
                    CHAR(10),
                    ' '
                ),
                CHAR(13),
                ' '
            )
        )
    )
WHERE `partNumberNorm` = '';

DELETE t1
FROM `npof_materials` t1
JOIN `npof_materials` t2
  ON t1.`plantId` = t2.`plantId`
 AND t1.`partNumberNorm` = t2.`partNumberNorm`
 AND t1.`scenario` = t2.`scenario`
 AND (
      t1.`updatedAt` < t2.`updatedAt`
      OR (t1.`updatedAt` = t2.`updatedAt` AND t1.`id` < t2.`id`)
 );

DROP INDEX `npof_materials_npofId_partNumber_key` ON `npof_materials`;

ALTER TABLE `npof_materials` DROP COLUMN `isEdited`;

CREATE UNIQUE INDEX `npof_materials_plantId_partNumberNorm_scenario_key`
    ON `npof_materials`(`plantId`, `partNumberNorm`, `scenario`);

CREATE INDEX `npof_materials_plantId_scenario_isActive_idx`
    ON `npof_materials`(`plantId`, `scenario`, `isActive`);

CREATE INDEX `npof_materials_partNumberNorm_idx`
    ON `npof_materials`(`partNumberNorm`);
