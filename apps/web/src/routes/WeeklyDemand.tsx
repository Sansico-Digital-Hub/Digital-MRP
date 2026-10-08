import React, { useState, useMemo } from 'react';
import { useWeeklyScheduleSummary, useBulkUpsertWeeklySchedule, useUpdateWeeklySchedule, useDeleteWeeklySchedule, useBulkDeleteWeeklySchedule } from '../hooks/useWeeklySchedule';
import { usePeriods, useCreatePeriod, useUpdatePeriod, useDeletePeriod, monthLabel, MODULE_LABELS, type DataModule } from '../hooks/usePeriods';
import { PeriodSelect } from '../components/PeriodSelect';
import { ModuleSelect } from '../components/ModuleSelect';
import { useItems, useCreateItem } from '../hooks/useItems';
import { SearchableSelect } from '../components/SearchableSelect';
import { Upload, Search, Save, Plus, CalendarRange, Trash2, ChevronLeft, ChevronRight, Calendar, Edit2, Folder, ArrowLeft, Lock, CalendarPlus, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuthStore, lockedDataModule } from '../stores/authStore';

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

/**
 * Apakah minggu ini sudah lewat (weekEnd < hari ini)?
 *
 * Dipakai HANYA untuk penanda visual "Lewat" pada header kolom. Datanya TIDAK
 * dihapus/disembunyikan — minggu yang sudah lewat tetap tampil lengkap.
 */
function isWeekPast(startDate: string | undefined | null): boolean {
  if (!startDate) return false;
  const start = new Date(startDate.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start.getTime() + 6 * 86400000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end.getTime() < today.getTime();
}

/** "19 Sep 2026" dari string tanggal (aman untuk tanggal saja). */
function formatFullDate(value: string | undefined | null): string {
  if (!value) return '';
  const d = new Date(value.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Excel Parser ────────────────────────────────────────────────────────────
interface ImportWeekData {
  weekNumber: number;
  weekStartDate: string; // YYYY-MM-DD
  quantity: number;
}

interface ImportRow {
  id: string;
  itemCode: string;
  description: string;
  weeks: ImportWeekData[];
  total: number;
}

function excelSerialToDate(serial: number): string {
  const utcDays = Math.floor(serial - 25569);
  const d = new Date(utcDays * 86400 * 1000);
  return d.toISOString().split('T')[0];
}

/**
 * Parse the 26-week demand Excel (26Weeks.xlsx format):
 *   Row 0: blank, blank, blank, 1, 2, 3 … 26  (week numbers at cols 3+)
 *   Row 1: "PN", "Description", "Total", date1, date2 … (Excel serial dates at cols 3+)
 *   Row 2+: itemCode, description, total, qty1, qty2 …
 */
function parse26WeekExcel(ws: XLSX.WorkSheet): { rows: ImportRow[]; year: number } {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  // Find header row where col 0 = "PN"
  let headerRow = -1;
  for (let r = 0; r <= Math.min(10, range.e.r); r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell && String(cell.v).trim().toUpperCase() === 'PN') { headerRow = r; break; }
  }
  if (headerRow === -1) return { rows: [], year: new Date().getFullYear() };

  // Week numbers are in the row ABOVE the header row (cols 3+)
  const weekNumRow = headerRow > 0 ? headerRow - 1 : -1;

  const weekColumns: { col: number; weekNumber: number; weekStartDate: string }[] = [];
  for (let c = 3; c <= range.e.c; c++) {
    const wCell = weekNumRow >= 0 ? ws[XLSX.utils.encode_cell({ r: weekNumRow, c })] : null;
    const dCell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
    if (!wCell || wCell.t !== 'n') continue;
    const weekNum = Math.round(wCell.v);
    if (weekNum < 1 || weekNum > 52) continue;
    let startDate = '';
    if (dCell && typeof dCell.v === 'number' && dCell.v > 40000) startDate = excelSerialToDate(dCell.v);
    weekColumns.push({ col: c, weekNumber: weekNum, weekStartDate: startDate });
  }

  if (weekColumns.length === 0) return { rows: [], year: new Date().getFullYear() };
  let year = new Date().getFullYear();
  if (weekColumns[0].weekStartDate) year = parseInt(weekColumns[0].weekStartDate.split('-')[0]);

  const rows: ImportRow[] = [];
  let idCounter = 0;
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const cellPN = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const cellDesc = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    const itemCode = cellPN ? String(cellPN.v).trim() : '';
    const description = cellDesc ? String(cellDesc.v).trim() : '';
    if (!itemCode || itemCode.toUpperCase() === 'PN' || itemCode.toLowerCase().includes('total')) continue;

    const weeks: ImportWeekData[] = [];
    let rowTotal = 0;
    for (const wc of weekColumns) {
      const qtyCell = ws[XLSX.utils.encode_cell({ r, c: wc.col })];
      const qty = qtyCell && typeof qtyCell.v === 'number' ? qtyCell.v : 0;
      if (qty > 0) {
        weeks.push({ weekNumber: wc.weekNumber, weekStartDate: wc.weekStartDate, quantity: Math.round(qty) });
        rowTotal += qty;
      }
    }
    if (weeks.length === 0) continue;
    idCounter++;
    rows.push({ id: `r-${idCounter}`, itemCode, description, weeks, total: Math.round(rowTotal) });
  }
  return { rows, year };
}

// ─── Main Component ──────────────────────────────────────────────────────────
const WEEKS_PER_PAGE = 13; // Show 13 weeks at a time (half of 26)

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
  const [importYear, setImportYear] = useState(currentYear);
  const [importSearch, setImportSearch] = useState('');
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

  // Manual add form state — uses an actual start date so the entry lines up
  // with the dynamic W1-W26 view (relative to today).
  const [formData, setFormData] = useState({
    itemId: '',
    startDate: getNextSaturdayISO(),
    endDate: getNextSaturdayISO(),
    quantity: 0,
  });

  const { data: summaryData, isLoading } = useWeeklyScheduleSummary(selectedPeriodId, moduleType);
  const { data: itemsData } = useItems();
  const createItem = useCreateItem();
  const bulkUpsert = useBulkUpsertWeeklySchedule();
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

  // Kalender kolom minggu dari backend (dibangun dari DATA import, bukan hari ini).
  // Kalau backend belum mengirimnya (versi lama), turunkan dari data yang ada.
  const weekCalendar = useMemo(() => summaryData?.weeks ?? [], [summaryData]);

  // All week numbers present in the period
  const allWeeks = useMemo(() => {
    if (weekCalendar.length > 0) return weekCalendar.map((w) => w.weekNumber);
    const wSet = new Set<number>();
    allData.forEach((row) => Object.keys(row.weeks).forEach((w) => wSet.add(Number(w))));
    return Array.from(wSet).sort((a, b) => a - b);
  }, [weekCalendar, allData]);

  // Map relative week number -> weekStartDate. Diutamakan kalender backend,
  // supaya minggu tanpa demand pun tetap punya label tanggal yang benar.
  // Used to render the small date label under each W column header.
  const weekStartByNumber = useMemo(() => {
    const map: Record<number, string> = {};
    for (const w of weekCalendar) {
      if (w.weekStartDate) map[w.weekNumber] = w.weekStartDate;
    }
    if (Object.keys(map).length > 0) return map;
    for (const row of allData) {
      for (const [w, info] of Object.entries(row.weeks)) {
        const wn = Number(w);
        if (!map[wn] && info?.weekStartDate) map[wn] = info.weekStartDate as string;
      }
    }
    return map;
  }, [weekCalendar, allData]);

  // Tanggal W1 (minggu pertama file import) + label periode untuk header.
  const firstWeekStart = allWeeks.length > 0 ? weekStartByNumber[allWeeks[0]] : null;
  const lastWeekStart = allWeeks.length > 0 ? weekStartByNumber[allWeeks[allWeeks.length - 1]] : null;
  const firstWeekLabel = formatFullDate(firstWeekStart);
  const lastWeekLabel = formatFullDate(lastWeekStart);
  const periodRangeText = firstWeekLabel
    ? `26 minggu dari ${firstWeekLabel}${lastWeekLabel ? ` s/d ${lastWeekLabel}` : ''}`
    : '26 minggu';

  // List of available weeks for the dropdown select in the form
  const availableWeeks = useMemo(() => {
    if (allWeeks.length > 0) {
      return allWeeks.map(w => {
        const startStr = weekStartByNumber[w];
        let dateLabel = '';
        if (startStr) {
          const localDateStr = startStr.split('T')[0];
          const d = new Date(localDateStr + 'T00:00:00');
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
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        let parsed: { rows: ImportRow[]; year: number } = { rows: [], year: currentYear };
        for (const sheetName of wb.SheetNames) {
          parsed = parse26WeekExcel(wb.Sheets[sheetName]);
          if (parsed.rows.length > 0) break;
        }
        if (parsed.rows.length === 0) {
          alert('Tidak dapat memparse file Excel. Pastikan format sesuai (kolom PN, Description, Week 1-26).');
          return;
        }
        setImportRows(parsed.rows);
        setImportYear(parsed.year || currentYear);
      } catch {
        alert('Gagal membaca file Excel.');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleBulkSave = async (saveMode: 'overwrite' | 'add') => {
    if (importRows.length === 0) return;
    const records: any[] = [];
    for (const row of importRows) {
      for (const w of row.weeks) {
        records.push({
          year: importYear,
          weekNumber: w.weekNumber,
          weekStartDate: w.weekStartDate || undefined,
          weekEndDate: w.weekStartDate
            ? new Date(new Date(w.weekStartDate).getTime() + 6 * 86400000).toISOString().split('T')[0]
            : undefined,
          itemCode: row.itemCode,
          description: row.description,
          quantity: w.quantity,
        });
      }
    }
    if (!targetPeriodId) {
      alert('Pilih periode dulu sebelum menyimpan data.');
      return;
    }
    try {
      const res: any = await bulkUpsert.mutateAsync({ records, saveMode, periodId: targetPeriodId, moduleType });
      setShowImport(false);
      setImportRows([]);
      alert(`Berhasil import ${res?.count ?? records.length} data ke modul ${MODULE_LABELS[moduleType]}!`);
    } catch (err: any) {
      alert(err.message || 'Gagal menyimpan data.');
    }
  };

  const filteredImport = importRows.filter((r) => {
    if (!importSearch) return true;
    const q = importSearch.toLowerCase();
    return r.itemCode.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
  });

  const importSummary = useMemo(() => {
    const parts = new Set(importRows.map((r) => r.itemCode));
    const total = importRows.reduce((a, r) => a + r.total, 0);
    const weeks = new Set(importRows.flatMap((r) => r.weeks.map((w) => w.weekNumber)));
    return { parts: parts.size, total, weeks: weeks.size };
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
          <p className="text-muted-foreground text-sm">
            {firstWeekLabel
              ? `Rencana kebutuhan produksi 26 minggu dari ${firstWeekLabel}${lastWeekLabel ? ` s/d ${lastWeekLabel}` : ''} (mengikuti periode data yang diupload).`
              : 'Rencana kebutuhan produksi selama 26 minggu.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground border rounded-md px-3 h-9">
            <Calendar size={14} />
            <span>{firstWeekLabel ? periodRangeText : '26 minggu'}</span>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                className="cursor-pointer p-5 border rounded-lg bg-card hover:bg-muted/50 hover:border-primary/50 transition-all flex items-center gap-4 group shadow-sm relative overflow-hidden pr-12"
              >
                <div className="p-3 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors">
                  <Folder className="w-8 h-8 text-blue-500 fill-blue-500/20" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground flex items-center gap-1.5">
                    <span className="truncate">{p.label}</span>
                    {p.isLocked && <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {p.moduleCounts[moduleType].MRP} baris MRP {MODULE_LABELS[moduleType]}
                  </p>
                </div>
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
        <div className="flex items-center gap-3 mb-2 animate-in fade-in slide-in-from-bottom-2">
          <button 
            onClick={() => setSelectedPeriodId(null)}
            className="p-2 hover:bg-background rounded-md border text-muted-foreground hover:text-foreground transition-colors shrink-0 bg-card"
            title="Kembali ke daftar periode"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h3 className="font-semibold text-lg">
            {selectedPeriod?.label ?? 'Periode'} (26-Week Demand Plan)
            {firstWeekLabel && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                26 minggu dari {firstWeekLabel}
              </span>
            )}
          </h3>
        </div>
      <div className="bg-card text-card-foreground border rounded-lg shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
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
                    ? new Date(start).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                    : '';
                  // Minggu yang sudah lewat tetap tampil — hanya diberi penanda.
                  const past = isWeekPast(start);
                  return (
                    <th key={w} className={`px-3 py-1 text-center min-w-[80px] ${past ? 'bg-muted/40' : ''}`}>
                      <div className="font-bold">W{w}</div>
                      {startLabel && <div className="text-[10px] font-normal normal-case text-muted-foreground/80">{startLabel}</div>}
                      {past && <div className="text-[9px] font-medium normal-case text-amber-600">Lewat</div>}
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
                    Loading...
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
                          {qty ? (
                            <div className="flex flex-col items-center justify-center w-full h-full">
                              <span className="font-medium text-blue-600 dark:text-blue-400">
                                {qty.toLocaleString()}
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
                      {visibleWeeks.reduce((sum, w) => sum + (row.weeks?.[w]?.quantity || 0), 0).toLocaleString()}
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
              <span className="ml-1 normal-case">
                (seluruh periode data import; minggu yang sudah lewat ditandai <span className="font-medium text-amber-600">Lewat</span>)
              </span>
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
      </>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card text-card-foreground border rounded-lg shadow-xl max-w-5xl w-full max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-6 border-b">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Upload size={20} /> Import 26-Week Demand Plan
              </h3>
              <button
                onClick={() => { setShowImport(false); setImportRows([]); setImportSearch(''); }}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
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

                  {/* Tahun import */}
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium whitespace-nowrap">Tahun Data:</label>
                    <input
                      type="number"
                      className="h-9 w-28 px-3 border rounded-md bg-background text-sm"
                      value={importYear}
                      onChange={(e) => setImportYear(Number(e.target.value))}
                    />
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
                      <input
                        type="text"
                        placeholder="Cari Part Number / Description..."
                        className="w-full h-9 pl-9 pr-3 border rounded-md bg-background text-sm"
                        value={importSearch}
                        onChange={(e) => setImportSearch(e.target.value)}
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
                        {filteredImport.map((row) => (
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
                                      ? new Date(week.weekStartDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                                      : '';
                                    const startDate = week.weekStartDate
                                      ? new Date(new Date(week.weekStartDate).getTime() - 6 * 86400000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
                                      : '';
                                    return (
                                      <div key={idx} className="flex items-center gap-1">
                                        <span className="font-medium text-blue-600">W{week.weekNumber}</span>
                                        {startDate && endDate && (
                                          <span className="text-muted-foreground/60">({startDate} - {endDate})</span>
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
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t flex justify-end gap-3 bg-muted/10">
              <button
                onClick={() => { setShowImport(false); setImportRows([]); }}
                className="h-10 border px-6 rounded-md font-medium hover:bg-muted text-sm transition-colors"
              >
                Batal
              </button>
              <button
                onClick={() => handleBulkSave('add')}
                disabled={bulkUpsert.isPending || importRows.length === 0 || !targetPeriodId}
                className="h-10 bg-green-600 hover:bg-green-700 text-white px-6 rounded-md font-medium flex items-center gap-2 disabled:opacity-50 text-sm transition-colors"
              >
                <Plus size={16} />
                {bulkUpsert.isPending ? 'Menyimpan...' : 'Save (Add)'}
              </button>
              <button
                onClick={() => handleBulkSave('overwrite')}
                disabled={bulkUpsert.isPending || importRows.length === 0 || !targetPeriodId}
                className="h-10 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white px-6 rounded-md font-medium flex items-center gap-2 disabled:opacity-50 text-sm transition-colors"
              >
                <Save size={16} />
                {bulkUpsert.isPending ? 'Menyimpan...' : 'Save Overwrite'}
              </button>
            </div>
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
