import { useState, useMemo } from 'react';
import { useDashboard } from '../hooks/useDashboard';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { AlertCircle, CheckCircle2, Clock, Search, Calendar, ShieldAlert } from 'lucide-react';
import { useTranslation } from '../i18n';

export function Dashboard() {
  const { t, locale } = useTranslation();
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showUrgentOnly, setShowUrgentOnly] = useState<boolean>(false);

  const { data, isLoading, error } = useDashboard(selectedDate);

  // Apply filters on the data received
  const filteredGapAnalysis = useMemo(() => {
    if (!data?.gapAnalysis) return [];
    
    return data.gapAnalysis.filter((item) => {
      // 1. Search Query Filter (Part Number or Name)
      const matchesSearch =
        item.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.itemName.toLowerCase().includes(searchQuery.toLowerCase());

      // 2. Urgent / Shortage Only Filter
      const matchesUrgent = !showUrgentOnly || item.status === 'SHORTAGE' || item.status === 'IN_PRODUCTION';

      return matchesSearch && matchesUrgent;
    });
  }, [data?.gapAnalysis, searchQuery, showUrgentOnly]);



  // Recalculate summary metrics based on filtered set
  const summaryMetrics = useMemo(() => {
    if (!data) return { total: 0, fulfilled: 0, inProduction: 0, shortage: 0 };
    
    const baseList = showUrgentOnly
      ? data.gapAnalysis.filter((item) => item.status === 'SHORTAGE' || item.status === 'IN_PRODUCTION')
      : data.gapAnalysis;

    const filtered = baseList.filter((item) =>
      item.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.itemName.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const fulfilled = filtered.filter(i => i.status === 'FULFILLED').length;
    const inProduction = filtered.filter(i => i.status === 'IN_PRODUCTION').length;
    const shortage = filtered.filter(i => i.status === 'SHORTAGE' || i.status === 'IN_PRODUCTION').length;

    return {
      total: filtered.length,
      fulfilled,
      inProduction,
      shortage,
    };
  }, [data, searchQuery, showUrgentOnly]);

  const chartData = useMemo(() => {
    return filteredGapAnalysis.map(item => ({
      name: item.itemCode,
      demand: item.demand,
      fgStock: item.fgStock,
      wip: item.wip,
    }));
  }, [filteredGapAnalysis]);

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">{t('dashboard.loading')}</div>;
  }

  if (error) {
    return <div className="bg-destructive/15 text-destructive p-4 rounded-md">{t('dashboard.loadError', { message: error.message })}</div>;
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
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
              placeholder={t('dashboard.searchPlaceholder')}
              className="w-full h-10 pl-9 pr-3 border rounded-md bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Urgent Only Switch */}
        <button
          onClick={() => setShowUrgentOnly(!showUrgentOnly)}
          className={`h-10 px-4 rounded-md font-semibold text-sm flex items-center gap-2 border transition-all ${
            showUrgentOnly
              ? 'bg-destructive/10 border-destructive text-destructive'
              : 'bg-background hover:bg-muted text-muted-foreground'
          }`}
        >
          <ShieldAlert size={16} />
          {showUrgentOnly ? t('dashboard.urgentActive') : t('dashboard.urgentInactive')}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card text-card-foreground shadow-sm border rounded-lg p-6">
          <h3 className="text-muted-foreground font-medium mb-2 text-sm">{t('dashboard.summary.filtered')}</h3>
          <p className="text-3xl font-bold">{summaryMetrics.total}</p>
        </div>
        <div className="bg-card text-card-foreground shadow-sm border rounded-lg p-6">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-muted-foreground font-medium mb-2 text-sm">{t('dashboard.summary.fulfilled')}</h3>
              <p className="text-3xl font-bold text-green-600 dark:text-green-500">{summaryMetrics.fulfilled}</p>
            </div>
            <CheckCircle2 className="text-green-600 dark:text-green-500" />
          </div>
        </div>
        <div className="bg-card text-card-foreground shadow-sm border rounded-lg p-6">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-muted-foreground font-medium mb-2 text-sm">{t('dashboard.summary.inProduction')}</h3>
              <p className="text-3xl font-bold text-amber-500">{summaryMetrics.inProduction}</p>
            </div>
            <Clock className="text-amber-500" />
          </div>
        </div>
        <div className="bg-card text-card-foreground shadow-sm border rounded-lg p-6">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-muted-foreground font-medium mb-2 text-sm">{t('dashboard.summary.shortage')}</h3>
              <p className="text-3xl font-bold text-destructive">{summaryMetrics.shortage}</p>
            </div>
            <AlertCircle className="text-destructive" />
          </div>
        </div>
      </div>

      {/* Main Charts / Layout */}
      <div className="bg-card text-card-foreground shadow-sm border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-6">{t('dashboard.chart.title')}</h3>
        <div className="h-[350px] w-full">
          {chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              {t('dashboard.chart.noData')}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" />
                <YAxis />
                <RechartsTooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    borderColor: 'hsl(var(--border))',
                    borderRadius: '6px'
                  }}
                  labelStyle={{
                    color: 'hsl(var(--foreground))',
                    fontWeight: 'bold'
                  }}
                  itemStyle={{
                    color: 'hsl(var(--foreground))'
                  }}
                />
                <Legend />
                <Bar dataKey="demand" name={t('dashboard.chart.demand')} fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="fgStock" name={t('dashboard.chart.fgStock')} fill="#16a34a" stackId="a" radius={[0, 0, 4, 4]} />
                <Bar dataKey="wip" name={t('dashboard.chart.wip')} fill="#f59e0b" stackId="a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Detail Shortage List (Only visible when Show Urgent is active) */}
      {showUrgentOnly && (
        <div className="bg-card text-card-foreground shadow-sm border rounded-lg overflow-hidden animate-in fade-in duration-200">
          <div className="p-6 border-b flex justify-between items-center bg-muted/10">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <AlertCircle size={18} className="text-destructive animate-pulse" />
              {t('dashboard.urgent.title')}
            </h3>
            <span className="text-xs text-muted-foreground font-medium bg-destructive/10 text-destructive px-2.5 py-1 rounded-full border border-destructive/20">
              {t('dashboard.urgent.count', { count: filteredGapAnalysis.length })}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-secondary/50">
                <tr>
                  <th className="px-6 py-3 font-semibold">{t('dashboard.urgent.table.partNumber')}</th>
                  <th className="px-6 py-3 font-semibold">{t('common.description')}</th>
                  <th className="px-6 py-3 font-semibold text-right">{t('dashboard.urgent.table.dailyDemand')}</th>
                  <th className="px-6 py-3 font-semibold text-right">{t('dashboard.urgent.table.fgStock')}</th>
                  <th className="px-6 py-3 font-semibold text-right text-rose-600 dark:text-rose-400">{t('dashboard.urgent.table.dailyShortage')}</th>
                  <th className="px-6 py-3 font-semibold text-right">{t('dashboard.urgent.table.wip')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredGapAnalysis.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                      {t('dashboard.urgent.noData')}
                    </td>
                  </tr>
                ) : (
                  filteredGapAnalysis.map((item, idx) => {
                    const immediateShortage = item.demand > item.fgStock ? item.demand - item.fgStock : 0;
                    // @ts-ignore
                    const itemWipDetails = data?.wipStatus?.filter((w: any) => w.partNumber === item.partNumber && w.qty > 0).map((w: any) => ({ location: w.location, quantity: w.qty })) || [];
                    
                    return (
                      <tr key={`${item.itemCode}-${idx}`} className="hover:bg-muted/50 transition-colors">
                        <td className="px-6 py-4 font-semibold text-foreground">{item.itemCode}</td>
                        <td className="px-6 py-4 max-w-[240px] truncate" title={item.itemName}>{item.itemName}</td>
                        <td className="px-6 py-4 text-right font-medium">{item.demand.toLocaleString(locale)}</td>
                        <td className="px-6 py-4 text-right font-medium text-green-600 dark:text-green-500">{item.fgStock.toLocaleString(locale)}</td>
                        <td className="px-6 py-4 text-right font-bold text-rose-600 dark:text-rose-400 bg-rose-500/5">
                          {immediateShortage.toLocaleString(locale)}
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-amber-500">
                          <div className="relative group inline-block">
                            <span className="cursor-help border-b border-dashed border-amber-500/50 pb-0.5">
                              {item.wip.toLocaleString(locale)}
                            </span>
                            {itemWipDetails.length > 0 && (
                              <div className="absolute top-1/2 right-[100%] mr-3 -translate-y-1/2 hidden group-hover:block w-max min-w-[150px] max-w-xs z-50 text-left">
                                <div className="bg-popover text-popover-foreground text-xs rounded-md shadow-lg border p-3">
                                  <div className="font-semibold mb-2 border-b pb-1">{t('dashboard.urgent.wipLocations')}</div>
                                  <ul className="space-y-1.5">
                                    {itemWipDetails.map((w: any) => (
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
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
