-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPER_ADMIN', 'ADMIN', 'USER') NOT NULL DEFAULT 'USER',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_email_idx`(`email`),
    INDEX `users_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `items` (
    `id` VARCHAR(191) NOT NULL,
    `partNumber` VARCHAR(191) NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `items_partNumber_key`(`partNumber`),
    INDEX `items_partNumber_idx`(`partNumber`),
    INDEX `items_itemName_idx`(`itemName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fg_stock_history` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `inQty` DOUBLE NOT NULL DEFAULT 0,
    `outQty` DOUBLE NOT NULL DEFAULT 0,
    `balance` DOUBLE NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `notes` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `fg_stock_history_itemId_idx`(`itemId`),
    INDEX `fg_stock_history_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `master_cartons` (
    `id` VARCHAR(191) NOT NULL,
    `cartonCode` VARCHAR(191) NOT NULL,
    `toyNameItemId` VARCHAR(191) NOT NULL,
    `partNumberCode` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `master_cartons_cartonCode_key`(`cartonCode`),
    INDEX `master_cartons_toyNameItemId_idx`(`toyNameItemId`),
    INDEX `master_cartons_partNumberCode_idx`(`partNumberCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_schedules` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `shift` INTEGER NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `daily_schedules_date_shift_idx`(`date`, `shift`),
    INDEX `daily_schedules_itemId_idx`(`itemId`),
    UNIQUE INDEX `daily_schedules_date_shift_itemId_key`(`date`, `shift`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `weekly_schedules` (
    `id` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `weekNumber` INTEGER NOT NULL,
    `weekStartDate` DATE NOT NULL,
    `weekEndDate` DATE NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `weekly_schedules_year_weekNumber_idx`(`year`, `weekNumber`),
    INDEX `weekly_schedules_itemId_idx`(`itemId`),
    UNIQUE INDEX `weekly_schedules_year_weekNumber_itemId_key`(`year`, `weekNumber`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fg_stocks` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `date` DATE NOT NULL,
    `shift` INTEGER NULL,
    `notes` TEXT NULL,
    `updatedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fg_stocks_itemId_key`(`itemId`),
    INDEX `fg_stocks_itemId_idx`(`itemId`),
    INDEX `fg_stocks_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `wips` (
    `id` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `progressPercent` INTEGER NOT NULL DEFAULT 0,
    `date` DATE NOT NULL,
    `shift` INTEGER NOT NULL,
    `status` ENUM('IN_PROGRESS', 'ON_HOLD', 'DELAYED', 'COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS',
    `notes` TEXT NULL,
    `updatedBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `wips_itemId_idx`(`itemId`),
    INDEX `wips_location_idx`(`location`),
    INDEX `wips_status_idx`(`status`),
    INDEX `wips_date_shift_idx`(`date`, `shift`),
    UNIQUE INDEX `wips_itemId_location_key`(`itemId`, `location`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE') NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `dataBefore` JSON NULL,
    `dataAfter` JSON NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_userId_idx`(`userId`),
    INDEX `audit_logs_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('SHORTAGE', 'DELAY', 'STALE_DATA', 'INFO') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` TEXT NOT NULL,
    `itemCode` VARCHAR(191) NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_isRead_idx`(`userId`, `isRead`),
    INDEX `notifications_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hotlists` (
    `id` VARCHAR(191) NOT NULL,
    `partNumber` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `previousDate` DATE NULL,
    `biTotal` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hotlists_partNumber_key`(`partNumber`),
    INDEX `hotlists_partNumber_idx`(`partNumber`),
    INDEX `hotlists_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_raw_materials` (
    `id` VARCHAR(191) NOT NULL,
    `itemDesc` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `supplier` VARCHAR(191) NULL,
    `qty` DOUBLE NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `stock_raw_materials_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outstanding_pos` (
    `id` VARCHAR(191) NOT NULL,
    `planReceivedDate` DATE NOT NULL,
    `supplierName` VARCHAR(191) NOT NULL,
    `itemDesc` VARCHAR(191) NOT NULL,
    `qtyOrder` DOUBLE NOT NULL,
    `qtyOrderUnit` VARCHAR(191) NOT NULL,
    `qtyDelivered` DOUBLE NOT NULL,
    `qtyDeliveredUnit` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `outstanding_pos_planReceivedDate_idx`(`planReceivedDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `npof_materials` (
    `id` VARCHAR(191) NOT NULL,
    `npofId` INTEGER NOT NULL,
    `partNumber` VARCHAR(191) NOT NULL,
    `productName` VARCHAR(191) NOT NULL,
    `material` VARCHAR(191) NULL,
    `gramatur` VARCHAR(191) NULL,
    `supplier` VARCHAR(191) NULL,
    `sheetedSize` VARCHAR(191) NULL,
    `formulaMaterial` TEXT NULL,
    `ups` VARCHAR(191) NULL,
    `isEdited` BOOLEAN NOT NULL DEFAULT false,
    `lastSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `npof_materials_npofId_idx`(`npofId`),
    INDEX `npof_materials_partNumber_idx`(`partNumber`),
    UNIQUE INDEX `npof_materials_npofId_partNumber_key`(`npofId`, `partNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calculation_histories` (
    `id` VARCHAR(191) NOT NULL,
    `monthKey` VARCHAR(191) NOT NULL,
    `periodStartDate` DATE NOT NULL,
    `periodEndDate` DATE NOT NULL,
    `periodWeeks` INTEGER NOT NULL,
    `calculatedAt` DATETIME(3) NOT NULL,
    `savedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `savedBy` VARCHAR(191) NOT NULL,
    `resultSnapshot` JSON NOT NULL,

    INDEX `calculation_histories_monthKey_idx`(`monthKey`),
    INDEX `calculation_histories_savedAt_idx`(`savedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calculation_source_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `historyId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(191) NOT NULL,
    `dataSnapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `calculation_source_snapshots_sourceType_idx`(`sourceType`),
    UNIQUE INDEX `calculation_source_snapshots_historyId_sourceType_key`(`historyId`, `sourceType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `planning_cycles` (
    `id` VARCHAR(191) NOT NULL,
    `uploadMonth` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'CALCULATED') NOT NULL DEFAULT 'DRAFT',
    `mrpStartDate` DATE NOT NULL,
    `mrpEndDate` DATE NOT NULL,
    `weekCount` INTEGER NOT NULL DEFAULT 26,
    `firstUploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastDataChangeAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `calculatedAt` DATETIME(3) NULL,
    `calculatedBy` VARCHAR(191) NULL,
    `calculatedRunCount` INTEGER NOT NULL DEFAULT 0,
    `isLocked` BOOLEAN NOT NULL DEFAULT false,
    `lockedAt` DATETIME(3) NULL,
    `lockedBy` VARCHAR(191) NULL,
    `lockNote` TEXT NULL,
    `retentionDueAt` DATETIME(3) NULL,
    `retentionNotifiedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdBy` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `planning_cycles_label_key`(`label`),
    INDEX `planning_cycles_status_idx`(`status`),
    INDEX `planning_cycles_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `planning_cycles_uploadMonth_key`(`uploadMonth`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cycle_source_uploads` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NULL,
    `rowCount` INTEGER NOT NULL DEFAULT 0,
    `mode` VARCHAR(191) NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `uploadedBy` VARCHAR(191) NOT NULL,

    INDEX `cycle_source_uploads_cycleId_sourceType_idx`(`cycleId`, `sourceType`),
    INDEX `cycle_source_uploads_uploadedAt_idx`(`uploadedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cycle_mrp_weeks` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `partNumber` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `year` INTEGER NOT NULL,
    `weekNumber` INTEGER NOT NULL,
    `weekStartDate` DATE NOT NULL,
    `weekEndDate` DATE NOT NULL,
    `quantity` DOUBLE NOT NULL,

    INDEX `cycle_mrp_weeks_cycleId_weekStartDate_idx`(`cycleId`, `weekStartDate`),
    INDEX `cycle_mrp_weeks_cycleId_partNumber_idx`(`cycleId`, `partNumber`),
    UNIQUE INDEX `cycle_mrp_weeks_cycleId_partNumber_year_weekNumber_key`(`cycleId`, `partNumber`, `year`, `weekNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cycle_hotlists` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `partNumber` VARCHAR(191) NOT NULL,
    `biTotal` DOUBLE NOT NULL,

    UNIQUE INDEX `cycle_hotlists_cycleId_partNumber_key`(`cycleId`, `partNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cycle_stock_rm` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `itemDesc` VARCHAR(191) NOT NULL,
    `supplier` VARCHAR(191) NULL,
    `qty` DOUBLE NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,

    INDEX `cycle_stock_rm_cycleId_itemDesc_supplier_idx`(`cycleId`, `itemDesc`, `supplier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cycle_outstanding_po` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `itemDesc` VARCHAR(191) NOT NULL,
    `supplierName` VARCHAR(191) NOT NULL,
    `qtyOrder` DOUBLE NOT NULL,
    `qtyOrderUnit` VARCHAR(191) NOT NULL,
    `qtyDelivered` DOUBLE NOT NULL,
    `qtyDeliveredUnit` VARCHAR(191) NOT NULL,
    `planReceivedDate` DATE NOT NULL,

    INDEX `cycle_outstanding_po_cycleId_itemDesc_supplierName_idx`(`cycleId`, `itemDesc`, `supplierName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cycle_wips` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `partNumber` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,

    UNIQUE INDEX `cycle_wips_cycleId_partNumber_location_key`(`cycleId`, `partNumber`, `location`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cycle_results` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `runNumber` INTEGER NOT NULL,
    `periodStartDate` DATE NOT NULL,
    `periodEndDate` DATE NOT NULL,
    `periodWeeks` INTEGER NOT NULL,
    `calculatedAt` DATETIME(3) NOT NULL,
    `calculatedBy` VARCHAR(191) NOT NULL,
    `dataVersionAt` DATETIME(3) NOT NULL,
    `isCurrent` BOOLEAN NOT NULL DEFAULT false,
    `isSaved` BOOLEAN NOT NULL DEFAULT false,
    `savedNote` TEXT NULL,
    `resultSnapshot` JSON NOT NULL,
    `summarySnapshot` JSON NULL,

    INDEX `cycle_results_cycleId_isCurrent_idx`(`cycleId`, `isCurrent`),
    INDEX `cycle_results_cycleId_isSaved_idx`(`cycleId`, `isSaved`),
    UNIQUE INDEX `cycle_results_cycleId_runNumber_key`(`cycleId`, `runNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cycle_audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `cycleId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE') NOT NULL,
    `sourceType` VARCHAR(191) NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `dataBefore` JSON NULL,
    `dataAfter` JSON NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cycle_audit_logs_cycleId_createdAt_idx`(`cycleId`, `createdAt`),
    INDEX `cycle_audit_logs_cycleId_sourceType_idx`(`cycleId`, `sourceType`),
    INDEX `cycle_audit_logs_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `fg_stock_history` ADD CONSTRAINT `fg_stock_history_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fg_stock_history` ADD CONSTRAINT `fg_stock_history_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `master_cartons` ADD CONSTRAINT `master_cartons_toyNameItemId_fkey` FOREIGN KEY (`toyNameItemId`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_schedules` ADD CONSTRAINT `daily_schedules_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_schedules` ADD CONSTRAINT `weekly_schedules_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fg_stocks` ADD CONSTRAINT `fg_stocks_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fg_stocks` ADD CONSTRAINT `fg_stocks_updatedBy_fkey` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wips` ADD CONSTRAINT `wips_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `wips` ADD CONSTRAINT `wips_updatedBy_fkey` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calculation_histories` ADD CONSTRAINT `calculation_histories_savedBy_fkey` FOREIGN KEY (`savedBy`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calculation_source_snapshots` ADD CONSTRAINT `calculation_source_snapshots_historyId_fkey` FOREIGN KEY (`historyId`) REFERENCES `calculation_histories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cycle_source_uploads` ADD CONSTRAINT `cycle_source_uploads_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cycle_mrp_weeks` ADD CONSTRAINT `cycle_mrp_weeks_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cycle_hotlists` ADD CONSTRAINT `cycle_hotlists_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cycle_stock_rm` ADD CONSTRAINT `cycle_stock_rm_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cycle_outstanding_po` ADD CONSTRAINT `cycle_outstanding_po_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cycle_wips` ADD CONSTRAINT `cycle_wips_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cycle_results` ADD CONSTRAINT `cycle_results_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cycle_audit_logs` ADD CONSTRAINT `cycle_audit_logs_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `planning_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cycle_audit_logs` ADD CONSTRAINT `cycle_audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
