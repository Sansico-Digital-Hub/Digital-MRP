import { useEffect, useState, useRef } from 'react';
import { useHotlist, useUploadHotlist, useAddManualHotlist, useUpdateHotlist, useDeleteHotlist, useBulkDeleteHotlist, useImportHotlist, type HotlistData } from '../hooks/useHotlist';
import { usePeriods, useCreatePeriod, monthLabel, periodDisplayLabel } from '../hooks/usePeriods';
import { PeriodSelect } from '../components/PeriodSelect';
import { PeriodMeta } from '../components/PeriodMeta';
import { FileSpreadsheet, Plus, Upload, Loader2, Search, Pencil, Trash2, X, Check, Save, Folder, ArrowLeft, CalendarPlus, Lock } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from '../i18n';
import { useAuthStore } from '../stores/authStore';

export function Hotlist() {
  const { t, lang, locale, dateLocale } = useTranslation();
  // Master Data "BI TOTAL" hanya boleh diubah oleh Admin & Material Planner;
  // Production Planner / User view-only.
  const canEditDataModule = useAuthStore((state) => state.canEditDataModule);
  const canManageData = canEditDataModule('MATERIAL');
  // Periode = keranjang data. WAJIB dipilih sebelum upload/isi manual.
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  // Periode tujuan untuk Import Excel / Isi Manual. Ikut periode yang sedang
  // dibuka, tapi tetap bisa diganti langsung dari dalam modal.
  const [targetPeriodId, setTargetPeriodId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedPeriodId) setTargetPeriodId(selectedPeriodId);
  }, [selectedPeriodId]);
  const [newPeriodMonth, setNewPeriodMonth] = useState('');
  const { data: periodsRes, isLoading: periodsLoading } = usePeriods();
  const periods = periodsRes?.data ?? [];
  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId) ?? null;
  const createPeriod = useCreatePeriod();
  const { data: hotlistData, isLoading } = useHotlist(selectedPeriodId);
  const uploadMutation = useUploadHotlist();
  const importMutation = useImportHotlist();
  const addManualMutation = useAddManualHotlist();
  const updateMutation = useUpdateHotlist();
  const deleteMutation = useDeleteHotlist();
  const bulkDeleteMutation = useBulkDeleteHotlist();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewData, setPreviewData] = useState<Omit<HotlistData, 'id' | 'createdAt' | 'updatedAt'>[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewSearchTerm, setPreviewSearchTerm] = useState('');
  const [previewEditingIndex, setPreviewEditingIndex] = useState<number | null>(null);
  const [previewEditForm, setPreviewEditForm] = useState({
    partNumber: '',
    date: '',
    biTotal: '',
  });

  const [isManualOpen, setIsManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    partNumber: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    biTotal: '',
  });
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    partNumber: '',
    date: '',
    biTotal: '',
  });

  const [searchTerm, setSearchTerm] = useState('');

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    uploadMutation.mutate(file, {
      onSuccess: (res) => {
        console.log('Upload response:', res);
        if (res.data && res.data.length > 0) {
          setPreviewData(res.data);
        } else {
          alert(t('hotlist.errors.noValidData'));
        }
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      },
      onError: (error: any) => {
        alert(t('hotlist.errors.uploadFailed', { message: error.message }));
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    });
  };

  const handleCreatePeriod = async () => {
    if (!newPeriodMonth) return;
    try {
      const res = await createPeriod.mutateAsync({ uploadMonth: newPeriodMonth });
      setNewPeriodMonth('');
      setSelectedPeriodId(res.data.id);
    } catch (error: any) {
      alert(error.message || t('hotlist.errors.createPeriodFailed'));
    }
  };

  const handleSaveImport = (mode: 'add' | 'overwrite') => {
    if (previewData.length === 0) return;
    if (!targetPeriodId) {
      alert(t('hotlist.errors.selectPeriodFirst'));
      return;
    }

    let confirmMsg = t('hotlist.import.addConfirm', {
      count: previewData.length,
      label: selectedPeriod?.label ?? '',
    });
    if (mode === 'overwrite') {
      const existing = selectedPeriod?.counts.HOTLIST ?? 0;
      confirmMsg = t('hotlist.import.overwriteConfirm', {
        label: selectedPeriod?.label ?? '',
        existing,
        count: previewData.length,
      });
    }

    if (!window.confirm(confirmMsg)) return;

    importMutation.mutate({ data: previewData, mode, periodId: targetPeriodId }, {
      onSuccess: () => {
        alert(t('hotlist.import.success'));
        setPreviewData([]);
        setPreviewSearchTerm('');
        setPreviewEditingIndex(null);
      },
      onError: (error: any) => {
        alert(t('hotlist.errors.importFailed', { message: error.message }));
      }
    });
  };

  const handlePreviewEditClick = (index: number, record: Omit<HotlistData, 'id' | 'createdAt' | 'updatedAt'>) => {
    setPreviewEditingIndex(index);
    setPreviewEditForm({
      partNumber: record.partNumber,
      date: format(new Date(record.date), 'yyyy-MM-dd'),
      biTotal: record.biTotal.toString(),
    });
  };

  const handlePreviewSaveEdit = (index: number) => {
    if (!previewEditForm.partNumber || !previewEditForm.date || !previewEditForm.biTotal) {
      alert(t('hotlist.errors.fillAllRequired'));
      return;
    }
    const updatedData = [...previewData];
    updatedData[index] = {
      ...updatedData[index],
      partNumber: previewEditForm.partNumber,
      date: previewEditForm.date,
      biTotal: parseFloat(previewEditForm.biTotal),
    };
    setPreviewData(updatedData);
    setPreviewEditingIndex(null);
  };

  const handlePreviewDelete = (index: number) => {
    if (window.confirm(t('hotlist.confirm.removePreview'))) {
      const updatedData = [...previewData];
      updatedData.splice(index, 1);
      setPreviewData(updatedData);
      if (previewEditingIndex === index) setPreviewEditingIndex(null);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.partNumber || !manualForm.date || !manualForm.biTotal) {
      alert(t('hotlist.errors.fillAllFields'));
      return;
    }

    if (!targetPeriodId) {
      alert(t('hotlist.errors.selectPeriodManual'));
      return;
    }

    addManualMutation.mutate({
      partNumber: manualForm.partNumber,
      date: manualForm.date,
      biTotal: parseFloat(manualForm.biTotal),
      periodId: targetPeriodId,
    }, {
      onSuccess: () => {
        setManualForm({
          partNumber: '',
          date: format(new Date(), 'yyyy-MM-dd'),
          biTotal: '',
        });
        setIsManualOpen(false);
      },
      onError: (error: any) => {
        alert(t('hotlist.errors.addFailed', { message: error.message }));
      }
    });
  };

  const handleEditClick = (record: HotlistData) => {
    setEditingId(record.id);
    setEditForm({
      partNumber: record.partNumber,
      date: format(new Date(record.date), 'yyyy-MM-dd'),
      biTotal: record.biTotal.toString(),
    });
  };

  const handleSaveEdit = (id: string) => {
    if (!editForm.partNumber || !editForm.date || !editForm.biTotal) {
      alert(t('hotlist.errors.fillAllFields'));
      return;
    }

    updateMutation.mutate({
      id,
      data: {
        partNumber: editForm.partNumber,
        date: editForm.date,
        biTotal: parseFloat(editForm.biTotal),
      }
    }, {
      onSuccess: () => {
        setEditingId(null);
      },
      onError: (error: any) => {
        alert(t('hotlist.errors.updateFailed', { message: error.message }));
      }
    });
  };

  const handleDelete = (id: string) => {
    if (window.confirm(t('hotlist.confirm.deleteOne'))) {
      deleteMutation.mutate(id, {
        onError: (error: any) => {
          alert(t('hotlist.errors.deleteFailed', { message: error.message }));
        }
      });
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredRecords.map((r) => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (e: React.ChangeEvent<HTMLInputElement>, id: string) => {
    if (e.target.checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter((selectedId) => selectedId !== id));
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(t('hotlist.confirm.deleteMany', { count: selectedIds.length }))) {
      bulkDeleteMutation.mutate(selectedIds, {
        onSuccess: () => {
          setSelectedIds([]);
        },
        onError: (error: any) => {
          alert(t('hotlist.errors.bulkDeleteFailed', { message: error.message }));
        }
      });
    }
  };

  const records = hotlistData?.data || [];

  const filteredRecords = records.filter(record => 
    record.partNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredPreviewData = previewData.filter(record => 
    record.partNumber.toLowerCase().includes(previewSearchTerm.toLowerCase())
  );

  /** Jumlah kolom tabel utama: checkbox + Part Number + Tanggal + BI Total + Aksi. */
  const tableColCount = canManageData ? 5 : 3;

  return (
    <div className="space-y-6">
      {/* Page Title & Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">BI TOTAL (DLV + Finish Goods)</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('hotlist.subtitle')}
          </p>
        </div>
        
        {canManageData && (
          <div className="flex gap-2">
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".xlsx, .xls, .xlsm"
              onChange={handleFileUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending || previewData.length > 0}
              className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md font-medium text-sm transition-colors"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {t('hotlist.uploadExcel')}
            </button>

            <button
              onClick={() => setIsManualOpen(!isManualOpen)}
              disabled={previewData.length > 0}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md font-medium text-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('hotlist.manualEntry')}
            </button>
          </div>
        )}
      </div>

      {canManageData && previewData.length > 0 ? (
        <div className="bg-card border border-primary/20 rounded-lg shadow-md overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
          <div className="p-5 border-b bg-primary/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" />
                {t('hotlist.preview.title')}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t('hotlist.preview.aboutPrefix')} <strong>{previewData.length}</strong> {t('hotlist.preview.aboutSuffix')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative w-full sm:w-64 mr-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <input type="text" placeholder={t('hotlist.preview.searchPlaceholder')} className="w-full pl-9 pr-4 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary" value={previewSearchTerm} onChange={(e) => setPreviewSearchTerm(e.target.value)} />
              </div>
              <button
                onClick={() => handleSaveImport('add')}
                disabled={importMutation.isPending || !targetPeriodId}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md font-medium text-sm transition-colors disabled:opacity-50"
              >
                {importMutation.isPending && importMutation.variables?.mode === 'add' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t('hotlist.preview.saveAdd')}
              </button>
              <button
                onClick={() => handleSaveImport('overwrite')}
                disabled={importMutation.isPending || !targetPeriodId}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-md font-medium text-sm transition-colors disabled:opacity-50"
              >
                {importMutation.isPending && importMutation.variables?.mode === 'overwrite' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t('hotlist.preview.saveOverwrite')}
              </button>
              <button
                onClick={() => setPreviewData([])}
                disabled={importMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground hover:bg-muted/80 rounded-md font-medium text-sm transition-colors"
              >
                <X className="w-4 h-4" />
                {t('common.cancel')}
              </button>
            </div>
          </div>
          <div className="px-5 py-4 border-b bg-amber-50/40 dark:bg-amber-500/5">
            <PeriodSelect value={targetPeriodId} onChange={setTargetPeriodId} className="max-w-md" />
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-secondary/50 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-6 py-4 font-semibold w-1/3">{t('hotlist.table.partNumber')}</th>
                  <th className="px-6 py-4 font-semibold">{t('common.date')}</th>
                  <th className="px-6 py-4 font-semibold">{t('hotlist.table.biTotal')}</th>
                  <th className="px-6 py-4 font-semibold text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredPreviewData.length === 0 ? (
                   <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">{t('hotlist.preview.noData')}</td></tr>
                ) : filteredPreviewData.map((record) => {
                  const originalIndex = previewData.indexOf(record);
                  return (
                    <tr key={originalIndex} className="hover:bg-muted/30 transition-colors">
                      {previewEditingIndex === originalIndex ? (
                        <>
                          <td className="px-6 py-3">
                            <input type="text" className="w-full h-8 px-2 border rounded text-sm" value={previewEditForm.partNumber} onChange={(e) => setPreviewEditForm({ ...previewEditForm, partNumber: e.target.value })} />
                          </td>
                          <td className="px-6 py-3">
                            <input type="date" className="w-full h-8 px-2 border rounded text-sm" value={previewEditForm.date} onChange={(e) => setPreviewEditForm({ ...previewEditForm, date: e.target.value })} />
                          </td>
                          <td className="px-6 py-3">
                            <input type="number" step="any" className="w-full h-8 px-2 border rounded text-sm" value={previewEditForm.biTotal} onChange={(e) => setPreviewEditForm({ ...previewEditForm, biTotal: e.target.value })} />
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
                          <td className="px-6 py-3 font-semibold text-foreground">
                            <span className="bg-primary/10 text-primary px-2.5 py-1 rounded text-xs">
                              {record.partNumber}
                            </span>
                          </td>
                          <td className="px-6 py-3 font-medium">
                            {format(new Date(record.date), 'dd MMM yyyy', { locale: dateLocale })}
                          </td>
                          <td className="px-6 py-3">
                            <span className="font-bold">{record.biTotal.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => handlePreviewEditClick(originalIndex, record)} className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => handlePreviewDelete(originalIndex)} className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors">
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
          {/* Manual Entry Form */}
          {canManageData && isManualOpen && (
            <div className="bg-card border rounded-lg p-5 shadow-sm animate-in slide-in-from-top-2">
              <h2 className="text-sm font-semibold mb-4">{t('hotlist.manual.title')}</h2>
              <form onSubmit={handleManualSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <PeriodSelect
                  value={targetPeriodId}
                  onChange={setTargetPeriodId}
                  className="md:col-span-4"
                />
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">{t('hotlist.table.partNumber')}</label>
                  <input
                    type="text"
                    className="w-full h-10 px-3 border rounded-md text-sm"
                    placeholder={t('hotlist.manual.partNumberPlaceholder')}
                    value={manualForm.partNumber}
                    onChange={(e) => setManualForm({ ...manualForm, partNumber: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">{t('common.date')}</label>
                  <input
                    type="date"
                    className="w-full h-10 px-3 border rounded-md text-sm"
                    value={manualForm.date}
                    onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase">{t('hotlist.table.biTotal')}</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full h-10 px-3 border rounded-md text-sm"
                    placeholder="0.00"
                    value={manualForm.biTotal}
                    onChange={(e) => setManualForm({ ...manualForm, biTotal: e.target.value })}
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={addManualMutation.isPending || !targetPeriodId}
                    className="h-10 px-6 bg-primary text-primary-foreground rounded-md font-medium text-sm w-full md:w-auto flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {addManualMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsManualOpen(false)}
                    className="h-10 px-4 bg-muted text-muted-foreground rounded-md font-medium text-sm"
                  >
                    {t('common.cancel')}
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
                  <p className="text-base font-semibold">{t('hotlist.period.none')}</p>
                  <p className="text-sm mt-1">
                    {t('hotlist.period.noneHint')}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {periods.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPeriodId(p.id)}
                    className="cursor-pointer p-5 border rounded-lg bg-card hover:bg-muted/50 hover:border-primary/50 transition-all flex flex-wrap items-center gap-x-4 gap-y-2 group shadow-sm"
                  >
                    <div className="p-3 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20 transition-colors">
                      <Folder className="w-8 h-8 text-blue-500 fill-blue-500/20" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground flex items-center gap-1.5">
                        <span className="truncate">{periodDisplayLabel(p, lang)}</span>
                        {p.isLocked && <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('hotlist.period.counts', { hotlist: p.counts.HOTLIST, mrp: p.counts.MRP })}
                      </p>
                    </div>
                    <PeriodMeta period={p} className="w-full" />
                  </div>
                ))}

                {canManageData && (
                  <div className="p-5 border-2 border-dashed rounded-lg bg-card flex flex-col gap-3 justify-center">
                    <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                      <CalendarPlus className="w-4 h-4" /> {t('hotlist.period.createTitle')}
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
                      {t('hotlist.period.create')} {newPeriodMonth ? monthLabel(newPeriodMonth, lang) : t('hotlist.period.fallbackLabel')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-card border rounded-lg shadow-sm overflow-hidden flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-muted/20">
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button 
                    onClick={() => setSelectedPeriodId(null)}
                    className="p-2 hover:bg-background rounded-md border text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    title={t('hotlist.period.backToList')}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                    <input
                      type="text"
                      placeholder={t('hotlist.searchIn', { label: selectedPeriod?.label ?? '' })}
                      className="w-full pl-9 pr-4 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>
              <div className="flex items-center gap-3">
                {canManageData && selectedIds.length > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleteMutation.isPending}
                    className="flex items-center gap-2 px-3 py-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md font-medium text-sm transition-colors animate-in fade-in"
                  >
                    {bulkDeleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    {t('hotlist.bulkDelete', { count: selectedIds.length })}
                  </button>
                )}
                <div className="text-sm font-medium text-muted-foreground bg-background px-3 py-1.5 border rounded-md">
                  {t('hotlist.totalData', { count: filteredRecords.length })}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase bg-secondary/50">
                  <tr>
                    {canManageData && (
                      <th className="px-4 py-4 w-12 text-center">
                        <input 
                          type="checkbox" 
                          className="rounded border-gray-300 w-4 h-4"
                          checked={filteredRecords.length > 0 && selectedIds.length === filteredRecords.length}
                          onChange={handleSelectAll}
                        />
                      </th>
                    )}
                    <th className="px-6 py-4 font-semibold w-1/3">{t('hotlist.table.partNumber')}</th>
                    <th className="px-6 py-4 font-semibold">{t('common.date')}</th>
                    <th className="px-6 py-4 font-semibold">{t('hotlist.table.biTotal')}</th>
                    {canManageData && (
                      <th className="px-6 py-4 font-semibold text-right">{t('common.actions')}</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr>
                      <td colSpan={tableColCount} className="px-6 py-12 text-center text-muted-foreground">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                        <p className="mt-2 text-sm font-medium">{t('common.loading')}</p>
                      </td>
                    </tr>
                  ) : filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={tableColCount} className="px-6 py-12 text-center text-muted-foreground">
                        <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
                        <p className="text-base font-semibold">{t('hotlist.empty.title')}</p>
                        <p className="text-sm mt-1">{t('hotlist.empty.hint')}</p>
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map((record) => (
                      <tr key={record.id} className="hover:bg-muted/30 transition-colors">
                        {canManageData && (
                          <td className="px-4 py-3 text-center">
                            <input 
                              type="checkbox" 
                              className="rounded border-gray-300 w-4 h-4"
                              checked={selectedIds.includes(record.id)}
                              onChange={(e) => handleSelectOne(e, record.id)}
                            />
                          </td>
                        )}
                        {editingId === record.id ? (
                          <>
                            <td className="px-6 py-3">
                              <input
                                type="text"
                                className="w-full h-8 px-2 border rounded text-sm"
                                value={editForm.partNumber}
                                onChange={(e) => setEditForm({ ...editForm, partNumber: e.target.value })}
                              />
                            </td>
                            <td className="px-6 py-3">
                              <input
                                type="date"
                                className="w-full h-8 px-2 border rounded text-sm"
                                value={editForm.date}
                                onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                              />
                            </td>
                            <td className="px-6 py-3">
                              <input
                                type="number"
                                step="0.01"
                                className="w-full h-8 px-2 border rounded text-sm"
                                value={editForm.biTotal}
                                onChange={(e) => setEditForm({ ...editForm, biTotal: e.target.value })}
                              />
                            </td>
                            <td className="px-6 py-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleSaveEdit(record.id)}
                                  disabled={updateMutation.isPending}
                                  className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                                >
                                  {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="p-1.5 text-muted-foreground hover:bg-muted rounded"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-6 py-3 font-semibold text-foreground">
                              <span className="bg-primary/10 text-primary px-2.5 py-1 rounded text-xs">
                                {record.partNumber}
                              </span>
                            </td>
                            <td className="px-6 py-3 font-medium">
                              <div className="flex flex-col gap-1">
                                <span>{format(new Date(record.date), 'dd MMM yyyy', { locale: dateLocale })}</span>
                                {record.previousDate && (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>
                                    {t('hotlist.prevDate')} {format(new Date(record.previousDate), 'dd MMM yyyy', { locale: dateLocale })}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-3">
                              <span className="font-bold">{record.biTotal.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</span>
                            </td>
                            {canManageData && (
                              <td className="px-6 py-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    onClick={() => handleEditClick(record)}
                                    className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors"
                                    title={t('common.edit')}
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(record.id)}
                                    disabled={deleteMutation.isPending && deleteMutation.variables === record.id}
                                    className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                                    title={t('common.delete')}
                                  >
                                    {deleteMutation.isPending && deleteMutation.variables === record.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin text-destructive" />
                                    ) : (
                                      <Trash2 className="w-4 h-4" />
                                    )}
                                  </button>
                                </div>
                              </td>
                            )}
                          </>
                        )}
                      </tr>
                    ))
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
