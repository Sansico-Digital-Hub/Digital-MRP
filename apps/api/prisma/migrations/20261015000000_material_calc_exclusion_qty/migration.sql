-- ============================================================================
-- Material Calculation: pengecualian pool SEBAGIAN (qty) per ukuran
-- ============================================================================
-- Permintaan user (2026-10-15): "untuk edit yang dimaksud itu bukan hanya
-- mengeluarkan keseluruhan qty po nya tapi bisa juga hanya memakai sebagian
-- dari yang ada".
--
-- Sebelumnya satu baris `material_calc_exclusions` selalu berarti "seluruh pool
-- item dikeluarkan dari ukuran itu". Sekarang baris yang sama boleh menyimpan
-- jumlah yang dikeluarkan saja:
--   qty  = jumlah yang DIKELUARKAN dari ukuran ini (NULL/0 = seluruhnya)
--   unit = satuan qty (`kg` untuk bagian bersatuan kg, `sheet` untuk bagian
--          bersatuan lembar)
--
-- Bagian yang TIDAK dikeluarkan tetap dihitung di ukuran ini: baris
-- `Outstanding PO` menghitung `qty − excluded`, dan alokasi membatasi pemakaian
-- pool item itu oleh grup ini pada angka yang sama (lihat `partialCaps` di
-- materialCalcEngine.ts).
-- ============================================================================

ALTER TABLE `material_calc_exclusions`
    ADD COLUMN `qty` DOUBLE NULL,
    ADD COLUMN `unit` VARCHAR(191) NULL;
