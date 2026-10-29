/**
 * Terjemahan halaman Stock Raw Material.
 * Namespace: `stockRawMaterial.*`
 */
export default {
  id: {
    title: 'Stock Raw Material',
    subtitle: 'Kelola data stok raw material. Unggah dari Excel atau tambah manual.',
    subtitleViewOnly: 'Data stok raw material per periode (hanya lihat).',
    viewOnlyBadge: 'Hanya lihat',
    viewOnlyHint:
      'Halaman ini view-only. Import, tambah, edit, dan hapus data dilakukan di modul Master Data → Stock Raw Material.',
    importExcel: 'Impor Excel',
    addManual: 'Tambah Manual',

    // Pratinjau data
    dataPreview: 'Pratinjau Data',
    previewIntroBefore: 'Anda akan mengimpor',
    previewIntroAfter: 'baris. Periksa data di bawah lalu pilih cara menyimpan.',
    searchPreview: 'Cari di pratinjau...',
    saveAdd: 'Simpan (Tambah)',
    saveOverwrite: 'Simpan (Timpa)',
    noPreviewResults: 'Tidak ada data yang cocok di pratinjau.',
    refBPlaceholder: 'Ref-B (mis. MTL/...)',

    // Ringkasan file
    summaryTitle: 'Ringkasan file Stock Raw Material',
    summaryTotalRows: 'Total baris di file:',
    summaryIncluded: 'Masuk (mengandung "MTL"):',
    summarySkipped: 'Dilewati (tidak mengandung "MTL"):',
    summaryHintBefore: 'Hanya baris dengan kolom',
    summaryHintAfter: 'mengandung "MTL" yang bisa diimpor.',

    // Form isi manual
    addManualTitle: 'Tambah Raw Material Manual',
    refBExample: 'mis. MTL/JUL 26/RP11.000',
    refBHint: 'Wajib mengandung "MTL".',

    // Tabel
    itemDesc: 'Deskripsi Item',
    refB: 'Ref-B',
    supplier: 'Supplier',
    qty: 'Qty',
    unit: 'Satuan',
    noUnit: '(tanpa satuan)',
    lot: 'lot',
    lots: 'lot',
    lotNumber: 'Lot #{number}',
    recordsCount: '{count} baris',
    itemsCount: '{count} Item',
    lotsCount: '{count} Lot',
    deleteCount: 'Hapus ({count})',
    unknownUnits: '⚠️ satuan tidak dikenali: {units}',

    // Daftar periode
    noPeriods: 'Belum ada periode',
    noPeriodsHint:
      'Buat periode dulu (mis. September 2026), lalu unggah data Stock Raw Material ke periode itu.',
    createNewPeriod: 'Buat Periode Baru',
    periodCounts: '{lots} Lot Stok · {mrp} baris MRP',
    backToPeriods: 'Kembali ke daftar periode',
    searchInPeriod: 'Cari di {period}...',

    // Kontrol detail
    expand: 'Buka',
    collapse: 'Tutup',
    expandAllTitle: 'Buka Semua Detail',
    collapseAllTitle: 'Tutup Semua Detail',
    openDetailTitle: 'Buka Detail',
    closeDetailTitle: 'Tutup Detail',
    editLot: 'Ubah Lot',
    deleteLot: 'Hapus Lot',

    // Kondisi kosong
    emptyData: 'Tidak ada data Stock Raw Material',

    // Pesan & konfirmasi
    fillRequiredFields: 'Mohon lengkapi semua field wajib.',
    noValidData: 'Tidak ada data valid di file.',
    uploadFailed: 'Gagal mengunggah file: {error}',
    importSuccess: 'Data berhasil diimpor!',
    importFailed: 'Gagal mengimpor data: {error}',
    addFailed: 'Gagal menambah data: {error}',
    updateFailed: 'Gagal memperbarui data: {error}',
    deleteFailed: 'Gagal menghapus data: {error}',
    bulkDeleteFailed: 'Gagal menghapus data: {error}',
    selectPeriodBeforeSave: 'Pilih periode dulu sebelum menyimpan data.',
    selectPeriodBeforeManual: 'Pilih periode dulu sebelum menambah data manual.',
    confirmAdd: 'Tambahkan {count} baris ke periode "{period}"?',
    confirmOverwrite:
      'PERHATIAN: seluruh data Stock Raw Material di periode "{period}" ({existing} baris) akan DIGANTI dengan {count} baris dari file ini.\n\nPeriode lain tidak terpengaruh. Lanjutkan?',
    confirmRemovePreview: 'Yakin ingin menghapus data ini dari pratinjau?',
    confirmDelete: 'Yakin ingin menghapus data ini?',
    confirmBulkDelete: 'Yakin ingin menghapus {count} data?',

    allocation: {
      title: 'Rekomendasi alokasi material',
      subtitle: '· {count} part bisa memakai lot ini',
      failed: 'Gagal memuat rekomendasi alokasi.',
      noResult:
        'Periode ini belum dihitung. Jalankan Hitung di menu Material Calculation agar rekomendasi alokasi bisa dibuat.',
      noDimension:
        'Ukuran / gramatur tidak terbaca dari deskripsi item, jadi rekomendasi tidak bisa dihitung.',
      empty:
        'Tidak ada part number pada periode ini yang cocok dengan gramatur, ukuran, dan supplier material ini.',
      part: 'Part Number',
      size: 'Ukuran & Gramatur',
      need: 'Kebutuhan',
      cut: 'Potong/lbr',
      wastePerSheet: 'Waste per lembar',
      allocatable: 'Bisa dialokasikan',
      waste: 'Estimasi waste',
      usedNow: 'Terpakai di ukuran ini',
      note:
        'Berdasarkan hasil perhitungan periode ini. Estimasi waste bersifat informasi — trim belum mengurangi alokasi stok, kekurangan, maupun End Ind.',
    },

    usage: {
      tabStock: 'Stok',
      tabUsage: 'Pemakaian',
      failed: 'Gagal memuat data pemakaian stok.',
      noResult:
        'Periode ini belum dihitung, jadi angka pemakaian belum ada. Jalankan Hitung di menu Material Calculation.',
      resultRun: 'Hasil perhitungan run #{run}',
      stale:
        'Data berubah setelah perhitungan — jalankan ulang Hitung agar angkanya akurat.',
      kpiTotal: 'Total stok',
      kpiUsed: 'Sudah dipakai',
      kpiRemaining: 'Belum dipakai',
      kpiUnusedMaterials: 'Material belum terpakai',
      kpiMaterials: '{count} material · {lots} lot',
      kpiStatusBreakdown: '{partial} sebagian · {used} habis',
      search: 'Cari material / supplier...',
      filterAll: 'Semua status',
      colSize: 'Ukuran & Supplier',
      colLots: 'Lot',
      colStock: 'Stok',
      colUsed: 'Sudah dipakai',
      colRemaining: 'Belum dipakai',
      colPct: 'Terpakai %',
      colStatus: 'Status',
      statusUnused: 'Belum terpakai',
      statusPartial: 'Sebagian',
      statusUsed: 'Habis terpakai',
      statusOver: 'Melebihi stok',
      statusNoMatch: 'tidak cocok ukuran',
      sheet: 'lembar',
      expand: 'Buka',
      collapse: 'Tutup',
      expandAll: 'Buka semua',
      collapseAll: 'Tutup semua',
      materialsCount: '{count} material',
      empty: 'Tidak ada material yang cocok dengan filter.',
      noData: 'Belum ada data stok raw material di periode ini.',
      unknownUnit: 'Satuan tidak dikenal: {units}',
      overNote:
        'Pemakaian melebihi stok — data stok berubah setelah perhitungan terakhir.',
      allocTitle: 'Dipakai untuk ukuran',
      allocSize: 'Ukuran tujuan',
      allocParts: 'Part number',
      allocMultiplier: 'Potong/lbr',
      allocSheet: 'Lembar fisik',
      allocKg: 'Kg terpakai',
      allocEmpty: 'Belum dipakai ukuran mana pun.',
      note:
        'Angka "sudah dipakai" berasal dari hasil perhitungan periode ini (alokasi material ke ukuran part), bukan pemakaian fisik dari gudang. Material yang tidak muncul di hasil perhitungan tetap ditampilkan dengan pemakaian 0.',
    },
  },
  en: {
    title: 'Stock Raw Material',
    subtitle: 'Manage stock raw material data. Upload from Excel or add manually.',
    subtitleViewOnly: 'Raw material stock data per period (read-only).',
    viewOnlyBadge: 'View only',
    viewOnlyHint:
      'This page is read-only. Import, add, edit, and delete are done in the Master Data module → Stock Raw Material.',
    importExcel: 'Import Excel',
    addManual: 'Add Manual',

    // Data preview
    dataPreview: 'Data Preview',
    previewIntroBefore: 'You are about to import',
    previewIntroAfter: 'records. Please review the data below and choose how to save.',
    searchPreview: 'Search preview...',
    saveAdd: 'Save (Add)',
    saveOverwrite: 'Save (Overwrite)',
    noPreviewResults: 'No matching data found in preview.',
    refBPlaceholder: 'Ref-B (e.g. MTL/...)',

    // File summary
    summaryTitle: 'Stock Raw Material file summary',
    summaryTotalRows: 'Total rows in file:',
    summaryIncluded: 'Included (contains "MTL"):',
    summarySkipped: 'Skipped (does not contain "MTL"):',
    summaryHintBefore: 'Only rows whose',
    summaryHintAfter: 'column contains "MTL" can be imported.',

    // Manual entry form
    addManualTitle: 'Add Raw Material Manual',
    refBExample: 'e.g. MTL/JUL 26/RP11.000',
    refBHint: 'Must contain "MTL".',

    // Table
    itemDesc: 'Item Desc',
    refB: 'Ref-B',
    supplier: 'Supplier',
    qty: 'Qty',
    unit: 'Unit',
    noUnit: '(no unit)',
    lot: 'lot',
    lots: 'lots',
    lotNumber: 'Lot #{number}',
    recordsCount: '{count} records',
    itemsCount: '{count} Items',
    lotsCount: '{count} Lots',
    deleteCount: 'Delete ({count})',
    unknownUnits: '⚠️ unrecognized unit(s): {units}',

    // Period list
    noPeriods: 'No periods yet',
    noPeriodsHint:
      'Create a period first (e.g. September 2026), then upload Stock Raw Material data to that period.',
    createNewPeriod: 'Create New Period',
    periodCounts: '{lots} Stock Lots · {mrp} MRP rows',
    backToPeriods: 'Back to period list',
    searchInPeriod: 'Search in {period}...',

    // Detail controls
    expand: 'Expand',
    collapse: 'Collapse',
    expandAllTitle: 'Expand All Details',
    collapseAllTitle: 'Collapse All Details',
    openDetailTitle: 'Open Detail',
    closeDetailTitle: 'Close Detail',
    editLot: 'Edit Lot',
    deleteLot: 'Delete Lot',

    // Empty states
    emptyData: 'No Stock Raw Material data',

    // Messages & confirmations
    fillRequiredFields: 'Please fill all required fields',
    noValidData: 'No valid data found in file.',
    uploadFailed: 'Failed to upload file: {error}',
    importSuccess: 'Data imported successfully!',
    importFailed: 'Failed to import data: {error}',
    addFailed: 'Failed to add record: {error}',
    updateFailed: 'Failed to update record: {error}',
    deleteFailed: 'Failed to delete record: {error}',
    bulkDeleteFailed: 'Failed to delete records: {error}',
    selectPeriodBeforeSave: 'Select a period before saving data.',
    selectPeriodBeforeManual: 'Select a period before adding manual data.',
    confirmAdd: 'Add {count} rows to period "{period}"?',
    confirmOverwrite:
      'WARNING: all Stock Raw Material data in period "{period}" ({existing} rows) will be REPLACED with {count} rows from this file.\n\nOther periods are not affected. Continue?',
    confirmRemovePreview: 'Are you sure you want to remove this record from the preview?',
    confirmDelete: 'Are you sure you want to delete this record?',
    confirmBulkDelete: 'Are you sure you want to delete {count} records?',

    allocation: {
      title: 'Material allocation recommendation',
      subtitle: '· {count} parts can use this lot',
      failed: 'Failed to load the allocation recommendation.',
      noResult:
        'This period has not been calculated yet. Run Calculate in Material Calculation so the recommendation can be built.',
      noDimension:
        'The size / grammage cannot be read from the item description, so the recommendation cannot be calculated.',
      empty:
        'No part number in this period matches this material grammage, size, and supplier.',
      part: 'Part Number',
      size: 'Size & Grammage',
      need: 'Requirement',
      cut: 'Cut/sheet',
      wastePerSheet: 'Waste per sheet',
      allocatable: 'Allocatable',
      waste: 'Estimated waste',
      usedNow: 'Used in this size',
      note:
        'Based on this period calculation. The waste estimate is informational — trim does not reduce stock allocation, shortage, or End In.',
    },

    usage: {
      tabStock: 'Stock',
      tabUsage: 'Usage',
      failed: 'Failed to load stock usage data.',
      noResult:
        'This period has not been calculated yet, so usage figures are not available. Run Calculate in Material Calculation.',
      resultRun: 'Calculation run #{run}',
      stale: 'Data changed after the calculation — run Calculate again for accurate figures.',
      kpiTotal: 'Total stock',
      kpiUsed: 'Used',
      kpiRemaining: 'Not used yet',
      kpiUnusedMaterials: 'Unused materials',
      kpiMaterials: '{count} materials · {lots} lots',
      kpiStatusBreakdown: '{partial} partial · {used} used up',
      search: 'Search material / supplier...',
      filterAll: 'All statuses',
      colSize: 'Size & Supplier',
      colLots: 'Lots',
      colStock: 'Stock',
      colUsed: 'Used',
      colRemaining: 'Not used yet',
      colPct: 'Used %',
      colStatus: 'Status',
      statusUnused: 'Not used',
      statusPartial: 'Partial',
      statusUsed: 'Used up',
      statusOver: 'Over stock',
      statusNoMatch: 'size not matched',
      sheet: 'sheets',
      expand: 'Open',
      collapse: 'Close',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
      materialsCount: '{count} materials',
      empty: 'No material matches the filter.',
      noData: 'No raw material stock data in this period yet.',
      unknownUnit: 'Unknown unit: {units}',
      overNote: 'Usage exceeds stock — stock data changed after the last calculation.',
      allocTitle: 'Used for size',
      allocSize: 'Target size',
      allocParts: 'Part numbers',
      allocMultiplier: 'Cut/sheet',
      allocSheet: 'Physical sheets',
      allocKg: 'Kg used',
      allocEmpty: 'Not used by any size yet.',
      note:
        '"Used" comes from this period calculation (material allocated to part sizes), not physical warehouse consumption. Materials that never appear in the calculation are still listed with 0 usage.',
    },
  },
};
