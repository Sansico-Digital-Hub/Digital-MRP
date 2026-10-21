import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../lib/api';
import { format } from 'date-fns';
import { Search, Loader2, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { useDebounce } from '../hooks/useDebounce';
import { useTranslation } from '../i18n';

interface HistoryRecord {
  id: string;
  itemId: string;
  item: { partNumber: string; description: string; unit: string };
  inQty: number;
  outQty: number;
  balance: number;
  type: string;
  date: string;
  notes: string | null;
  user: { name: string };
  createdAt: string;
}

export function FGHistory() {
  const { t, dateLocale } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebounce(searchTerm, 500);
  const [page, setPage] = useState(1);
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['fg-stock-history', page, limit, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      if (debouncedSearch) params.append('search', debouncedSearch);

      const res = await fetchApi<any>(`/fg-stock-history?${params.toString()}`);
      return res;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('fgHistory.title')}</h2>
          <p className="text-muted-foreground">
            {t('fgHistory.subtitle')}
          </p>
        </div>
      </div>

      <div className="bg-card border rounded-lg shadow-sm">
        <div className="p-4 border-b flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <input
              type="text"
              placeholder={t('fgHistory.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-secondary/50 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-secondary/30">
              <tr>
                <th className="px-6 py-3 font-medium">{t('common.date')}</th>
                <th className="px-6 py-3 font-medium">{t('fgHistory.partNumber')}</th>
                <th className="px-6 py-3 font-medium">{t('common.type')}</th>
                <th className="px-6 py-3 font-medium text-right">{t('fgHistory.in')}</th>
                <th className="px-6 py-3 font-medium text-right">{t('fgHistory.out')}</th>
                <th className="px-6 py-3 font-medium text-right">{t('fgHistory.balance')}</th>
                <th className="px-6 py-3 font-medium">{t('common.notes')}</th>
                <th className="px-6 py-3 font-medium">{t('fgHistory.by')}</th>
                <th className="px-6 py-3 font-medium">{t('fgHistory.recordedAt')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">{t('fgHistory.loadingHistory')}</p>
                  </td>
                </tr>
              ) : data?.data?.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-muted-foreground">
                    {t('fgHistory.noRecords')}
                  </td>
                </tr>
              ) : (
                data?.data?.map((record: HistoryRecord) => (
                  <tr key={record.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      {format(new Date(record.date), 'dd MMM yyyy', { locale: dateLocale })}
                    </td>
                    <td className="px-6 py-4 font-medium">
                      {record.item.partNumber}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${record.type === 'ADD' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                        {record.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {record.inQty > 0 ? (
                        <span className="flex items-center justify-end text-green-600 font-medium">
                          <ArrowUpCircle size={14} className="mr-1" />
                          {record.inQty}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {record.outQty > 0 ? (
                        <span className="flex items-center justify-end text-red-600 font-medium">
                          <ArrowDownCircle size={14} className="mr-1" />
                          {record.outQty}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4 text-right font-semibold">
                      {record.balance}
                    </td>
                    <td className="px-6 py-4 max-w-[200px] truncate" title={record.notes || ''}>
                      {record.notes || '-'}
                    </td>
                    <td className="px-6 py-4">
                      {record.user.name}
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(record.createdAt), 'dd MMM yyyy HH:mm', { locale: dateLocale })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="p-4 border-t flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('fgHistory.showingPage', { page: data.pagination.page, totalPages: data.pagination.totalPages })}
            </span>
            <div className="flex space-x-2">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1 border rounded-md hover:bg-secondary disabled:opacity-50 transition-colors"
              >
                {t('fgHistory.previous')}
              </button>
              <button
                disabled={page === data.pagination.totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1 border rounded-md hover:bg-secondary disabled:opacity-50 transition-colors"
              >
                {t('common.next')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default FGHistory;
