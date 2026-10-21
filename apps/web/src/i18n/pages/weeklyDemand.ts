/**
 * Terjemahan halaman 26-Week Demand (MRP).
 * Namespace: `weeklyDemand.*`
 */
export default {
  id: {
    title: '26-Week Demand Plan',
    subtitle: 'Rencana kebutuhan produksi selama 26 minggu ke depan.',
    next26Weeks: '26 minggu ke depan dari hari ini',
    importExcel: 'Import Excel',
    addDemand: 'Add Demand',
    partNumber: 'Part Number',
    saving: 'Menyimpan...',
    weekWithDate: 'Minggu {week} ({date})',
    weekOnly: 'Minggu {week}',

    form: {
      title: 'Add Weekly Demand',
      saveHint:
        'Gunakan "Save Add" untuk menambahkan ke data yang ada, atau "Save Overwrite" untuk mengganti.',
      searchPartNumber: 'Cari Part Number...',
      searchDescription: 'Cari Description...',
      selectWeekDate: 'Pilih Minggu & Tanggal',
      selectWeekHint:
        'Pilih minggu target pengisian demand plan (minggu dihitung dari hari Sabtu sampai Jumat berikutnya).',
      quantityPerWeek: 'Quantity / Week',
      saveAdd: 'Simpan (Tambah)',
      saveOverwrite: 'Simpan (Timpa)',
    },

    periods: {
      emptyTitle: 'Belum ada periode',
      emptyHint:
        'Buat periode dulu (mis. September 2026), lalu upload data MRP ke periode itu.',
      editTitle: 'Edit Periode',
      deleteTitle: 'Hapus Periode',
      createNew: 'Buat Periode Baru',
      create: 'Buat {label}',
      fallback: 'Periode',
      rowsMrp: '{count} baris MRP {module}',
    },

    table: {
      back: 'Kembali ke daftar periode',
      deleteSelected: 'Hapus Terpilih ({count})',
      searchPlaceholder: 'Cari Part Number atau Description...',
      weekRange: 'Minggu {from}–{to}',
      weekShort: 'W{week}',
      noData: 'Belum ada data.',
      noDataAdminBefore: 'Belum ada data. Klik ',
      noDataAdminLink: 'Import Excel',
      noDataAdminAfter: ' untuk upload data 26-week demand.',
      showing: 'Menampilkan {items} item · {weeks}',
      onlyFutureWeeks: 'hanya minggu yang belum lewat',
      rowRange: 'Baris {from}–{to} / {total}',
    },

    import: {
      title: 'Import 26-Week Demand Plan',
      uploadHint1: 'Upload file Excel dengan format: kolom ',
      uploadHint2: ' (Part Number), ',
      uploadHint3: ' (Description), lalu kolom Week ',
      uploadHint4: ' dengan tanggal di bawahnya.',
      totalItems: 'Total Item',
      uniqueParts: 'Part Unik',
      totalQty: 'Total Qty',
      dataYear: 'Tahun Data:',
      searchPlaceholder: 'Cari Part Number / Description...',
      itemsCount: '{shown}/{total} item',
      dataWeeks: 'Minggu Data',
      del: 'Hapus',
      weekRangeParens: 'W{from}–W{to} ({count} {unit})',
      saveAdd: 'Simpan (Tambah)',
      saveOverwrite: 'Simpan (Timpa)',
      success: 'Berhasil import {count} data ke modul {module}!',
    },

    edit: {
      title: 'Edit Demand',
      week: 'Minggu',
      saveChanges: 'Simpan Perubahan',
    },

    errors: {
      createPeriod: 'Gagal membuat periode.',
      updatePeriod: 'Gagal mengubah periode.',
      deletePeriodConfirm:
        'Yakin ingin menghapus periode ini? Semua data di dalamnya akan terhapus.',
      deletePeriod: 'Gagal menghapus periode.',
      updateSchedule: 'Gagal memperbarui jadwal.',
      deleteRecordConfirm: 'Yakin ingin menghapus data ini?',
      deleteSchedule: 'Gagal menghapus jadwal.',
      deleteSelectedConfirm: 'Yakin ingin menghapus demand untuk {count} item terpilih?',
      deleteRecords: 'Gagal menghapus data.',
      parseExcel:
        'Tidak dapat membaca file Excel. Pastikan format sesuai (kolom PN, Description, Week 1-26).',
      readExcel: 'Gagal membaca file Excel.',
      selectPeriod: 'Pilih periode dulu sebelum menyimpan data.',
      saveData: 'Gagal menyimpan data.',
      endBeforeStart: 'Tanggal Selesai tidak boleh lebih kecil dari Tanggal Mulai.',
    },
  },
  en: {
    title: '26-Week Demand Plan',
    subtitle: 'Production demand plan for the next 26 weeks.',
    next26Weeks: 'Next 26 weeks from today',
    importExcel: 'Import Excel',
    addDemand: 'Add Demand',
    partNumber: 'Part Number',
    saving: 'Saving...',
    weekWithDate: 'Week {week} ({date})',
    weekOnly: 'Week {week}',

    form: {
      title: 'Add Weekly Demand',
      saveHint:
        'Use "Save Add" to add to existing data, or "Save Overwrite" to replace it.',
      searchPartNumber: 'Search Part Number...',
      searchDescription: 'Search Description...',
      selectWeekDate: 'Select Week & Date',
      selectWeekHint:
        'Choose the target week for the demand plan (weeks run from Saturday to the following Friday).',
      quantityPerWeek: 'Quantity / Week',
      saveAdd: 'Save (Add)',
      saveOverwrite: 'Save (Overwrite)',
    },

    periods: {
      emptyTitle: 'No periods yet',
      emptyHint: 'Create a period first (e.g. September 2026), then upload MRP data into it.',
      editTitle: 'Edit Period',
      deleteTitle: 'Delete Period',
      createNew: 'Create New Period',
      create: 'Create {label}',
      fallback: 'Period',
      rowsMrp: '{count} MRP rows {module}',
    },

    table: {
      back: 'Back to period list',
      deleteSelected: 'Delete Selected ({count})',
      searchPlaceholder: 'Search Part Number or Description...',
      weekRange: 'Week {from}–{to}',
      weekShort: 'W{week}',
      noData: 'No data yet.',
      noDataAdminBefore: 'No data yet. Click ',
      noDataAdminLink: 'Import Excel',
      noDataAdminAfter: ' to upload 26-week demand data.',
      showing: 'Showing {items} items · {weeks}',
      onlyFutureWeeks: 'future weeks only',
      rowRange: 'Rows {from}–{to} / {total}',
    },

    import: {
      title: 'Import 26-Week Demand Plan',
      uploadHint1: 'Upload an Excel file in this format: column ',
      uploadHint2: ' (Part Number), ',
      uploadHint3: ' (Description), then Week column ',
      uploadHint4: ' with the dates below it.',
      totalItems: 'Total Items',
      uniqueParts: 'Unique Parts',
      totalQty: 'Total Qty',
      dataYear: 'Data Year:',
      searchPlaceholder: 'Search Part Number / Description...',
      itemsCount: '{shown}/{total} items',
      dataWeeks: 'Data Weeks',
      del: 'Del',
      weekRangeParens: 'W{from}–W{to} ({count} {unit})',
      saveAdd: 'Save (Add)',
      saveOverwrite: 'Save (Overwrite)',
      success: 'Successfully imported {count} records into the {module} module!',
    },

    edit: {
      title: 'Edit Demand',
      week: 'Week',
      saveChanges: 'Save Changes',
    },

    errors: {
      createPeriod: 'Failed to create the period.',
      updatePeriod: 'Failed to update the period.',
      deletePeriodConfirm:
        'Are you sure you want to delete this period? All data inside it will be removed.',
      deletePeriod: 'Failed to delete the period.',
      updateSchedule: 'Failed to update schedule.',
      deleteRecordConfirm: 'Are you sure you want to delete this record?',
      deleteSchedule: 'Failed to delete schedule.',
      deleteSelectedConfirm:
        'Are you sure you want to delete the demand for {count} selected items?',
      deleteRecords: 'Failed to delete records.',
      parseExcel:
        'Cannot parse the Excel file. Make sure the format is correct (PN, Description, Week 1-26 columns).',
      readExcel: 'Failed to read the Excel file.',
      selectPeriod: 'Select a period before saving data.',
      saveData: 'Failed to save data.',
      endBeforeStart: 'End Date cannot be earlier than Start Date.',
    },
  },
};
