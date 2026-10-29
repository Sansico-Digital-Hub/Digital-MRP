import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { localeCode, useTranslation, type Lang } from '../i18n';
import { useStockAllocationRecommendation } from '../hooks/useStockRawMaterial';

/**
 * Rekomendasi alokasi untuk satu item stok raw material.
 *
 * Menjawab: "material ini bisa dipakai untuk part number / ukuran mana saja,
 * dan berapa waste kalau dipakai di sana". Daftar part diambil dari snapshot
 * hasil perhitungan periode ini, jadi angkanya konsisten dengan halaman
 * Material Calculation. Read-only — tidak mengubah stok.
 */

function num(value: number | null | undefined, decimals = 2, lang: Lang = 'id'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString(localeCode(lang), {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function pct(ratio: number | null | undefined, lang: Lang): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toLocaleString(localeCode(lang), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function wasteClass(ratio: number): string {
  if (ratio <= 0.0001) return 'bg-green-100 text-green-700';
  if (ratio <= 0.02) return 'bg-emerald-100 text-emerald-700';
  if (ratio <= 0.05) return 'bg-blue-100 text-blue-700';
  if (ratio <= 0.1) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

export function StockAllocationPanel({
  periodId,
  itemDesc,
  supplier,
}: {
  periodId: string;
  itemDesc: string;
  supplier: string | null;
}) {
  const { t, lang } = useTranslation();
  const { data, isLoading } = useStockAllocationRecommendation(periodId, itemDesc, supplier);
  const rec = data?.data;

  return (
    <div className="rounded-lg border border-primary/20 bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/10 bg-primary/5 px-4 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">
            {t('stockRawMaterial.allocation.title')}
          </span>
          {rec && rec.hasResult && (
            <span className="text-[11px] text-muted-foreground">
              {t('stockRawMaterial.allocation.subtitle', {
                count: num(rec.candidates.length, 0, lang),
              })}
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="px-4 py-6 text-center text-muted-foreground">
          <Loader2 className="w-5 h-5 mx-auto animate-spin" />
        </div>
      ) : !rec ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          {t('stockRawMaterial.allocation.failed')}
        </div>
      ) : !rec.hasResult ? (
        <div className="flex items-start gap-2 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t('stockRawMaterial.allocation.noResult')}</span>
        </div>
      ) : rec.reason === 'no-dimension' ? (
        <div className="flex items-start gap-2 px-4 py-3 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t('stockRawMaterial.allocation.noDimension')}</span>
        </div>
      ) : rec.candidates.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          {t('stockRawMaterial.allocation.empty')}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">{t('stockRawMaterial.allocation.part')}</th>
                  <th className="px-3 py-1.5 text-left font-medium">{t('stockRawMaterial.allocation.size')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('stockRawMaterial.allocation.need')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('stockRawMaterial.allocation.cut')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('stockRawMaterial.allocation.wastePerSheet')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('stockRawMaterial.allocation.allocatable')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('stockRawMaterial.allocation.waste')}</th>
                  <th className="px-3 py-1.5 text-right font-medium">{t('stockRawMaterial.allocation.usedNow')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rec.candidates.map((c) => (
                  <tr key={`${c.partNumber}-${c.ukuran}`} className="hover:bg-muted/30">
                    <td className="px-3 py-1.5 font-mono text-foreground">{c.partNumber}</td>
                    <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                      {c.ukuran}
                      <span className="text-[10px] text-muted-foreground/70"> · {c.gramatur}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-foreground whitespace-nowrap">
                      {num(c.needSheet, 0, lang)} {t('unit.sheets')}
                      <div className="text-[10px] text-muted-foreground">{num(c.needKg, 2, lang)} kg</div>
                    </td>
                    <td className="px-3 py-1.5 text-right text-foreground">{num(c.multiplier, 0, lang)}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded font-medium ${wasteClass(c.wastePct)}`}>
                        {pct(c.wastePct, lang)}
                      </span>
                      {c.trimWidthCm > 0 && (
                        <div className="text-[10px] text-muted-foreground">
                          +{num(c.trimWidthCm, 1, lang)} cm
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-foreground whitespace-nowrap">
                      {num(c.allocatableKg, 2, lang)} kg
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      <span className={c.wasteKg > 0 ? 'text-amber-700 font-medium' : 'text-muted-foreground'}>
                        {num(c.wasteKg, 2, lang)} kg
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground whitespace-nowrap">
                      {c.alreadyAllocatedKg > 0 ? `${num(c.alreadyAllocatedKg, 2, lang)} kg` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border/60 px-4 py-2 text-[10px] text-muted-foreground">
            {t('stockRawMaterial.allocation.note')}
          </div>
        </>
      )}
    </div>
  );
}
