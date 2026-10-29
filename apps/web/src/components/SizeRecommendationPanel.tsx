import { AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { localeCode, useTranslation, type Lang, type TranslateParams } from '../i18n';
import type {
  GroupSizeRecommendation,
  RecommendationNote,
  RecommendationSource,
  SizeRecommendation,
} from '../hooks/useMaterialCalc';

/**
 * Panel "Rekomendasi & Waste" untuk satu grup ukuran.
 *
 * Semua angka di sini bersifat INFORMASI: trim belum diperhitungkan ke alokasi
 * stok/PO, sehingga `shortage`, `Stock As Of`, dan `End Ind` tidak berubah.
 * Panel ini read-only (tidak ada aksi yang mengubah data).
 */

function fmt(value: number | null | undefined, decimals = 2, lang: Lang = 'id'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString(localeCode(lang), {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function pct(ratio: number | null | undefined, lang: Lang = 'id', decimals = 2): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  const value = (ratio * 100).toLocaleString(localeCode(lang), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${value}%`;
}

const SOURCE_LABEL_KEY: Record<RecommendationSource, string> = {
  stock: 'materialCalc.recommendation.sourceStock',
  po: 'materialCalc.recommendation.sourcePo',
  npof: 'materialCalc.recommendation.sourceNpof',
  standard: 'materialCalc.recommendation.sourceStandard',
  need: 'materialCalc.recommendation.sourceNeed',
};

const NOTE_LABEL_KEY: Record<RecommendationNote, string> = {
  'trim-not-applied': 'materialCalc.recommendation.noteTrimNotApplied',
  'arrives-late': 'materialCalc.recommendation.noteArrivesLate',
  'new-purchase': 'materialCalc.recommendation.noteNewPurchase',
  'no-quantity': 'materialCalc.recommendation.noteNoQuantity',
  'size-multiplied': 'materialCalc.recommendation.noteMultiplied',
  baseline: 'materialCalc.recommendation.noteBaseline',
};

/** Warna badge berdasarkan waste per lembar. */
function wasteBadgeClass(ratio: number): string {
  if (ratio <= 0.0001) return 'bg-green-100 text-green-700';
  if (ratio <= 0.02) return 'bg-emerald-100 text-emerald-700';
  if (ratio <= 0.05) return 'bg-blue-100 text-blue-700';
  if (ratio <= 0.1) return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}

function availabilityText(
  row: SizeRecommendation,
  t: (key: string, params?: TranslateParams) => string,
  lang: Lang,
): string {
  if (row.source === 'npof') return t('materialCalc.recommendation.notInStock');
  if (row.source === 'standard') return t('materialCalc.recommendation.standardSize');
  if (row.source === 'po') {
    return row.arrivalWeek === null
      ? t('materialCalc.recommendation.poNoDate')
      : t('materialCalc.recommendation.poArrivesWeek', { week: row.arrivalWeek + 1 });
  }
  if (row.availableNow) {
    const parts: string[] = [];
    if (row.availableKg > 0) parts.push(`${fmt(row.availableKg, 2, lang)} kg`);
    if (row.availableSheet > 0) parts.push(`${fmt(row.availableSheet, 0, lang)} ${t('unit.sheets')}`);
    return parts.join(' · ');
  }
  return t('materialCalc.recommendation.notInStock');
}

function RecommendRow({
  row,
  isBest,
  t,
  lang,
}: {
  row: SizeRecommendation;
  isBest: boolean;
  t: (key: string, params?: TranslateParams) => string;
  lang: Lang;
}) {
  return (
    <tr className={`border-b border-gray-100 ${isBest ? 'bg-indigo-50/40' : ''}`}>
      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
        {row.size}
        {isBest && (
          <span className="ml-2 text-[10px] font-semibold text-indigo-700 bg-indigo-100 rounded px-1.5 py-0.5">
            {t('materialCalc.recommendation.badgeBest')}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
        {t(SOURCE_LABEL_KEY[row.source])}
      </td>
      <td className="px-3 py-2 text-right text-gray-700">{fmt(row.multiplier, 0, lang)}</td>
      <td className="px-3 py-2 text-right text-gray-700 whitespace-nowrap">
        {row.trimWidthCm > 0 ? `+${fmt(row.trimWidthCm, 2, lang)} cm` : '—'}
        {row.trimLengthCm > 0 && (
          <div className="text-[11px] text-gray-500">
            {t('materialCalc.recommendation.lengthPlus', { value: fmt(row.trimLengthCm, 2, lang) })}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${wasteBadgeClass(row.wastePctPerSheet)}`}>
          {pct(row.wastePctPerSheet, lang)}
        </span>
        {row.wastePerSheetKg > 0 && (
          <div className="text-[11px] text-gray-500 mt-0.5">
            {fmt(row.wastePerSheetKg, 4, lang)} kg/{t('materialCalc.recommendation.perSheetShort')}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <div className={row.purchase.wasteKg > 0 ? 'text-amber-700 font-medium' : 'text-gray-700'}>
          {fmt(row.purchase.wasteKg, 2, lang)} kg
        </div>
        <div className="text-[11px] text-gray-500">{pct(row.purchase.wastePct, lang)}</div>
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <div className={row.production.wasteKg > 0 ? 'text-amber-700 font-medium' : 'text-gray-700'}>
          {fmt(row.production.wasteKg, 2, lang)} kg
        </div>
        <div className="text-[11px] text-gray-500">{pct(row.production.wastePct, lang)}</div>
      </td>
      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{availabilityText(row, t, lang)}</td>
      <td className="px-3 py-2 text-[11px] text-gray-500">
        {row.notes
          .filter((n) => n !== 'trim-not-applied' && n !== 'baseline')
          .map((n) => t(NOTE_LABEL_KEY[n]))
          .join(' · ') || '—'}
      </td>
    </tr>
  );
}

export function SizeRecommendationPanel({
  recommendation,
}: {
  recommendation?: GroupSizeRecommendation;
}) {
  const { t, lang } = useTranslation();

  if (!recommendation) {
    return (
      <div className="mx-4 my-3 rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
        <Info className="w-5 h-5 mx-auto mb-2 text-gray-400" />
        {t('materialCalc.recommendation.recalcHint')}
      </div>
    );
  }

  const emptyTitle = recommendation.emptyReason
    ? t(`materialCalc.recommendation.empty.${recommendation.emptyReason}`)
    : null;
  const hasOptions = recommendation.options.length > 0;

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Konteks perhitungan */}
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="text-sm text-gray-800">
          <span className="font-medium">{t('materialCalc.recommendation.needSize')}:</span>{' '}
          {recommendation.needWidth !== null
            ? recommendation.needLength !== null
              ? `${fmt(recommendation.needWidth, 2, lang)} × ${fmt(recommendation.needLength, 2, lang)} cm`
              : `${fmt(recommendation.needWidth, 2, lang)} cm`
            : '—'}
          {recommendation.needGsm !== null && (
            <span className="text-gray-500"> · {fmt(recommendation.needGsm, 0, lang)} gsm</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
          <span>
            {t('materialCalc.recommendation.basisPurchase')}:{' '}
            <span className="font-medium text-gray-800">
              {fmt(recommendation.purchaseQtySheet, 0, lang)} {t('unit.sheets')}
            </span>
          </span>
          <span>
            {t('materialCalc.recommendation.basisProduction')}:{' '}
            <span className="font-medium text-gray-800">
              {fmt(recommendation.productionQtySheet, 0, lang)} {t('unit.sheets')}
            </span>
          </span>
        </div>
      </div>

      {/* Disclaimer: sifatnya informasi */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900">
          <div className="font-semibold">{t('materialCalc.recommendation.disclaimerTitle')}</div>
          <div className="mt-0.5">{t('materialCalc.recommendation.disclaimerBody')}</div>
        </div>
      </div>

      {emptyTitle && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          {emptyTitle}
        </div>
      )}

      {hasOptions && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{t('materialCalc.recommendation.colSize')}</th>
                <th className="px-3 py-2 text-left font-semibold">{t('materialCalc.recommendation.colSource')}</th>
                <th className="px-3 py-2 text-right font-semibold">{t('materialCalc.recommendation.colCut')}</th>
                <th className="px-3 py-2 text-right font-semibold">{t('materialCalc.recommendation.colTrim')}</th>
                <th className="px-3 py-2 text-right font-semibold">{t('materialCalc.recommendation.colWastePerSheet')}</th>
                <th className="px-3 py-2 text-right font-semibold">{t('materialCalc.recommendation.colWastePurchase')}</th>
                <th className="px-3 py-2 text-right font-semibold">{t('materialCalc.recommendation.colWasteProduction')}</th>
                <th className="px-3 py-2 text-left font-semibold">{t('materialCalc.recommendation.colAvailability')}</th>
                <th className="px-3 py-2 text-left font-semibold">{t('materialCalc.recommendation.colNotes')}</th>
              </tr>
            </thead>
            <tbody>
              {recommendation.options.map((row) => (
                <RecommendRow
                  key={`${row.source}-${row.size}-${row.multiplier}`}
                  row={row}
                  isBest={recommendation.best !== null && row === recommendation.best}
                  t={t}
                  lang={lang}
                />
              ))}
              {recommendation.baseline && (
                <tr className="bg-gray-50/60 border-b border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-700 whitespace-nowrap">
                    {recommendation.baseline.size}
                    <span className="ml-2 text-[10px] font-semibold text-gray-600 bg-gray-200 rounded px-1.5 py-0.5">
                      {t('materialCalc.recommendation.badgeBaseline')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{t(SOURCE_LABEL_KEY.need)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">1</td>
                  <td className="px-3 py-2 text-right text-gray-500">—</td>
                  <td className="px-3 py-2 text-right">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                      <CheckCircle className="w-3 h-3" />
                      {pct(0, lang)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">0 kg</td>
                  <td className="px-3 py-2 text-right text-gray-500">0 kg</td>
                  <td className="px-3 py-2 text-gray-500">{t('materialCalc.recommendation.baselineNote')}</td>
                  <td className="px-3 py-2 text-[11px] text-gray-400">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[11px] text-gray-500 space-y-0.5">
        <div>{t('materialCalc.recommendation.formulaNote')}</div>
        <div>{t('materialCalc.recommendation.basisNote')}</div>
      </div>
    </div>
  );
}
