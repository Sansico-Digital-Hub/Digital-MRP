/**
 * Terjemahan halaman Stock Raw Material.
 * Namespace: `stockRawMaterial.*`
 */
export default {
  id: {
    title: 'Stock Raw Material',
    subtitle: 'Kelola data stok raw material. Unggah dari Excel atau tambah manual.',
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
  },
  en: {
    title: 'Stock Raw Material',
    subtitle: 'Manage stock raw material data. Upload from Excel or add manually.',
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
  },
};
