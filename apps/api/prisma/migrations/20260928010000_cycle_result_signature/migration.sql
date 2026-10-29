-- ============================================================================
-- Checksum data master per hasil perhitungan
-- ============================================================================
-- Menyimpan snapshot RINGKAS data master tiap sumber (MRP, HOTLIST, STOCK_RM,
-- OUTSTANDING_PO, WIP) tepat saat perhitungan dijalankan:
--   { rows: number, sum: number, lastUpdatedAt: string | null }
--
-- Ketika folder periode dibuka kembali, nilai ini dibandingkan dengan kondisi
-- data master SEKARANG. Kalau berbeda -> hasil dianggap tidak valid dan UI
-- menampilkan "Calculation tidak valid karena ada perubahan data. Silakan
-- hitung ulang."
--
-- Aman untuk data lama: kolom NULL berarti perhitungan lama belum punya
-- checksum, sehingga status "tidak valid" ditentukan dari perbandingan
-- `planning_cycles.lastDataChangeAt` vs `cycle_results.dataVersionAt` (cara lama).
-- ============================================================================

-- AlterTable
ALTER TABLE `cycle_results` ADD COLUMN `dataSignature` JSON NULL;
