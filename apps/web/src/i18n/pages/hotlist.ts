/**
 * Terjemahan halaman Hotlist.
 * Namespace: `hotlist.*`
 */
export default {
  id: {
    subtitle: 'Kelola data hotlist untuk item. Unggah dari Excel atau isi manual.',
    uploadExcel: 'Unggah Excel',
    manualEntry: 'Isi Manual',
    prevDate: 'Sebelumnya:',
    searchIn: 'Cari di {label}...',
    bulkDelete: 'Hapus ({count})',
    totalData: 'Total Data: {count}',
    table: {
      partNumber: 'Nomor Part',
      biTotal: 'BI Total',
    },
    preview: {
      title: 'Pratinjau Data',
      aboutPrefix: 'Anda akan mengimpor',
      aboutSuffix: 'baris. Silakan tinjau data di bawah dan pilih cara menyimpan.',
      searchPlaceholder: 'Cari di pratinjau...',
      saveAdd: 'Simpan (Tambah)',
      saveOverwrite: 'Simpan (Timpa)',
      noData: 'Tidak ada data yang cocok di pratinjau.',
    },
    manual: {
      title: 'Input Hotlist Manual',
      partNumberPlaceholder: 'mis. JKG12-4399T',
    },
    period: {
      none: 'Belum ada periode',
      noneHint: 'Buat periode dulu (mis. September 2026), lalu unggah data HOTLIST ke periode itu.',
      counts: '{hotlist} Item Hot List · {mrp} baris MRP',
      createTitle: 'Buat Periode Baru',
      create: 'Buat',
      fallbackLabel: 'Periode',
      backToList: 'Kembali ke daftar periode',
    },
    empty: {
      title: 'Tidak ada data HOTLIST',
      hint: 'Unggah excel atau isi manual untuk menambahkan data.',
    },
    confirm: {
      removePreview: 'Hapus data ini dari pratinjau?',
      deleteOne: 'Hapus data ini?',
      deleteMany: 'Hapus {count} data?',
    },
    import: {
      addConfirm: 'Tambahkan {count} baris ke periode "{label}"?',
      overwriteConfirm:
        'PERHATIAN: seluruh data HOTLIST di periode "{label}" ({existing} baris) akan DIGANTI dengan {count} baris dari file ini.\n\nPeriode lain tidak terpengaruh. Lanjutkan?',
      success: 'Data berhasil diimpor!',
    },
    errors: {
      noValidData: 'Tidak ada data valid di file.',
      uploadFailed: 'Gagal mengunggah file: {message}',
      createPeriodFailed: 'Gagal membuat periode.',
      selectPeriodFirst: 'Pilih periode dulu sebelum menyimpan data.',
      selectPeriodManual: 'Pilih periode dulu sebelum menambah data manual.',
      fillAllRequired: 'Mohon isi semua kolom wajib.',
      fillAllFields: 'Mohon isi semua kolom.',
      importFailed: 'Gagal mengimpor data: {message}',
      addFailed: 'Gagal menambah data: {message}',
      updateFailed: 'Gagal memperbarui data: {message}',
      deleteFailed: 'Gagal menghapus data: {message}',
      bulkDeleteFailed: 'Gagal menghapus data: {message}',
    },
  },
  en: {
    subtitle: 'Manage hotlist data for items. Upload from Excel or add manually.',
    uploadExcel: 'Upload Excel',
    manualEntry: 'Manual Entry',
    prevDate: 'Prev:',
    searchIn: 'Search in {label}...',
    bulkDelete: 'Delete ({count})',
    totalData: 'Total Data: {count}',
    table: {
      partNumber: 'Part Number',
      biTotal: 'BI Total',
    },
    preview: {
      title: 'Data Preview',
      aboutPrefix: 'You are about to import',
      aboutSuffix: 'records. Please review the data below and choose how to save.',
      searchPlaceholder: 'Search preview...',
      saveAdd: 'Save (Add)',
      saveOverwrite: 'Save (Overwrite)',
      noData: 'No matching data found in preview.',
    },
    manual: {
      title: 'Input Hotlist Manual',
      partNumberPlaceholder: 'e.g. JKG12-4399T',
    },
    period: {
      none: 'No periods yet',
      noneHint: 'Create a period first (e.g. September 2026), then upload HOTLIST data into that period.',
      counts: '{hotlist} Hot List items · {mrp} MRP rows',
      createTitle: 'Create New Period',
      create: 'Create',
      fallbackLabel: 'Period',
      backToList: 'Back to period list',
    },
    empty: {
      title: 'No HOTLIST data',
      hint: 'Upload an Excel file or add data manually.',
    },
    confirm: {
      removePreview: 'Are you sure you want to remove this record from the preview?',
      deleteOne: 'Are you sure you want to delete this record?',
      deleteMany: 'Are you sure you want to delete {count} records?',
    },
    import: {
      addConfirm: 'Add {count} rows to period "{label}"?',
      overwriteConfirm:
        'WARNING: all HOTLIST data in period "{label}" ({existing} rows) will be REPLACED with {count} rows from this file.\n\nOther periods are not affected. Continue?',
      success: 'Data imported successfully!',
    },
    errors: {
      noValidData: 'No valid data found in file.',
      uploadFailed: 'Failed to upload file: {message}',
      createPeriodFailed: 'Failed to create period.',
      selectPeriodFirst: 'Select a period before saving data.',
      selectPeriodManual: 'Select a period before adding manual data.',
      fillAllRequired: 'Please fill all required fields',
      fillAllFields: 'Please fill all fields',
      importFailed: 'Failed to import data: {message}',
      addFailed: 'Failed to add record: {message}',
      updateFailed: 'Failed to update record: {message}',
      deleteFailed: 'Failed to delete record: {message}',
      bulkDeleteFailed: 'Failed to delete records: {message}',
    },
  },
};
