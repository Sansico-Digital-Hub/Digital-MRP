import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useFGStocks, useUpsertFGStock, useBulkUpsertFGStock, useUpdateFGStock, useDeleteFGStock, useBulkDeleteFGStock } from '../hooks/useFGStock';
import { useItems, useCreateItem } from '../hooks/useItems';
import { Box, Plus, Save, Search, Upload, Trash2, Edit2 } from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { useAuthStore } from '../stores/authStore';

export function FGStock() {
  const { canEdit } = useAuthStore();
  // Production Planner & Admin boleh edit; Material Planner / User view-only.
  const isAdmin = canEdit('production');
  
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const { data: fgData, isLoading: loadingFG } = useFGStocks();
  const { data: itemsData } = useItems();
  const upsertFG = useUpsertFGStock();
  const createItem = useCreateItem();
  const bulkUpsertFG = useBulkUpsertFGStock();
  const bulkDeleteFG = useBulkDeleteFGStock();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState<any[]>([]);
  const [importSearch, setImportSearch] = useState('');

  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddItem, setQuickAddItem] = useState({ itemCode: '', itemName: '' });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [formData, setFormData] = useState({
    itemCode: '',
    quantity: 0,
    date: new Date().toISOString().split('T')[0],
    notes: '',
    unit: 'pcs',
  });

  const stocks = fgData?.data || [];
  const items = itemsData?.data || [];

  const units = useMemo(() => {
    const activeUnits = Array.from(new Set(items.map(item => item.unit).filter(Boolean)));
    return activeUnits.length > 0 ? activeUnits : ['pcs', 'kg', 'box', 'liters'];
  }, [items]);

  const filteredStocks = stocks.filter(stock => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase();
    return stock.item.partNumber.toLowerCase().includes(lowerQuery) || 
           stock.item.itemName.toLowerCase().includes(lowerQuery);
  });

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
        
        const parsedRecords = data.map((row, index) => {
          const itemKey = Object.keys(row as any).find(k => k.trim().toUpperCase() === 'ITEM') || Object.keys(row as any)[0];
          const qtyKey = Object.keys(row as any).find(k => k.trim().toUpperCase() === 'BI') || Object.keys(row as any)[1];
          
          return {
            id: `import-${index}`,
            itemCode: String((row as any)[itemKey] || '').trim(),
            quantity: Number((row as any)[qtyKey]) || 0,
            date: new Date().toISOString().split('T')[0],
            unit: ''
          };
        }).filter(r => r.itemCode);
        
        setImportData(parsedRecords);
      } catch (err) {
        alert('Failed to parse file. Please make sure it is a valid Excel/CSV with ITEM and BI columns.');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleBulkSubmit = async (saveMode: 'overwrite' | 'add') => {
    if (importData.length === 0) return;
    try {
      await bulkUpsertFG.mutateAsync({
        records: importData,
        saveMode
      });
      setShowImportModal(false);
      setImportData([]);
    } catch (err: any) {
      alert(err.message || 'Failed to bulk import FG Stock');
    }
  };

  const updateFG = useUpdateFGStock();
  const deleteFG = useDeleteFGStock();

  const [editModal, setEditModal] = useState<{ isOpen: boolean; data: any }>({
    isOpen: false,
    data: null,
  });

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModal.data) return;
    try {
      await updateFG.mutateAsync({
        id: editModal.data.id,
        date: editModal.data.date,
        quantity: Number(editModal.data.quantity),
        notes: editModal.data.notes,
      });
      setEditModal({ isOpen: false, data: null });
    } catch (err: any) {
      alert(err.message || 'Failed to update FG Stock');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try {
      await deleteFG.mutateAsync(id);
    } catch (err: any) {
      alert(err.message || 'Failed to delete FG Stock');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.length} selected records?`)) return;
    try {
      await bulkDeleteFG.mutateAsync({ ids: selectedIds });
      setSelectedIds([]);
    } catch (err: any) {
      alert(err.message || 'Failed to delete records');
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const newIds = new Set([...selectedIds, ...filteredStocks.map(s => s.id)]);
      setSelectedIds(Array.from(newIds));
    } else {
      const filteredSet = new Set(filteredStocks.map(s => s.id));
      setSelectedIds(selectedIds.filter(id => !filteredSet.has(id)));
    }
  };
  const allFilteredSelected = filteredStocks.length > 0 && filteredStocks.every(s => selectedIds.includes(s.id));

  const handleSubmit = async (e: React.FormEvent, saveMode: 'overwrite' | 'add') => {
    e.preventDefault();
    if (!formData.itemCode) return;

    try {
      await upsertFG.mutateAsync({
        ...formData,
        quantity: Number(formData.quantity),
        saveMode
      });
      setShowForm(false);
      setFormData(prev => ({ ...prev, itemCode: '', quantity: 0, notes: '', unit: units[0] || 'pcs' }));
    } catch (err: any) {
      alert(err.message || 'Failed to save FG Stock');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Finish Good (FG) Stock</h2>
          <p className="text-muted-foreground text-sm">Manage current warehouse ready-stock inventory.</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button 
              onClick={() => setShowImportModal(true)}
              className="bg-secondary text-secondary-foreground border hover:bg-secondary/80 px-4 py-2 rounded-md font-medium text-sm flex items-center space-x-2"
            >
              <Upload size={16} />
              <span>Import Data</span>
            </button>
          )}
          {isAdmin && (
            <button 
              onClick={() => setShowForm(!showForm)}
              className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium text-sm flex items-center space-x-2"
            >
              <Plus size={16} />
              <span>Update Stock Snapshot</span>
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div className="bg-card text-card-foreground border rounded-lg p-6 shadow-sm">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Box size={18} /> Record Latest Stock
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Note: Providing an update for an Item will OVERWRITE its current total quantity in the system snapshot.</p>
          
          <form className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            <div className="space-y-2 lg:col-span-2">
              <label className="text-sm font-medium">Part Number</label>
              <div className="flex gap-2" ref={dropdownRef}>
                <div className="relative flex-1">
                  <input 
                    type="text"
                    required
                    placeholder="Search or select Part Number..."
                    className="w-full h-10 px-3 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={formData.itemCode}
                    onFocus={() => setIsDropdownOpen(true)}
                    onChange={e => {
                      setFormData({...formData, itemCode: e.target.value});
                      setIsDropdownOpen(true);
                    }}
                  />
                  {isDropdownOpen && (
                    <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-y-auto bg-card text-card-foreground">
                      {items.filter(item => 
                        item.partNumber.toLowerCase().includes(formData.itemCode.toLowerCase()) ||
                        item.itemName.toLowerCase().includes(formData.itemCode.toLowerCase())
                      ).length > 0 ? (
                        items.filter(item => 
                          item.partNumber.toLowerCase().includes(formData.itemCode.toLowerCase()) ||
                          item.itemName.toLowerCase().includes(formData.itemCode.toLowerCase())
                        ).map(item => (
                          <button
                            key={item.id}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex flex-col border-b border-border/50 last:border-b-0"
                            onClick={() => {
                              setFormData({...formData, itemCode: item.partNumber, unit: item.unit});
                              setIsDropdownOpen(false);
                            }}
                          >
                            <span className="font-semibold">{item.partNumber}</span>
                            <span className="text-xs text-muted-foreground">{item.itemName}</span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">No matches found</div>
                      )}
                      
                      {formData.itemCode.trim() !== '' && !items.some(item => item.partNumber.toLowerCase() === formData.itemCode.toLowerCase()) && (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2.5 text-sm text-primary hover:bg-primary/10 flex items-center gap-2 font-medium border-t bg-muted/30"
                          onClick={() => {
                            setQuickAddItem(prev => ({ ...prev, itemCode: formData.itemCode }));
                            setShowQuickAdd(true);
                            setIsDropdownOpen(false);
                          }}
                        >
                          <Plus size={16} />
                          <span>Add new: "{formData.itemCode}"</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setQuickAddItem(prev => ({ ...prev, itemCode: formData.itemCode }));
                    setShowQuickAdd(true);
                  }}
                  className="h-10 px-3 border rounded-md bg-secondary hover:bg-secondary/80 flex items-center justify-center gap-1 text-sm font-medium shrink-0"
                  title="Add new Master Item"
                >
                  <Plus size={16} />
                  <span>Add</span>
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Current Total Quantity</label>
              <input 
                type="number" required min="0"
                className="w-full h-10 px-3 border rounded-md bg-background"
                value={formData.quantity} onChange={e => setFormData({...formData, quantity: Number(e.target.value)})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Recorded Date</label>
              <input 
                type="date" required
                className="w-full h-10 px-3 border rounded-md bg-background"
                value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})}
              />
            </div>
            <div className="lg:col-span-4 flex justify-end gap-3 mt-2">
              <button type="button" onClick={() => setShowForm(false)} className="h-10 border px-6 rounded-md font-medium hover:bg-muted">Cancel</button>
              <button type="button" onClick={(e) => handleSubmit(e, 'add')} disabled={upsertFG.isPending} className="h-10 bg-green-600 hover:bg-green-700 text-white px-6 rounded-md font-medium flex items-center gap-2">
                <Plus size={16} /> {upsertFG.isPending ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={(e) => handleSubmit(e, 'overwrite')} disabled={upsertFG.isPending} className="h-10 bg-primary text-primary-foreground px-6 rounded-md font-medium flex items-center gap-2">
                <Save size={16} /> {upsertFG.isPending ? 'Saving...' : 'Save Overwrite'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-card text-card-foreground border rounded-lg shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/10 flex flex-wrap items-center gap-3">
          {isAdmin && selectedIds.length > 0 && (
            <button 
              onClick={handleDeleteSelected}
              disabled={bulkDeleteFG.isPending}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-md font-medium text-sm flex items-center space-x-2 transition-colors mr-2"
            >
              <Trash2 size={16} />
              <span>Delete Selected ({selectedIds.length})</span>
            </button>
          )}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input 
              type="text"
              placeholder="Search Part Number..."
              className="w-full h-9 pl-9 pr-3 border rounded-md bg-background text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/50 text-muted-foreground uppercase text-xs font-medium">
              <tr>
                {isAdmin && (
                  <th className="px-6 py-3 w-12 text-center">
                    <input type="checkbox" checked={allFilteredSelected} onChange={handleSelectAll} className="rounded border-gray-300" />
                  </th>
                )}
                <th className="px-6 py-3">Part Number</th>
                <th className="px-6 py-3 text-right">Available Qty</th>
                <th className="px-6 py-3">Recorded Date</th>
                <th className="px-6 py-3">Updated By</th>
                {isAdmin && <th className="px-6 py-3 text-center">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loadingFG ? (
                <tr><td colSpan={isAdmin ? 6 : 4} className="p-8 text-center">Loading stock data...</td></tr>
              ) : filteredStocks.length === 0 ? (
                <tr><td colSpan={isAdmin ? 6 : 4} className="p-8 text-center text-muted-foreground">No FG Stock found.</td></tr>
              ) : (
                filteredStocks.map((stock) => (
                  <tr key={stock.id} className="hover:bg-muted/50 transition-colors">
                    {isAdmin && (
                      <td className="px-6 py-4 text-center">
                        <input 
                          type="checkbox" 
                          checked={selectedIds.includes(stock.id)} 
                          onChange={(e) => {
                            if (e.target.checked) setSelectedIds([...selectedIds, stock.id]);
                            else setSelectedIds(selectedIds.filter(id => id !== stock.id));
                          }} 
                          className="rounded border-gray-300"
                        />
                      </td>
                    )}
                    <td className="px-6 py-4 font-medium">{stock.item.partNumber}</td>
                    <td className="px-6 py-4 text-right font-bold text-green-600 dark:text-green-500">{stock.quantity}</td>
                    <td className="px-6 py-4 text-xs">
                      {format(new Date(stock.date || stock.updatedAt), 'dd MMM yyyy')}
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground">
                      {stock.user?.name || 'System'}
                    </td>
                    {isAdmin && (
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setEditModal({
                              isOpen: true,
                              data: {
                                id: stock.id,
                                date: stock.date ? stock.date.split('T')[0] : new Date().toISOString().split('T')[0],
                                quantity: stock.quantity,
                                notes: stock.notes || '',
                                itemCode: stock.item.partNumber,
                                itemName: stock.item.itemName,
                              }
                            })}
                            className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950 rounded-md transition-colors"
                            title="Edit Record"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(stock.id)}
                            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors"
                            title="Delete Record"
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

      {showImportModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card text-card-foreground border rounded-lg shadow-lg max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-6 border-b">
              <h3 className="text-xl font-bold flex items-center gap-2"><Upload size={20} /> Import Stock Data</h3>
              <button onClick={() => setShowImportModal(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            
            <div className="p-6 flex-1 overflow-auto space-y-4">
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
                    <span className="font-medium text-sm">{importData.length} records loaded</span>
                    <div className="relative w-64">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                      <input 
                        type="text" 
                        placeholder="Search loaded data..." 
                        className="w-full h-9 pl-9 pr-4 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                        value={importSearch}
                        onChange={e => setImportSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="border rounded-md overflow-hidden max-h-[50vh] overflow-y-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-muted text-muted-foreground text-xs uppercase font-medium sticky top-0">
                        <tr>
                          <th className="px-4 py-3">Part Number</th>
                          <th className="px-4 py-3 text-right">Quantity</th>
                          <th className="px-4 py-3 text-center w-20">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {importData.filter(d => d.itemCode.toLowerCase().includes(importSearch.toLowerCase())).map((row) => (
                          <tr key={row.id} className="hover:bg-muted/50">
                            <td className="px-4 py-2 font-medium">{row.itemCode}</td>
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
                                className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 rounded-md transition-colors title='Delete Record'"
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
                Cancel
              </button>
              <button 
                onClick={() => handleBulkSubmit('add')} 
                disabled={bulkUpsertFG.isPending || importData.length === 0} 
                className="h-10 bg-green-600 hover:bg-green-700 text-white px-6 rounded-md font-medium flex items-center gap-2 disabled:opacity-50 text-sm"
              >
                <Plus size={16} /> {bulkUpsertFG.isPending ? 'Saving...' : 'Save (Add)'}
              </button>
              <button 
                onClick={() => handleBulkSubmit('overwrite')} 
                disabled={bulkUpsertFG.isPending || importData.length === 0} 
                className="h-10 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white px-6 rounded-md font-medium flex items-center gap-2 disabled:opacity-50 text-sm"
              >
                <Save size={16} /> {bulkUpsertFG.isPending ? 'Saving...' : 'Save Overwrite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showQuickAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card text-card-foreground border rounded-lg shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Add New Part Number</h3>
              <button 
                type="button" 
                onClick={() => setShowQuickAdd(false)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!quickAddItem.itemCode) return;
              try {
                await createItem.mutateAsync({
                  partNumber: quickAddItem.itemCode,
                  itemName: quickAddItem.itemCode, // Set itemName equal to itemCode under the hood
                  unit: formData.unit || 'pcs'
                });
                setFormData(prev => ({ ...prev, itemCode: quickAddItem.itemCode }));
                setShowQuickAdd(false);
                setQuickAddItem({ itemCode: '', itemName: '' });
              } catch (err: any) {
                alert(err.message || 'Failed to create Part Number');
              }
            }} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Part Number</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. PROD-F006"
                  className="w-full h-10 px-3 border rounded-md bg-background"
                  value={quickAddItem.itemCode}
                  onChange={e => setQuickAddItem({...quickAddItem, itemCode: e.target.value})}
                />
              </div>
              
              <div className="flex justify-end gap-3 pt-2">
                <button 
                  type="button" 
                  onClick={() => setShowQuickAdd(false)}
                  className="h-10 border px-4 rounded-md font-medium hover:bg-muted text-sm"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={createItem.isPending}
                  className="h-10 bg-primary text-primary-foreground hover:bg-primary/90 px-4 rounded-md font-medium disabled:opacity-50 text-sm"
                >
                  {createItem.isPending ? 'Saving...' : 'Save Part Number'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editModal.isOpen && editModal.data && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card text-card-foreground border rounded-lg shadow-lg max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Edit FG Stock</h3>
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
                <label className="text-sm font-medium">Date</label>
                <input 
                  type="date" required
                  className="w-full h-10 px-3 border rounded-md bg-background"
                  value={editModal.data.date} onChange={e => setEditModal(prev => ({...prev, data: {...prev.data, date: e.target.value}}))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Quantity</label>
                <input 
                  type="number" required min="0"
                  className="w-full h-10 px-3 border rounded-md bg-background"
                  value={editModal.data.quantity} onChange={e => setEditModal(prev => ({...prev, data: {...prev.data, quantity: Number(e.target.value)}}))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Notes</label>
                <input 
                  type="text"
                  className="w-full h-10 px-3 border rounded-md bg-background"
                  value={editModal.data.notes} onChange={e => setEditModal(prev => ({...prev, data: {...prev.data, notes: e.target.value}}))}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setEditModal({ isOpen: false, data: null })} className="h-10 border px-4 rounded-md font-medium hover:bg-muted transition-colors">Cancel</button>
                <button type="submit" disabled={updateFG.isPending} className="h-10 bg-primary text-primary-foreground hover:bg-primary/90 px-4 rounded-md font-medium flex items-center gap-2 transition-colors">
                  <Save size={16} /> {updateFG.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
