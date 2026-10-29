/**
 * Terjemahan untuk komponen bersama (pemilih periode/modul, pencarian, Ref-B).
 * Namespace: `components.*`
 */
export default {
  id: {
    // PeriodSelect
    periodLabel: 'Periode',
    periodLower: 'periode',
    createPeriod: 'Buat {label}',
    cancelAddPeriod: 'Batal tambah periode',
    periodPlaceholder: '— Pilih periode —',
    periodLocked: ' 🔒 (terkunci)',
    addPeriod: '+ Tambah periode baru…',
    periodRequired:
      'Pilih periode dulu — data tidak bisa diupload/diinput sebelum periode ditentukan.',
    periodSaved: 'Data akan disimpan ke periode ini. Periode lain tidak terpengaruh.',
    periodCreateFailed: 'Gagal membuat periode.',

    // ModuleSelect
    moduleFor: 'Data untuk modul',
    moduleNoAccess: 'Role Anda tidak punya akses ke modul ini',

    // SearchableSelect
    noOptions: 'Tidak ada hasil ditemukan.',
    addOption: 'Tambah "{value}"',
    found: '{count} ditemukan',

    // RefB
    refBMore: '+{count} lagi',
    refBMtlMessage: 'Kolom Ref-B wajib diisi dan harus mengandung "MTL".',

    // Kartu folder periode (info upload & edit terakhir)
    periodUpload: 'Upload',
    periodLastEdit: 'Edit terakhir',
    periodNoUpload: 'belum ada upload',
    periodNoEdit: 'belum ada edit',
    periodUploadSource: 'Sumber: {source}',
  },
  en: {
    // PeriodSelect
    periodLabel: 'Period',
    periodLower: 'period',
    createPeriod: 'Create {label}',
    cancelAddPeriod: 'Cancel adding period',
    periodPlaceholder: '— Select a period —',
    periodLocked: ' 🔒 (locked)',
    addPeriod: '+ Add new period…',
    periodRequired:
      'Select a period first — data cannot be uploaded/entered before a period is set.',
    periodSaved: 'Data will be saved to this period. Other periods are not affected.',
    periodCreateFailed: 'Failed to create period.',

    // ModuleSelect
    moduleFor: 'Data for module',
    moduleNoAccess: 'Your role does not have access to this module',

    // SearchableSelect
    noOptions: 'No results found.',
    addOption: 'Add "{value}"',
    found: '{count} found',

    // RefB
    refBMore: '+{count} more',
    refBMtlMessage: 'The Ref-B field is required and must contain "MTL".',

    // Period folder card (upload & last edit info)
    periodUpload: 'Upload',
    periodLastEdit: 'Last edit',
    periodNoUpload: 'no upload yet',
    periodNoEdit: 'no edit yet',
    periodUploadSource: 'Source: {source}',
  },
};
