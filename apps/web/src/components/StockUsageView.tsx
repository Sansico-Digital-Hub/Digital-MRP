import { Fragment, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Info, Loader2, PackageSearch } from 'lucide-react';
import { localeCode, useTranslation, type Lang } from '../i18n';
import { useStockUsage, type StockUsageItem } from '../hooks/useStockRawMaterial';

/**
 * Monitoring penggunaan stok raw material per ukuran.
 *
 * Menampilkan stok, bagian yang SUDAH dipakai hasil perhitungan, dan bagian
 * yang BELUM dipakai. Sumber angka pemakaian = snapshot hasil perhitungan
 * periode ini (bukan pemakaian fisik gudang).
 */

type UsageStatus = 'unused' | 'partial' | 'used' | 'over';

const EPS = 1e-6;

function num(value: number | null | undefined, decimals: number, lang: Lang): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString(localeCode(lang), {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function pctText(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

function statusOf(item: StockUsageItem): UsageStatus {
  if (item.overAllocated) return 'over';
  if (item.usedKg <= EPS && item.usedSheet <= EPS) return 'unused';
  if (item.remainingKg <= EPS && item.remainingSheet <= EPS) return 'used';
  return 'partial';
}

const STATUS_CLASS: Record<UsageStatus, string> = {
  unused: 'bg-secondary text-secondary-foreground',
  partial: 'bg-blue-100 text-blue-700',
  used: 'bg-green-100 text-green-700',
  over: 'bg-red-100 text-red-700',
};

export function StockUsageView({ periodId }: { periodId: string }) {
  const { t, lang } = useTranslation();
  const { data, isLoading } = useStockUsage(periodId);
  const payload = data?.data;

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | UsageStatus>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const items = useMemo(() => {
    const list = payload?.items ?? [];
    const term = search.trim().toLowerCase();
    return list.filter((item) => {
      if (status !== 'all' && statusOf(item) !== status) return false;
      if (!term) return true;
      return (
        item.itemDesc.toLowerCase().includes(term) ||
        item.supplier.toLowerCase().includes(term)
      );
    });
  }, [payload, search, status]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        <p className="mt-2 text-sm font-medium">{t('common.loading')}</p>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="py-12 text-center text-muted-foreground border rounded-lg bg-card">
        <AlertTriangle className="w-10 h-10 mx-auto text-amber-500/70 mb-3" />
        <p className="text-sm font-semibold">{t('stockRawMaterial.usage.failed')}</p>
      </div>
    );
  }

  const totals = payload.totals;
  const result = payload.result;
  const statusLabels: Record<UsageStatus, string> = {
    unused: t('stockRawMaterial.usage.statusUnused'),
    partial: t('stockRawMaterial.usage.statusPartial'),
    used: t('stockRawMaterial.usage.statusUsed'),
    over: t('stockRawMaterial.usage.statusOver'),
  };

  return (
    <div className="space-y-4">
      {/* Status sumber angka */}
      {!result ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t('stockRawMaterial.usage.noResult')}</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-xs">
          <Info className="w-4 h-4 text-primary shrink-0" />
          <span className="text-muted-foreground">
            {t('stockRawMaterial.usage.resultRun', { run: result.runNumber })}
          </span>
          <span className="text-muted-foreground/40">•</span>
          <span className="text-muted-foreground">
            {new Date(result.calculatedAt).toLocaleString(localeCode(lang), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
          {result.isStale && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('stockRawMaterial.usage.stale')}
            </span>
          )}
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">
            {t('stockRawMaterial.usage.kpiTotal')}
          </p>
          <p className="mt-1 text-lg font-bold text-foreground">
            {num(totals.capacityKg, 2, lang)} kg
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t('stockRawMaterial.usage.kpiMaterials', {
              count: num(totals.materials, 0, lang),
              lots: num(totals.lots, 0, lang),
            })}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">
            {t('stockRawMaterial.usage.kpiUsed')}
          </p>
          <p className="mt-1 text-lg font-bold text-blue-700">{num(totals.usedKg, 2, lang)} kg</p>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500"
              style={{ width: `${Math.min(100, Math.max(0, totals.usedPct * 100))}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{pctText(totals.usedPct)}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">
            {t('stockRawMaterial.usage.kpiRemaining')}
          </p>
          <p className="mt-1 text-lg font-bold text-foreground">
            {num(totals.remainingKg, 2, lang)} kg
          </p>
          <p className="text-[11px] text-muted-foreground">
            {pctText(totals.capacityKg > EPS ? Math.max(0, 1 - totals.usedPct) : null)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">
            {t('stockRawMaterial.usage.kpiUnusedMaterials')}
          </p>
          <p className="mt-1 text-lg font-bold text-foreground">
            {num(totals.unusedMaterials, 0, lang)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t('stockRawMaterial.usage.kpiStatusBreakdown', {
              partial: num(totals.partialMaterials, 0, lang),
              used: num(totals.usedUpMaterials, 0, lang),
            })}
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder={t('stockRawMaterial.usage.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-64 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'all' | UsageStatus)}
          className="px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">{t('stockRawMaterial.usage.filterAll')}</option>
          <option value="unused">{t('stockRawMaterial.usage.statusUnused')}</option>
          <option value="partial">{t('stockRawMaterial.usage.statusPartial')}</option>
          <option value="used">{t('stockRawMaterial.usage.statusUsed')}</option>
          <option value="over">{t('stockRawMaterial.usage.statusOver')}</option>
        </select>
        <div className="flex items-center gap-1 bg-background border rounded-md p-0.5 text-xs text-muted-foreground">
          <button
            onClick={() => setExpanded(new Set(items.map((i) => i.key)))}
            className="px-2 py-1 hover:bg-muted hover:text-foreground rounded flex items-center gap-1 transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5" /> {t('stockRawMaterial.usage.expandAll')}
          </button>
          <span className="text-muted-foreground/30">|</span>
          <button
            onClick={() => setExpanded(new Set())}
            className="px-2 py-1 hover:bg-muted hover:text-foreground rounded flex items-center gap-1 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" /> {t('stockRawMaterial.usage.collapseAll')}
          </button>
        </div>
        <div className="ml-auto text-xs font-medium text-muted-foreground bg-background px-3 py-1.5 border rounded-md">
          {t('stockRawMaterial.usage.materialsCount', { count: items.length })}
        </div>
      </div>

      {/* Tabel */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-secondary/50">
            <tr>
              <th className="px-4 py-3 font-semibold">{t('stockRawMaterial.usage.colSize')}</th>
              <th className="px-4 py-3 font-semibold text-center">{t('stockRawMaterial.usage.colLots')}</th>
              <th className="px-4 py-3 font-semibold text-right">{t('stockRawMaterial.usage.colStock')}</th>
              <th className="px-4 py-3 font-semibold text-right">{t('stockRawMaterial.usage.colUsed')}</th>
              <th className="px-4 py-3 font-semibold text-right">{t('stockRawMaterial.usage.colRemaining')}</th>
              <th className="px-4 py-3 font-semibold text-center">{t('stockRawMaterial.usage.colStatus')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  <PackageSearch className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm font-semibold">
                    {(payload.items.length === 0
                      ? t('stockRawMaterial.usage.noData')
                      : t('stockRawMaterial.usage.empty'))}
                  </p>
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isOpen = expanded.has(item.key);
                const state = statusOf(item);
                return (
                  <Fragment key={item.key}>
                    <tr className="hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => toggle(item.key)}
                            className="p-1 hover:bg-muted/80 rounded transition-colors text-muted-foreground hover:text-foreground shrink-0"
                            title={isOpen ? t('stockRawMaterial.usage.collapse') : t('stockRawMaterial.usage.expand')}
                          >
                            {isOpen ? (
                              <ChevronDown className="w-4 h-4 text-primary" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                          <div className="min-w-0">
                            <div className="font-semibold text-foreground">{item.itemDesc}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {item.supplier || '—'}
                              {item.width !== null && item.length !== null && (
                                <> · {num(item.width, 1, lang)} × {num(item.length, 1, lang)} cm</>
                              )}
                              {item.gsm !== null && <> · {num(item.gsm, 0, lang)} gsm</>}
                              {!item.seenInResult && <> · {t('stockRawMaterial.usage.statusNoMatch')}</>}
                            </div>
                            {item.unknownUnits.length > 0 && (
                              <div className="text-[11px] font-medium text-amber-600">
                                {t('stockRawMaterial.usage.unknownUnit', { units: item.unknownUnits.join(', ') })}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-muted-foreground">{item.lots}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-semibold text-foreground">{num(item.capacityKg, 2, lang)} kg</div>
                        {item.totalSheet > 0 && (
                          <div className="text-[11px] text-muted-foreground">
                            {num(item.totalSheet, 0, lang)} {t('stockRawMaterial.usage.sheet')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-semibold text-blue-700">{num(item.usedKg, 2, lang)} kg</div>
                        <div className="mt-1 h-1.5 w-full min-w-16 rounded-full bg-secondary overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{ width: `${Math.min(100, Math.max(0, (item.usedPct ?? 0) * 100))}%` }}
                          />
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {pctText(item.usedPct)}
                          {item.usedSheet > EPS && (
                            <> · {num(item.usedSheet, 0, lang)} {t('stockRawMaterial.usage.sheet')}</>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-semibold text-foreground">{num(item.remainingKg, 2, lang)} kg</div>
                        {item.totalSheet > 0 && (
                          <div className="text-[11px] text-muted-foreground">
                            {num(item.remainingSheet, 0, lang)} {t('stockRawMaterial.usage.sheet')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block rounded px-2 py-1 text-[11px] font-semibold ${STATUS_CLASS[state]}`}>
                          {statusLabels[state]}
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/20">
                        <td colSpan={6} className="px-4 py-3">
                          {item.overAllocated && (
                            <div className="mb-2 flex items-start gap-2 text-[11px] font-medium text-red-700">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                              <span>{t('stockRawMaterial.usage.overNote')}</span>
                            </div>
                          )}
                          {item.allocations.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              {t('stockRawMaterial.usage.allocEmpty')}
                            </p>
                          ) : (
                            <table className="w-full text-[11px] bg-background border rounded">
                              <thead className="bg-secondary/40 text-muted-foreground">
                                <tr>
                                  <th className="px-3 py-1.5 text-left font-medium">{t('stockRawMaterial.usage.allocSize')}</th>
                                  <th className="px-3 py-1.5 text-left font-medium">{t('stockRawMaterial.usage.allocParts')}</th>
                                  <th className="px-3 py-1.5 text-right font-medium">{t('stockRawMaterial.usage.allocMultiplier')}</th>
                                  <th className="px-3 py-1.5 text-right font-medium">{t('stockRawMaterial.usage.allocSheet')}</th>
                                  <th className="px-3 py-1.5 text-right font-medium">{t('stockRawMaterial.usage.allocKg')}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/60">
                                {item.allocations.map((alloc) => (
                                  <tr key={`${alloc.ukuran}-${alloc.gramatur}-${alloc.supplier}`}>
                                    <td className="px-3 py-1.5 text-foreground">
                                      {alloc.ukuran || '—'}
                                      {alloc.gramatur && (
                                        <span className="text-muted-foreground"> · {alloc.gramatur}</span>
                                      )}
                                      {alloc.supplier && (
                                        <span className="text-muted-foreground/70"> · {alloc.supplier}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-1.5 font-mono text-muted-foreground">
                                      {alloc.parts.length > 0 ? alloc.parts.join(', ') : '—'}
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                                      {num(alloc.multiplier, 0, lang)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                                      {num(alloc.physicalSheet, 0, lang)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-semibold text-foreground">
                                      {num(alloc.allocatedKg, 2, lang)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">{t('stockRawMaterial.usage.note')}</p>
    </div>
  );
}
