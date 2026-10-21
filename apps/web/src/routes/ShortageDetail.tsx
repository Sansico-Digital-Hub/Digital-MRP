import { useState, useMemo } from 'react';
import { useShortageDetails } from '../hooks/useShortageDetails';
import { AlertCircle, Calendar, Search, CalendarRange, Clock, ShieldAlert } from 'lucide-react';
import { useTranslation } from '../i18n';

export function ShortageDetail() {
  const { t, locale } = useTranslation();
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [shiftFilter, setShiftFilter] = useState<string>('all');
  
  const { data, isLoading, error } = useShortageDetails(selectedDate);

  const filteredShortages = useMemo(() => {
    if (!data?.unifiedShortages) return [];
    return data.unifiedShortages.filter(item => {
      const matchesSearch = 
        item.partNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.toyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.masterCarton.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesShift = 
        shiftFilter === 'all' || item.shift === parseInt(shiftFilter);

      return matchesSearch && matchesShift;
    });
  }, [data?.unifiedShortages, searchQuery, shiftFilter]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <Clock className="animate-spin text-primary" size={24} />
          <span>{t('shortageDetail.loading')}</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-destructive/15 text-destructive p-4 rounded-md">
        {t('shortageDetail.errorLoading')} {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldAlert size={24} className="text-destructive animate-pulse" /> {t('shortageDetail.title')}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t('shortageDetail.subtitle')}
        </p>
      </div>

      {/* Premium Filter Toolbar */}
      <div className="bg-card text-card-foreground p-4 border rounded-lg shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          {/* Date Filter */}
          <div className="relative min-w-[200px]">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input
              type="date"
              className="w-full h-10 pl-9 pr-3 border rounded-md bg-background text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>

          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input
              type="text"
              placeholder={t('shortageDetail.searchPlaceholder')}
              className="w-full h-10 pl-9 pr-3 border rounded-md bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Tab Specific Filters */}
        <div className="flex items-center gap-3">
          <select
            className="h-10 px-3 border rounded-md bg-background text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary"
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
          >
            <option value="all">{t('shortageDetail.allShifts')}</option>
            <option value="1">{t('shortageDetail.shift', { number: 1 })}</option>
            <option value="2">{t('shortageDetail.shift', { number: 2 })}</option>
            <option value="3">{t('shortageDetail.shift', { number: 3 })}</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card text-card-foreground shadow-sm border rounded-lg p-6 text-left">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-muted-foreground font-medium mb-1 text-sm">{t('shortageDetail.shiftShortages')}</h3>
              <p className="text-3xl font-bold text-destructive">
                {data?.shiftShortagesCount || 0}
              </p>
            </div>
            <Clock className="text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{t('shortageDetail.shiftShortagesHint')}</p>
        </div>

        <div className="bg-card text-card-foreground shadow-sm border rounded-lg p-6 text-left">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-muted-foreground font-medium mb-1 text-sm">{t('shortageDetail.dailyShortages')}</h3>
              <p className="text-3xl font-bold text-destructive">
                {data?.dailyShortagesCount || 0}
              </p>
            </div>
            <Calendar className="text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{t('shortageDetail.dailyShortagesHint')}</p>
        </div>

        <div className="bg-card text-card-foreground shadow-sm border rounded-lg p-6 text-left">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-muted-foreground font-medium mb-1 text-sm">{t('shortageDetail.weeklyShortages')}</h3>
              <p className="text-3xl font-bold text-destructive">
                {data?.weeklyShortagesCount || 0}
              </p>
            </div>
            <CalendarRange className="text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{t('shortageDetail.weeklyShortagesHint')}</p>
        </div>
      </div>

      {/* Details Table */}
      <div className="bg-card text-card-foreground shadow-sm border rounded-lg overflow-hidden">
        <div className="p-6 border-b flex justify-between items-center bg-muted/10">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <AlertCircle size={18} className="text-destructive" />
            {t('shortageDetail.title')}
          </h3>
          <span className="text-xs text-muted-foreground font-medium bg-secondary px-2.5 py-1 rounded-full">
            {t('shortageDetail.recordsFound', { count: filteredShortages.length })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-secondary/50">
              <tr>
                <th className="px-6 py-3 font-semibold">{t('shortageDetail.columns.partNumber')}</th>
                <th className="px-6 py-3 font-semibold text-center">{t('common.date')}</th>
                <th className="px-6 py-3 font-semibold text-center">{t('shortageDetail.columns.shift')}</th>
                <th className="px-6 py-3 font-semibold text-right">{t('shortageDetail.columns.dailyDemand')}</th>
                <th className="px-6 py-3 font-semibold text-right">{t('shortageDetail.columns.weeklyDemand')}</th>
                <th className="px-6 py-3 font-semibold text-right">{t('shortageDetail.columns.fgStock')}</th>
                <th className="px-6 py-3 font-semibold text-right text-destructive">{t('shortageDetail.columns.dailyShortage')}</th>
                <th className="px-6 py-3 font-semibold text-right text-destructive">{t('shortageDetail.columns.weeklyShortage')}</th>
                <th className="px-6 py-3 font-semibold text-right">{t('shortageDetail.columns.wip')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredShortages.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">
                    {t('shortageDetail.noResults')}
                  </td>
                </tr>
              ) : (
                filteredShortages.map((item, idx) => (
                  <tr key={`${item.partNumber}-${item.shift}-${idx}`} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-4 font-semibold text-foreground">{item.partNumber}</td>
                    <td className="px-6 py-4 text-center text-muted-foreground font-medium">{item.date}</td>
                    <td className="px-6 py-4 text-center">
                      <span className="bg-primary/10 text-primary px-2.5 py-1 rounded text-xs font-semibold">
                        {t('shortageDetail.shift', { number: item.shift })}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-medium">{item.dailyDemand.toLocaleString(locale)}</td>
                    <td className="px-6 py-4 text-right font-medium">{item.weeklyDemand.toLocaleString(locale)}</td>
                    <td className="px-6 py-4 text-right font-medium text-green-600 dark:text-green-500">{item.fgStock.toLocaleString(locale)}</td>
                    <td className="px-6 py-4 text-right font-bold text-destructive bg-destructive/5">
                      {item.dailyShortage.toLocaleString(locale)}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-destructive bg-destructive/5">
                      {item.weeklyShortage.toLocaleString(locale)}
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-amber-500">
                      <div className="relative group inline-block">
                        <span className="cursor-help border-b border-dashed border-amber-500/50 pb-0.5">
                          {item.wip.toLocaleString(locale)}
                        </span>
                        {item.wipDetails && item.wipDetails.length > 0 && (
                          <div className="absolute top-1/2 right-[100%] mr-3 -translate-y-1/2 hidden group-hover:block w-max min-w-[150px] max-w-xs z-50 text-left">
                            <div className="bg-popover text-popover-foreground text-xs rounded-md shadow-lg border p-3">
                              <div className="font-semibold mb-2 border-b pb-1">{t('shortageDetail.wipLocations')}</div>
                              <ul className="space-y-1.5">
                                {item.wipDetails.map(w => (
                                  <li key={w.location} className="flex justify-between gap-6">
                                    <span className="text-muted-foreground">{w.location}</span>
                                    <span className="font-bold text-foreground">{w.quantity.toLocaleString(locale)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
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
