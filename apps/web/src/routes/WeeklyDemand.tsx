import React, { useState, useMemo } from 'react';
import { useWeeklyScheduleSummary, useBulkUpsertWeeklySchedule, useUpdateWeeklySchedule, useDeleteWeeklySchedule, useBulkDeleteWeeklySchedule } from '../hooks/useWeeklySchedule';
import { usePeriods, useCreatePeriod, useUpdatePeriod, useDeletePeriod, monthLabel, MODULE_LABELS, type DataModule } from '../hooks/usePeriods';
import { PeriodSelect } from '../components/PeriodSelect';
import { PeriodMeta } from '../components/PeriodMeta';
import { ModuleSelect } from '../components/ModuleSelect';
import { useItems, useCreateItem } from '../hooks/useItems';
import { SearchableSelect } from '../components/SearchableSelect';
import { Upload, Search, Save, Plus, CalendarRange, Trash2, ChevronLeft, ChevronRight, Calendar, Edit2, Folder, ArrowLeft, Lock, CalendarPlus, Loader2, GitCompare, History, Info, FileSpreadsheet } from 'lucide-react';
import { useAuthStore, lockedDataModule } from '../stores/authStore';
import { localDateFromISO, type ImportRow } from '../lib/mrpWeekImport';
import { parseMrpExcelFile } from '../lib/mrpParseWorker';
import { usePreviewMrpVersion, useSaveMrpVersion, type MrpUploadRow } from '../hooks/useMrpVersions';
import { ChangeSummaryCards } from '../components/mrp/ChangeSummaryCards';
import { VersionCompareTable } from '../components/mrp/VersionCompareTable';
import { UploadHistoryPanel } from '../components/mrp/UploadHistoryPanel';
import { dateTimeLabel } from '../lib/mrpCompare';

// Compute ISO week number / ISO year for a given date.
// Used to build a unique (year, weekNumber) pair when manually adding demand.
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

// Default start date for the manual Add Demand form: the upcoming Saturday from today.
function getNextSaturdayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const offset = (6 - d.getDay() + 7) % 7 || 7; // strictly future Saturday
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

/** Bentuk payload yang dipakai API riwayat MRP (snapshot per upload). */
function toUploadRows(rows: ImportRow[]): MrpUploadRow[] {
  return rows.map((row) => ({
    partNumber: row.itemCode,
    description: row.description,
    weeks: row.weeks.map((week) => ({
      weekNumber: week.weekNumber,
      weekStartDate: week.weekStartDate,
      quantity: week.quantity,
    })),
  }));
}

// ─── Main Component ──────────────────────────────────────────────────────────
const WEEKS_PER_PAGE = 13; // Show 13 weeks at a time (half of 26)
const PREVIEW_ROWS_PER_PAGE = 20; // Pratinjau import: batasi baris yang dirender

export function WeeklyDemand() {
  const { user, canEditDataModule } = useAuthStore();
  // Planner terkunci ke modulnya sendiri; Admin/Super Admin bebas memilih modul.
  const lockedModule = lockedDataModule(user?.role) as DataModule | null;

  const currentYear = new Date().getFullYear();
  const [search, setSearch] = useState('');
  const [weekPage, setWeekPage] = useState(0);
  const [rowPage, setRowPage] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importSearch, setImportSearch] = useState('');
  // Nama file & kunci idempotensi disimpan per sesi upload: retry setelah
  // jaringan gagal tidak boleh membuat versi ganda.
  const [importFileName, setImportFileName] = useState('');
  const clientRequestIdRef = React.useRef('');
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  // Parsing Excel berjalan di Web Worker; state ini menampilkan indikator loading.
  const [isParsingFile, setIsParsingFile] = useState(false);
  // Pratinjau hanya merender sebagian baris — merender ribuan baris x 35 minggu
  // sekaligus membuat browser freeze ("Page Unresponsive").
  const [previewPage, setPreviewPage] = useState(0);
  // Tab di dalam periode terpilih: data aktif vs riwayat upload.
  const [periodTab, setPeriodTab] = useState<'data' | 'history'>('data');
  // Periode upload = keranjang data. WAJIB dipilih sebelum upload/isi manual.
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  // Modul pemilik data MRP. Data Production Planning dan Material Planning
  // disimpan TERPISAH — upload di sini hanya menyentuh modul yang dipilih.
  // Planner TIDAK bebas memilih: modulnya dikunci ke modul miliknya.
  const [moduleType, setModuleType] = useState<DataModule>(lockedModule ?? 'PRODUCTION');
  // Jaga-jaga kalau role baru ter-rehydrate dari localStorage setelah mount.
  React.useEffect(() => {
    if (lockedModule && moduleType !== lockedModule) setModuleType(lockedModule);
  }, [lockedModule, moduleType]);
  // Gate edit: Admin/Super Admin selalu boleh; planner hanya untuk modulnya
  // sendiri; User/Viewer tidak boleh. (Nama variabel dipertahankan.)
  const isAdmin = canEditDataModule(moduleType);
  // Periode tujuan untuk modal Import / Isi Manual. Ikut periode yang sedang
  // dibuka, tapi tetap bisa diganti langsung dari dalam modal.
  const [targetPeriodId, setTargetPeriodId] = useState<string | null>(null);
  React.useEffect(() => {
    if (selectedPeriodId) setTargetPeriodId(selectedPeriodId);
  }, [selectedPeriodId]);
  const [newPeriodMonth, setNewPeriodMonth] = useState('');
  const { data: periodsRes, isLoading: periodsLoading } = usePeriods();
  const periods = periodsRes?.data ?? [];
  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId) ?? null;
  const targetPeriod = periods.find((p) => p.id === targetPeriodId) ?? null;
  const createPeriod = useCreatePeriod();

  const handleCreatePeriod = async () => {
    if (!newPeriodMonth) return;
    try {
      const res = await createPeriod.mutateAsync({ uploadMonth: newPeriodMonth });
      setNewPeriodMonth('');
      setSelectedPeriodId(res.data.id);
    } catch (error: any) {
      alert(error.message || 'Gagal membuat periode.');
    }
  };

  const updatePeriod = useUpdatePeriod();
  const deletePeriod = useDeletePeriod();
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null);
  const [editPeriodMonth, setEditPeriodMonth] = useState('');

  const handleUpdatePeriod = async (id: string) => {
    if (!editPeriodMonth) return;
    try {
      await updatePeriod.mutateAsync({ id, data: { uploadMonth: editPeriodMonth } });
      setEditingPeriodId(null);
      setEditPeriodMonth('');
    } catch (error: any) {
      alert(error.message || 'Gagal mengubah periode.');
    }
  };

  const handleDeletePeriod = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Yakin ingin menghapus periode ini? Semua data di dalamnya akan terhapus.')) return;
    try {
      await deletePeriod.mutateAsync(id);
      if (selectedPeriodId === id) setSelectedPeriodId(null);
    } catch (error: any) {
      alert(error.message || 'Gagal menghapus periode.');
    }
  };

  // Manual add form state — aligned to the selected period's first uploaded week.
  const [formData, setFormData] = useState({
    itemId: '',
    startDate: getNextSaturdayISO(),
    endDate: getNextSaturdayISO(),
    quantity: 0,
  });

  const { data: summaryData, isLoading, isFetching: isSummaryFetching } = useWeeklyScheduleSummary(selectedPeriodId, moduleType);
  const { data: itemsData } = useItems();
  const createItem = useCreateItem();
  const bulkUpsert = useBulkUpsertWeeklySchedule();
  const previewVersion = usePreviewMrpVersion();
  const saveVersion = useSaveMrpVersion();
  const updateWeekly = useUpdateWeeklySchedule();
  const deleteWeekly = useDeleteWeeklySchedule();
  const bulkDelete = useBulkDeleteWeeklySchedule();

  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  const [editModal, setEditModal] = useState<{ isOpen: boolean; data: any }>({
    isOpen: false,
    data: null,
  });

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal.data) return;
    try {
      await updateWeekly.mutateAsync({
        id: editModal.data.id,
        quantity: Number(editModal.data.quantity),
      });
      setEditModal({ isOpen: false, data: null });
    } catch (err: any) {
      alert(err.message || 'Failed to update schedule');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try {
      await deleteWeekly.mutateAsync(id);
    } catch (err: any) {
      alert(err.message || 'Failed to delete schedule');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedItemIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete the demand for ${selectedItemIds.length} selected items?`)) return;
    
    const idsToDelete = selectedItemIds.flatMap(itemId => {
      const row = allData.find((r: any) => r.itemId === itemId);
      if (!row) return [];
      return Object.values(row.weeks).map((w: any) => w.id);
    });

    if (idsToDelete.length === 0) {
      setSelectedItemIds([]);
      return;
    }

    try {
      await bulkDelete.mutateAsync({ ids: idsToDelete });
      setSelectedItemIds([]);
    } catch (err: any) {
      alert(err.message || 'Failed to delete records');
    }
  };

  const items = itemsData?.data || [];

  const allData = summaryData?.data || [];

  const ROWS_PER_PAGE = 50;

  const calendarWeeks = summaryData?.weeks ?? [];

  // Prefer the complete uploaded calendar so all-zero weeks remain visible.
  const allWeeks = useMemo(() => {
    if (calendarWeeks.length > 0) return calendarWeeks.map((week) => week.weekNumber);
    const wSet = new Set<number>();
    allData.forEach((row) => Object.keys(row.weeks).forEach((w) => wSet.add(Number(w))));
    return Array.from(wSet).sort((a, b) => a - b);
  }, [allData, calendarWeeks]);

  // Map W1-W26 to their dates from the uploaded period, including zero-demand weeks.
  const weekStartByNumber = useMemo(() => {
    const map: Record<number, string> = {};
    for (const week of calendarWeeks) map[week.weekNumber] = week.weekStartDate;
    for (const row of allData) {
      for (const [w, info] of Object.entries(row.weeks)) {
        const wn = Number(w);
        if (!map[wn] && info?.weekStartDate) map[wn] = info.weekStartDate as string;
      }
    }
    return map;
  }, [allData, calendarWeeks]);

  // List of available weeks for the dropdown select in the form
  const availableWeeks = useMemo(() => {
    if (allWeeks.length > 0) {
      return allWeeks.map(w => {
        const startStr = weekStartByNumber[w];
        let dateLabel = '';
        if (startStr) {
          const localDateStr = startStr.split('T')[0];
          const d = localDateFromISO(localDateStr);
          if (!isNaN(d.getTime())) {
            dateLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
          }
        }
        return {
          weekNumber: w,
          startDate: startStr ? startStr.split('T')[0] : '',
          label: `Week ${w} ${dateLabel ? `(${dateLabel})` : ''}`,
        };
      });
    }

    // Fallback: Generate 26 weeks starting from the Saturday of this week
    const list = [];
    const baseDate = new Date();
    baseDate.setHours(0, 0, 0, 0);
    const day = baseDate.getDay();
    const diff = (6 - day + 7) % 7;
    baseDate.setDate(baseDate.getDate() + diff);

    for (let i = 0; i < 26; i++) {
      const d = new Date(baseDate.getTime() + i * 7 * 86400000);
      const { week } = getISOWeek(d);
      const startStr = d.toISOString().split('T')[0];
      const dateLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
      list.push({
        weekNumber: week,
        startDate: startStr,
        label: `Week ${i + 1} (${dateLabel})`,
      });
    }
    return list;
  }, [allWeeks, weekStartByNumber]);

  React.useEffect(() => {
    if (showForm && availableWeeks.length > 0) {
      const firstWeek = availableWeeks[0];
      const endStr = new Date(new Date(firstWeek.startDate).getTime() + 6 * 86400000).toISOString().split('T')[0];
      // Kembalikan `prev` apa adanya kalau nilainya sudah sama — tanpa ini,
      // setFormData selalu membuat objek baru sehingga render berulang tanpa henti
      // ("Maximum update depth exceeded") selama form dibuka.
      setFormData(prev =>
        prev.startDate === firstWeek.startDate && prev.endDate === endStr
          ? prev
          : {
              ...prev,
              startDate: firstWeek.startDate,
              endDate: endStr,
            },
      );
    }
  }, [showForm, availableWeeks]);

  // Semua minggu MILIK PERIODE yang sedang dibuka. Tidak lagi dipecah per bulan
  // berdasarkan tanggal di dalam data (itulah pengelompokan lama yang salah).
  const visibleWeeks = useMemo(
    () => allWeeks.slice(weekPage * WEEKS_PER_PAGE, (weekPage + 1) * WEEKS_PER_PAGE),
    [allWeeks, weekPage],
  );
  const totalPages = useMemo(() => Math.ceil(allWeeks.length / WEEKS_PER_PAGE), [allWeeks]);

  const periodRangeLabel = useMemo(() => {
    if (calendarWeeks.length === 0) return '';
    // Rentang ditampilkan dari tanggal minggu pertama sampai tanggal minggu
    // terakhir pada data (sesuai label kolom W1..W26).
    const firstDate = localDateFromISO(calendarWeeks[0].weekStartDate);
    const lastDate = localDateFromISO(calendarWeeks[calendarWeeks.length - 1].weekStartDate);
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
    return `${firstDate.toLocaleDateString('id-ID', options)} – ${lastDate.toLocaleDateString('id-ID', options)}`;
  }, [calendarWeeks]);
  const periodTitle = summaryData?.periodStart
    ? localDateFromISO(summaryData.periodStart).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
    : selectedPeriod?.label ?? 'Periode';

  const filteredData = useMemo(() => {
    if (!search) return allData;
    const q = search.toLowerCase();
    return allData.filter(
      (row) => row.itemCode.toLowerCase().includes(q) || row.itemName.toLowerCase().includes(q),
    );
  }, [allData, search]);

  const totalRowPages = Math.ceil(filteredData.length / ROWS_PER_PAGE);
  const paginatedData = filteredData.slice(rowPage * ROWS_PER_PAGE, (rowPage + 1) * ROWS_PER_PAGE);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const newIds = new Set([...selectedItemIds, ...paginatedData.map((r: any) => r.itemId)]);
      setSelectedItemIds(Array.from(newIds));
    } else {
      const filteredSet = new Set(paginatedData.map((r: any) => r.itemId));
      setSelectedItemIds(selectedItemIds.filter(id => !filteredSet.has(id)));
    }
  };

  const allFilteredSelected = paginatedData.length > 0 && paginatedData.every((r: any) => selectedItemIds.includes(r.itemId));

  // ── Import handlers ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    // Kosongkan pratinjau lama supaya tabel besar sebelumnya tidak ikut dirender.
    setImportRows([]);
    setPreviewPage(0);
    setIsParsingFile(true);

    try {
      const fallbackYear = Number(targetPeriod?.uploadMonth.slice(0, 4)) || currentYear;
      const parsed = await parseMrpExcelFile(file, fallbackYear);
      if (parsed.rows.length === 0) {
        alert('Tidak dapat memparse file Excel. Pastikan format sesuai (kolom PN, Description, Week 1-26).');
        return;
      }
      setImportRows(parsed.rows);
      setImportFileName(file.name);
      clientRequestIdRef.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `mrp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    } catch (error: any) {
      alert(error?.message || 'Gagal membaca file Excel. Pastikan tanggal setiap kolom minggu terbaca.');
    } finally {
      setIsParsingFile(false);
    }
  };

  // Pratinjau perubahan dihitung ulang setiap file / periode / modul berubah,
  // supaya ringkasan "part baru / dihapus / berubah" selalu mengacu ke versi
  // terakhir pada periode + modul yang dipilih.
  React.useEffect(() => {
    if (!showImport || !targetPeriodId || importRows.length === 0) return;
    previewVersion.mutate({ periodId: targetPeriodId, moduleType, rows: toUploadRows(importRows) });
    // `previewVersion.mutate` stabil; sengaja tidak dimasukkan ke daftar dependensi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showImport, targetPeriodId, moduleType, importRows]);

  /**
   * Simpan upload sebagai VERSI BARU (snapshot) lalu jadikan versi aktif.
   * Versi sebelumnya tidak dihapus — bisa dibandingkan di tab History & Compare.
   */
  const handleVersionSave = async () => {
    // Cegah double-click: satu klik hanya boleh menghasilkan satu versi.
    if (isSavingVersion || saveVersion.isPending) return;
    if (!targetPeriodId) {
      alert('Pilih periode dulu sebelum menyimpan data.');
      return;
    }
    if (importRows.length === 0) return;

    const confirmed = confirm(
      'Versi ini akan menjadi versi aktif. Versi sebelumnya tetap tersimpan di history.\n\nLanjutkan menyimpan?',
    );
    if (!confirmed) return;

    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `mrp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    setIsSavingVersion(true);
    try {
      const res = await saveVersion.mutateAsync({
        periodId: targetPeriodId,
        moduleType,
        fileName: importFileName || 'import.xlsx',
        clientRequestId: clientRequestIdRef.current,
        rows: toUploadRows(importRows),
      });
      setShowImport(false);
      setImportRows([]);
      setImportSearch('');
      setImportFileName('');
      clientRequestIdRef.current = '';
      setPeriodTab('history');
      alert(
        res.duplicate
          ? `Data ini sudah tersimpan sebagai Upload ke-${res.data.versionNumber}.`
          : `Berhasil disimpan sebagai Upload ke-${res.data.versionNumber} pada periode ${res.label}.\nVersi sebelumnya tetap tersimpan di tab History & Compare.`,
      );
    } catch (err: any) {
      alert(err.message || 'Gagal menyimpan data.');
    } finally {
      setIsSavingVersion(false);
    }
  };

  const filteredImport = importRows.filter((r) => {
    if (!importSearch) return true;
    const q = importSearch.toLowerCase();
    return r.itemCode.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
  });

  const previewPageCount = Math.max(1, Math.ceil(filteredImport.length / PREVIEW_ROWS_PER_PAGE));
  const safePreviewPage = Math.min(previewPage, previewPageCount - 1);
  const pagedImport = filteredImport.slice(
    safePreviewPage * PREVIEW_ROWS_PER_PAGE,
    (safePreviewPage + 1) * PREVIEW_ROWS_PER_PAGE,
  );

  const importSummary = useMemo(() => {
    const parts = new Set(importRows.map((r) => r.itemCode));
    const total = importRows.reduce((a, r) => a + r.total, 0);
    const weeks = new Set(importRows.flatMap((r) => r.weeks.map((w) => w.weekNumber)));
    const firstWeek = importRows[0]?.weeks[0];
    const lastWeek = importRows[0]?.weeks[importRows[0].weeks.length - 1];
    return {
      parts: parts.size,
      total,
      weeks: weeks.size,
      startDate: firstWeek?.weekStartDate ?? '',
      endDate: lastWeek?.weekStartDate ?? '',
    };
  }, [importRows]);

  const handleManualSave = async (saveMode: 'overwrite' | 'add') => {
    if (!formData.itemId || !formData.quantity || !formData.startDate || !formData.endDate) return;
    const item = items.find((i: any) => i.id === formData.itemId);
    if (!item) return;

    const baseStart = new Date(formData.startDate + 'T00:00:00');
    const baseEnd = new Date(formData.endDate + 'T00:00:00');
    if (baseEnd < baseStart) {
      alert("End Date tidak boleh lebih kecil dari Start Date");
      return;
    }

    const diffTime = Math.abs(baseEnd.getTime() - baseStart.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const weeksCount = Math.floor(diffDays / 7) + 1;

    const formatLocal = (d: Date) => 
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const records: any[] = [];
    for (let i = 0; i < weeksCount; i++) {
      const start = new Date(baseEnd.getTime() - (weeksCount - 1 - i) * 7 * 86400000);
      const end = new Date(start.getTime() + 6 * 86400000);
      const { year: isoYear, week: isoWeek } = getISOWeek(start);
      records.push({
        year: isoYear,
        weekNumber: isoWeek,
        weekStartDate: formatLocal(start),
        weekEndDate: formatLocal(end),
        itemCode: (item as any).itemCode,
        description: (item as any).itemName,
        quantity: formData.quantity,
      });
    }
    if (!targetPeriodId) {
      alert('Pilih periode dulu sebelum menyimpan data.');
      return;
    }
    try {
      await bulkUpsert.mutateAsync({ records, saveMode, periodId: targetPeriodId, moduleType });
      setShowForm(false);
      setFormData({ itemId: '', startDate: getNextSaturdayISO(), endDate: getNextSaturdayISO(), quantity: 0 });
    } catch (err: any) {
      alert(err.message || 'Gagal menyimpan data.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarRange size={24} /> 26-Week Demand Plan
          </h2>
          <p className="text-muted-foreground text-sm">Rencana kebutuhan produksi sesuai periode data yang diunggah.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground border rounded-md px-3 h-9">
            <Calendar size={14} />
            <span>{periodRangeLabel || 'Rentang mengikuti tanggal data yang diunggah'}</span>
          </div>
          {isAdmin && (
            <button onClick={() => setShowImport(true)} className="bg-secondary border hover:bg-secondary/80 px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 transition-colors">
              <Upload size={16} /> Import Excel
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowForm(!showForm)} className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2 transition-colors">
              <Plus size={16} /> Add Demand
            </button>
          )}
        </div>
      </div>

      {/*
        Pemisah modul: MRP 26 Weeks dipakai Production Planning DAN Material
        Planning, tapi datanya disimpan terpisah. Semua baca/tulis di halaman ini
        mengikuti pilihan di bawah.
      */}
      <ModuleSelect value={moduleType} onChange={setModuleType} lockedTo={lockedModule} />

      {/* Manual Add Form */}
      {showForm && (
        <div className="bg-card text-card-foreground border rounded-lg p-6 shadow-sm">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><Calendar size={18} /> Add Weekly Demand</h3>
          <p className="text-xs text-muted-foreground mb-4">Use "Save Add" to add to existing, or "Save Overwrite" to replace.</p>
          <ModuleSelect value={moduleType} onChange={setModuleType} className="mb-5" lockedTo={lockedModule} />
          <PeriodSelect value={targetPeriodId} onChange={setTargetPeriodId} className="mb-5 max-w-md" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium">Part Number</label>
              <SearchableSelect
                options={items.map((i: any) => ({ value: i.id, label: i.partNumber }))}
                value={formData.itemId}
                onChange={(val) => setFormData({ ...formData, itemId: val })}
                onAdd={async (search) => {
                  try {
                    const res = await createItem.mutateAsync({ partNumber: search, itemName: search, unit: 'PCS' }) as any;
                    if (res?.data?.id) setFormData(f => ({ ...f, itemId: res.data.id }));
                  } catch (e: any) { alert(e.message); }
                }}
                placeholder="Search Part Number..."
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <SearchableSelect
                options={items.filter((i: any) => i.partNumber !== i.itemName).map((i: any) => ({ value: i.id, label: i.itemName }))}
                value={formData.itemId}
                onChange={(val) => setFormData({ ...formData, itemId: val })}
                onAdd={async (search) => {
                  try {
                    const code = `PN-${Date.now().toString().slice(-5)}`;
                    const res = await createItem.mutateAsync({ partNumber: code, itemName: search, unit: 'PCS' }) as any;
                    if (res?.data?.id) setFormData(f => ({ ...f, itemId: res.data.id }));
                  } catch (e: any) { alert(e.message); }
                }}
                placeholder="Search Description..."
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Select Week & Date</label>
              <select
                className="w-full h-10 px-3 border rounded-md bg-background text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                value={formData.startDate}
                onChange={e => {
                  const startStr = e.target.value;
                  const endStr = new Date(new Date(startStr).getTime() + 6 * 86400000).toISOString().split('T')[0];
                  setFormData({ ...formData, startDate: startStr, endDate: endStr });
                }}
              >
                {availableWeeks.map((w, idx) => (
                  <option key={idx} value={w.startDate}>
                    {w.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">Pilih minggu target pengisian demand plan (minggu dihitung dari hari Sabtu sampai Jumat berikutnya).</p>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium">Quantity / Week</label>
              <input type="number" min="0" className="w-full h-10 px-3 border rounded-md bg-background text-sm" value={formData.quantity} onChange={e => setFormData({ ...formData, quantity: Number(e.target.value) })} />
            </div>
            <div className="md:col-span-2 flex justify-end gap-3 mt-2">
              <button type="button" onClick={() => setShowForm(false)} className="h-10 border px-6 rounded-md font-medium hover:bg-muted text-sm transition-colors">Cancel</button>
              <button type="button" onClick={() => handleManualSave('add')} disabled={bulkUpsert.isPending || !targetPeriodId} className="h-10 bg-green-600 hover:bg-green-700 text-white px-6 rounded-md font-medium flex items-center gap-2 text-sm transition-colors disabled:opacity-50">
                <Plus size={16} /> {bulkUpsert.isPending ? 'Saving...' : 'Save Add'}
              </button>
              <button type="button" onClick={() => handleManualSave('overwrite')} disabled={bulkUpsert.isPending || !targetPeriodId} className="h-10 bg-primary text-primary-foreground hover:bg-primary/90 px-6 rounded-md font-medium flex items-center gap-2 text-sm transition-colors disabled:opacity-50">
                <Save size={16} /> {bulkUpsert.isPending ? 'Saving...' : 'Save Overwrite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Folder View or Table View */}
      {!selectedPeriodId ? (
        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
          {periods.length === 0 && !periodsLoading && (
            <div className="py-12 text-center text-muted-foreground border rounded-lg bg-card shadow-sm">
              <CalendarRange className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-base font-semibold">Belum ada periode</p>
              <p className="text-sm mt-1">
                Buat periode dulu (mis. September 2026), lalu upload data MRP ke periode itu.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {periods.map((p) => {
              if (editingPeriodId === p.id) {
                return (
                  <div key={p.id} className="p-5 border-2 border-primary rounded-lg bg-card flex flex-col gap-3 justify-center shadow-sm relative">
                    <div className="text-sm font-semibold mb-1 flex items-center gap-2"><Edit2 className="w-4 h-4" /> Edit Periode</div>
                    <input
                      type="month"
                      value={editPeriodMonth}
                      onChange={(e) => setEditPeriodMonth(e.target.value)}
                      className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdatePeriod(p.id)}
                        disabled={updatePeriod.isPending}
                        className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-2 rounded-md text-sm font-medium flex items-center justify-center"
                      >
                        {updatePeriod.isPending ? <Loader2 size={16} className="animate-spin" /> : 'Simpan'}
                      </button>
                      <button
                        onClick={() => { setEditingPeriodId(null); setEditPeriodMonth(''); }}
                        className="flex-1 bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-2 rounded-md text-sm font-medium"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                );
              }
              return (
              <div
                key={p.id}
                onClick={() => setSelectedPeriodId(p.id)}
                className="cursor-pointer p-5 border rounded-lg bg-card hover:bg-muted/50 hover:border-primary/50 transition-all flex flex-wrap items-center gap-x-4 gap-y-2 group shadow-sm relative overflow-hidden pr-12"
              >
                <div className="p-3 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors">
                  <Folder className="w-8 h-8 text-blue-500 fill-blue-500/20" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-foreground flex items-center gap-1.5">
                    <span className="truncate">{p.label}</span>
                    {p.isLocked && <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {p.moduleCounts[moduleType].MRP} baris MRP {MODULE_LABELS[moduleType]}
                  </p>
                </div>
                <PeriodMeta period={p} className="w-full" />
                {isAdmin && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingPeriodId(p.id);
                        setEditPeriodMonth(p.uploadMonth);
                      }}
                      className="p-1.5 bg-background border rounded-md text-muted-foreground hover:text-blue-600 hover:border-blue-200 transition-colors shadow-sm"
                      title="Edit Periode"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleDeletePeriod(p.id, e)}
                      className="p-1.5 bg-background border rounded-md text-muted-foreground hover:text-red-600 hover:border-red-200 transition-colors shadow-sm"
                      title="Hapus Periode"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )})}

            <div className="p-5 border-2 border-dashed rounded-lg bg-card flex flex-col gap-3 justify-center">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <CalendarPlus className="w-4 h-4" /> Buat Periode Baru
              </div>
              <input
                type="month"
                value={newPeriodMonth}
                onChange={(e) => setNewPeriodMonth(e.target.value)}
                className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={handleCreatePeriod}
                disabled={!newPeriodMonth || createPeriod.isPending}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 px-3 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2"
              >
                {createPeriod.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Buat {newPeriodMonth ? monthLabel(newPeriodMonth) : 'Periode'}
              </button>
            </div>
          </div>
        </div>
      ) : (
      <>
        <div className="flex flex-wrap items-center gap-3 mb-2 animate-in fade-in slide-in-from-bottom-2">
          <button 
            onClick={() => { setSelectedPeriodId(null); setPeriodTab('data'); setSearch(''); setRowPage(0); }}
            className="p-2 hover:bg-background rounded-md border text-muted-foreground hover:text-foreground transition-colors shrink-0 bg-card"
            title="Kembali ke daftar periode"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h3 className="font-semibold text-lg">
            {periodTitle} (26-Week Demand Plan)
          </h3>
          {/* Tab di dalam periode: data aktif vs riwayat upload (snapshot). */}
          <div className="ml-auto flex items-center gap-1 border rounded-lg p-1 bg-card">
            <button
              onClick={() => setPeriodTab('data')}
              className={`h-8 px-3 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
                periodTab === 'data' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <CalendarRange size={14} /> Data Aktif
            </button>
            <button
              onClick={() => setPeriodTab('history')}
              className={`h-8 px-3 rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors ${
                periodTab === 'history' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <History size={14} /> History &amp; Compare
            </button>
          </div>
        </div>

      {periodTab === 'data' && (summaryData?.activeVersion || summaryData?.lastChange) && (
        <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground bg-muted/30 border rounded-lg px-3 py-2 animate-in fade-in">
          <span className="flex items-center gap-1.5">
            <Info size={13} className="shrink-0" />
            {summaryData?.activeVersion ? (
              <>
                Data aktif dari{' '}
                <strong className="text-foreground">
                  Upload ke-{summaryData.activeVersion.versionNumber}
                </strong>
                {summaryData.activeVersion.fileName && (
                  <span className="flex items-center gap-1 text-muted-foreground/80">
                    <FileSpreadsheet size={11} /> {summaryData.activeVersion.fileName}
                  </span>
                )}
              </>
            ) : (
              'Belum ada versi tersimpan untuk data aktif'
            )}
          </span>
          {summaryData?.lastChange && (
            <span>
              Diperbarui:{' '}
              <strong className="text-foreground">{dateTimeLabel(summaryData.lastChange.at)}</strong>
              {' · '}
              {summaryData.lastChange.byName ?? '—'}
              {summaryData.lastChange.kind && (
                <span className="text-muted-foreground/80">
                  {' '}
                  (
                  {summaryData.lastChange.kind === 'UPLOAD'
                    ? 'upload'
                    : summaryData.lastChange.kind === 'EDIT'
                      ? 'edit manual'
                      : 'rollback hapus versi'}
                  )
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {periodTab === 'history' ? (
        <div className="bg-card text-card-foreground border rounded-lg shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
          <UploadHistoryPanel
            periodId={selectedPeriodId}
            periodLabel={periodTitle}
            moduleType={moduleType}
            isAdmin={isAdmin}
          />
        </div>
      ) : (
      <div className="bg-card text-card-foreground border rounded-lg shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
        {/* Indikator saat data aktif dimuat ulang (mis. setelah simpan versi baru) */}
        {isSummaryFetching && !isLoading && (
          <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground border-b bg-primary/5">
            <Loader2 size={12} className="animate-spin" /> Memuat data aktif terbaru...
          </div>
        )}
        {/* Filter bar */}
        <div className="p-4 border-b bg-muted/10 flex items-center gap-3">
          {isAdmin && selectedItemIds.length > 0 && (
            <button 
              onClick={handleDeleteSelected}
              disabled={bulkDelete.isPending}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md font-medium text-sm flex items-center space-x-2 transition-colors shrink-0"
            >
              <Trash2 size={16} />
              <span>Delete Selected ({selectedItemIds.length})</span>
            </button>
          )}
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input
              type="text"
              placeholder="Cari Part Number atau Description..."
              className="w-full h-9 pl-9 pr-3 border rounded-md bg-background text-sm"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setRowPage(0); }}
            />
          </div>
          {allWeeks.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Week {visibleWeeks[0]}–{visibleWeeks[visibleWeeks.length - 1]}</span>
              <button
                onClick={() => setWeekPage((p) => Math.max(0, p - 1))}
                disabled={weekPage === 0}
                className="h-8 w-8 flex items-center justify-center border rounded-md hover:bg-muted disabled:opacity-40 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs">{weekPage + 1}/{totalPages || 1}</span>
              <button
                onClick={() => setWeekPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={weekPage >= totalPages - 1}
                className="h-8 w-8 flex items-center justify-center border rounded-md hover:bg-muted disabled:opacity-40 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/50 text-muted-foreground uppercase text-xs font-medium">
              <tr>
                {isAdmin && (
                  <th className="px-4 py-3 sticky left-0 bg-secondary/80 z-20 w-12 text-center">
                    <input type="checkbox" checked={allFilteredSelected} onChange={handleSelectAll} className="rounded border-gray-300" />
                  </th>
                )}
                <th className={`px-4 py-3 sticky bg-secondary/80 z-10 min-w-[130px] ${isAdmin ? 'left-[48px]' : 'left-0'}`}>Part Number</th>
                <th className={`px-4 py-3 sticky bg-secondary/80 z-10 min-w-[180px] ${isAdmin ? 'left-[178px]' : 'left-[130px]'}`}>Description</th>
                {visibleWeeks.map((w) => {
                  const start = weekStartByNumber[w];
                  const startLabel = start
                    ? localDateFromISO(start).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                    : '';
                  return (
                    <th key={w} className="px-3 py-1 text-center min-w-[80px]">
                      <div className="font-bold">W{w}</div>
                      {startLabel && <div className="text-[10px] font-normal normal-case text-muted-foreground/80">{startLabel}</div>}
                    </th>
                  );
                })}
                <th className="px-4 py-3 text-right min-w-[90px] bg-secondary/80">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={visibleWeeks.length + (isAdmin ? 4 : 3)} className="p-8 text-center">
                    <Loader2 size={22} className="animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Memuat data aktif...</p>
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={visibleWeeks.length + (isAdmin ? 4 : 3)} className="p-8 text-center text-muted-foreground">
                    {isAdmin ? (
                      <>Belum ada data. Klik <strong>Import Excel</strong> untuk upload data 26-week demand.</>
                    ) : (
                      'Belum ada data.'
                    )}
                  </td>
                </tr>
              ) : (
                paginatedData.map((row) => (
                  <tr key={row.itemId} className="hover:bg-muted/50 transition-colors">
                    {isAdmin && (
                      <td className="px-4 py-3 text-center sticky left-0 bg-card z-[5]">
                        <input 
                          type="checkbox" 
                          checked={selectedItemIds.includes(row.itemId)} 
                          onChange={(e) => {
                            if (e.target.checked) setSelectedItemIds([...selectedItemIds, row.itemId]);
                            else setSelectedItemIds(selectedItemIds.filter(id => id !== row.itemId));
                          }} 
                          className="rounded border-gray-300"
                        />
                      </td>
                    )}
                    <td className={`px-4 py-3 font-medium sticky bg-card z-[5] ${isAdmin ? 'left-[48px]' : 'left-0'}`}>{row.itemCode}</td>
                    <td className={`px-4 py-3 text-muted-foreground sticky bg-card z-[5] max-w-[180px] truncate ${isAdmin ? 'left-[178px]' : 'left-[130px]'}`} title={row.itemName}>
                      {row.itemName}
                    </td>
                    {visibleWeeks.map((w) => {
                      const weekData = row.weeks?.[w];
                      const qty = weekData?.quantity;
                      return (
                        <td key={w} className="px-3 py-3 text-center relative group min-w-[80px]">
                          {weekData ? (
                            <div className="flex flex-col items-center justify-center w-full h-full">
                              <span className="font-medium text-blue-600 dark:text-blue-400">
                                {weekData.quantity.toLocaleString()}
                              </span>
                              {isAdmin && (
                                <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 bg-card/90 backdrop-blur-[1px] transition-all">
                                  <button
                                    onClick={() => setEditModal({
                                      isOpen: true,
                                      data: {
                                        id: weekData.id,
                                        itemCode: row.itemCode,
                                        itemName: row.itemName,
                                        weekNumber: w,
                                        quantity: qty,
                                      }
                                    })}
                                    className="p-1.5 text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                                    title="Edit"
                                  >
                                    <Edit2 size={14} />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(weekData.id)}
                                    className="p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-md transition-colors"
                                    title="Delete"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/30">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right font-bold text-primary">
                      {row.total.toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredData.length > 0 && (
          <div className="px-4 py-3 border-t bg-muted/10 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Menampilkan {filteredData.length} item · {allWeeks.length} minggu
            </span>
            {totalRowPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRowPage((p) => Math.max(0, p - 1))}
                  disabled={rowPage === 0}
                  className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted disabled:opacity-40"
                >
                  <ChevronLeft size={13} />
                </button>
                <span>Baris {rowPage * ROWS_PER_PAGE + 1}–{Math.min((rowPage + 1) * ROWS_PER_PAGE, filteredData.length)} / {filteredData.length}</span>
                <button
                  onClick={() => setRowPage((p) => Math.min(totalRowPages - 1, p + 1))}
                  disabled={rowPage >= totalRowPages - 1}
                  className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted disabled:opacity-40"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      )}
      </>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="relative bg-card text-card-foreground border rounded-lg shadow-xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-6 border-b">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Upload size={20} /> Import 26-Week Demand Plan
              </h3>
              <button
                onClick={() => { setShowImport(false); setImportRows([]); setImportSearch(''); setImportFileName(''); clientRequestIdRef.current = ''; }}
                disabled={isSavingVersion || saveVersion.isPending}
                className="text-muted-foreground hover:text-foreground text-lg leading-none disabled:opacity-40"
              >
                ✕
              </button>
            </div>

            <div className="p-6 flex-1 overflow-auto space-y-5">
              {/* Modul tujuan — data Production & Material disimpan terpisah */}
              <ModuleSelect value={moduleType} onChange={setModuleType} lockedTo={lockedModule} />

              {/* Periode tujuan — wajib dipilih sebelum bisa menyimpan */}
              <PeriodSelect value={targetPeriodId} onChange={setTargetPeriodId} className="max-w-md" />

              {/* Upload */}
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Upload file Excel dengan format: kolom <strong>PN</strong> (Part Number), <strong>Description</strong> (Description),
                  lalu kolom Week <strong>1–26</strong> dengan tanggal di bawahnya.
                </p>
                <input
                  type="file"
                  accept=".xlsx,.xls,.xlsm,.csv"
                  onChange={handleFileUpload}
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                />
              </div>

              {importRows.length > 0 && (
                <>
                  {/* Summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-primary">{importRows.length}</div>
                      <div className="text-xs text-muted-foreground">Total Items</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-green-600">{importSummary.parts}</div>
                      <div className="text-xs text-muted-foreground">Unique Parts</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-blue-600">{importSummary.weeks}</div>
                      <div className="text-xs text-muted-foreground">Minggu</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-orange-600">{importSummary.total.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Total Qty</div>
                    </div>
                  </div>

                  {/* Peringatan format file / PN duplikat */}
                  {previewVersion.data && previewVersion.data.warnings.length > 0 && (
                    <div className="text-xs border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 rounded-lg px-3 py-2 space-y-1">
                      <p className="font-semibold text-amber-800 dark:text-amber-300">Periksa file sebelum menyimpan</p>
                      <ul className="list-disc pl-4 text-amber-900/80 dark:text-amber-200/80 space-y-0.5">
                        {previewVersion.data.warnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Perbandingan dengan versi sebelumnya (dihitung sebelum disimpan) */}
                  <div className="border rounded-lg bg-card">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <GitCompare size={15} /> Perubahan vs Versi Sebelumnya
                      </h4>
                      <span className="text-xs text-muted-foreground">
                        {previewVersion.isPending ? (
                          <span className="flex items-center gap-1">
                            <Loader2 size={12} className="animate-spin" /> Menghitung...
                          </span>
                        ) : previewVersion.data?.hasBaseline ? (
                          <>
                            Versi baru: <strong>Upload ke-{previewVersion.data.nextVersionNumber}</strong>
                          </>
                        ) : null}
                      </span>
                    </div>
                    <div className="p-3 space-y-3">
                      {!targetPeriodId ? (
                        <p className="text-xs text-muted-foreground">
                          Pilih periode dulu untuk melihat perbandingan dengan upload sebelumnya.
                        </p>
                      ) : previewVersion.isError ? (
                        <p className="text-xs text-red-600">{(previewVersion.error as Error).message}</p>
                      ) : !previewVersion.data ? (
                        <p className="text-xs text-muted-foreground">Menghitung perbandingan...</p>
                      ) : !previewVersion.data.hasBaseline ? (
                        <div className="text-xs bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-md px-3 py-2 text-blue-800 dark:text-blue-300">
                          <strong>Ini upload pertama</strong> untuk periode{' '}
                          {targetPeriod?.label ?? 'terpilih'} modul {MODULE_LABELS[moduleType]} — belum ada
                          versi pembanding.
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">
                            Pembanding:{' '}
                            {previewVersion.data.baseline?.source === 'LIVE'
                              ? 'data aktif (belum tersimpan sebagai versi)'
                              : `Upload ke-${previewVersion.data.baseline?.versionNumber} · ${dateTimeLabel(
                                  previewVersion.data.baseline?.uploadedAt,
                                )}${
                                  previewVersion.data.baseline?.uploadedByName
                                    ? ` · ${previewVersion.data.baseline.uploadedByName}`
                                    : ''
                                }`}
                          </p>
                          <ChangeSummaryCards summary={previewVersion.data.summary} />
                          <VersionCompareTable
                            key={`${targetPeriodId}-${moduleType}-${importRows.length}`}
                            columns={previewVersion.data.columns}
                            parts={previewVersion.data.parts}
                            emptyMessage="Tidak ada perubahan dibanding versi sebelumnya."
                            maxHeightClass="max-h-[35vh]"
                          />
                        </>
                      )}
                    </div>
                  </div>

                  {/* Periode tanggal sumber */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium whitespace-nowrap">Rentang Data:</span>
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      {importSummary.startDate && importSummary.endDate
                        ? `${localDateFromISO(importSummary.startDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })} – ${localDateFromISO(importSummary.endDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`
                        : '—'}
                    </span>
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
                      <input
                        type="text"
                        placeholder="Cari Part Number / Description..."
                        className="w-full h-9 pl-9 pr-3 border rounded-md bg-background text-sm"
                        value={importSearch}
                        onChange={(e) => {
                          setImportSearch(e.target.value);
                          setPreviewPage(0);
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {filteredImport.length}/{importRows.length} items
                    </span>
                  </div>

                  {/* Preview Table */}
                  <div className="border rounded-md overflow-hidden max-h-[40vh] overflow-y-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-muted text-muted-foreground text-xs uppercase font-medium sticky top-0">
                        <tr>
                          <th className="px-4 py-2">Part Number</th>
                          <th className="px-4 py-2">Description</th>
                          <th className="px-4 py-2 text-center">Minggu Data</th>
                          <th className="px-4 py-2 text-right">Total Qty</th>
                          <th className="px-4 py-2 text-center w-12">Del</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {pagedImport.map((row) => (
                          <tr key={row.id} className="hover:bg-muted/40">
                            <td className="px-4 py-2 font-medium">{row.itemCode}</td>
                            <td className="px-4 py-2 text-muted-foreground max-w-[200px] truncate" title={row.description}>
                              {row.description}
                            </td>
                            <td className="px-4 py-2">
                              <div className="text-xs text-muted-foreground">
                                <div className="font-medium mb-1">
                                  W{row.weeks[0]?.weekNumber}–W{row.weeks[row.weeks.length - 1]?.weekNumber} ({row.weeks.length} minggu)
                                </div>
                                <div className="text-[10px] space-y-0.5 max-w-md">
                                  {row.weeks.map((week, idx) => {
                                    const endDate = week.weekStartDate
                                      ? localDateFromISO(week.weekStartDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                                      : '';
                                    const startDate = week.weekStartDate ? localDateFromISO(week.weekStartDate) : null;
                                    startDate?.setDate(startDate.getDate() - 6);
                                    return (
                                      <div key={idx} className="flex items-center gap-1">
                                        <span className="font-medium text-blue-600">W{week.weekNumber}</span>
                                        {startDate && endDate && (
                                          <span className="text-muted-foreground/60">
                                            ({startDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - {endDate})
                                          </span>
                                        )}
                                        <span className="text-foreground font-medium">: {week.quantity.toLocaleString()}</span>
                                      </div>
                                    );
                                  })}
                                  <div className="flex items-center gap-1 pt-1 border-t border-border/50 mt-1">
                                    <span className="font-bold text-primary">Total:</span>
                                    <span className="font-bold text-primary">{row.total.toLocaleString()}</span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2 text-right font-semibold text-blue-600">
                              {row.total.toLocaleString()}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <button
                                onClick={() => setImportRows((rows) => rows.filter((r) => r.id !== row.id))}
                                className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded transition-colors"
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Paginasi pratinjau — wajib: merender semua baris x semua minggu
                      sekaligus membuat browser freeze pada file besar. */}
                  {filteredImport.length > PREVIEW_ROWS_PER_PAGE && (
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Menampilkan {safePreviewPage * PREVIEW_ROWS_PER_PAGE + 1}–
                        {Math.min((safePreviewPage + 1) * PREVIEW_ROWS_PER_PAGE, filteredImport.length)} dari{' '}
                        {filteredImport.length.toLocaleString('id-ID')} part
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewPage((page) => Math.max(0, page - 1))}
                          disabled={safePreviewPage === 0}
                          className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted disabled:opacity-40"
                        >
                          <ChevronLeft size={13} />
                        </button>
                        <span>
                          {safePreviewPage + 1}/{previewPageCount}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPreviewPage((page) => Math.min(previewPageCount - 1, page + 1))}
                          disabled={safePreviewPage >= previewPageCount - 1}
                          className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted disabled:opacity-40"
                        >
                          <ChevronRight size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t flex flex-wrap justify-between items-center gap-3 bg-muted/10">
              <p className="text-xs text-muted-foreground max-w-xl">
                <strong>Save Overwrite</strong> menyimpan file ini sebagai{' '}
                <strong>versi baru (Upload ke-{previewVersion.data?.nextVersionNumber ?? 1})</strong> dan
                menjadikannya versi aktif untuk periode &amp; modul terpilih. Versi sebelumnya tidak dihapus
                — tetap tersimpan di tab <em>History &amp; Compare</em>.
              </p>
              <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowImport(false); setImportRows([]); setImportSearch(''); setImportFileName(''); }}
                disabled={isSavingVersion || saveVersion.isPending}
                className="h-10 border px-6 rounded-md font-medium hover:bg-muted text-sm transition-colors disabled:opacity-50"
              >
                Batal
              </button>
              <button
                onClick={handleVersionSave}
                disabled={isSavingVersion || saveVersion.isPending || importRows.length === 0 || !targetPeriodId}
                className="h-10 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white px-6 rounded-md font-medium flex items-center gap-2 disabled:opacity-50 text-sm transition-colors"
              >
                {isSavingVersion || saveVersion.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {isSavingVersion || saveVersion.isPending ? 'Menyimpan...' : 'Save Overwrite'}
              </button>
              </div>
            </div>

            {/* Overlay proses: membaca file (worker) / menyimpan versi baru */}
            {(isParsingFile || isSavingVersion || saveVersion.isPending) && (
              <div className="absolute inset-0 z-30 bg-card/85 backdrop-blur-sm flex items-center justify-center">
                <div className="text-center space-y-3 px-8">
                  <Loader2 size={34} className="animate-spin mx-auto text-primary" />
                  <p className="text-sm font-semibold">
                    {isParsingFile ? 'Membaca file Excel...' : 'Menyimpan versi baru...'}
                  </p>
                  <p className="text-xs text-muted-foreground max-w-sm">
                    {isParsingFile
                      ? `${importFileName ? `${importFileName} · ` : ''}file besar bisa butuh beberapa detik. Mohon tunggu, halaman tetap bisa dipakai.`
                      : 'Snapshot sedang dibuat dan data aktif sedang diperbarui. Jangan tutup halaman ini.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Edit Modal */}
      {editModal.isOpen && editModal.data && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card text-card-foreground border rounded-lg shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Edit Demand</h3>
              <button 
                type="button" 
                onClick={() => setEditModal({ isOpen: false, data: null })}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Part Number</label>
                <div className="font-semibold">{editModal.data.itemCode} - {editModal.data.itemName}</div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Week</label>
                <div className="font-semibold">W{editModal.data.weekNumber}</div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Quantity</label>
                <input 
                  type="number" required min="1"
                  className="w-full h-10 px-3 border rounded-md bg-background"
                  value={editModal.data.quantity} onChange={e => setEditModal(prev => ({...prev, data: {...prev.data, quantity: Number(e.target.value)}}))}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setEditModal({ isOpen: false, data: null })} className="h-10 border px-4 rounded-md font-medium hover:bg-muted transition-colors">Cancel</button>
                <button type="submit" disabled={updateWeekly.isPending} className="h-10 bg-primary text-primary-foreground hover:bg-primary/90 px-4 rounded-md font-medium flex items-center gap-2 transition-colors">
                  <Save size={16} /> {updateWeekly.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
