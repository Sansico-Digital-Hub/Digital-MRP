import { useState, useMemo } from 'react';
import {
  useNpofMaterials,
  useSyncNpofMaterials,
  useDeleteNpofMaterial,
  useBulkDeleteNpofMaterials
} from '../hooks/useNpofMaterials';
import { RefreshCw, Search, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useAuthStore } from '../stores/authStore';
import { useTranslation } from '../i18n';

export function NpofMaterials() {
  const { t, dateLocale } = useTranslation();
  const { data: materialsData, isLoading } = useNpofMaterials();
  const syncMutation = useSyncNpofMaterials();
  const deleteMutation = useDeleteNpofMaterial();
  const bulkDeleteMutation = useBulkDeleteNpofMaterials();
  const { canEdit } = useAuthStore();
  // Material Planner & Admin boleh edit; Production Planner / User view-only.
  const isAdmin = canEdit('material');

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleSync = () => {
    if (confirm(t('npofMaterials.confirmSync'))) {
      syncMutation.mutate(undefined, {
        onSuccess: (res) => {
          alert(t('npofMaterials.syncSuccess', { updated: res.syncCount, skipped: res.skippedCount, total: res.totalProcessed }));
        },
        onError: (error: any) => {
          alert(t('npofMaterials.syncFailed', { message: error.message }));
        }
      });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm(t('npofMaterials.confirmDelete'))) {
      deleteMutation.mutate(id, {
        onError: (error: any) => {
          alert(t('npofMaterials.deleteFailed', { message: error.message }));
        }
      });
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    if (confirm(t('npofMaterials.confirmBulkDelete', { count: selectedIds.length }))) {
      bulkDeleteMutation.mutate(selectedIds, {
        onSuccess: () => {
          setSelectedIds([]);
        },
        onError: (error: any) => {
          alert(t('npofMaterials.bulkDeleteFailed', { message: error.message }));
        }
      });
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredData.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredData.map(item => item.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const filteredData = useMemo(() => {
    if (!materialsData) return [];
    if (!searchTerm) return materialsData;
    
    const lowerSearch = searchTerm.toLowerCase();
    return materialsData.filter(item => 
      item.partNumber.toLowerCase().includes(lowerSearch) ||
      item.productName.toLowerCase().includes(lowerSearch) ||
      item.material?.toLowerCase().includes(lowerSearch) ||
      item.gramatur?.toLowerCase().includes(lowerSearch) ||
      item.supplier?.toLowerCase().includes(lowerSearch)
    );
  }, [materialsData, searchTerm]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('npofMaterials.title')}</h1>
          <p className="text-gray-500 mt-1">{t('npofMaterials.subtitle')}</p>
        </div>
        
        {isAdmin && (
          <div className="flex gap-2">
            {selectedIds.length > 0 && (
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleteMutation.isPending}
                className="btn btn-secondary text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                {bulkDeleteMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                {t('npofMaterials.deleteSelected', { count: selectedIds.length })}
              </button>
            )}
            <button
              onClick={handleSync}
              disabled={syncMutation.isPending}
              className="btn btn-primary"
            >
              {syncMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              {t('npofMaterials.syncFromNpof')}
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-center bg-gray-50/50">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder={t('npofMaterials.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input pl-10 w-full bg-white"
            />
          </div>
          
          <div className="flex items-center text-sm text-gray-500 bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm">
            <span className="font-medium text-gray-900 mr-1">{filteredData.length}</span> {t('npofMaterials.recordsFound')}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50/80 sticky top-0 backdrop-blur-sm">
              <tr>
                {isAdmin && (
                  <th className="px-4 py-3 w-12">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === filteredData.length && filteredData.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                )}
                <th className="px-4 py-3 font-semibold w-24">{t('npofMaterials.npofId')}</th>
                <th className="px-4 py-3 font-semibold">{t('npofMaterials.partNumber')}</th>
                <th className="px-4 py-3 font-semibold">{t('npofMaterials.productName')}</th>
                <th className="px-4 py-3 font-semibold">{t('npofMaterials.material')}</th>
                <th className="px-4 py-3 font-semibold">{t('npofMaterials.gramatur')}</th>
                <th className="px-4 py-3 font-semibold">{t('npofMaterials.supplier')}</th>
                <th className="px-4 py-3 font-semibold">{t('npofMaterials.sheetedSize')}</th>
                <th className="px-4 py-3 font-semibold min-w-[200px]">{t('npofMaterials.formulaMaterial')}</th>
                <th className="px-4 py-3 font-semibold w-20">{t('npofMaterials.ups')}</th>
                <th className="px-4 py-3 font-semibold">{t('npofMaterials.lastUpdated')}</th>
                {isAdmin && <th className="px-4 py-3 font-semibold text-right w-24">{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan={isAdmin ? 12 : 11} className="px-4 py-8 text-center text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
                    {t('npofMaterials.loading')}
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 12 : 11} className="px-4 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                        <AlertCircle className="w-6 h-6 text-gray-400" />
                      </div>
                      <p className="text-gray-900 font-medium">{t('npofMaterials.emptyTitle')}</p>
                      <p className="text-sm mt-1">{t('npofMaterials.emptyHint')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredData.map((item) => (
                  <tr key={item.id} className={`hover:bg-gray-50/50 transition-colors ${selectedIds.includes(item.id) ? 'bg-indigo-50/30' : ''}`}>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-500">#{item.npofId}</td>
                    
                    <td className="px-4 py-3 font-medium text-gray-900">{item.partNumber}</td>
                    <td className="px-4 py-3 text-gray-700">{item.productName}</td>
                    <td className="px-4 py-3 text-gray-700">{item.material || '-'}</td>
                    <td className="px-4 py-3 text-gray-700 font-medium">{item.gramatur || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{item.supplier || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{item.sheetedSize || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 truncate max-w-xs" title={item.formulaMaterial || ''}>
                      {item.formulaMaterial || '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-center">{item.ups || '-'}</td>
                    
                    <td className="px-4 py-3 text-gray-500">
                      <div title={item.lastSyncedAt ? format(new Date(item.lastSyncedAt), 'PPpp', { locale: dateLocale }) : t('common.never')}>
                        {item.lastSyncedAt ? format(new Date(item.lastSyncedAt), 'MMM d, HH:mm', { locale: dateLocale }) : '-'}
                      </div>
                    </td>

                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => handleDelete(item.id)} className="p-1 text-red-600 hover:bg-red-50 rounded" title={t('common.delete')}>
                            <Trash2 className="w-4 h-4" />
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
    </div>
  );
}
