import { useEffect, useState, useRef, useMemo, Fragment } from 'react';
import {
  useOutstandingPO,
  useUploadOutstandingPO,
  useAddManualOutstandingPO,
  useUpdateOutstandingPO,
  useDeleteOutstandingPO,
  useBulkDeleteOutstandingPO,
  useImportOutstandingPO,
  type OutstandingPOData,
  type OutstandingPOImportError,
  type OutstandingPOUploadResult
} from '../hooks/useOutstandingPO';
import { FileSpreadsheet, Plus, Upload, Loader2, Search, Pencil, Trash2, X, Check, Save, Folder, ArrowLeft, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Lock, CalendarPlus, AlertTriangle } from 'lucide-react';
import { usePeriods, useCreatePeriod, monthLabel } from '../hooks/usePeriods';
import { PeriodSelect } from '../components/PeriodSelect';
import { RefBSummary, RefBValue, matchesMtl, REF_B_MTL_MESSAGE } from '../components/RefB';
import { format } from 'date-fns';

/** Satu baris Outstanding PO sebelum disimpan (hasil parse Excel / edit di preview). */
type OutstandingPORow = Omit<OutstandingPOData, 'id' | 'periodId' | 'createdAt' | 'updatedAt'>;

/** Bentuk minimal sebuah baris PO, dipakai oleh pengelompokan (record & preview). */
type PoRowLike = {
  itemDesc: string;
  poNumber: string;
  planReceivedDate: string;
  supplierName: string;
  qtyOrder: number;
  qtyOrderUnit: string;
  qtyDelivered: number;
  qtyDeliveredUnit: string;
  /** Referensi customer (kolom Excel `PR Ref-B`). */
  refB?: string | null;
};

/** Total per satuan — kg dan rim TIDAK boleh dijumlahkan jadi satu angka. */
interface UnitTotal {
  unit: string;
  qty: number;
}

/** Grup level-1: satu UKURAN / ITEM DESC, berisi semua PO dengan ukuran itu. */
interface PoGroup<T> {
  itemDesc: string;
  items: T[];
  /** Nomor PO unik di grup ini (satu PO boleh muncul di beberapa baris). */
  poNumbers: string[];
  /** Referensi customer unik di grup ini (kolom `PR Ref-B`). */
  refBs: string[];
  /** Label tanggal rencana yang unik, mis. "2 Plan Dates". */
  planDateLabels: string[];
  supplierNames: string;
  orderTotals: UnitTotal[];
  deliveredTotals: UnitTotal[];
}

const fmtQty = (n: number, decimals = 4) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });

/** Format tanggal yang tidak melempar error untuk nilai tidak valid. */
function safeFormatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : format(d, 'dd MMM yyyy');
}

function addUnitTotal(list: UnitTotal[], unit: string, qty: number) {
  const u = (unit || 'kg').trim().toLowerCase() || 'kg';
  const value = Number(qty) || 0;
  const found = list.find((t) => t.unit === u);
  if (found) found.qty += value;
  else list.push({ unit: u, qty: value });
}

/**
 * Kelompokkan baris Outstanding PO per ITEM DESC (ukuran).
 *
 * Aturan penting:
 *  - SATU BARIS = SATU RECORD ITEM. Tidak ada dedup berdasarkan PO Number.
 *  - Badge jumlah PO = jumlah NOMOR PO UNIK, bukan jumlah baris.
 *  - Total qty dihitung PER SATUAN, supaya kg dan rim tidak tercampur.
 */
function buildPoGroups<T extends PoRowLike>(rows: T[]): PoGroup<T>[] {
  const map = new Map<string, PoGroup<T>>();

  for (const r of rows) {
    const label = (r.itemDesc || '').trim();
    const key = label.toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = {
        itemDesc: label,
        items: [],
        poNumbers: [],
        refBs: [],
        planDateLabels: [],
        supplierNames: '',
        orderTotals: [],
        deliveredTotals: [],
      };
      map.set(key, g);
    }
    g.items.push(r);

    const no = (r.poNumber || '').trim();
    if (no && !g.poNumbers.includes(no)) g.poNumbers.push(no);

    const ref = (r.refB || '').trim();
    if (ref && !g.refBs.includes(ref)) g.refBs.push(ref);

    const dateLabel = safeFormatDate(r.planReceivedDate);
    if (dateLabel !== '—' && !g.planDateLabels.includes(dateLabel)) g.planDateLabels.push(dateLabel);

    const sup = (r.supplierName || '').trim();
    if (sup) {
      const current = g.supplierNames ? g.supplierNames.split(', ') : [];
      if (!current.includes(sup)) g.supplierNames = current.length ? `${g.supplierNames}, ${sup}` : sup;
    }

    addUnitTotal(g.orderTotals, r.qtyOrderUnit, r.qtyOrder);
    addUnitTotal(g.deliveredTotals, r.qtyDeliveredUnit, r.qtyDelivered);
  }

  return [...map.values()].sort((a, b) => a.itemDesc.localeCompare(b.itemDesc));
}

/** Jumlah nomor PO unik dalam sederet baris. */
function uniquePoCount(rows: Array<{ poNumber: string }>): number {
  const set = new Set<string>();
  for (const r of rows) {
    const no = (r.poNumber || '').trim();
    if (no) set.add(no);
  }
  return set.size;
}

/** Badge nomor PO di baris grup (maks 3, sisanya jadi "+N lagi"). */
function PoNumberBadges({ numbers }: { numbers: string[] }) {
  if (numbers.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const shown = numbers.slice(0, 3);
  return (
    <div className="flex flex-wrap gap-1 max-w-[220px]" title={`PO: ${numbers.join(', ')}`}>
      {shown.map((no) => (
        <span key={no} className="font-mono text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded whitespace-nowrap">
          {no}
        </span>
      ))}
      {numbers.length > shown.length && (
        <span className="text-[11px] font-semibold text-muted-foreground self-center">
          +{numbers.length - shown.length} lagi
        </span>
      )}
    </div>
  );
}

/**
 * Total per satuan. Kalau satu ukuran punya unit campuran (kg + rim),
 * angkanya ditumpuk ke bawah agar TIDAK dijumlahkan lintas satuan.
 */
function UnitTotals({
  totals,
  unitOnly = false,
  strong = false,
}: {
  totals: UnitTotal[];
  unitOnly?: boolean;
  strong?: boolean;
}) {
  if (totals.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className={`flex flex-col gap-0.5 ${unitOnly ? 'items-center' : 'items-end'}`}>
      {totals.map((t) => (
        <span key={t.unit}>
          {unitOnly ? (
            <span className="bg-primary/10 text-primary font-semibold px-2.5 py-1 rounded text-xs">{t.unit}</span>
          ) : (
            <span className={`tabular-nums text-sm ${strong ? 'font-extrabold text-foreground' : 'text-foreground'}`}>
              {fmtQty(t.qty)}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export function OutstandingPO() {
  // Periode upload = keranjang data. WAJIB dipilih sebelum upload/isi manual.
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  // Periode tujuan untuk Import / Add Manual. Ikut periode yang sedang dibuka,
  // tapi tetap bisa diganti langsung dari dalam form.
  const [targetPeriodId, setTargetPeriodId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedPeriodId) setTargetPeriodId(selectedPeriodId);
  }, [selectedPeriodId]);
  const [newPeriodMonth, setNewPeriodMonth] = useState('');
  const { data: periodsRes, isLoading: periodsLoading } = usePeriods();
  const periods = periodsRes?.data ?? [];
  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId) ?? null;
  const targetPeriod = periods.find((p) => p.id === targetPeriodId) ?? null;
  const createPeriod = useCreatePeriod();
  const { data: poData, isLoading } = useOutstandingPO(selectedPeriodId);

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
  const uploadMutation = useUploadOutstandingPO();
  const importMutation = useImportOutstandingPO();
  const addManualMutation = useAddManualOutstandingPO();
  const updateMutation = useUpdateOutstandingPO();
  const deleteMutation = useDeleteOutstandingPO();
  const bulkDeleteMutation = useBulkDeleteOutstandingPO();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewData, setPreviewData] = useState<OutstandingPORow[]>([]);
  /** Baris Excel yang gagal diimpor (mis. kolom `PO NO` kosong). */
  const [importErrors, setImportErrors] = useState<OutstandingPOImportError[]>([]);
  /** Ringkasan hasil pembacaan file (total/masuk MTL/dilewati). */
  const [uploadSummary, setUploadSummary] = useState<OutstandingPOUploadResult['summary'] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewSearchTerm, setPreviewSearchTerm] = useState('');
  const [previewEditingIndex, setPreviewEditingIndex] = useState<number | null>(null);
  const [previewEditForm, setPreviewEditForm] = useState({
    poNumber: '',
    supplierName: '',
    itemDesc: '',
    qtyOrder: '',
    qtyOrderUnit: 'kg',
    qtyDelivered: '',
    qtyDeliveredUnit: 'kg',
    refB: '',
  });

  const [isManualOpen, setIsManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    poNumber: '',
    planReceivedDate: format(new Date(), 'yyyy-MM-dd'),
    supplierName: '',
    itemDesc: '',
    qtyOrder: '',
    qtyOrderUnit: 'kg',
    qtyDelivered: '',
    qtyDeliveredUnit: 'kg',
    refB: '',
  });
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    poNumber: '',
    planReceivedDate: '',
    supplierName: '',
    itemDesc: '',
    qtyOrder: '',
    qtyOrderUnit: 'kg',
    qtyDelivered: '',
    qtyDeliveredUnit: 'kg',
    refB: '',
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedItemDescs, setExpandedItemDescs] = useState<Set<string>>(new Set());
  const [expandedPreviewDescs, setExpandedPreviewDescs] = useState<Set<string>>(new Set());

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    uploadMutation.mutate(file, {
      onSuccess: (res) => {
        setImportErrors(res.errors ?? []);
        setUploadSummary(res.summary ?? null);
        setExpandedPreviewDescs(new Set());
        if (res.data && res.data.length > 0) {
          setPreviewData(res.data);
        } else {
          setPreviewData([]);
          alert(res.message || 'No valid data found in file.');
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
      onError: (error: any) => {
        setImportErrors([]);
        setUploadSummary(null);
        alert(`Failed to upload file: ${error.message}`);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    });
  };

  const handleSaveImport = (mode: 'add' | 'overwrite') => {
    if (previewData.length === 0) return;
    if (!targetPeriodId) {
      alert('Pilih periode dulu sebelum menyimpan data.');
      return;
    }
    const missingPo = previewData.filter((r) => !String(r.poNumber || '').trim());
    if (missingPo.length > 0) {
      alert(
        `${missingPo.length} baris belum punya PO Number. PO Number wajib diisi untuk semua baris.`,
      );
      return;
    }

    let confirmMsg = `Tambahkan ${previewData.length} baris ke periode "${targetPeriod?.label}"?`;
    if (mode === 'overwrite') {
      const existing = targetPeriod?.counts.OUTSTANDING_PO ?? 0;
      confirmMsg =
        `PERHATIAN: seluruh data Outstanding PO di periode "${targetPeriod?.label}" (${existing} baris) ` +
        `akan DIGANTI dengan ${previewData.length} baris dari file ini.\n\n` +
        'Periode lain tidak terpengaruh. Lanjutkan?';
    }

    if (!window.confirm(confirmMsg)) return;

    importMutation.mutate({ data: previewData, mode, periodId: targetPeriodId }, {
      onSuccess: () => {
        alert('Data imported successfully!');
        setPreviewData([]);
        setImportErrors([]);
        setUploadSummary(null);
        setPreviewSearchTerm('');
        setPreviewEditingIndex(null);
      },
      onError: (error: any) => {
        alert(`Failed to import data: ${error.message}`);
      }
    });
  };

  const handlePreviewEditClick = (index: number, record: OutstandingPORow) => {
    setPreviewEditingIndex(index);
    setPreviewEditForm({
      poNumber: record.poNumber || '',
      supplierName: record.supplierName,
      itemDesc: record.itemDesc,
      qtyOrder: record.qtyOrder.toString(),
      qtyOrderUnit: record.qtyOrderUnit,
      qtyDelivered: record.qtyDelivered.toString(),
      qtyDeliveredUnit: record.qtyDeliveredUnit,
      refB: record.refB || '',
    });
  };

  const handlePreviewSaveEdit = (index: number) => {
    if (!previewEditForm.poNumber.trim() || !previewEditForm.supplierName || !previewEditForm.itemDesc || !previewEditForm.qtyOrder || !previewEditForm.qtyDelivered) {
      alert('Please fill all required fields (PO Number wajib diisi)');
      return;
    }
    if (!matchesMtl(previewEditForm.refB)) {
      alert(REF_B_MTL_MESSAGE);
      return;
    }
    const updatedData = [...previewData];
    updatedData[index] = {
      ...updatedData[index],
      poNumber: previewEditForm.poNumber.trim(),
      supplierName: previewEditForm.supplierName,
      itemDesc: previewEditForm.itemDesc,
      qtyOrder: parseFloat(previewEditForm.qtyOrder),
      qtyOrderUnit: previewEditForm.qtyOrderUnit,
      qtyDelivered: parseFloat(previewEditForm.qtyDelivered),
      qtyDeliveredUnit: previewEditForm.qtyDeliveredUnit,
      refB: previewEditForm.refB.trim() || null,
    };
    setPreviewData(updatedData);
    setPreviewEditingIndex(null);
  };

  const handlePreviewDelete = (index: number) => {
    if (window.confirm('Are you sure you want to remove this record from the preview?')) {
      const updatedData = [...previewData];
      updatedData.splice(index, 1);
      setPreviewData(updatedData);
      if (previewEditingIndex === index) setPreviewEditingIndex(null);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.poNumber.trim() || !manualForm.planReceivedDate || !manualForm.supplierName || !manualForm.itemDesc || !manualForm.qtyOrder || !manualForm.qtyDelivered) {
      alert('Please fill all required fields (PO Number wajib diisi)');
      return;
    }

    if (!matchesMtl(manualForm.refB)) {
      alert(REF_B_MTL_MESSAGE);
      return;
    }

    if (!targetPeriodId) {
      alert('Pilih periode dulu sebelum menambah data manual.');
      return;
    }

    addManualMutation.mutate({
      poNumber: manualForm.poNumber.trim(),
      planReceivedDate: manualForm.planReceivedDate,
      supplierName: manualForm.supplierName,
      itemDesc: manualForm.itemDesc,
      qtyOrder: parseFloat(manualForm.qtyOrder),
      qtyOrderUnit: manualForm.qtyOrderUnit,
      qtyDelivered: parseFloat(manualForm.qtyDelivered),
      qtyDeliveredUnit: manualForm.qtyDeliveredUnit,
      refB: manualForm.refB.trim() || null,
      periodId: targetPeriodId,
    }, {
      onSuccess: () => {
        setManualForm({
          poNumber: '',
          planReceivedDate: format(new Date(), 'yyyy-MM-dd'),
          supplierName: '',
          itemDesc: '',
          qtyOrder: '',
          qtyOrderUnit: 'kg',
          qtyDelivered: '',
          qtyDeliveredUnit: 'kg',
          refB: '',
        });
        setIsManualOpen(false);
      },
      onError: (error: any) => {
        alert(`Failed to add record: ${error.message}`);
      }
    });
  };

  const handleEditClick = (record: OutstandingPOData) => {
    setEditingId(record.id);
    setEditForm({
      poNumber: record.poNumber || '',
      planReceivedDate: format(new Date(record.planReceivedDate), 'yyyy-MM-dd'),
      supplierName: record.supplierName,
      itemDesc: record.itemDesc,
      qtyOrder: record.qtyOrder.toString(),
      qtyOrderUnit: record.qtyOrderUnit,
      qtyDelivered: record.qtyDelivered.toString(),
      qtyDeliveredUnit: record.qtyDeliveredUnit,
      refB: record.refB || '',
    });
  };

  const handleSaveEdit = (id: string) => {
    if (!editForm.poNumber.trim() || !editForm.planReceivedDate || !editForm.supplierName || !editForm.itemDesc || !editForm.qtyOrder || !editForm.qtyDelivered) {
      alert('Please fill all required fields (PO Number wajib diisi)');
      return;
    }
    if (!matchesMtl(editForm.refB)) {
      alert(REF_B_MTL_MESSAGE);
      return;
    }

    updateMutation.mutate({
      id,
      data: {
        poNumber: editForm.poNumber.trim(),
        planReceivedDate: editForm.planReceivedDate,
        supplierName: editForm.supplierName,
        itemDesc: editForm.itemDesc,
        qtyOrder: parseFloat(editForm.qtyOrder),
        qtyOrderUnit: editForm.qtyOrderUnit,
        qtyDelivered: parseFloat(editForm.qtyDelivered),
        qtyDeliveredUnit: editForm.qtyDeliveredUnit,
        refB: editForm.refB.trim() || null,
      }
    }, {
      onSuccess: () => setEditingId(null),
      onError: (error: any) => alert(`Failed to update record: ${error.message}`)
    });
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this record?')) {
      deleteMutation.mutate(id, {
        onError: (error: any) => alert(`Failed to delete record: ${error.message}`)
      });
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) setSelectedIds(filteredRecords.map((r) => r.id));
    else setSelectedIds([]);
  };

  const handleSelectOne = (e: React.ChangeEvent<HTMLInputElement>, id: string) => {
    if (e.target.checked) setSelectedIds([...selectedIds, id]);
    else setSelectedIds(selectedIds.filter((s) => s !== id));
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`Are you sure you want to delete ${selectedIds.length} records?`)) {
      bulkDeleteMutation.mutate(selectedIds, {
        onSuccess: () => setSelectedIds([]),
        onError: (error: any) => alert(`Failed to delete records: ${error.message}`)
      });
    }
  };

  const records = useMemo(() => poData ?? [], [poData]);

  /** Pencarian mencakup nomor PO, item desc, supplier, dan Ref-B. */
  const matchSearch = (record: PoRowLike, term: string) => {
    const q = term.trim().toLowerCase();
    if (!q) return true;
    return (
      (record.itemDesc || '').toLowerCase().includes(q) ||
      (record.supplierName || '').toLowerCase().includes(q) ||
      (record.poNumber || '').toLowerCase().includes(q) ||
      (record.refB || '').toLowerCase().includes(q)
    );
  };

  const filteredRecords = useMemo(
    () => records.filter((record) => matchSearch(record, searchTerm)),
    [records, searchTerm],
  );

  const groupedByItem = useMemo(() => buildPoGroups(filteredRecords), [filteredRecords]);

  /** Items = jumlah grup ukuran unik, POs = jumlah NOMOR PO unik. */
  const totalItems = groupedByItem.length;
  const totalPos = useMemo(() => uniquePoCount(filteredRecords), [filteredRecords]);

  const toggleExpand = (itemDesc: string) => {
    setExpandedItemDescs(prev => {
      const next = new Set(prev);
      if (next.has(itemDesc)) {
        next.delete(itemDesc);
      } else {
        next.add(itemDesc);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedItemDescs(new Set(groupedByItem.map(g => g.itemDesc)));
  };

  const collapseAll = () => {
    setExpandedItemDescs(new Set());
  };

  const handleToggleGroupSelect = (groupItems: OutstandingPOData[]) => {
    const groupIds = groupItems.map(i => i.id);
    const allSelected = groupIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !groupIds.includes(id)));
    } else {
      const newIds = new Set([...selectedIds, ...groupIds]);
      setSelectedIds(Array.from(newIds));
    }
  };

  // ── Data Preview: pencarian + pengelompokan yang sama dengan list utama ──
  const filteredPreviewData = useMemo(
    () => previewData.filter((record) => matchSearch(record, previewSearchTerm)),
    [previewData, previewSearchTerm],
  );
  const previewGroups = useMemo(() => buildPoGroups(filteredPreviewData), [filteredPreviewData]);
  const previewPos = useMemo(() => uniquePoCount(filteredPreviewData), [filteredPreviewData]);

  const togglePreviewExpand = (itemDesc: string) => {
    setExpandedPreviewDescs(prev => {
      const next = new Set(prev);
      if (next.has(itemDesc)) next.delete(itemDesc);
      else next.add(itemDesc);
      return next;
    });
  };

  const expandAllPreview = () => setExpandedPreviewDescs(new Set(previewGroups.map(g => g.itemDesc)));
  const collapseAllPreview = () => setExpandedPreviewDescs(new Set());

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Outstanding PO</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage outstanding PO data. Upload from Excel or add manually.
          </p>
        </div>
        
        <div className="flex gap-2">
          <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx, .xls, .xlsm" onChange={handleFileUpload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending || previewData.length > 0}
            className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md font-medium text-sm transition-colors"
          >
            {uploadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Import Excel
          </button>
          
          <button
            onClick={() => setIsManualOpen(!isManualOpen)}
            disabled={previewData.length > 0}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md font-medium text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Manual
          </button>
        </div>
      </div>

      {previewData.length > 0 ? (
        <div className="bg-card border border-primary/20 rounded-lg shadow-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className="p-5 border-b bg-primary/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" /> Data Preview
              </h2>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                <span>You are about to import <strong>{previewData.length}</strong> records.</span>
                <span className="text-xs font-medium bg-background border px-2 py-0.5 rounded">
                  {previewGroups.length} Items <span className="text-muted-foreground/40">•</span> {previewPos} POs
                </span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative w-full sm:w-64 mr-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <input type="text" placeholder="Cari PO Number / item..." className="w-full pl-9 pr-4 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary" value={previewSearchTerm} onChange={(e) => setPreviewSearchTerm(e.target.value)} />
              </div>
              <div className="flex items-center gap-1 bg-background border rounded-md p-0.5 text-xs text-muted-foreground">
                <button onClick={expandAllPreview} className="px-2 py-1 hover:bg-muted hover:text-foreground rounded flex items-center gap-1 transition-colors" title="Buka Semua Detail">
                  <ChevronsDown className="w-3.5 h-3.5" /> Buka
                </button>
                <span className="text-muted-foreground/30">|</span>
                <button onClick={collapseAllPreview} className="px-2 py-1 hover:bg-muted hover:text-foreground rounded flex items-center gap-1 transition-colors" title="Tutup Semua Detail">
                  <ChevronsUp className="w-3.5 h-3.5" /> Tutup
                </button>
              </div>
              <button onClick={() => handleSaveImport('add')} disabled={importMutation.isPending || !targetPeriodId} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md font-medium text-sm disabled:opacity-50">
                {importMutation.isPending && importMutation.variables?.mode === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save (Add)
              </button>
              <button onClick={() => handleSaveImport('overwrite')} disabled={importMutation.isPending || !targetPeriodId} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-md font-medium text-sm disabled:opacity-50">
                {importMutation.isPending && importMutation.variables?.mode === 'overwrite' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save (Overwrite)
              </button>
              <button onClick={() => setPreviewData([])} disabled={importMutation.isPending} className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground hover:bg-muted/80 rounded-md font-medium text-sm">
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </div>
          <div className="px-5 py-4 border-b bg-amber-50/40 dark:bg-amber-500/5">
            <PeriodSelect value={targetPeriodId} onChange={setTargetPeriodId} className="max-w-md" />
          </div>
          {uploadSummary && (
            <div className="mx-5 mt-4 border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 rounded-lg px-4 py-3">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-1">
                Ringkasan file Outstanding PO
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-foreground">
                <span>
                  Total baris di file: <strong>{uploadSummary.totalRows}</strong>
                </span>
                <span className="text-emerald-700 dark:text-emerald-400">
                  Masuk (mengandung "MTL"): <strong>{uploadSummary.included}</strong>
                </span>
                <span className="text-amber-700 dark:text-amber-400">
                  Dilewati (tidak mengandung "MTL"): <strong>{uploadSummary.skippedNoMtl}</strong>
                </span>
                {uploadSummary.failed > 0 && (
                  <span className="text-destructive">
                    Gagal: <strong>{uploadSummary.failed}</strong>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Hanya baris dengan kolom <span className="font-semibold">PR Ref-B</span> mengandung
                "MTL" yang bisa diimpor.
              </p>
            </div>
          )}
          {importErrors.length > 0 && (
            <div className="mx-5 my-4 border border-destructive/40 bg-destructive/5 rounded-lg overflow-hidden">
              <div className="px-4 py-3 flex items-center gap-2 border-b border-destructive/20 bg-destructive/10">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                <p className="text-sm font-semibold text-destructive">
                  {importErrors.length} baris GAGAL diimpor — baris valid tetap diproses
                </p>
              </div>
              <ul className="max-h-40 overflow-auto divide-y divide-destructive/10 text-xs">
                {importErrors.map((err, i) => (
                  <li key={i} className="px-4 py-2 flex items-start gap-2 text-destructive">
                    <span className="font-mono font-semibold shrink-0">Baris {err.row}</span>
                    <span>{err.message.replace(/^Baris \d+\s*(\(PO [^)]*\))?\s*:?\s*/, '')}</span>
                  </li>
                ))}
              </ul>
              <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-destructive/10">
                Perbaiki kolom <span className="font-semibold">PO NO</span> di file Excel lalu impor ulang,
                atau tambahkan PO Number langsung pada baris pratinjau di bawah.
              </p>
            </div>
          )}
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-secondary/50 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-6 py-4 font-semibold">Plan Date</th>
                  <th className="px-6 py-4 font-semibold">PO Number</th>
                  <th className="px-6 py-4 font-semibold">Supplier</th>
                  <th className="px-6 py-4 font-semibold w-1/4">Item Desc</th>
                  <th className="px-6 py-4 font-semibold">Ref-B</th>
                  <th className="px-6 py-4 font-semibold text-right">Qty Order</th>
                  <th className="px-6 py-4 font-semibold text-center">Unit</th>
                  <th className="px-6 py-4 font-semibold text-right">Qty Delivered</th>
                  <th className="px-6 py-4 font-semibold text-center">Unit</th>
                  <th className="px-6 py-4 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {previewGroups.length === 0 ? (
                   <tr><td colSpan={10} className="px-6 py-8 text-center text-muted-foreground">No matching data found in preview.</td></tr>
                ) : previewGroups.map((group) => {
                  const isExpanded = expandedPreviewDescs.has(group.itemDesc);
                  return (
                    <Fragment key={group.itemDesc}>
                      {/* Baris grup (level 1): satu ukuran / ITEM DESC */}
                      <tr className="hover:bg-muted/40 transition-colors bg-card font-medium border-b">
                        <td className="px-6 py-3.5 text-muted-foreground text-xs font-medium whitespace-nowrap">
                          {group.planDateLabels.length === 1
                            ? group.planDateLabels[0]
                            : `${group.planDateLabels.length} Plan Dates`}
                        </td>
                        <td className="px-6 py-3.5"><PoNumberBadges numbers={group.poNumbers} /></td>
                        <td className="px-6 py-3.5 text-muted-foreground text-xs">{group.supplierNames || '-'}</td>
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => togglePreviewExpand(group.itemDesc)}
                              className="p-1 hover:bg-muted/80 rounded transition-colors text-muted-foreground hover:text-foreground shrink-0"
                              title={isExpanded ? 'Tutup Detail' : 'Buka Detail'}
                            >
                              {isExpanded ? <ChevronDown className="w-4 h-4 text-primary" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            <span
                              className="font-bold text-foreground cursor-pointer hover:text-primary transition-colors"
                              onClick={() => togglePreviewExpand(group.itemDesc)}
                            >
                              {group.itemDesc}
                            </span>
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                              {group.poNumbers.length} {group.poNumbers.length > 1 ? 'POs' : 'PO'}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-3.5"><RefBSummary refs={group.refBs} /></td>
                        <td className="px-6 py-3.5"><UnitTotals totals={group.orderTotals} strong /></td>
                        <td className="px-6 py-3.5"><UnitTotals totals={group.orderTotals} unitOnly /></td>
                        <td className="px-6 py-3.5"><UnitTotals totals={group.deliveredTotals} strong /></td>
                        <td className="px-6 py-3.5"><UnitTotals totals={group.deliveredTotals} unitOnly /></td>
                        <td className="px-6 py-3.5 text-right">
                          <button
                            onClick={() => togglePreviewExpand(group.itemDesc)}
                            className="text-xs text-primary hover:text-primary/80 font-medium inline-flex items-center gap-1 p-1 hover:bg-primary/10 rounded transition-colors"
                          >
                            {isExpanded ? 'Tutup' : 'Detail'}
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      </tr>

                      {/* Baris detail (level 2): satu baris = satu record item */}
                      {isExpanded && group.items.map((record) => {
                        const originalIndex = previewData.indexOf(record);
                        return (
                          <tr key={originalIndex} className="bg-muted/20 hover:bg-muted/35 transition-colors border-l-4 border-l-primary/60">
                            <td className="px-6 py-2.5 font-medium whitespace-nowrap text-xs text-foreground">{safeFormatDate(record.planReceivedDate)}</td>
                            {previewEditingIndex === originalIndex ? (
                              <>
                                <td className="px-6 py-2.5"><input type="text" className="w-full h-8 px-2 border rounded text-xs font-mono" placeholder="PO Number" value={previewEditForm.poNumber} onChange={(e) => setPreviewEditForm({ ...previewEditForm, poNumber: e.target.value })} /></td>
                                <td className="px-6 py-2.5"><input type="text" className="w-full h-8 px-2 border rounded text-xs" value={previewEditForm.supplierName} onChange={(e) => setPreviewEditForm({ ...previewEditForm, supplierName: e.target.value })} /></td>
                                <td className="px-6 py-2.5"><input type="text" className="w-full h-8 px-2 border rounded text-xs" placeholder="Item Desc" value={previewEditForm.itemDesc} onChange={(e) => setPreviewEditForm({ ...previewEditForm, itemDesc: e.target.value })} /></td>
                                <td className="px-6 py-2.5"><input type="text" className="w-full h-8 px-2 border rounded text-xs font-mono" placeholder="Ref-B (mis. MTL/...)" value={previewEditForm.refB} onChange={(e) => setPreviewEditForm({ ...previewEditForm, refB: e.target.value })} /></td>
                                <td className="px-6 py-2.5"><input type="number" step="any" className="w-full h-8 px-2 border rounded text-xs text-right" value={previewEditForm.qtyOrder} onChange={(e) => setPreviewEditForm({ ...previewEditForm, qtyOrder: e.target.value })} /></td>
                                <td className="px-6 py-2.5">
                                  <select className="w-full h-8 px-2 border rounded text-xs" value={previewEditForm.qtyOrderUnit} onChange={(e) => setPreviewEditForm({ ...previewEditForm, qtyOrderUnit: e.target.value })}>
                                    <option value="kg">kg</option>
                                    <option value="rim">rim</option>
                                    <option value="sheets">sheets</option>
                                  </select>
                                </td>
                                <td className="px-6 py-2.5"><input type="number" step="any" className="w-full h-8 px-2 border rounded text-xs text-right" value={previewEditForm.qtyDelivered} onChange={(e) => setPreviewEditForm({ ...previewEditForm, qtyDelivered: e.target.value })} /></td>
                                <td className="px-6 py-2.5">
                                  <select className="w-full h-8 px-2 border rounded text-xs" value={previewEditForm.qtyDeliveredUnit} onChange={(e) => setPreviewEditForm({ ...previewEditForm, qtyDeliveredUnit: e.target.value })}>
                                    <option value="kg">kg</option>
                                    <option value="rim">rim</option>
                                    <option value="sheets">sheets</option>
                                  </select>
                                </td>
                                <td className="px-6 py-2.5 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <button onClick={() => handlePreviewSaveEdit(originalIndex)} className="p-1.5 text-green-600 hover:bg-green-50 rounded">
                                      <Check className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => setPreviewEditingIndex(null)} className="p-1.5 text-muted-foreground hover:bg-muted rounded"><X className="w-4 h-4" /></button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-6 py-2.5 font-mono text-xs font-semibold text-primary whitespace-nowrap">
                                  {record.poNumber || <span className="text-destructive font-sans">(kosong)</span>}
                                </td>
                                <td className="px-6 py-2.5 text-xs text-muted-foreground">{record.supplierName}</td>
                                <td className="px-6 py-2.5">
                                  <div className="pl-6 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" title={group.itemDesc}></span>
                                  </div>
                                </td>
                                <td className="px-6 py-2.5"><RefBValue value={record.refB} /></td>
                                <td className="px-6 py-2.5 text-right text-xs font-bold text-foreground tabular-nums">{fmtQty(record.qtyOrder)}</td>
                                <td className="px-6 py-2.5 text-center">
                                  <span className="bg-secondary/60 text-secondary-foreground px-2 py-0.5 rounded text-[11px]">{record.qtyOrderUnit}</span>
                                </td>
                                <td className="px-6 py-2.5 text-right text-xs font-bold text-foreground tabular-nums">{fmtQty(record.qtyDelivered)}</td>
                                <td className="px-6 py-2.5 text-center">
                                  <span className="bg-secondary/60 text-secondary-foreground px-2 py-0.5 rounded text-[11px]">{record.qtyDeliveredUnit}</span>
                                </td>
                                <td className="px-6 py-2.5 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button onClick={() => handlePreviewEditClick(originalIndex, record)} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded" title="Edit baris"><Pencil className="w-4 h-4" /></button>
                                    <button onClick={() => handlePreviewDelete(originalIndex)} className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded" title="Hapus dari pratinjau">
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          {isManualOpen && (
            <div className="bg-card border rounded-lg p-5 shadow-sm animate-in slide-in-from-top-2">
              <h2 className="text-sm font-semibold mb-4">Add Outstanding PO Manual</h2>
              <form onSubmit={handleManualSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                <PeriodSelect
                  value={targetPeriodId}
                  onChange={setTargetPeriodId}
                  className="md:col-span-12"
                />
                <div className="space-y-1.5 md:col-span-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">
                    PO Number <span className="text-destructive">*</span>
                  </label>
                  <input type="text" className="w-full h-10 px-3 border rounded-md text-sm font-mono" placeholder="mis. L1G000602" value={manualForm.poNumber} onChange={(e) => setManualForm({ ...manualForm, poNumber: e.target.value })} required />
                </div>
                <div className="space-y-1.5 md:col-span-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Plan Received Date</label>
                  <input type="date" className="w-full h-10 px-3 border rounded-md text-sm" value={manualForm.planReceivedDate} onChange={(e) => setManualForm({ ...manualForm, planReceivedDate: e.target.value })} required />
                </div>
                <div className="space-y-1.5 md:col-span-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier</label>
                  <input type="text" className="w-full h-10 px-3 border rounded-md text-sm" placeholder="Supplier Name" value={manualForm.supplierName} onChange={(e) => setManualForm({ ...manualForm, supplierName: e.target.value })} required />
                </div>
                <div className="space-y-1.5 md:col-span-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Item Desc</label>
                  <input type="text" className="w-full h-10 px-3 border rounded-md text-sm" placeholder="Item Description" value={manualForm.itemDesc} onChange={(e) => setManualForm({ ...manualForm, itemDesc: e.target.value })} required />
                </div>
                <div className="space-y-1.5 md:col-span-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Ref-B <span className="text-destructive">*</span></label>
                  <input type="text" className="w-full h-10 px-3 border rounded-md text-sm font-mono" placeholder="mis. MTL/JUL 26/RP11.000" value={manualForm.refB} onChange={(e) => setManualForm({ ...manualForm, refB: e.target.value })} required />
                  <p className="text-[11px] text-muted-foreground">Wajib mengandung "MTL".</p>
                </div>

                <div className="space-y-1.5 md:col-span-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Qty Order</label>
                  <input type="number" step="any" className="w-full h-10 px-3 border rounded-md text-sm" placeholder="0" value={manualForm.qtyOrder} onChange={(e) => setManualForm({ ...manualForm, qtyOrder: e.target.value })} required />
                </div>
                <div className="space-y-1.5 md:col-span-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Order Unit</label>
                  <select className="w-full h-10 px-3 border rounded-md text-sm" value={manualForm.qtyOrderUnit} onChange={(e) => setManualForm({ ...manualForm, qtyOrderUnit: e.target.value })}>
                    <option value="kg">kg</option>
                    <option value="rim">rim</option>
                    <option value="sheets">sheets</option>
                  </select>
                </div>
                <div className="space-y-1.5 md:col-span-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Qty Delivered</label>
                  <input type="number" step="any" className="w-full h-10 px-3 border rounded-md text-sm" placeholder="0" value={manualForm.qtyDelivered} onChange={(e) => setManualForm({ ...manualForm, qtyDelivered: e.target.value })} required />
                </div>
                <div className="space-y-1.5 md:col-span-3">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Delivered Unit</label>
                  <select className="w-full h-10 px-3 border rounded-md text-sm" value={manualForm.qtyDeliveredUnit} onChange={(e) => setManualForm({ ...manualForm, qtyDeliveredUnit: e.target.value })}>
                    <option value="kg">kg</option>
                    <option value="rim">rim</option>
                    <option value="sheets">sheets</option>
                  </select>
                </div>
                
                <div className="flex gap-2 md:col-span-12 justify-end mt-2">
                  <button type="button" onClick={() => setIsManualOpen(false)} className="h-10 px-4 bg-muted text-muted-foreground rounded-md font-medium text-sm">Cancel</button>
                  <button type="submit" disabled={addManualMutation.isPending || !targetPeriodId} className="h-10 px-6 bg-primary text-primary-foreground rounded-md font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                    {addManualMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Folder View or Data Table */}
          {!selectedPeriodId ? (
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
              {periods.length === 0 && !periodsLoading && (
                <div className="py-12 text-center text-muted-foreground border rounded-lg bg-card">
                  <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-base font-semibold">Belum ada periode</p>
                  <p className="text-sm mt-1">
                    Buat periode dulu (mis. September 2026), lalu upload data Outstanding PO ke periode itu.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {periods.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPeriodId(p.id)}
                    className="cursor-pointer p-5 border rounded-lg bg-card hover:bg-muted/50 hover:border-primary/50 transition-all flex items-center gap-4 group shadow-sm"
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
                        {p.counts.OUTSTANDING_PO} Baris PO · {p.counts.MRP} baris MRP
                      </p>
                    </div>
                  </div>
                ))}

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
                    {createPeriod.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Buat {newPeriodMonth ? monthLabel(newPeriodMonth) : 'Periode'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
          <div className="bg-card border rounded-lg shadow-sm overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-muted/20">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button 
                  onClick={() => setSelectedPeriodId(null)}
                  className="p-2 hover:bg-background rounded-md border text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title="Kembali ke daftar periode"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <input type="text" placeholder={`Cari di ${selectedPeriod?.label ?? ''}...`} className="w-full pl-9 pr-4 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex items-center gap-1 bg-background border rounded-md p-0.5 text-xs text-muted-foreground">
                  <button onClick={expandAll} className="px-2 py-1 hover:bg-muted hover:text-foreground rounded flex items-center gap-1 transition-colors" title="Buka Semua Detail">
                    <ChevronsDown className="w-3.5 h-3.5" /> Buka
                  </button>
                  <span className="text-muted-foreground/30">|</span>
                  <button onClick={collapseAll} className="px-2 py-1 hover:bg-muted hover:text-foreground rounded flex items-center gap-1 transition-colors" title="Tutup Semua Detail">
                    <ChevronsUp className="w-3.5 h-3.5" /> Tutup
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {selectedIds.length > 0 && (
                  <button onClick={handleBulkDelete} disabled={bulkDeleteMutation.isPending} className="flex items-center gap-2 px-3 py-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md font-medium text-sm animate-in fade-in">
                    {bulkDeleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete ({selectedIds.length})
                  </button>
                )}
                <div className="text-sm font-medium text-muted-foreground bg-background px-3 py-1.5 border rounded-md flex items-center gap-2">
                  <span>{totalItems} Items</span>
                  <span className="text-muted-foreground/40">•</span>
                  <span>{totalPos} POs</span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-secondary/50">
                  <tr>
                    <th className="px-4 py-4 w-12 text-center">
                      <input type="checkbox" className="rounded border-gray-300 w-4 h-4" checked={filteredRecords.length > 0 && selectedIds.length === filteredRecords.length} onChange={handleSelectAll} />
                    </th>
                    <th className="px-6 py-4 font-semibold">Plan Date</th>
                    <th className="px-6 py-4 font-semibold">PO Number</th>
                    <th className="px-6 py-4 font-semibold">Supplier</th>
                    <th className="px-6 py-4 font-semibold w-1/4">Item Desc</th>
                    <th className="px-6 py-4 font-semibold">Ref-B</th>
                    <th className="px-6 py-4 font-semibold text-right">Qty Order</th>
                    <th className="px-6 py-4 font-semibold text-center">Unit</th>
                    <th className="px-6 py-4 font-semibold text-right">Qty Delivered</th>
                    <th className="px-6 py-4 font-semibold text-center">Unit</th>
                    <th className="px-6 py-4 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center text-muted-foreground">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                        <p className="mt-2 text-sm font-medium">Memuat data...</p>
                      </td>
                    </tr>
                  ) : groupedByItem.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center text-muted-foreground">
                        <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                        <p className="text-base font-semibold">Tidak ada data Outstanding PO</p>
                      </td>
                    </tr>
                  ) : (
                    groupedByItem.map((group) => {
                      const isExpanded = expandedItemDescs.has(group.itemDesc);
                      const groupIds = group.items.map(i => i.id);
                      const isGroupAllSelected = groupIds.length > 0 && groupIds.every(id => selectedIds.includes(id));
                      const isGroupSomeSelected = groupIds.some(id => selectedIds.includes(id)) && !isGroupAllSelected;

                      return (
                        <Fragment key={group.itemDesc}>
                          {/* Baris grup (level 1): satu ukuran / ITEM DESC */}
                          <tr className="hover:bg-muted/40 transition-colors bg-card font-medium border-b">
                            <td className="px-4 py-3.5 text-center">
                              <input
                                type="checkbox"
                                className="rounded border-gray-300 w-4 h-4"
                                checked={isGroupAllSelected}
                                ref={(el) => {
                                  if (el) el.indeterminate = isGroupSomeSelected;
                                }}
                                onChange={() => handleToggleGroupSelect(group.items)}
                              />
                            </td>
                            <td className="px-6 py-3.5 text-muted-foreground text-xs font-medium whitespace-nowrap">
                              {group.planDateLabels.length === 1
                                ? group.planDateLabels[0]
                                : `${group.planDateLabels.length} Plan Dates`}
                            </td>
                            <td className="px-6 py-3.5"><PoNumberBadges numbers={group.poNumbers} /></td>
                            <td className="px-6 py-3.5 text-muted-foreground text-xs">{group.supplierNames || '-'}</td>
                            <td className="px-6 py-3.5">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => toggleExpand(group.itemDesc)}
                                  className="p-1 hover:bg-muted/80 rounded transition-colors text-muted-foreground hover:text-foreground shrink-0"
                                  title={isExpanded ? 'Tutup Detail' : 'Buka Detail'}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-primary" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </button>
                                <span className="font-bold text-foreground cursor-pointer hover:text-primary transition-colors" onClick={() => toggleExpand(group.itemDesc)}>
                                  {group.itemDesc}
                                </span>
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground whitespace-nowrap">
                                  {group.poNumbers.length} {group.poNumbers.length > 1 ? 'POs' : 'PO'}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-3.5"><RefBSummary refs={group.refBs} /></td>
                            {/* Total dihitung PER SATUAN — kg dan rim tidak dijumlahkan */}
                            <td className="px-6 py-3.5"><UnitTotals totals={group.orderTotals} strong /></td>
                            <td className="px-6 py-3.5"><UnitTotals totals={group.orderTotals} unitOnly /></td>
                            <td className="px-6 py-3.5"><UnitTotals totals={group.deliveredTotals} strong /></td>
                            <td className="px-6 py-3.5"><UnitTotals totals={group.deliveredTotals} unitOnly /></td>
                            <td className="px-6 py-3.5 text-right">
                              <button
                                onClick={() => toggleExpand(group.itemDesc)}
                                className="text-xs text-primary hover:text-primary/80 font-medium inline-flex items-center gap-1 p-1 hover:bg-primary/10 rounded transition-colors"
                              >
                                {isExpanded ? 'Tutup' : 'Detail'}
                                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          </tr>

                          {/* Baris detail (level 2): satu baris = satu record item */}
                          {isExpanded &&
                            group.items.map((record) => (
                              <tr
                                key={record.id}
                                className="bg-muted/20 hover:bg-muted/35 transition-colors border-l-4 border-l-primary/60"
                              >
                                <td className="px-4 py-2.5 text-center">
                                  <input
                                    type="checkbox"
                                    className="rounded border-gray-300 w-4 h-4"
                                    checked={selectedIds.includes(record.id)}
                                    onChange={(e) => handleSelectOne(e, record.id)}
                                  />
                                </td>
                                <td className="px-6 py-2.5 font-medium whitespace-nowrap text-xs text-foreground">
                                  {safeFormatDate(record.planReceivedDate)}
                                </td>
                                {editingId === record.id ? (
                                  <>
                                    <td className="px-6 py-2.5">
                                      <input
                                        type="text"
                                        className="w-full h-8 px-2 border rounded text-xs bg-background font-mono"
                                        placeholder="PO Number"
                                        value={editForm.poNumber}
                                        onChange={(e) => setEditForm({ ...editForm, poNumber: e.target.value })}
                                      />
                                    </td>
                                    <td className="px-6 py-2.5">
                                      <input
                                        type="text"
                                        className="w-full h-8 px-2 border rounded text-xs bg-background"
                                        value={editForm.supplierName}
                                        onChange={(e) => setEditForm({ ...editForm, supplierName: e.target.value })}
                                      />
                                    </td>
                                    <td className="px-6 py-2.5">
                                      <input
                                        type="text"
                                        className="w-full h-8 px-2 border rounded text-xs bg-background"
                                        value={editForm.itemDesc}
                                        onChange={(e) => setEditForm({ ...editForm, itemDesc: e.target.value })}
                                      />
                                    </td>
                                    <td className="px-6 py-2.5">
                                      <input
                                        type="text"
                                        className="w-full h-8 px-2 border rounded text-xs bg-background font-mono"
                                        placeholder="Ref-B (mis. MTL/...)"
                                        value={editForm.refB}
                                        onChange={(e) => setEditForm({ ...editForm, refB: e.target.value })}
                                      />
                                    </td>
                                    <td className="px-6 py-2.5">
                                      <input
                                        type="number"
                                        step="any"
                                        className="w-full h-8 px-2 border rounded text-xs text-right bg-background"
                                        value={editForm.qtyOrder}
                                        onChange={(e) => setEditForm({ ...editForm, qtyOrder: e.target.value })}
                                      />
                                    </td>
                                    <td className="px-6 py-2.5">
                                      <select
                                        className="w-full h-8 px-2 border rounded text-xs bg-background"
                                        value={editForm.qtyOrderUnit}
                                        onChange={(e) => setEditForm({ ...editForm, qtyOrderUnit: e.target.value })}
                                      >
                                        <option value="kg">kg</option>
                                        <option value="rim">rim</option>
                                        <option value="sheets">sheets</option>
                                      </select>
                                    </td>
                                    <td className="px-6 py-2.5">
                                      <input
                                        type="number"
                                        step="any"
                                        className="w-full h-8 px-2 border rounded text-xs text-right bg-background"
                                        value={editForm.qtyDelivered}
                                        onChange={(e) => setEditForm({ ...editForm, qtyDelivered: e.target.value })}
                                      />
                                    </td>
                                    <td className="px-6 py-2.5">
                                      <select
                                        className="w-full h-8 px-2 border rounded text-xs bg-background"
                                        value={editForm.qtyDeliveredUnit}
                                        onChange={(e) => setEditForm({ ...editForm, qtyDeliveredUnit: e.target.value })}
                                      >
                                        <option value="kg">kg</option>
                                        <option value="rim">rim</option>
                                        <option value="sheets">sheets</option>
                                      </select>
                                    </td>
                                    <td className="px-6 py-2.5 text-right">
                                      <div className="flex items-center justify-end gap-1.5">
                                        <button
                                          onClick={() => handleSaveEdit(record.id)}
                                          disabled={updateMutation.isPending}
                                          className="p-1 text-green-600 hover:bg-green-50 rounded"
                                        >
                                          {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                        </button>
                                        <button
                                          onClick={() => setEditingId(null)}
                                          className="p-1 text-muted-foreground hover:bg-muted rounded"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-6 py-2.5 whitespace-nowrap">
                                      <span className="font-mono text-xs font-semibold text-primary">
                                        {record.poNumber || '—'}
                                      </span>
                                    </td>
                                    <td className="px-6 py-2.5 text-xs text-muted-foreground">{record.supplierName}</td>
                                    <td className="px-6 py-2.5">
                                      <div className="pl-6 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" title={group.itemDesc}></span>
                                      </div>
                                    </td>
                                    <td className="px-6 py-2.5"><RefBValue value={record.refB} /></td>
                                    <td className="px-6 py-2.5 text-right text-xs font-bold text-foreground tabular-nums">
                                      {fmtQty(record.qtyOrder)}
                                    </td>
                                    <td className="px-6 py-2.5 text-center text-xs text-muted-foreground">
                                      <span className="bg-secondary/60 text-secondary-foreground px-2 py-0.5 rounded text-[11px]">
                                        {record.qtyOrderUnit}
                                      </span>
                                    </td>
                                    <td className="px-6 py-2.5 text-right text-xs font-bold text-foreground tabular-nums">
                                      {fmtQty(record.qtyDelivered)}
                                    </td>
                                    <td className="px-6 py-2.5 text-center text-xs text-muted-foreground">
                                      <span className="bg-secondary/60 text-secondary-foreground px-2 py-0.5 rounded text-[11px]">
                                        {record.qtyDeliveredUnit}
                                      </span>
                                    </td>
                                    <td className="px-6 py-2.5 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          onClick={() => handleEditClick(record)}
                                          className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors"
                                          title="Edit PO"
                                        >
                                          <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => handleDelete(record.id)}
                                          disabled={deleteMutation.isPending && deleteMutation.variables === record.id}
                                          className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                                          title="Hapus PO"
                                        >
                                          {deleteMutation.isPending && deleteMutation.variables === record.id ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-destructive" />
                                          ) : (
                                            <Trash2 className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                      </div>
                                    </td>
                                  </>
                                )}
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
