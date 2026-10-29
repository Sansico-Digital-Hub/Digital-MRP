/**
 * Terjemahan halaman Outstanding PO.
 * Namespace: `outstandingPo.*`
 */
export default {
  id: {
    title: 'Outstanding PO',
    subtitle: 'Kelola data outstanding PO. Unggah dari Excel atau tambahkan secara manual.',
    importExcel: 'Impor Excel',
    addManual: 'Tambah Manual',
    addManualTitle: 'Tambah Outstanding PO Manual',

    // Panel pratinjau
    dataPreview: 'Pratinjau Data',
    aboutToImportPre: 'Anda akan mengimpor',
    aboutToImportPost: 'baris data.',
    searchPreviewPlaceholder: 'Cari PO Number / item...',
    saveAdd: 'Simpan (Tambah)',
    saveOverwrite: 'Simpan (Timpa)',

    // Ringkasan file
    summaryTitle: 'Ringkasan file Outstanding PO',
    summaryTotalRows: 'Total baris di file:',
    summaryIncluded: 'Masuk (mengandung "MTL"):',
    summarySkipped: 'Dilewati (tidak mengandung "MTL"):',
    summaryFailed: 'Gagal:',
    onlyMtlRowsPre: 'Hanya baris dengan kolom',
    onlyMtlRowsPost: 'mengandung "MTL" yang bisa diimpor.',

    // Baris gagal diimpor
    importErrorsTitle: '{count} baris GAGAL diimpor — baris valid tetap diproses',
    rowLabel: 'Baris {row}',
    fixPoNoPre: 'Perbaiki kolom',
    fixPoNoPost:
      'di file Excel lalu impor ulang, atau tambahkan PO Number langsung pada baris pratinjau di bawah.',

    // Judul kolom
    planDate: 'Tanggal Rencana',
    poNumber: 'Nomor PO',
    supplier: 'Supplier',
    itemDesc: 'Deskripsi Item',
    refBLabel: 'Ref-B',
    qtyOrder: 'Qty Pesanan',
    unit: 'Satuan',
    qtyDelivered: 'Qty Terkirim',

    // Baris grup
    planDatesCount: '{count} Tanggal Rencana',
    itemsCount: '{count} Item',
    posCount: '{count} PO',
    poTooltip: 'PO: {numbers}',
    moreItems: '+{count} lagi',

    // Aksi perluasan
    expand: 'Buka',
    expandAll: 'Buka Semua Detail',
    collapseAll: 'Tutup Semua Detail',
    expandDetail: 'Buka Detail',
    collapseDetail: 'Tutup Detail',

    // Pratinjau / tabel
    noPreviewData: 'Tidak ada data yang cocok di pratinjau.',
    emptyPo: '(kosong)',
    editRow: 'Edit baris',
    deleteFromPreview: 'Hapus dari pratinjau',
    editPo: 'Edit PO',
    deletePo: 'Hapus PO',

    // Form manual
    planReceivedDate: 'Tanggal Rencana Terima',
    poNumberPlaceholder: 'mis. L1G000602',
    supplierPlaceholder: 'Nama Supplier',
    itemDescPlaceholder: 'Deskripsi Item',
    refBInputPlaceholder: 'Ref-B (mis. MTL/...)',
    refBExample: 'mis. MTL/JUL 26/RP11000',
    refBMtlRequired: 'Wajib mengandung "MTL".',
    orderUnit: 'Satuan Pesanan',
    deliveredUnit: 'Satuan Terkirim',

    // Daftar periode
    noPeriods: 'Belum ada periode',
    noPeriodsHint:
      'Buat periode dulu (mis. September 2026), lalu upload data Outstanding PO ke periode itu.',
    periodCounts: '{po} Baris PO · {mrp} baris MRP',
    createNewPeriod: 'Buat Periode Baru',
    backToPeriods: 'Kembali ke daftar periode',
    searchInPeriod: 'Cari di {period}...',
    deleteCount: 'Hapus ({count})',
    noData: 'Tidak ada data Outstanding PO',

    errors: {
      noValidData: 'Tidak ada data valid di file.',
      selectPeriodSave: 'Pilih periode dulu sebelum menyimpan data.',
      missingPo: '{count} baris belum punya PO Number. PO Number wajib diisi untuk semua baris.',
      confirmAdd: 'Tambahkan {count} baris ke periode "{period}"?',
      confirmOverwrite:
        'PERHATIAN: seluruh data Outstanding PO di periode "{period}" ({existing} baris) akan DIGANTI dengan {count} baris dari file ini.\n\nPeriode lain tidak terpengaruh. Lanjutkan?',
      importSuccess: 'Data berhasil diimpor!',
      importFailed: 'Gagal mengimpor data: {message}',
      uploadFailed: 'Gagal mengunggah file: {message}',
      fillRequiredFields: 'Mohon isi semua kolom wajib (PO Number wajib diisi)',
      confirmRemovePreview: 'Yakin ingin menghapus baris ini dari pratinjau?',
      selectPeriodManual: 'Pilih periode dulu sebelum menambah data manual.',
      addFailed: 'Gagal menambah data: {message}',
      confirmDelete: 'Yakin ingin menghapus data ini?',
      deleteFailed: 'Gagal menghapus data: {message}',
      confirmBulkDelete: 'Yakin ingin menghapus {count} data?',
      bulkDeleteFailed: 'Gagal menghapus data: {message}',
      updateFailed: 'Gagal memperbarui data: {message}',
    },
  },
  en: {
    title: 'Outstanding PO',
    subtitle: 'Manage outstanding PO data. Upload from Excel or add manually.',
    importExcel: 'Import Excel',
    addManual: 'Add Manual',
    addManualTitle: 'Add Outstanding PO Manual',

    // Preview panel
    dataPreview: 'Data Preview',
    aboutToImportPre: 'You are about to import',
    aboutToImportPost: 'records.',
    searchPreviewPlaceholder: 'Search PO Number / item...',
    saveAdd: 'Save (Add)',
    saveOverwrite: 'Save (Overwrite)',

    // File summary
    summaryTitle: 'Outstanding PO File Summary',
    summaryTotalRows: 'Total rows in file:',
    summaryIncluded: 'Included (containing "MTL"):',
    summarySkipped: 'Skipped (not containing "MTL"):',
    summaryFailed: 'Failed:',
    onlyMtlRowsPre: 'Only rows with the',
    onlyMtlRowsPost: 'column containing "MTL" can be imported.',

    // Failed rows
    importErrorsTitle: '{count} rows FAILED to import — valid rows are still processed',
    rowLabel: 'Row {row}',
    fixPoNoPre: 'Fix the',
    fixPoNoPost:
      'column in the Excel file then re-import, or add a PO Number directly on the preview row below.',

    // Column headers
    planDate: 'Plan Date',
    poNumber: 'PO Number',
    supplier: 'Supplier',
    itemDesc: 'Item Desc',
    refBLabel: 'Ref-B',
    qtyOrder: 'Qty Order',
    unit: 'Unit',
    qtyDelivered: 'Qty Delivered',

    // Group rows
    planDatesCount: '{count} Plan Dates',
    itemsCount: '{count} Items',
    posCount: '{count} POs',
    poTooltip: 'PO: {numbers}',
    moreItems: '+{count} more',

    // Expand actions
    expand: 'Expand',
    expandAll: 'Expand All Details',
    collapseAll: 'Collapse All Details',
    expandDetail: 'Expand Detail',
    collapseDetail: 'Collapse Detail',

    // Preview / table
    noPreviewData: 'No matching data found in preview.',
    emptyPo: '(empty)',
    editRow: 'Edit row',
    deleteFromPreview: 'Remove from preview',
    editPo: 'Edit PO',
    deletePo: 'Delete PO',

    // Manual form
    planReceivedDate: 'Plan Received Date',
    poNumberPlaceholder: 'e.g. L1G000602',
    supplierPlaceholder: 'Supplier Name',
    itemDescPlaceholder: 'Item Description',
    refBInputPlaceholder: 'Ref-B (e.g. MTL/...)',
    refBExample: 'e.g. MTL/JUL 26/RP11000',
    refBMtlRequired: 'Must contain "MTL".',
    orderUnit: 'Order Unit',
    deliveredUnit: 'Delivered Unit',

    // Period list
    noPeriods: 'No periods yet',
    noPeriodsHint:
      'Create a period first (e.g. September 2026), then upload Outstanding PO data to that period.',
    periodCounts: '{po} PO rows · {mrp} MRP rows',
    createNewPeriod: 'Create New Period',
    backToPeriods: 'Back to period list',
    searchInPeriod: 'Search in {period}...',
    deleteCount: 'Delete ({count})',
    noData: 'No Outstanding PO data',

    errors: {
      noValidData: 'No valid data found in file.',
      selectPeriodSave: 'Select a period before saving data.',
      missingPo: '{count} rows have no PO Number. PO Number is required for every row.',
      confirmAdd: 'Add {count} rows to period "{period}"?',
      confirmOverwrite:
        'WARNING: all Outstanding PO data in period "{period}" ({existing} rows) will be REPLACED with {count} rows from this file.\n\nOther periods are not affected. Continue?',
      importSuccess: 'Data imported successfully!',
      importFailed: 'Failed to import data: {message}',
      uploadFailed: 'Failed to upload file: {message}',
      fillRequiredFields: 'Please fill in all required fields (PO Number is required)',
      confirmRemovePreview: 'Are you sure you want to remove this record from the preview?',
      selectPeriodManual: 'Select a period before adding manual data.',
      addFailed: 'Failed to add record: {message}',
      confirmDelete: 'Are you sure you want to delete this record?',
      deleteFailed: 'Failed to delete record: {message}',
      confirmBulkDelete: 'Are you sure you want to delete {count} records?',
      bulkDeleteFailed: 'Failed to delete records: {message}',
      updateFailed: 'Failed to update record: {message}',
    },
  },
};
