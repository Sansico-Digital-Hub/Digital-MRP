import React, { useEffect, useState } from 'react';
import { useWIPs, useUpsertWIP, useBulkUpsertWIP, useBulkDeleteWIP } from '../hooks/useWIP';
import { useItems, useCreateItem } from '../hooks/useItems';
import { SearchableSelect } from '../components/SearchableSelect';
import { Settings2, Plus, Save, Upload, Trash2, Search, Filter, Calendar, X, Folder, ArrowLeft, Lock, CalendarPlus, Loader2 } from 'lucide-react';
import { usePeriods, useCreatePeriod, monthLabel, periodDisplayLabel, type DataModule } from '../hooks/usePeriods';
import { PeriodSelect } from '../components/PeriodSelect';
import { ModuleSelect } from '../components/ModuleSelect';
import * as XLSX from 'xlsx';
import { useAuthStore, lockedDataModule } from '../stores/authStore';
import { useTranslation } from '../i18n';

const WIP_SHEET_LOCATIONS = ['Blister', 'UV', 'Varnish OPP', 'Die Cut'];

function getWipUnit(location: string): 'Sheet' | 'Pcs' {
  return WIP_SHEET_LOCATIONS.some(l =>
    location.toLowerCase().includes(l.toLowerCase())
  ) ? 'Sheet' : 'Pcs';
}

export function WIP() {
  const { t, lang, locale } = useTranslation();
  const { user, canEditDataModule } = useAuthStore();
  // Planner terkunci ke modulnya sendiri; Admin/Super Admin bebas memilih modul.
  const lockedModule = lockedDataModule(user?.role) as DataModule | null;

  const [showForm, setShowForm] = useState(false);
  
  // Periode upload = keranjang data. WAJIB dipilih sebelum upload/isi manual.
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  // Periode tujuan untuk Import / Update Manual. Ikut periode yang sedang dibuka,
  // tapi tetap bisa diganti langsung dari dalam modal.
  const [targetPeriodId, setTargetPeriodId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedPeriodId) setTargetPeriodId(selectedPeriodId);
  }, [selectedPeriodId]);
  const [newPeriodMonth, setNewPeriodMonth] = useState('');
  const { data: periodsRes, isLoading: periodsLoading } = usePeriods();
  const periods = periodsRes?.data ?? [];
  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId) ?? null;
  const createPeriod = useCreatePeriod();
  // Modul pemilik data WIP. Data Production Planning dan Material Planning
  // disimpan TERPISAH — upload/edit di sini hanya menyentuh modul yang dipilih.
  // Planner TIDAK bebas memilih: modulnya dikunci ke modul miliknya.
  const [moduleType, setModuleType] = useState<DataModule>(lockedModule ?? 'PRODUCTION');
  // Jaga-jaga kalau role baru ter-rehydrate dari localStorage setelah mount.
  useEffect(() => {
    if (lockedModule && moduleType !== lockedModule) setModuleType(lockedModule);
  }, [lockedModule, moduleType]);
  // Gate edit: Admin/Super Admin selalu boleh; planner hanya untuk modulnya
  // sendiri; User/Viewer tidak boleh. (Nama variabel dipertahankan.)
  const isAdmin = canEditDataModule(moduleType);
  // Label modul untuk ditampilkan (Production Planning / Material Planning).
  const moduleLabel = moduleType === 'PRODUCTION'
    ? t('layout.modules.production')
    : t('layout.modules.material');
  const { data: wipData, isLoading: loadingWIP } = useWIPs(selectedPeriodId, moduleType);

  const handleCreatePeriod = async () => {
    if (!newPeriodMonth) return;
    try {
      const res = await createPeriod.mutateAsync({ uploadMonth: newPeriodMonth });
      setNewPeriodMonth('');
      setSelectedPeriodId(res.data.id);
    } catch (error: any) {
      alert(error.message || t('wip.errors.createPeriodFailed'));
    }
  };
  const { data: itemsData } = useItems();
  const createItem = useCreateItem();
  const upsertWIP = useUpsertWIP();
  const bulkUpsertWIP = useBulkUpsertWIP();
  const bulkDeleteWIP = useBulkDeleteWIP();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState<any[]>([]);
  const [importSearch, setImportSearch] = useState('');

  const [formData, setFormData] = useState({
    itemId: '',
    location: '',
    quantity: 0,
    progressPercent: 0,
    date: new Date().toISOString().split('T')[0],
    shift: 1,
    status: 'IN_PROGRESS',
    notes: '',
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedDate, setSelectedDate] = useState('');

  const wips = wipData?.data || [];
  const items = itemsData?.data || [];

  // Data sudah difilter server-side per periode — tidak lagi dipecah per bulan
  // berdasarkan tanggal di dalam data.
  const currentMonthWips = wips;

  // Extract unique locations dynamically from current active WIP data
  const activeLocations = React.useMemo(() => {
    const activeLocs = Array.from(new Set(currentMonthWips.map((wip: any) => wip.location))).filter(Boolean) as string[];
    const defaultLocations = ['Mesin-01', 'Mesin-02', 'Assembly Line', 'QC Station'];
    return activeLocs.length > 0 ? activeLocs : defaultLocations;
  }, [currentMonthWips]);

  const allLocations = activeLocations;

  // Filter WIP data based on search, location, and date inputs
  const filteredWips = currentMonthWips.filter((wip: any) => {
    // Search query matches part number or name
    const matchesSearch = 
      !searchQuery ||
      wip.item.partNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wip.item.itemName.toLowerCase().includes(searchQuery.toLowerCase());

    // Location matches selected filter option
    const matchesLocation = 
      !selectedLocation || wip.location === selectedLocation;

    // Date matches production date
    const wipDateStr = wip.date ? wip.date.split('T')[0] : '';
    const targetDateStr = selectedDate;

    const matchesDate = 
      !selectedDate || 
      wipDateStr === targetDateStr;

    return matchesSearch && matchesLocation && matchesDate;
  });

  const groupedWips = React.useMemo(() => {
    const groups: Record<string, any> = {};
    for (const wip of filteredWips) {
      const key = wip.item.partNumber;
      if (!groups[key]) {
        groups[key] = {
          id: key,
          itemCode: wip.item.partNumber,
          itemName: wip.item.itemName,
          locations: {},
          ids: [],
          recordedDate: wip.date ? wip.date.split('T')[0] : '',
        };
      }
      groups[key].locations[wip.location] = { id: wip.id, quantity: wip.quantity };
      groups[key].ids.push(wip.id);

      const wipDateStr = wip.date ? wip.date.split('T')[0] : '';
      if (wipDateStr && wipDateStr > groups[key].recordedDate) {
        groups[key].recordedDate = wipDateStr;
      }
    }
    return Object.values(groups).sort((a: any, b: any) => a.itemCode.localeCompare(b.itemCode));
  }, [filteredWips]);

  const itemOptions = items.map((item: any) => ({
    value: item.id,
    label: `${item.itemCode} - ${item.itemName}`
  }));

  const locationOptions = React.useMemo(() => {
    const opts = allLocations.map(loc => ({
      value: loc,
      label: loc
    }));
    if (formData.location && !allLocations.includes(formData.location)) {
      opts.push({ value: formData.location, label: formData.location });
    }
    return opts;
  }, [allLocations, formData.location]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data: any[] = XLSX.utils.sheet_to_json(ws);
        
        const parsedRecords: any[] = [];
        data.forEach((row: any, index) => {
          const itemKey = Object.keys(row).find(k => k.trim().toLowerCase().includes('no toy')) || Object.keys(row)[1];
          const itemCode = String(row[itemKey] || '').trim();
          
          if (!itemCode) return;
          
          Object.keys(row).forEach(key => {
            const k = key.trim().toLowerCase();
            if (k !== 'no' && !k.includes('no toy') && !k.includes('total wip')) {
              const val = String(row[key]).trim();
              if (val !== '-' && val !== '') {
                const numVal = parseFloat(val);
                if (!isNaN(numVal)) {
                  parsedRecords.push({
                    id: `import-${index}-${key}`,
                    itemCode,
                    location: key.trim(),
                    quantity: numVal * 1000,
                    date: new Date().toISOString().split('T')[0]
                  });
                }
              }
            }
          });
        });
        
        setImportData(parsedRecords);
      } catch (err) {
        alert(t('wip.errors.parseFileFailed'));
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleBulkSubmit = async (saveMode: 'overwrite' | 'add') => {
    if (importData.length === 0) return;
    if (!targetPeriodId) {
      alert(t('wip.errors.periodRequired'));
      return;
    }
    try {
      await bulkUpsertWIP.mutateAsync({
        records: importData,
        saveMode,
        periodId: targetPeriodId,
        moduleType,
      });
      setShowImportModal(false);
      setImportData([]);
    } catch (err: any) {
      alert(err.message || t('wip.errors.bulkImportFailed'));
    }
  };



  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(t('wip.confirm.deleteSelected', { count: selectedIds.length }))) return;
    try {
      await bulkDeleteWIP.mutateAsync({ ids: selectedIds });
      setSelectedIds([]);
    } catch (err: any) {
      alert(err.message || t('wip.errors.deleteFailed'));
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const newIds = new Set([...selectedIds, ...filteredWips.map((s: any) => s.id)]);
      setSelectedIds(Array.from(newIds));
    } else {
      const filteredSet = new Set(filteredWips.map((s: any) => s.id));
      setSelectedIds(selectedIds.filter(id => !filteredSet.has(id)));
    }
  };
  const allFilteredSelected = filteredWips.length > 0 && filteredWips.every((s: any) => selectedIds.includes(s.id));

  const handleSubmit = async (e: React.FormEvent | React.MouseEvent, saveMode: 'overwrite' | 'add') => {
    e.preventDefault();
    if (!formData.itemId || !formData.location) return;
    if (!targetPeriodId) {
      alert(t('wip.errors.periodRequiredSave'));
      return;
    }

    try {
      await upsertWIP.mutateAsync({
        ...formData,
        shift: Number(formData.shift),
        quantity: Number(formData.quantity),
        progressPercent: Number(formData.progressPercent),
        saveMode,
        periodId: targetPeriodId,
        moduleType,
      });
      setShowForm(false);
      setFormData(prev => ({ ...prev, itemId: '', quantity: 0, progressPercent: 0, notes: '' }));
    } catch (err: any) {
      alert(err.message || t('wip.errors.saveFailed'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('wip.title')}</h2>
          <p className="text-muted-foreground text-sm">{t('wip.subtitle')}</p>
        </div>        <div className="flex gap-2">
          {isAdmin && (
            <button 
              onClick={() => setShowImportModal(true)}
              className="bg-secondary text-secondary-foreground border hover:bg-secondary/80 px-4 py-2 rounded-md font-medium text-sm flex items-center space-x-2"
            >
              <Upload size={16} />
              <span>{t('wip.importData')}</span>
            </button>
          )}
          {isAdmin && (
            <button 
              onClick={() => setShowForm(!showForm)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium text-sm flex items-center space-x-2"
            >
              <Plus size={16} />
              <span>{t('wip.updateWipStatus')}</span>
            </button>
          )}
        </div>
      </div>

      {/*
        Pemisah modul: WIP dipakai Production Planning DAN Material Planning,
        tapi datanya disimpan terpisah. Semua baca/tulis di halaman ini
        mengikuti pilihan di bawah.
      */}
      <ModuleSelect value={moduleType} onChange={setModuleType} lockedTo={lockedModule} />

      {showForm && (
        <div className="bg-card text-card-foreground border rounded-lg p-6 shadow-sm">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Settings2 size={18} /> {t('wip.form.title')}
          </h3>
          <p className="text-xs text-muted-foreground mb-4">{t('wip.form.note')}</p>
          
          <form className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            <ModuleSelect value={moduleType} onChange={setModuleType} className="lg:col-span-4" lockedTo={lockedModule} />
            <PeriodSelect
              value={targetPeriodId}
              onChange={setTargetPeriodId}
              className="lg:col-span-4"
            />
            <div className="space-y-2 lg:col-span-2">
              <label className="text-sm font-medium">{t('wip.fields.partNumber')}</label>
              <SearchableSelect
                options={itemOptions}
                value={formData.itemId}
                onChange={val => setFormData({...formData, itemId: val})}
                onAdd={async (search) => {
                  try {
                    const res = await createItem.mutateAsync({ partNumber: search, itemName: search, unit: 'PCS' }) as any;
                    if (res?.data?.id) {
                      setFormData(prev => ({...prev, itemId: res.data.id}));
                    }
                  } catch (e: any) {
                    alert(e.message || t('wip.errors.createPartFailed'));
                  }
                }}
                placeholder={t('wip.placeholders.selectPartNumber')}
              />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <label className="text-sm font-medium">{t('wip.fields.locationLine')}</label>
              <SearchableSelect
                options={locationOptions}
                value={formData.location}
                onChange={val => setFormData({...formData, location: val})}
                onAdd={(search) => {
                  setFormData(prev => ({...prev, location: search}));
                }}
                placeholder={t('wip.placeholders.selectLocation')}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('common.quantity')}</label>
              <input 
                type="number" required min="1"
                className="w-full h-10 px-3 border rounded-md bg-background"
                value={formData.quantity} onChange={e => setFormData({...formData, quantity: Number(e.target.value)})}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('wip.fields.recordedDate')}</label>
              <input 
                type="date" required
                className="w-full h-10 px-3 border rounded-md bg-background"
                value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})}
              />
            </div>

            <div className="lg:col-span-4 flex justify-end gap-3 mt-2">
              <button type="button" onClick={() => setShowForm(false)} className="h-10 border px-6 rounded-md font-medium hover:bg-muted">{t('common.cancel')}</button>
              <button type="button" onClick={(e) => handleSubmit(e, 'add')} disabled={upsertWIP.isPending || !targetPeriodId} className="h-10 bg-green-600 hover:bg-green-700 text-white px-6 rounded-md font-medium flex items-center gap-2 disabled:opacity-50">
                <Plus size={16} /> {upsertWIP.isPending ? t('wip.saving') : t('common.save')}
              </button>
              <button type="button" onClick={(e) => handleSubmit(e, 'overwrite')} disabled={upsertWIP.isPending || !targetPeriodId} className="h-10 bg-primary text-primary-foreground px-6 rounded-md font-medium flex items-center gap-2 disabled:opacity-50">
                <Save size={16} /> {upsertWIP.isPending ? t('wip.saving') : t('wip.saveOverwrite')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Folder View or Table View */}
      {!selectedPeriodId ? (
        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
          {periods.length === 0 && !periodsLoading && (
            <div className="py-12 text-center text-muted-foreground border rounded-lg bg-card">
              <Settings2 className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-base font-semibold">{t('wip.noPeriods')}</p>
              <p className="text-sm mt-1">
                {t('wip.noPeriodsHint')}
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
                    {t('wip.periodCard.line', { count: p.moduleCounts[moduleType].WIP, module: moduleLabel })}
                  </p>
                </div>
              </div>
            ))}

            <div className="p-5 border-2 border-dashed rounded-lg bg-card flex flex-col gap-3 justify-center">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <CalendarPlus className="w-4 h-4" /> {t('wip.createPeriod')}
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
                {newPeriodMonth ? t('wip.createMonth', { month: monthLabel(newPeriodMonth, lang) }) : t('wip.createPeriodFallback')}
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
              title={t('wip.backToPeriods')}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h3 className="font-semibold text-lg">{t('wip.periodHeader', { period: selectedPeriod?.label ?? t('wip.periodFallback') })}</h3>
          </div>
          {/* Filters Bar */}
          <div className="bg-card text-card-foreground border rounded-lg p-4 shadow-sm flex flex-col md:flex-row gap-4 items-center animate-in fade-in slide-in-from-bottom-2">
        {isAdmin && selectedIds.length > 0 && (
          <button 
            onClick={handleDeleteSelected}
            disabled={bulkDeleteWIP.isPending}
            className="w-full md:w-auto h-10 px-4 flex items-center justify-center gap-2 border bg-red-600 text-white hover:bg-red-700 text-sm font-medium rounded-md transition-colors"
          >
            <Trash2 size={16} />
            <span className="whitespace-nowrap">{t('wip.deleteSelected', { count: selectedIds.length })}</span>
          </button>
        )}
        {/* Search Input */}
        <div className="relative w-full md:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <input
            type="text"
            placeholder={t('wip.placeholders.search')}
            className="w-full h-10 pl-10 pr-10 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Location Dropdown */}
        <div className="relative w-full md:w-64">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground flex items-center pointer-events-none">
            <Filter size={16} />
          </div>
          <select
            className="w-full h-10 pl-10 pr-8 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm appearance-none cursor-pointer"
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
          >
            <option value="">{t('wip.allLocations')}</option>
            {activeLocations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground flex items-center">
            <span className="text-xs">▼</span>
          </div>
        </div>

        {/* Date Filter */}
        <div className="relative w-full md:w-64">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground flex items-center pointer-events-none">
            <Calendar size={16} />
          </div>
          <input
            type="date"
            className="w-full h-10 pl-10 pr-10 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm cursor-pointer"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          {selectedDate && (
            <button
              onClick={() => setSelectedDate('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Reset All */}
        {(searchQuery || selectedLocation || selectedDate) && (
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedLocation('');
              setSelectedDate('');
            }}
            className="w-full md:w-auto h-10 px-4 flex items-center justify-center gap-2 border border-red-200 dark:border-red-950/50 bg-red-50/50 dark:bg-red-950/10 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 text-sm font-medium rounded-md transition-colors"
          >
            <X size={16} />
            <span>{t('common.reset')}</span>
          </button>
        )}
      </div>

      <div className="bg-card text-card-foreground border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/50 text-muted-foreground uppercase text-xs font-medium">
              <tr>
                {isAdmin && (
                  <th className="px-6 py-3 w-12 text-center">
                    <input type="checkbox" checked={allFilteredSelected} onChange={handleSelectAll} className="rounded border-gray-300" />
                  </th>
                )}
                <th className="px-6 py-3 whitespace-nowrap">{t('wip.fields.partNumber')}</th>
                <th className="px-6 py-3 whitespace-nowrap">{t('wip.fields.recordedDate')}</th>
                {activeLocations.map(loc => (
                  <th key={loc} className="px-6 py-3 text-right whitespace-nowrap">
                    <div>{loc}</div>
                    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.2 rounded mt-0.5 normal-case ${
                      getWipUnit(loc) === 'Sheet'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                    }`}>
                      {getWipUnit(loc) === 'Sheet' ? t('unit.sheets') : t('unit.pcs')}
                    </span>
                  </th>
                ))}
                {isAdmin && <th className="px-6 py-3 text-center whitespace-nowrap">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loadingWIP ? (
                <tr><td colSpan={isAdmin ? activeLocations.length + 4 : activeLocations.length + 2} className="p-8 text-center">{t('wip.loading')}</td></tr>
              ) : wips.length === 0 ? (
                <tr><td colSpan={isAdmin ? activeLocations.length + 4 : activeLocations.length + 2} className="p-8 text-center text-muted-foreground">{t('wip.empty')}</td></tr>
              ) : groupedWips.length === 0 ? (
                <tr><td colSpan={isAdmin ? activeLocations.length + 4 : activeLocations.length + 2} className="p-8 text-center text-muted-foreground">{t('wip.emptyFiltered')}</td></tr>
              ) : (
                groupedWips.map((group: any) => (
                  <tr key={group.id} className="hover:bg-muted/50 transition-colors">
                    {isAdmin && (
                      <td className="px-6 py-4 text-center">
                        <input 
                          type="checkbox" 
                          checked={group.ids.length > 0 && group.ids.every((id: string) => selectedIds.includes(id))} 
                          onChange={(e) => {
                            if (e.target.checked) {
                              const newIds = new Set([...selectedIds, ...group.ids]);
                              setSelectedIds(Array.from(newIds));
                            } else {
                              setSelectedIds(selectedIds.filter(id => !group.ids.includes(id)));
                            }
                          }} 
                          className="rounded border-gray-300"
                        />
                      </td>
                    )}
                    <td className="px-6 py-4 font-medium whitespace-nowrap">{group.itemCode}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-muted-foreground">{group.recordedDate ? new Date(group.recordedDate).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td>
                    {activeLocations.map(loc => (
                      <td key={loc} className="px-6 py-4 text-right font-medium">
                        {group.locations[loc]?.quantity > 0 ? (
                          <span className="text-amber-600 dark:text-amber-500">{group.locations[loc].quantity}</span>
                        ) : (
                          <span className="text-muted-foreground/30">-</span>
                        )}
                      </td>
                    ))}
                    {isAdmin && (
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => {
                               if (!confirm(t('wip.confirm.deletePart'))) return;
                               bulkDeleteWIP.mutateAsync({ ids: group.ids }).catch(err => alert(err.message || t('wip.errors.deleteFailed')));
                            }}
                            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors"
                            title={t('wip.deletePartTooltip')}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card text-card-foreground border rounded-lg shadow-lg max-w-5xl w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-6 border-b">
              <h3 className="text-xl font-bold flex items-center gap-2"><Upload size={20} /> {t('wip.importModal.title')}</h3>
              <button onClick={() => setShowImportModal(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            
            <div className="p-6 flex-1 overflow-auto space-y-4">
              {/* Modul tujuan — data Production & Material disimpan terpisah */}
              <ModuleSelect value={moduleType} onChange={setModuleType} lockedTo={lockedModule} />
              <PeriodSelect value={targetPeriodId} onChange={setTargetPeriodId} className="max-w-md" />

              <div className="flex items-center gap-4">
                <input 
                  type="file" 
                  accept=".xlsx, .xls, .csv" 
                  onChange={handleFileUpload} 
                  className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                />
              </div>

              {importData.length > 0 && (
                <>
                  <div className="flex justify-between items-center bg-muted/30 p-3 rounded-md">
                    <span className="font-medium text-sm">{t('wip.importModal.recordsLoaded', { count: importData.length })}</span>
                    <div className="relative w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                      <input 
                        type="text" 
                        placeholder={t('wip.placeholders.searchLoaded')} 
                        className="w-full h-9 pl-9 pr-4 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                        value={importSearch}
                        onChange={e => setImportSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="border rounded-md overflow-hidden max-h-[50vh] overflow-y-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-muted text-muted-foreground text-xs uppercase font-medium sticky top-0 shadow-sm">
                        <tr>
                          <th className="px-4 py-3">{t('wip.fields.partNumber')}</th>
                          <th className="px-4 py-3">{t('wip.fields.locationLineShort')}</th>
                          <th className="px-4 py-3 text-right">{t('common.quantity')}</th>
                          <th className="px-4 py-3 text-center w-20">{t('common.action')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {importData.filter(d => d.itemCode.toLowerCase().includes(importSearch.toLowerCase()) || d.location.toLowerCase().includes(importSearch.toLowerCase())).map((row) => (
                          <tr key={row.id} className="hover:bg-muted/50">
                            <td className="px-4 py-2 font-medium">{row.itemCode}</td>
                            <td className="px-4 py-2"><span className="bg-secondary px-2 py-1 rounded text-xs">{row.location}</span></td>
                            <td className="px-4 py-2 text-right">
                              <input 
                                type="number" 
                                className="w-24 h-8 px-2 border rounded text-right bg-background"
                                value={row.quantity}
                                onChange={e => {
                                  const newData = [...importData];
                                  const targetIndex = importData.findIndex(r => r.id === row.id);
                                  newData[targetIndex].quantity = Number(e.target.value);
                                  setImportData(newData);
                                }}
                              />
                            </td>
                            <td className="px-4 py-2 text-center">
                              <button 
                                onClick={() => setImportData(importData.filter(r => r.id !== row.id))}
                                className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors"
                                title={t('common.delete')}
                              >
                                <Trash2 size={16} />
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
            
            <div className="p-6 border-t flex justify-end gap-3 bg-muted/10">
              <button 
                onClick={() => setShowImportModal(false)}
                className="h-10 border px-6 rounded-md font-medium hover:bg-muted text-sm"
              >
                {t('common.cancel')}
              </button>
              <button 
                onClick={() => handleBulkSubmit('add')}
                disabled={bulkUpsertWIP.isPending || importData.length === 0 || !targetPeriodId}
                className="h-10 bg-green-600 hover:bg-green-700 text-white px-6 rounded-md font-medium flex items-center gap-2 disabled:opacity-50 text-sm"
              >
                <Plus size={16} /> {bulkUpsertWIP.isPending ? t('wip.saving') : t('wip.saveAdd')}
              </button>
              <button 
                onClick={() => handleBulkSubmit('overwrite')}
                disabled={bulkUpsertWIP.isPending || importData.length === 0 || !targetPeriodId}
                className="h-10 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white px-6 rounded-md font-medium flex items-center gap-2 disabled:opacity-50 text-sm"
              >
                <Save size={16} /> {bulkUpsertWIP.isPending ? t('wip.saving') : t('wip.saveOverwrite')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
