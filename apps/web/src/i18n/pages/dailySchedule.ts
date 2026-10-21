/**
 * Terjemahan halaman Daily Schedule.
 * Namespace: `dailySchedule.*`
 */
export default {
  id: {
    title: 'Jadwal Permintaan Harian',
    subtitle: 'Kelola kebutuhan permintaan produksi harian.',

    importData: 'Impor Data',
    addDemand: 'Tambah Permintaan',

    // Kartu ringkasan
    runningItems: 'Item Berjalan',
    runningItemsDesc: 'Item unik yang dijadwalkan untuk produksi pada tanggal ini.',
    totalDemandQty: 'Total Kuantitas Permintaan',
    totalDemandQtyDesc: 'Total kuantitas yang diminta di semua shift dan item.',
    shiftBreakdown: 'Rincian Shift',
    shiftBreakdownDesc: 'Distribusi kuantitas di tiga shift harian.',

    // Shift
    shift: 'Shift',
    shift1: 'Shift 1',
    shift2: 'Shift 2',
    shift3: 'Shift 3',
    allShifts: 'Semua Shift',

    // Formulir
    recordSchedule: 'Catat Jadwal Harian',
    recordNote: 'Catatan: Gunakan "Simpan Tambah" untuk menambahkan ke kuantitas yang ada, atau "Simpan Timpa" untuk menggantinya sepenuhnya.',
    toyName: 'Nama Mainan',
    masterCarton: 'Master Carton',
    partNumber: 'Part Number',
    quantityRequired: 'Kuantitas Dibutuhkan',
    selectOrEnterToyName: 'Pilih atau masukkan Nama Mainan...',
    selectOrEnterMasterCarton: 'Pilih atau masukkan Master Carton...',
    selectOrEnterPartNumber: 'Pilih atau masukkan Part Number...',
    saveAdd: 'Simpan Tambah',
    saveOverwrite: 'Simpan Timpa',
    saving: 'Menyimpan...',

    // Toolbar & tabel utama
    deleteSelected: 'Hapus Terpilih ({count})',
    searchPlaceholder: 'Cari Part Number atau Nama Mainan...',
    targetDemand: 'Target Permintaan',
    noDemand: 'Tidak ada permintaan terjadwal.',
    editRecord: 'Ubah Data',
    deleteRecord: 'Hapus Data',

    // Modal ubah
    editDailySchedule: 'Ubah Jadwal Harian',
    saveChanges: 'Simpan Perubahan',
    dateValue: 'Tanggal: {date}',

    // Modal impor
    importDailySchedule: 'Impor Jadwal Harian',
    importHint: 'Unggah file Excel Jadwal Harian (.xlsx / .xlsm). Dua format didukung:',
    importFlatLabel: 'Tabel datar',
    importFlatPrefix: ' — kolom: ',
    importFlatColumns: 'Nama Mainan, Master Carton, Part Number, Tanggal, Shift 1, Shift 2, Shift 3',
    importFlatSuffix: ' (mis. DailySchedule.xlsx)',
    importPivotLabel: 'FA_Attach pivot',
    importPivotDesc: ' — header tanggal di baris 2, sub-header shift di baris 3 (mis. NEXT Week Daily Production Schedule.xlsm)',
    totalRecords: 'Total Data',
    uniqueParts: 'Part Unik',
    days: 'Hari',
    totalQuantity: 'Total Kuantitas',
    recordsShown: '{shown} dari {total} data ditampilkan',
    importSearchPlaceholder: 'Cari berdasarkan Part Number, Nama Mainan, Tanggal...',
    saveAddParen: 'Simpan (Tambah)',

    // Pesan konfirmasi & kesalahan
    confirmDeleteOne: 'Yakin ingin menghapus data ini?',
    confirmDeleteMany: 'Yakin ingin menghapus {count} data terpilih?',
    failedUpdate: 'Gagal memperbarui jadwal',
    failedDelete: 'Gagal menghapus jadwal',
    failedDeleteRecords: 'Gagal menghapus data',
    partNumberRequired: 'Silakan pilih atau masukkan Part Number',
    failedSave: 'Gagal menyimpan jadwal',
    parseError: 'Tidak dapat memproses file Excel.\n\nFormat yang didukung:\n1. Tabel datar dengan kolom: Nama Mainan, Master Carton, Part Number, Tanggal, Shift 1, Shift 2, Shift 3\n2. Lembar pivot FA_Attach dari NEXT Week Daily Production Schedule.xlsm',
    parseFailed: 'Gagal memproses file Excel. Silakan periksa format file.',
    importSuccess: 'Berhasil mengimpor {count} data jadwal!',
    failedBulkImport: 'Gagal mengimpor Jadwal Harian secara massal',
  },
  en: {
    title: 'Daily Demand Schedule',
    subtitle: 'Manage daily production demand requirements.',

    importData: 'Import Data',
    addDemand: 'Add Demand',

    // Summary cards
    runningItems: 'Running Items',
    runningItemsDesc: 'Unique items scheduled for production on this date.',
    totalDemandQty: 'Total Demand Qty',
    totalDemandQtyDesc: 'Total quantity demanded across all shifts and items.',
    shiftBreakdown: 'Shift Breakdown',
    shiftBreakdownDesc: 'Quantity distribution across the three daily shifts.',

    // Shift
    shift: 'Shift',
    shift1: 'Shift 1',
    shift2: 'Shift 2',
    shift3: 'Shift 3',
    allShifts: 'All Shifts',

    // Form
    recordSchedule: 'Record Daily Schedule',
    recordNote: 'Note: Use "Save Add" to add to existing quantity, or "Save Overwrite" to replace it entirely.',
    toyName: 'Toy Name',
    masterCarton: 'Master Carton',
    partNumber: 'Part Number',
    quantityRequired: 'Quantity Required',
    selectOrEnterToyName: 'Select or enter Toy Name...',
    selectOrEnterMasterCarton: 'Select or enter Master Carton...',
    selectOrEnterPartNumber: 'Select or enter Part Number...',
    saveAdd: 'Save Add',
    saveOverwrite: 'Save Overwrite',
    saving: 'Saving...',

    // Toolbar & main table
    deleteSelected: 'Delete Selected ({count})',
    searchPlaceholder: 'Search Part Number or Toy Name...',
    targetDemand: 'Target Demand',
    noDemand: 'No demand scheduled.',
    editRecord: 'Edit Record',
    deleteRecord: 'Delete Record',

    // Edit modal
    editDailySchedule: 'Edit Daily Schedule',
    saveChanges: 'Save Changes',
    dateValue: 'Date: {date}',

    // Import modal
    importDailySchedule: 'Import Daily Schedule',
    importHint: 'Upload a Daily Schedule Excel file (.xlsx / .xlsm). Two formats are supported:',
    importFlatLabel: 'Flat table',
    importFlatPrefix: ' — columns: ',
    importFlatColumns: 'Toy Name, Master Carton, Part Number, Date, Shift 1, Shift 2, Shift 3',
    importFlatSuffix: ' (e.g. DailySchedule.xlsx)',
    importPivotLabel: 'FA_Attach pivot',
    importPivotDesc: ' — date headers in row 2, shift sub-headers in row 3 (e.g. NEXT Week Daily Production Schedule.xlsm)',
    totalRecords: 'Total Records',
    uniqueParts: 'Unique Parts',
    days: 'Days',
    totalQuantity: 'Total Quantity',
    recordsShown: '{shown} of {total} records shown',
    importSearchPlaceholder: 'Search by Part Number, Toy Name, Date...',
    saveAddParen: 'Save (Add)',

    // Confirmation & error messages
    confirmDeleteOne: 'Are you sure you want to delete this record?',
    confirmDeleteMany: 'Are you sure you want to delete {count} selected records?',
    failedUpdate: 'Failed to update schedule',
    failedDelete: 'Failed to delete schedule',
    failedDeleteRecords: 'Failed to delete records',
    partNumberRequired: 'Please select or enter a Part Number',
    failedSave: 'Failed to save schedule',
    parseError: 'Could not parse the Excel file.\n\nSupported formats:\n1. Flat table with columns: Toy Name, Master Carton, Part Number, Date, Shift 1, Shift 2, Shift 3\n2. FA_Attach pivot sheet from NEXT Week Daily Production Schedule.xlsm',
    parseFailed: 'Failed to parse Excel file. Please check the file format.',
    importSuccess: 'Successfully imported {count} schedule records!',
    failedBulkImport: 'Failed to bulk import Daily Schedule',
  },
};
