-- ============================================================================
-- Outstanding PO: kolom `poNumber` (nomor PO) — WAJIB diisi
-- ============================================================================
-- Nomor PO berasal dari kolom `PO NO` pada file Excel Outstanding PO, dan juga
-- diinput manual. Sifatnya MANDATORY tapi TIDAK UNIK: satu nomor PO boleh
-- dipakai untuk beberapa item/baris.
--
-- Strategi data lama:
--   Kolom ditambahkan dengan DEFAULT sementara 'TANPA-PO' supaya baris yang
--   sudah ada tidak menggagalkan migrasi (NOT NULL tanpa default akan ditolak
--   MySQL kalau tabel sudah berisi data).
--   Default itu langsung DIHAPUS lagi di baris berikutnya, sehingga setelah
--   migrasi tidak ada jalur input baru yang bisa lolos tanpa PO Number.
--   Baris lama yang bernilai 'TANPA-PO' sengaja dibiarkan dan mudah dicari
--   (`WHERE poNumber = 'TANPA-PO'`) untuk di-backfill manual lewat form Edit.
-- ============================================================================

-- AlterTable: tambah kolom wajib dengan nilai placeholder untuk data lama
ALTER TABLE `outstanding_pos` ADD COLUMN `poNumber` VARCHAR(191) NOT NULL DEFAULT 'TANPA-PO';

-- Hapus DEFAULT agar kolom murni wajib diisi aplikasi (bukan diam-diam terisi)
ALTER TABLE `outstanding_pos` ALTER COLUMN `poNumber` DROP DEFAULT;

-- CreateIndex
CREATE INDEX `outstanding_pos_periodId_poNumber_idx` ON `outstanding_pos`(`periodId`, `poNumber`);
