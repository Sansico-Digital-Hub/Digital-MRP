import { useEffect, useState, useRef, useMemo, Fragment } from 'react';
import { useStockRawMaterial, useUploadStockRawMaterial, useAddManualStockRawMaterial, useUpdateStockRawMaterial, useDeleteStockRawMaterial, useBulkDeleteStockRawMaterial, useImportStockRawMaterial, type StockRawMaterialData, type StockRawMaterialUploadSummary } from '../hooks/useStockRawMaterial';
import { FileSpreadsheet, Plus, Upload, Loader2, Search, Pencil, Trash2, X, Check, Save, Folder, ArrowLeft, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Lock, CalendarPlus } from 'lucide-react';
import { usePeriods, useCreatePeriod, monthLabel, periodDisplayLabel } from '../hooks/usePeriods';
import { PeriodSelect } from '../components/PeriodSelect';
import { RefBSummary, RefBValue, matchesMtl } from '../components/RefB';
import { format } from 'date-fns';
import { useTranslation, translate, type Lang } from '../i18n';

// Satuan yang benar-benar dipakai data.
// CATATAN PENTING: satuan terbanyak di data adalah "sht" (199 baris), BUKAN
// "sheet". Sebelumnya kode hanya mengenali "sheet"/"sheets", sehingga seluruh
// baris "sht" salah dihitung sebagai kg.
const SHEET_UNITS = ['sheet', 'sheets', 'sht', 'lbr', 'lembar'];
const RIM_UNITS = ['rim', 'ream'];
const SHEETS_PER_RIM = 500; // sama dengan config.materialCalc.sheetsPerRim di API

const normalizeUnit = (unit: string | null | undefined) => String(unit || '').trim().toLowerCase();
const unitLabel = (unit: string | null | undefined, lang: Lang = 'id') => {
  const value = String(unit || '').trim();
  return value === '' ? translate(lang, 'stockRawMaterial.noUnit') : value;
};
const isKnownUnit = (unit: string) => SHEET_UNITS.includes(unit) || RIM_UNITS.includes(unit) || unit === 'kg';

export function StockRawMaterial() {
  const { t, lang, locale, dateLocale } = useTranslation();
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
  const { data: stockData, isLoading } = useStockRawMaterial(selectedPeriodId);

  const handleCreatePeriod = async () => {
    if (!newPeriodMonth) return;
    try {
      const res = await createPeriod.mutateAsync({ uploadMonth: newPeriodMonth });
      setNewPeriodMonth('');
      setSelectedPeriodId(res.data.id);
    } catch (error: any) {
      alert(error.message || t('components.periodCreateFailed'));
    }
  };
  const uploadMutation = useUploadStockRawMaterial();
  const importMutation = useImportStockRawMaterial();
  const addManualMutation = useAddManualStockRawMaterial();
  const updateMutation = useUpdateStockRawMaterial();
  const deleteMutation = useDeleteStockRawMaterial();
  const bulkDeleteMutation = useBulkDeleteStockRawMaterial();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewData, setPreviewData] = useState<Omit<StockRawMaterialData, 'id' | 'createdAt' | 'updatedAt'>[]>([]);
  /** Ringkasan hasil pembacaan file (total/masuk MTL/dilewati). */
  const [uploadSummary, setUploadSummary] = useState<StockRawMaterialUploadSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewSearchTerm, setPreviewSearchTerm] = useState('');
  const [previewEditingIndex, setPreviewEditingIndex] = useState<number | null>(null);
  const [previewEditForm, setPreviewEditForm] = useState({
    itemDesc: '',
    supplier: '',
    qty: '',
    unit: '',
    refB: '',
  });

  const [isManualOpen, setIsManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    itemDesc: '',
    supplier: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    qty: '',
    unit: '',
    refB: '',
  });
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    itemDesc: '',
    supplier: '',
    date: '',
    qty: '',
    unit: '',
    refB: '',
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedItemDescs, setExpandedItemDescs] = useState<Set<string>>(new Set());

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    uploadMutation.mutate(file, {
      onSuccess: (res) => {
        setUploadSummary(res.summary ?? null);
        if (res.data && res.data.length > 0) {
          setPreviewData(res.data);
        } else {
          setPreviewData([]);
          alert(res.message || t('stockRawMaterial.noValidData'));
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
      onError: (error: any) => {
        setUploadSummary(null);
        alert(t('stockRawMaterial.uploadFailed', { error: error.message }));
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    });
  };

  const handleSaveImport = (mode: 'add' | 'overwrite') => {
    if (previewData.length === 0) return;
    
    if (!targetPeriodId) {
      alert(t('stockRawMaterial.selectPeriodBeforeSave'));
      return;
    }

    let confirmMsg = t('stockRawMaterial.confirmAdd', {
      count: previewData.length,
      period: targetPeriod?.label ?? '',
    });
    if (mode === 'overwrite') {
      const existing = targetPeriod?.counts.STOCK_RM ?? 0;
      confirmMsg = t('stockRawMaterial.confirmOverwrite', {
        period: targetPeriod?.label ?? '',
        existing,
        count: previewData.length,
      });
    }

    if (!window.confirm(confirmMsg)) return;

    importMutation.mutate({ data: previewData, mode, periodId: targetPeriodId }, {
      onSuccess: () => {
        alert(t('stockRawMaterial.importSuccess'));
        setPreviewData([]);
        setUploadSummary(null);
        setPreviewSearchTerm('');
        setPreviewEditingIndex(null);
      },
      onError: (error: any) => {
        alert(t('stockRawMaterial.importFailed', { error: error.message }));
      }
    });
  };

  const handlePreviewEditClick = (index: number, record: Omit<StockRawMaterialData, 'id' | 'createdAt' | 'updatedAt'>) => {
    setPreviewEditingIndex(index);
    setPreviewEditForm({
      itemDesc: record.itemDesc,
      supplier: record.supplier || '',
      qty: record.qty.toString(),
      unit: record.unit,
      refB: record.refB || '',
    });
  };

  const handlePreviewSaveEdit = (index: number) => {
    if (!previewEditForm.itemDesc || !previewEditForm.qty || !previewEditForm.unit) {
      alert(t('stockRawMaterial.fillRequiredFields'));
      return;
    }
    if (!matchesMtl(previewEditForm.refB)) {
      alert(t('components.refBMtlMessage'));
      return;
    }
    const updatedData = [...previewData];
    updatedData[index] = {
      ...updatedData[index],
      itemDesc: previewEditForm.itemDesc,
      supplier: previewEditForm.supplier,
      qty: parseFloat(previewEditForm.qty),
      unit: previewEditForm.unit,
      refB: previewEditForm.refB.trim() || null,
    };
    setPreviewData(updatedData);
    setPreviewEditingIndex(null);
  };

  const handlePreviewDelete = (index: number) => {
    if (window.confirm(t('stockRawMaterial.confirmRemovePreview'))) {
      const updatedData = [...previewData];
      updatedData.splice(index, 1);
      setPreviewData(updatedData);
      if (previewEditingIndex === index) setPreviewEditingIndex(null);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.itemDesc || !manualForm.date || !manualForm.qty || !manualForm.unit) {
      alert(t('stockRawMaterial.fillRequiredFields'));
      return;
    }

    if (!matchesMtl(manualForm.refB)) {
      alert(t('components.refBMtlMessage'));
      return;
    }

    if (!targetPeriodId) {
      alert(t('stockRawMaterial.selectPeriodBeforeManual'));
      return;
    }

    addManualMutation.mutate({
      itemDesc: manualForm.itemDesc,
      supplier: manualForm.supplier,
      date: manualForm.date,
      qty: parseFloat(manualForm.qty),
      unit: manualForm.unit,
      refB: manualForm.refB.trim() || null,
      periodId: targetPeriodId,
    }, {
      onSuccess: () => {
        setManualForm({
          itemDesc: '',
          supplier: '',
          date: format(new Date(), 'yyyy-MM-dd'),
          qty: '',
          unit: '',
          refB: '',
        });
        setIsManualOpen(false);
      },
      onError: (error: any) => {
        alert(t('stockRawMaterial.addFailed', { error: error.message }));
      }
    });
  };

  const handleEditClick = (record: StockRawMaterialData) => {
    setEditingId(record.id);
    setEditForm({
      itemDesc: record.itemDesc,
      supplier: record.supplier || '',
      date: format(new Date(record.date), 'yyyy-MM-dd'),
      qty: record.qty.toString(),
      unit: record.unit,
      refB: record.refB || '',
    });
  };

  const handleSaveEdit = (id: string) => {
    if (!editForm.itemDesc || !editForm.date || !editForm.qty || !editForm.unit) {
      alert(t('stockRawMaterial.fillRequiredFields'));
      return;
    }

    if (!matchesMtl(editForm.refB)) {
      alert(t('components.refBMtlMessage'));
      return;
    }

    updateMutation.mutate({
      id,
      data: {
        itemDesc: editForm.itemDesc,
        supplier: editForm.supplier,
        date: editForm.date,
        qty: parseFloat(editForm.qty),
        unit: editForm.unit,
        refB: editForm.refB.trim() || null,
      }
    }, {
      onSuccess: () => setEditingId(null),
      onError: (error: any) => alert(t('stockRawMaterial.updateFailed', { error: error.message }))
    });
  };

  const handleDelete = (id: string) => {
    if (window.confirm(t('stockRawMaterial.confirmDelete'))) {
      deleteMutation.mutate(id, {
        onError: (error: any) => alert(t('stockRawMaterial.deleteFailed', { error: error.message }))
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
    if (window.confirm(t('stockRawMaterial.confirmBulkDelete', { count: selectedIds.length }))) {
      bulkDeleteMutation.mutate(selectedIds, {
        onSuccess: () => setSelectedIds([]),
        onError: (error: any) => alert(t('stockRawMaterial.bulkDeleteFailed', { error: error.message }))
      });
    }
  };

  const records = stockData?.data || [];

  const filteredRecords = records.filter(record => 
    record.itemDesc.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (record.supplier && record.supplier.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (record.refB && record.refB.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const groupedByItem = useMemo(() => {
    const groups: Record<string, {
      key: string;
      itemDesc: string;
      suppliers: string;
      /**
       * Total PER SATUAN — sengaja TIDAK dijumlahkan lintas satuan.
       * Menjumlahkan kg + lembar + rim menghasilkan angka yang tidak berarti,
       * dan itulah bug yang pernah membuat total stok terlihat aneh.
       */
      totals: { unit: string; qty: number; lots: number }[];
      /** Satuan yang tidak dikenali; angkanya tetap ditampilkan apa adanya. */
      unknownUnits: string[];
      /** Referensi customer unik di grup ini (kolom `Ref_B_PO`). */
      refBs: string[];
      items: StockRawMaterialData[];
    }> = {};

    filteredRecords.forEach((record) => {
      // Dikelompokkan per itemDesc + SUPPLIER (rancangan §8.6). Kalau digabung
      // hanya per itemDesc, material dari supplier berbeda akan tercampur dan
      // label suppliernya menyesatkan.
      const groupKey = `${record.itemDesc.trim()}||${record.supplier || ''}`;
      if (!groups[groupKey]) {
        groups[groupKey] = {
          key: groupKey,
          itemDesc: record.itemDesc,
          suppliers: record.supplier || '',
          totals: [],
          unknownUnits: [],
          refBs: [],
          items: [],
        };
      }
      groups[groupKey].items.push(record);

      const ref = (record.refB || '').trim();
      if (ref && !groups[groupKey].refBs.includes(ref)) groups[groupKey].refBs.push(ref);

      // Akumulasi per satuan (tidak dicampur).
      const label = unitLabel(record.unit, lang);
      const existing = groups[groupKey].totals.find((t) => t.unit.toLowerCase() === label.toLowerCase());
      if (existing) {
        existing.qty += record.qty;
        existing.lots += 1;
      } else {
        groups[groupKey].totals.push({ unit: label, qty: record.qty, lots: 1 });
      }

      const normalized = normalizeUnit(record.unit);
      if (!isKnownUnit(normalized) && !groups[groupKey].unknownUnits.includes(label)) {
        groups[groupKey].unknownUnits.push(label);
      }

      if (record.supplier) {
        const currentSuppliers = groups[groupKey].suppliers.split(', ').filter(Boolean);
        if (!currentSuppliers.includes(record.supplier)) {
          groups[groupKey].suppliers = currentSuppliers.length > 0
            ? `${groups[groupKey].suppliers}, ${record.supplier}`
            : record.supplier;
        }
      }
    });

    return Object.values(groups).sort((a, b) => a.itemDesc.localeCompare(b.itemDesc));
  }, [filteredRecords, lang]);

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
    setExpandedItemDescs(new Set(groupedByItem.map(g => g.key)));
  };

  const collapseAll = () => {
    setExpandedItemDescs(new Set());
  };

  const handleToggleGroupSelect = (groupItems: StockRawMaterialData[]) => {
    const groupIds = groupItems.map(i => i.id);
    const allSelected = groupIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(prev => prev.filter(id => !groupIds.includes(id)));
    } else {
      const newIds = new Set([...selectedIds, ...groupIds]);
      setSelectedIds(Array.from(newIds));
    }
  };

  const filteredPreviewData = previewData.filter(record => 
    record.itemDesc.toLowerCase().includes(previewSearchTerm.toLowerCase()) ||
    (record.supplier && record.supplier.toLowerCase().includes(previewSearchTerm.toLowerCase())) ||
    (record.refB && record.refB.toLowerCase().includes(previewSearchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('stockRawMaterial.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('stockRawMaterial.subtitle')}
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
            {t('stockRawMaterial.importExcel')}
          </button>
          
          <button
            onClick={() => setIsManualOpen(!isManualOpen)}
            disabled={previewData.length > 0}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md font-medium text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('stockRawMaterial.addManual')}
          </button>
        </div>
      </div>

      {previewData.length > 0 ? (
        <div className="bg-card border border-primary/20 rounded-lg shadow-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className="p-5 border-b bg-primary/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" /> {t('stockRawMaterial.dataPreview')}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t('stockRawMaterial.previewIntroBefore')} <strong>{previewData.length}</strong> {t('stockRawMaterial.previewIntroAfter')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative w-full sm:w-64 mr-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <input type="text" placeholder={t('stockRawMaterial.searchPreview')} className="w-full pl-9 pr-4 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary" value={previewSearchTerm} onChange={(e) => setPreviewSearchTerm(e.target.value)} />
              </div>
              <button onClick={() => handleSaveImport('add')} disabled={importMutation.isPending || !targetPeriodId} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md font-medium text-sm disabled:opacity-50">
                {importMutation.isPending && importMutation.variables?.mode === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {t('stockRawMaterial.saveAdd')}
              </button>
              <button onClick={() => handleSaveImport('overwrite')} disabled={importMutation.isPending || !targetPeriodId} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-md font-medium text-sm disabled:opacity-50">
                {importMutation.isPending && importMutation.variables?.mode === 'overwrite' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {t('stockRawMaterial.saveOverwrite')}
              </button>
              <button onClick={() => setPreviewData([])} disabled={importMutation.isPending} className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground hover:bg-muted/80 rounded-md font-medium text-sm">
                <X className="w-4 h-4" /> {t('common.cancel')}
              </button>
            </div>
          </div>
          <div className="px-5 py-4 border-b bg-amber-50/40 dark:bg-amber-500/5">
            <PeriodSelect value={targetPeriodId} onChange={setTargetPeriodId} className="max-w-md" />
          </div>
          {uploadSummary && (
            <div className="mx-5 mt-4 border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 rounded-lg px-4 py-3">
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-1">
                {t('stockRawMaterial.summaryTitle')}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-foreground">
                <span>
                  {t('stockRawMaterial.summaryTotalRows')} <strong>{uploadSummary.totalRows}</strong>
                </span>
                <span className="text-emerald-700 dark:text-emerald-400">
                  {t('stockRawMaterial.summaryIncluded')} <strong>{uploadSummary.included}</strong>
                </span>
                <span className="text-amber-700 dark:text-amber-400">
                  {t('stockRawMaterial.summarySkipped')} <strong>{uploadSummary.skippedNoMtl}</strong>
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {t('stockRawMaterial.summaryHintBefore')} <span className="font-semibold">Ref_B_PO</span>{' '}
                {t('stockRawMaterial.summaryHintAfter')}
              </p>
            </div>
          )}
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-secondary/50 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-6 py-4 font-semibold w-1/3">{t('stockRawMaterial.itemDesc')}</th>
                    <th className="px-6 py-4 font-semibold">{t('stockRawMaterial.refB')}</th>
                    <th className="px-6 py-4 font-semibold">{t('stockRawMaterial.supplier')}</th>
                    <th className="px-6 py-4 font-semibold text-right">{t('stockRawMaterial.qty')}</th>
                    <th className="px-6 py-4 font-semibold text-center">{t('stockRawMaterial.unit')}</th>
                    <th className="px-6 py-4 font-semibold text-right">{t('common.action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredPreviewData.length === 0 ? (
                     <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">{t('stockRawMaterial.noPreviewResults')}</td></tr>
                ) : filteredPreviewData.map((record) => {
                  const originalIndex = previewData.indexOf(record);
                  return (
                    <tr key={originalIndex} className="hover:bg-muted/30">
                      {previewEditingIndex === originalIndex ? (
                        <>
                          <td className="px-6 py-3"><input type="text" className="w-full h-8 px-2 border rounded text-sm" value={previewEditForm.itemDesc} onChange={(e) => setPreviewEditForm({ ...previewEditForm, itemDesc: e.target.value })} /></td>
                          <td className="px-6 py-3"><input type="text" className="w-full h-8 px-2 border rounded text-sm font-mono" placeholder={t('stockRawMaterial.refBPlaceholder')} value={previewEditForm.refB} onChange={(e) => setPreviewEditForm({ ...previewEditForm, refB: e.target.value })} /></td>
                          <td className="px-6 py-3"><input type="text" className="w-full h-8 px-2 border rounded text-sm" value={previewEditForm.supplier} onChange={(e) => setPreviewEditForm({ ...previewEditForm, supplier: e.target.value })} /></td>
                          <td className="px-6 py-3"><input type="number" step="any" className="w-full h-8 px-2 border rounded text-sm text-right" value={previewEditForm.qty} onChange={(e) => setPreviewEditForm({ ...previewEditForm, qty: e.target.value })} /></td>
                          <td className="px-6 py-3">
                            <input type="text" className="w-full h-8 px-2 border rounded text-sm text-center" value={previewEditForm.unit} onChange={(e) => setPreviewEditForm({ ...previewEditForm, unit: e.target.value })} />
                          </td>
                          <td className="px-6 py-3 text-right">
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
                          <td className="px-6 py-3 font-semibold text-foreground">{record.itemDesc}</td>
                          <td className="px-6 py-3"><RefBValue value={record.refB} /></td>
                          <td className="px-6 py-3">{record.supplier}</td>
                          <td className="px-6 py-3 text-right font-bold">{record.qty}</td>
                          <td className="px-6 py-3 text-center"><span className="bg-primary/10 text-primary px-2.5 py-1 rounded text-xs">{record.unit}</span></td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => handlePreviewEditClick(originalIndex, record)} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => handlePreviewDelete(originalIndex)} className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
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
              <h2 className="text-sm font-semibold mb-4">{t('stockRawMaterial.addManualTitle')}</h2>
              <form onSubmit={handleManualSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                <PeriodSelect
                  value={targetPeriodId}
                  onChange={setTargetPeriodId}
                  className="md:col-span-6"
                />
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">{t('stockRawMaterial.itemDesc')}</label>
                  <input type="text" className="w-full h-10 px-3 border rounded-md text-sm" placeholder={t('common.description')} value={manualForm.itemDesc} onChange={(e) => setManualForm({ ...manualForm, itemDesc: e.target.value })} required />
                </div>
                <div className="space-y-1.5 md:col-span-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">{t('stockRawMaterial.supplier')}</label>
                  <input type="text" className="w-full h-10 px-3 border rounded-md text-sm" placeholder={t('stockRawMaterial.supplier')} value={manualForm.supplier} onChange={(e) => setManualForm({ ...manualForm, supplier: e.target.value })} />
                </div>
                <div className="space-y-1.5 md:col-span-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">{t('common.date')}</label>
                  <input type="date" className="w-full h-10 px-3 border rounded-md text-sm" value={manualForm.date} onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })} required />
                </div>
                <div className="space-y-1.5 md:col-span-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">{t('stockRawMaterial.qty')}</label>
                  <input type="number" step="any" className="w-full h-10 px-3 border rounded-md text-sm" placeholder="0" value={manualForm.qty} onChange={(e) => setManualForm({ ...manualForm, qty: e.target.value })} required />
                </div>
                <div className="space-y-1.5 md:col-span-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">{t('stockRawMaterial.unit')}</label>
                  <input type="text" className="w-full h-10 px-3 border rounded-md text-sm" placeholder={t('stockRawMaterial.unit')} value={manualForm.unit} onChange={(e) => setManualForm({ ...manualForm, unit: e.target.value })} required />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">{t('stockRawMaterial.refB')} <span className="text-destructive">*</span></label>
                  <input type="text" className="w-full h-10 px-3 border rounded-md text-sm font-mono" placeholder={t('stockRawMaterial.refBExample')} value={manualForm.refB} onChange={(e) => setManualForm({ ...manualForm, refB: e.target.value })} required />
                  <p className="text-[11px] text-muted-foreground">{t('stockRawMaterial.refBHint')}</p>
                </div>
                <div className="flex gap-2 md:col-span-6 justify-end mt-2">
                  <button type="button" onClick={() => setIsManualOpen(false)} className="h-10 px-4 bg-muted text-muted-foreground rounded-md font-medium text-sm">{t('common.cancel')}</button>
                  <button type="submit" disabled={addManualMutation.isPending || !targetPeriodId} className="h-10 px-6 bg-primary text-primary-foreground rounded-md font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                    {addManualMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} {t('common.save')}
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
                  <p className="text-base font-semibold">{t('stockRawMaterial.noPeriods')}</p>
                  <p className="text-sm mt-1">
                    {t('stockRawMaterial.noPeriodsHint')}
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
                        <span className="truncate">{periodDisplayLabel(p, lang)}</span>
                        {p.isLocked && <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('stockRawMaterial.periodCounts', { lots: p.counts.STOCK_RM, mrp: p.counts.MRP })}
                      </p>
                    </div>
                  </div>
                ))}

                <div className="p-5 border-2 border-dashed rounded-lg bg-card flex flex-col gap-3 justify-center">
                  <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <CalendarPlus className="w-4 h-4" /> {t('stockRawMaterial.createNewPeriod')}
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
                    {t('components.createPeriod', { label: newPeriodMonth ? monthLabel(newPeriodMonth, lang) : t('components.periodLabel') })}
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
                  title={t('stockRawMaterial.backToPeriods')}
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <input type="text" placeholder={t('stockRawMaterial.searchInPeriod', { period: selectedPeriod?.label ?? '' })} className="w-full pl-9 pr-4 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex items-center gap-1 bg-background border rounded-md p-0.5 text-xs text-muted-foreground">
                  <button onClick={expandAll} className="px-2 py-1 hover:bg-muted hover:text-foreground rounded flex items-center gap-1 transition-colors" title={t('stockRawMaterial.expandAllTitle')}>
                    <ChevronsDown className="w-3.5 h-3.5" /> {t('stockRawMaterial.expand')}
                  </button>
                  <span className="text-muted-foreground/30">|</span>
                  <button onClick={collapseAll} className="px-2 py-1 hover:bg-muted hover:text-foreground rounded flex items-center gap-1 transition-colors" title={t('stockRawMaterial.collapseAllTitle')}>
                    <ChevronsUp className="w-3.5 h-3.5" /> {t('stockRawMaterial.collapse')}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {selectedIds.length > 0 && (
                  <button onClick={handleBulkDelete} disabled={bulkDeleteMutation.isPending} className="flex items-center gap-2 px-3 py-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md font-medium text-sm animate-in fade-in">
                    {bulkDeleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {t('stockRawMaterial.deleteCount', { count: selectedIds.length })}
                  </button>
                )}
                <div className="text-sm font-medium text-muted-foreground bg-background px-3 py-1.5 border rounded-md flex items-center gap-2">
                  <span>{t('stockRawMaterial.itemsCount', { count: groupedByItem.length })}</span>
                  <span className="text-muted-foreground/40">•</span>
                  <span>{t('stockRawMaterial.lotsCount', { count: filteredRecords.length })}</span>
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
                    <th className="px-6 py-4 font-semibold">{t('stockRawMaterial.itemDesc')}</th>
                    <th className="px-6 py-4 font-semibold">{t('stockRawMaterial.refB')}</th>
                    <th className="px-6 py-4 font-semibold">{t('stockRawMaterial.supplier')}</th>
                    <th className="px-6 py-4 font-semibold">{t('common.date')}</th>
                    <th className="px-6 py-4 font-semibold text-right">{t('stockRawMaterial.qty')}</th>
                    <th className="px-6 py-4 font-semibold text-center">{t('stockRawMaterial.unit')}</th>
                    <th className="px-6 py-4 font-semibold text-right">{t('common.action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                        <p className="mt-2 text-sm font-medium">{t('common.loading')}</p>
                      </td>
                    </tr>
                  ) : groupedByItem.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
                        <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                        <p className="text-base font-semibold">{t('stockRawMaterial.emptyData')}</p>
                      </td>
                    </tr>
                  ) : (
                    groupedByItem.map((group) => {
                      const isExpanded = expandedItemDescs.has(group.key);
                      const groupIds = group.items.map(i => i.id);
                      const isGroupAllSelected = groupIds.length > 0 && groupIds.every(id => selectedIds.includes(id));
                      const isGroupSomeSelected = groupIds.some(id => selectedIds.includes(id)) && !isGroupAllSelected;

                      return (
                        <Fragment key={group.key}>
                          {/* Parent Group Row */}
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
                            <td className="px-6 py-3.5">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => toggleExpand(group.key)}
                                  className="p-1 hover:bg-muted/80 rounded transition-colors text-muted-foreground hover:text-foreground shrink-0"
                                  title={isExpanded ? t('stockRawMaterial.closeDetailTitle') : t('stockRawMaterial.openDetailTitle')}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-primary" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </button>
                                <span className="font-bold text-foreground cursor-pointer hover:text-primary transition-colors" onClick={() => toggleExpand(group.key)}>
                                  {group.itemDesc}
                                </span>
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                                  {group.items.length} {group.items.length > 1 ? t('stockRawMaterial.lots') : t('stockRawMaterial.lot')}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-3.5"><RefBSummary refs={group.refBs} /></td>
                            <td className="px-6 py-3.5 text-muted-foreground text-xs">{group.suppliers || '-'}</td>
                            <td className="px-6 py-3.5 text-muted-foreground text-xs font-medium">
                              {group.items.length === 1
                                ? format(new Date(group.items[0].date), 'dd MMM yyyy', { locale: dateLocale })
                                : t('stockRawMaterial.recordsCount', { count: group.items.length })}
                            </td>
                            <td className="px-6 py-3.5 text-right font-extrabold text-foreground text-sm">
                              <div className="space-y-0.5">
                                {group.totals.map((total) => {
                                  const isRim = RIM_UNITS.includes(total.unit.toLowerCase());
                                  return (
                                    <div key={total.unit}>
                                      {total.qty.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}
                                      {isRim && (
                                        <span className="block text-[10px] font-normal text-muted-foreground">
                                          = {(total.qty * SHEETS_PER_RIM).toLocaleString(locale)} {t('unit.sheets')}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              {group.unknownUnits.length > 0 && (
                                <div className="text-[10px] font-normal text-amber-600 mt-1">
                                  {t('stockRawMaterial.unknownUnits', { units: group.unknownUnits.join(', ') })}
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <div className="flex flex-wrap gap-1 justify-center">
                                {group.totals.map((total) => (
                                  <span
                                    key={total.unit}
                                    className={`font-semibold px-2.5 py-1 rounded text-xs ${
                                      isKnownUnit(total.unit.toLowerCase())
                                        ? 'bg-primary/10 text-primary'
                                        : 'bg-amber-100 text-amber-700'
                                    }`}
                                  >
                                    {total.unit}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-6 py-3.5 text-right">
                              <button
                                onClick={() => toggleExpand(group.key)}
                                className="text-xs text-primary hover:text-primary/80 font-medium inline-flex items-center gap-1 p-1 hover:bg-primary/10 rounded transition-colors"
                              >
                                {isExpanded ? t('stockRawMaterial.collapse') : t('common.detail')}
                                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          </tr>

                          {/* Child Detailed Rows */}
                          {isExpanded &&
                            group.items.map((record, idx) => (
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
                                {editingId === record.id ? (
                                  <>
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
                                        placeholder={t('stockRawMaterial.refBPlaceholder')}
                                        value={editForm.refB}
                                        onChange={(e) => setEditForm({ ...editForm, refB: e.target.value })}
                                      />
                                    </td>
                                    <td className="px-6 py-2.5">
                                      <input
                                        type="text"
                                        className="w-full h-8 px-2 border rounded text-xs bg-background"
                                        value={editForm.supplier}
                                        onChange={(e) => setEditForm({ ...editForm, supplier: e.target.value })}
                                      />
                                    </td>
                                    <td className="px-6 py-2.5">
                                      <input
                                        type="date"
                                        className="w-full h-8 px-2 border rounded text-xs bg-background"
                                        value={editForm.date}
                                        onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                                      />
                                    </td>
                                    <td className="px-6 py-2.5">
                                      <input
                                        type="number"
                                        step="any"
                                        className="w-full h-8 px-2 border rounded text-xs text-right bg-background"
                                        value={editForm.qty}
                                        onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })}
                                      />
                                    </td>
                                    <td className="px-6 py-2.5">
                                      <input
                                        type="text"
                                        className="w-full h-8 px-2 border rounded text-xs text-center bg-background"
                                        value={editForm.unit}
                                        onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                                      />
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
                                    <td className="px-6 py-2.5">
                                      <div className="pl-6 text-xs text-muted-foreground flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0"></span>
                                        <span>{t('stockRawMaterial.lotNumber', { number: idx + 1 })}</span>
                                      </div>
                                    </td>
                                    <td className="px-6 py-2.5"><RefBValue value={record.refB} /></td>
                                    <td className="px-6 py-2.5 text-xs text-muted-foreground">{record.supplier || '-'}</td>
                                    <td className="px-6 py-2.5 text-xs font-medium text-foreground">
                                      {format(new Date(record.date), 'dd MMM yyyy', { locale: dateLocale })}
                                    </td>
                                    <td className="px-6 py-2.5 text-right text-xs font-bold text-foreground">
                                      {record.qty.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}
                                    </td>
                                    <td className="px-6 py-2.5 text-center text-xs text-muted-foreground">
                                      <span className="bg-secondary/60 text-secondary-foreground px-2 py-0.5 rounded text-[11px]">
                                        {record.unit}
                                      </span>
                                    </td>
                                    <td className="px-6 py-2.5 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          onClick={() => handleEditClick(record)}
                                          className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors"
                                          title={t('stockRawMaterial.editLot')}
                                        >
                                          <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => handleDelete(record.id)}
                                          disabled={deleteMutation.isPending && deleteMutation.variables === record.id}
                                          className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                                          title={t('stockRawMaterial.deleteLot')}
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
