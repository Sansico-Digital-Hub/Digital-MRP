import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useCalculateCycle,
  useCreateCycle,
  useCreatePoolExclusion,
  useCycleAudit,
  useCycleDataStatus,
  useCycleExclusions,
  useCycleResultDetail,
  useCycles,
  useCycleRetentionAction,
  useDeletePoolExclusion,
  useExpiredCycles,
  useNpofCheck,
  useNpofCoverage,
  usePeriodSourceRows,
  useUpdatePoolExclusion,
  type CycleAuditEntry,
  type CycleCalculationResult,
  type CycleSourceRow,
  type CycleSummary,
  type ExpiredCycle,
  type MaterialCalcExclusion,
  type MaterialGroup,
  type MaterialCalcResponse,
  type MaterialPoolKind,
  type NpofCoverageRow,
  type NpofRequiredField,
  type OutstandingPoDetail,
  type PartNumberDetail,
  type PoolQtyUnit,
  type StockDetail,
  type StockForm,
  type WeeklyMatrix,
} from '../hooks/useMaterialCalc';
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileDown,
  Files,
  Filter,
  Folder,
  FolderOpen,
  History,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Unlock,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation, translate, localeCode, dateLocale, type Lang } from '../i18n';
import { usePeriods, periodDisplayLabel } from '../hooks/usePeriods';
import { useAuthStore } from '../stores/authStore';
import { exportAllMaterialTypesZip, exportMaterialTypePdf } from '../lib/materialCalcExport';
import { materialTypeLabel } from '../lib/materialCalcPdf';
import { SizeRecommendationPanel } from '../components/SizeRecommendationPanel';

// ── Format angka & tanggal ────────────────────────────────────────────────

function formatNum(n: number | null | undefined, decimals = 2, lang: Lang = 'id'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString(localeCode(lang), { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function formatMonth(month: string, lang: Lang = 'id'): string {
  const date = new Date(`${month}-01T00:00:00`);
  return Number.isNaN(date.getTime())
    ? translate(lang, 'materialCalc.monthUnavailable')
    : format(date, 'MMMM yyyy', { locale: dateLocale(lang) });
}

function formatWeekDate(date: string, lang: Lang = 'id'): string {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? '-' : format(parsed, 'dd MMM yyyy', { locale: dateLocale(lang) });
}

function formatDateTime(value: string | null | undefined, lang: Lang = 'id'): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : format(parsed, 'dd MMM yyyy HH:mm', { locale: dateLocale(lang) });
}

/** Label pendek untuk kepala kolom minggu, mis. "19 Sep". */
function formatDayMonth(value: string, lang: Lang = 'id'): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : format(parsed, 'dd MMM', { locale: dateLocale(lang) });
}

function getFallbackTimeline(leadTimeMonths: number) {
  const purchaseDate = new Date();
  const arrivalDate = new Date(purchaseDate);
  arrivalDate.setMonth(arrivalDate.getMonth() + Math.max(0, leadTimeMonths - 1));
  const usageDate = new Date(purchaseDate);
  usageDate.setMonth(usageDate.getMonth() + leadTimeMonths);
  const toMonth = (date: Date) => date.toISOString().slice(0, 7);
  return {
    purchaseMonth: toMonth(purchaseDate),
    arrivalMonth: toMonth(arrivalDate),
    usageMonth: toMonth(usageDate),
  };
}

// ── Sel tabel mingguan: lembar (semua baris) + kg (khusus End Ind) ────────

/**
 * Sel angka tabel mingguan.
 *
 * `showKg` diaktifkan pada baris **Total + Allowance, Stock As Of, Outstanding PO,
 * dan End Ind**. Keterangan kg dihitung sederhana: **lbr × Kg/Lbr** grup
 * (tidak mengikuti rumus saldo kg di backend). Gaya teks kg sengaja SAMA dengan
 * baris lbr (tebal & warna penuh, tanpa peredupan).
 */
function UnitCell({
  sheet,
  kg,
  hasKg,
  showKg = false,
  poNumbers,
}: {
  sheet: number | undefined;
  kg: number | undefined;
  hasKg: boolean;
  showKg?: boolean;
  poNumbers?: string[];
}) {
  const { t, lang } = useTranslation();
  const sheets = sheet ?? 0;
  const kilos = kg ?? 0;
  return (
    <td className={`px-2 py-1.5 text-right align-top tabular-nums ${sheets < 0 ? 'text-red-600' : 'text-gray-700'}`}>
      <div className="text-[11px] font-medium">{formatNum(sheets, 0, lang)} {t('unit.sheets')}</div>
      {showKg && <div className="text-[11px] font-medium">{hasKg ? `${formatNum(kilos, 2, lang)} ${t('unit.kg')}` : '—'}</div>}
      {poNumbers && poNumbers.length > 0 && (
        <div
          className="mt-0.5 flex flex-wrap justify-end gap-x-1 text-[9px] leading-tight text-indigo-400"
          title={`PO: ${poNumbers.join(', ')}`}
        >
          {poNumbers.map((no, idx) => (
            <span key={no} className="font-mono">
              {no}{idx < poNumbers.length - 1 ? ',' : ''}
            </span>
          ))}
        </div>
      )}
    </td>
  );
}

// ── Aksi pool: keluarkan / kembalikan material untuk satu ukuran ──────────

/** Konteks yang dibutuhkan setiap baris pool untuk mengubah pengecualian. */
interface PoolEdit {
  cycleId: string | null;
  /** `${ukuran}||${gramatur}||${supplier}` — sama dengan `groupKey` engine. */
  groupKey: string;
  /** Teks grup untuk disimpan sebagai label jejak audit. */
  groupLabel: string;
  canEdit: boolean;
  /** Pengecualian yang sudah ada di periode ini (untuk mencari id-nya). */
  exclusions: MaterialCalcExclusion[];
}

/**
 * Tombol per baris pool (`Stock As Of` / `Outstanding PO`).
 *
 * Permintaan user (2026-10-14): material yang sebenarnya TIDAK ikut perhitungan
 * ukuran ini — mis. ukurannya hanya kelipatan, atau materialnya sudah dipakai
 * ukuran lain — harus bisa DIKELUARKAN dari daftar ukuran ini saja. API langsung
 * menghitung ulang periode, jadi baris Stock As Of / Outstanding PO / End Ind
 * ikut berubah tanpa perlu klik "Hitung Ulang" lagi.
 *
 * Hak akses tulis: Admin, Super Admin, Material Planner (sama dengan API).
 */
function PoolRowActions({
  kind,
  poolRefs,
  poolLabel,
  excluded,
  reason,
  edit,
  totalQty = null,
  qtyUnit = 'kg',
  excludedQty = null,
}: {
  kind: MaterialPoolKind;
  /** Bisa lebih dari satu: satu nomor PO boleh berisi beberapa baris item. */
  poolRefs: string[];
  poolLabel: string;
  excluded?: boolean;
  reason?: string | null;
  edit: PoolEdit;
  /**
   * Total qty fisik baris ini (kg / lembar). Dipakai memvalidasi jumlah yang
   * dikeluarkan sebagian; `null` = baris gabungan, jumlah sebagian tidak dipakai.
   */
  totalQty?: number | null;
  /** Satuan `totalQty` — menentukan apakah jumlah sebagian dalam kg atau lembar. */
  qtyUnit?: PoolQtyUnit;
  /** Snapshot bagian yang dikeluarkan (dipakai kalau data pengecualian belum ada). */
  excludedQty?: number | null;
}) {
  const { t, lang } = useTranslation();
  const createExclusion = useCreatePoolExclusion();
  const deleteExclusion = useDeletePoolExclusion();
  const updateExclusion = useUpdatePoolExclusion();
  /** `exclude` = mengeluarkan material, `reason` = mengubah alasan/jumlah saja. */
  const [mode, setMode] = useState<'exclude' | 'reason' | null>(null);
  const [draft, setDraft] = useState(reason ?? '');
  const [draftQty, setDraftQty] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy =
    createExclusion.isPending || deleteExclusion.isPending || updateExclusion.isPending;

  /**
   * Hasil perhitungan LAMA belum mengirim `poolRef` (fitur ini baru 2026-10-14),
   * jadi ref kosong disaring dulu — kalau tidak, `null` terkirim sebagai string
   * "null" dan pengecualiannya tidak cocok dengan pool item mana pun.
   */
  const validRefs = poolRefs.filter((r) => typeof r === 'string' && r.trim().length > 0);

  const existing = edit.exclusions.filter(
    (e) => e.kind === kind && e.groupKey === edit.groupKey && validRefs.includes(e.poolRef),
  );
  const isExcluded = excluded || existing.length > 0;
  /** Alasan tersimpan TERBARU (dari tabel pengecualian, bukan snapshot). */
  const liveReason = existing.find((e) => e.reason)?.reason ?? reason ?? null;
  /** Jumlah yang dikeluarkan sebagian (dari tabel pengecualian, bukan snapshot). */
  const livePartial = existing.find((e) => (e.qty ?? 0) > 0) ?? null;
  const partialQty = livePartial?.qty ?? excludedQty ?? null;
  const partialUnit: PoolQtyUnit = livePartial
    ? livePartial.unit === 'sheet'
      ? 'sheet'
      : 'kg'
    : qtyUnit;

  /** Satu baris gabungan (beberapa pool item) tidak bisa dikeluarkan sebagian. */
  const canPartial = validRefs.length === 1 && totalQty !== null && totalQty > 0;
  const unitLabel = t(partialUnit === 'sheet' ? 'unit.sheets' : 'unit.kg');
  const partialText =
    partialQty && partialQty > 0
      ? t('materialCalc.poolEdit.partialBadge', {
          qty: formatNum(partialQty, partialUnit === 'sheet' ? 0 : 2, lang),
          unit: unitLabel,
        })
      : null;

  if (!edit.canEdit) {
    return isExcluded ? (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
          {t('materialCalc.poolEdit.excluded')}
        </span>
        {partialText && <span className="text-[10px] text-amber-700">{partialText}</span>}
      </span>
    ) : (
      <span className="text-gray-300">—</span>
    );
  }

  // Hasil perhitungan sebelum fitur ini ada: tidak punya identitas pool item.
  if (validRefs.length === 0) {
    return (
      <span className="text-[10px] text-gray-400" title={t('materialCalc.poolEdit.staleResult')}>
        {t('materialCalc.poolEdit.staleResult')}
      </span>
    );
  }

  /**
   * Baca isi kolom jumlah yang dikeluarkan.
   * Kosong / ≥ total = keluarkan SELURUHNYA (`null`), sama seperti perilaku lama.
   */
  const parseDraftQty = ():
    | { ok: true; qty: number | null }
    | { ok: false; tooLarge?: boolean } => {
    const raw = draftQty.trim();
    if (!raw) return { ok: true, qty: null };
    const parsed = Number(raw.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false };
    // Jumlah yang dikeluarkan tidak boleh melebihi qty baris ini (stok fisik /
    // qty PO). Sama dengan total = keluarkan seluruhnya.
    if (totalQty !== null && parsed > totalQty + 1e-9) return { ok: false, tooLarge: true };
    if (totalQty !== null && parsed >= totalQty - 1e-9) return { ok: true, qty: null };
    return { ok: true, qty: parsed };
  };

  const qtyErrorText = (tooLarge?: boolean) =>
    tooLarge
      ? t('materialCalc.poolEdit.qtyTooLarge', {
          max: formatNum(totalQty ?? 0, qtyUnit === 'sheet' ? 0 : 2, lang),
          unit: unitLabel,
        })
      : t('materialCalc.poolEdit.qtyInvalid');

  const doExclude = async () => {
    if (!edit.cycleId) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(t('materialCalc.poolEdit.reasonRequired'));
      return;
    }
    const parsedQty = parseDraftQty();
    if (!parsedQty.ok) {
      setError(qtyErrorText(parsedQty.tooLarge));
      return;
    }
    setError(null);
    try {
      await createExclusion.mutateAsync({
        cycleId: edit.cycleId,
        kind,
        groupKey: edit.groupKey,
        poolRefs: validRefs,
        groupLabel: edit.groupLabel,
        poolLabel,
        reason: trimmed,
        qty: parsedQty.qty,
        unit: parsedQty.qty === null ? null : qtyUnit,
      });
      setMode(null);
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  };

  const doUpdateReason = async () => {
    if (!edit.cycleId || existing.length === 0) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      setError(t('materialCalc.poolEdit.reasonRequired'));
      return;
    }
    const parsedQty = parseDraftQty();
    if (!parsedQty.ok) {
      setError(qtyErrorText(parsedQty.tooLarge));
      return;
    }
    setError(null);
    try {
      // Alasan saja TIDAK menghitung ulang; begitu jumlahnya berubah, API
      // menghitung ulang sendiri karena jatah pemakaian ukuran ini ikut berubah.
      for (const ex of existing) {
        await updateExclusion.mutateAsync({
          cycleId: edit.cycleId,
          exclusionId: ex.id,
          reason: trimmed,
          ...(canPartial || ex.qty !== null ? { qty: parsedQty.qty, unit: qtyUnit } : {}),
        });
      }
      setMode(null);
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  };

  const doRestore = async () => {
    if (!edit.cycleId || existing.length === 0) return;
    setError(null);
    try {
      await deleteExclusion.mutateAsync({
        cycleId: edit.cycleId,
        exclusionIds: existing.map((e) => e.id),
      });
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  };

  return (
    <div className="flex flex-col items-start gap-0.5">
      {isExcluded ? (
        <>
          <button
            type="button"
            onClick={() => void doRestore()}
            disabled={busy}
            title={t('materialCalc.poolEdit.restore')}
            className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {busy ? t('materialCalc.poolEdit.recalculating') : t('materialCalc.poolEdit.restore')}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(liveReason ?? '');
              setDraftQty(partialQty && partialQty > 0 ? String(partialQty) : '');
              setError(null);
              setMode('reason');
            }}
            disabled={busy}
            className="rounded px-1 py-0.5 text-[10px] font-medium text-indigo-600 hover:underline disabled:opacity-50"
          >
            {t('materialCalc.poolEdit.editReason')}
          </button>
          {liveReason && <span className="text-[10px] text-amber-700">{liveReason}</span>}
          {partialText && <span className="text-[10px] text-amber-700">{partialText}</span>}
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            setDraftQty('');
            setError(null);
            setMode('exclude');
          }}
          disabled={busy}
          className="rounded border px-1.5 py-0.5 text-[10px] font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
        >
          {t('materialCalc.poolEdit.exclude')}
        </button>
      )}
      {error && !mode && (
        <span className="text-[10px] text-red-600">
          {t('materialCalc.poolEdit.failed', { message: error })}
        </span>
      )}

      {mode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setMode(null)}
        >
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-5 py-3 text-sm font-semibold text-gray-900">
              {mode === 'exclude'
                ? t('materialCalc.poolEdit.excludeTitle')
                : t('materialCalc.poolEdit.editTitle')}
            </div>
            <div className="space-y-2 px-5 py-4 text-xs text-gray-700">
              <p className="font-mono text-[11px] text-gray-800">{poolLabel}</p>
              <p className="text-[11px] text-gray-500">{t('materialCalc.poolEdit.groupNote')}</p>
              {mode === 'exclude' && (
                <p className="rounded bg-indigo-50 px-2 py-1.5 text-[11px] text-indigo-800">
                  {t('materialCalc.poolEdit.excludeHint')}
                </p>
              )}
              {canPartial ? (
                <div>
                  <label className="block text-[11px] font-medium text-gray-700">
                    {t('materialCalc.poolEdit.qty', { unit: unitLabel })}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={totalQty ?? undefined}
                    step="any"
                    value={draftQty}
                    onChange={(e) => {
                      setDraftQty(e.target.value);
                      setError(null);
                    }}
                    placeholder={t('materialCalc.poolEdit.qtyPlaceholder', {
                      total: formatNum(totalQty ?? 0, qtyUnit === 'sheet' ? 0 : 2, lang),
                      unit: unitLabel,
                    })}
                    className="w-full rounded-md border px-2 py-1.5 text-xs"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">
                    {t('materialCalc.poolEdit.qtyHint', {
                      total: formatNum(totalQty ?? 0, qtyUnit === 'sheet' ? 0 : 2, lang),
                      unit: unitLabel,
                    })}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-gray-600">
                    {t('materialCalc.poolEdit.qtyMax', {
                      max: formatNum(totalQty ?? 0, qtyUnit === 'sheet' ? 0 : 2, lang),
                      unit: unitLabel,
                    })}
                  </p>
                </div>
              ) : (
                <p className="rounded bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">
                  {t('materialCalc.poolEdit.multiRefNote')}
                </p>
              )}
              <label className="block text-[11px] font-medium text-gray-700">
                {t('materialCalc.poolEdit.reason')}
              </label>
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
                rows={2}
                placeholder={t('materialCalc.poolEdit.reasonPlaceholder')}
                className="w-full rounded-md border px-2 py-1.5 text-xs"
              />
              {error && <p className="text-[11px] text-red-600">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t px-5 py-3">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="rounded-md border px-3 py-1.5 text-xs text-gray-700"
              >
                {t('materialCalc.poolEdit.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void (mode === 'exclude' ? doExclude() : doUpdateReason())}
                disabled={busy}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                {busy ? t('materialCalc.poolEdit.recalculating') : t('materialCalc.poolEdit.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Rincian stok (dropdown baris `Stock As Of`) ───────────────────────────

/** Label bentuk fisik lot stok. Key literal supaya pemeriksa i18n tetap jalan. */
const STOCK_FORM_KEY: Record<StockForm, string> = {
  roll: 'materialCalc.stockDetail.formRoll',
  sheet: 'materialCalc.stockDetail.formSheet',
  mixed: 'materialCalc.stockDetail.formMixed',
  unknown: 'materialCalc.stockDetail.formUnknown',
};

/** "5.000 lbr · 2.422 kg" — hanya satuan yang ada isinya yang ditampilkan. */
function stockQtyText(kg: number, sheet: number, lang: Lang): string {
  const parts: string[] = [];
  if (Math.abs(sheet) > 1e-9) parts.push(`${formatNum(sheet, 0, lang)} ${translate(lang, 'unit.sheets')}`);
  if (Math.abs(kg) > 1e-9) parts.push(`${formatNum(kg, 2, lang)} ${translate(lang, 'unit.kg')}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/**
 * Rincian lot stok yang ukurannya cocok dengan grup ini.
 *
 * Kalau lot itu ukurannya **KELIPATAN** ukuran grup (mis. kertas 117 × 92 cm
 * untuk ukuran 58,5 × 92 cm), jumlah pada baris `Stock As Of` memakai angka
 * setara (5.000 lbr → 10.000 lbr), sedangkan kolom "Stok fisik" tetap
 * menampilkan jumlah asli pembelian. Keterangannya ditulis di kolom terakhir.
 */
function StockDetailPanel({
  details,
  maxMultiplier,
  edit,
}: {
  details: StockDetail[];
  maxMultiplier: number;
  edit: PoolEdit;
}) {
  const { t, lang } = useTranslation();
  /** Alasan dari data pengecualian TERBARU (snapshot lama belum punya). */
  const reasonOf = (poolRef: string, fallback?: string | null) =>
    edit.exclusions.find((e) => e.kind === 'STOCK' && e.groupKey === edit.groupKey && e.poolRef === poolRef)
      ?.reason ?? fallback ?? null;
  return (
    <div className="rounded-md border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-1.5">
        <span className="text-[11px] font-semibold text-gray-600">{t('materialCalc.stockDetail.title')}</span>
        {maxMultiplier > 1 && (
          <span className="text-[10px] text-amber-700">
            {t('materialCalc.stockDetail.multiplierHint', { multiplier: formatNum(maxMultiplier, 0, lang) })}
          </span>
        )}
      </div>
      {details.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-gray-500">{t('materialCalc.stockDetail.empty')}</div>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-gray-500">
            <tr>
              <th className="px-3 py-1 text-left font-medium">{t('materialCalc.stockDetail.desc')}</th>
              <th className="px-3 py-1 text-left font-medium">{t('materialCalc.stockDetail.supplier')}</th>
              <th className="px-3 py-1 text-left font-medium">{t('materialCalc.stockDetail.form')}</th>
              <th className="px-3 py-1 text-right font-medium">{t('materialCalc.stockDetail.total')}</th>
              <th className="px-3 py-1 text-right font-medium">{t('materialCalc.stockDetail.equivalent')}</th>
              <th className="px-3 py-1 text-right font-medium">{t('materialCalc.stockDetail.excluded')}</th>
              <th className="px-3 py-1 text-right font-medium">{t('materialCalc.stockDetail.allocated')}</th>
              <th className="px-3 py-1 text-right font-medium" title={t('materialCalc.stockDetail.wasteHint')}>
                {t('materialCalc.stockDetail.waste')}
              </th>
              <th className="px-3 py-1 text-left font-medium">{t('materialCalc.stockDetail.note')}</th>
              <th className="px-3 py-1 text-left font-medium">{t('materialCalc.poolEdit.action')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {details.map((d) => (
              <tr key={`${d.desc}||${d.supplier}`} className={d.excluded ? 'bg-amber-50/50' : undefined}>
                <td className="px-3 py-1 font-mono text-gray-800">{d.desc}</td>
                <td className="px-3 py-1 text-gray-600">{d.supplier || '—'}</td>
                <td className="px-3 py-1 text-gray-600">{t(STOCK_FORM_KEY[d.form] ?? STOCK_FORM_KEY.unknown)}</td>
                <td className="px-3 py-1 text-right text-gray-700">{stockQtyText(d.totalKg, d.totalSheet, lang)}</td>
                <td className="px-3 py-1 text-right text-gray-700">
                  {formatNum(d.equivalentSheet, 0, lang)} {t('unit.sheets')}
                </td>
                <td className="px-3 py-1 text-right text-amber-700">
                  {d.excluded
                    ? t('materialCalc.stockDetail.excludedAll')
                    : d.excludedKg > 0 || d.excludedSheet > 0
                      ? stockQtyText(d.excludedKg, d.excludedSheet, lang)
                      : '—'}
                </td>
                <td className="px-3 py-1 text-right font-medium text-gray-800">
                  {stockQtyText(d.allocatedKg, d.allocatedSheet, lang)}
                </td>
                <td className="px-3 py-1 text-right whitespace-nowrap">
                  {d.wasteKg && d.wasteKg > 0 ? (
                    <>
                      <span className="text-amber-700">{formatNum(d.wasteKg, 2, lang)} kg</span>
                      <div className="text-[10px] text-gray-500">
                        {formatNum((d.wastePct ?? 0) * 100, 2, lang)}%
                        {d.trimWidthCm ? ` · +${formatNum(d.trimWidthCm, 1, lang)} cm` : ''}
                      </div>
                    </>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-1 text-gray-600">
                  {d.multiplier > 1
                    ? d.totalSheet > 0
                      ? t('materialCalc.stockDetail.multiplied', {
                          width: formatNum(d.sourceWidth, 1, lang),
                          length: formatNum(d.sourceLength, 1, lang),
                          sheet: formatNum(d.totalSheet, 0, lang),
                          equivalent: formatNum(d.equivalentSheet, 0, lang),
                          multiplier: formatNum(d.multiplier, 0, lang),
                        })
                      : t('materialCalc.stockDetail.multipliedRoll', {
                          width: formatNum(d.sourceWidth, 1, lang),
                          kg: formatNum(d.totalKg, 2, lang),
                          equivalent: formatNum(d.equivalentSheet, 0, lang),
                          multiplier: formatNum(d.multiplier, 0, lang),
                        })
                    : t('materialCalc.stockDetail.same')}
                </td>
                <td className="px-3 py-1 align-top">
                  <PoolRowActions
                    kind="STOCK"
                    poolRefs={[d.poolRef ?? `${d.desc}||${d.supplier}`]}
                    poolLabel={`${d.desc} · ${d.supplier || '—'}`}
                    excluded={d.excluded}
                    reason={reasonOf(d.poolRef, d.exclusionReason)}
                    edit={edit}
                    // Lot bersatuan lembar dihitung dalam lembar, sisanya (gulungan
                    // kg/ton & campuran) dalam kg — sama seperti kolom "Stok fisik".
                    totalQty={d.form === 'sheet' ? d.totalSheet : d.totalKg}
                    qtyUnit={d.form === 'sheet' ? 'sheet' : 'kg'}
                    excludedQty={d.excludedKg > 0 ? d.excludedKg : d.excludedSheet || null}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          {(() => {
            const allocated = details.reduce((s, d) => s + (d.excluded ? 0 : d.allocatedKg || 0), 0);
            const waste = details.reduce((s, d) => s + (d.excluded ? 0 : d.wasteKg || 0), 0);
            if (waste <= 0) return null;
            return (
              <tfoot className="bg-amber-50/60">
                <tr>
                  <td colSpan={6} className="px-3 py-1 text-[11px] font-semibold text-amber-900">
                    {t('materialCalc.stockDetail.wasteTotal')}
                  </td>
                  <td className="px-3 py-1 text-right text-[11px] font-medium text-gray-800">
                    {formatNum(allocated, 2, lang)} kg
                  </td>
                  <td className="px-3 py-1 text-right text-[11px] font-semibold text-amber-800 whitespace-nowrap">
                    {formatNum(waste, 2, lang)} kg
                    <div className="text-[10px] font-normal text-gray-500">
                      {allocated + waste > 0
                        ? formatNum((waste / (allocated + waste)) * 100, 2, lang)
                        : '0'}
                      %
                    </div>
                  </td>
                  <td colSpan={2} className="px-3 py-1 text-[10px] text-gray-500">
                    {t('materialCalc.stockDetail.wasteHint')}
                  </td>
                </tr>
              </tfoot>
            );
          })()}
        </table>
        </div>
      )}
    </div>
  );
}

/**
 * Baris rincian PO, sudah digabung PER NOMOR PO.
 *
 * Satu nomor PO boleh mencakup beberapa item/baris Excel (satu PO bisa berisi
 * beberapa ukuran), jadi kolam PO memuat nomor yang sama beberapa kali. Supaya
 * rincian benar-benar "per nomor PO", baris-baris itu dijumlahkan dan nomor PO
 * tanpa nomor (null) dikelompokkan per deskripsi + supplier.
 */
interface PoDetailRow {
  key: string;
  poNumber: string | null;
  itemDescs: string[];
  supplier: string;
  /** Semua pool item yang diwakili baris ini (satu PO bisa berisi banyak item). */
  poolRefs: string[];
  /** true = ada pool item di baris ini yang dikeluarkan dari ukuran ini. */
  excluded: boolean;
  exclusionReason: string | null;
  /** Minggu kedatangan paling awal (0-based). */
  weekIndex: number;
  planReceivedDate: string | null;
  units: string[];
  qtyKg: number;
  qtySheet: number;
  /** Bagian yang DIKELUARKAN sebagian dari ukuran ini (satuan fisik PO). */
  excludedKg: number;
  excludedSheet: number;
  allocatedKg: number;
  allocatedSheet: number;
  remainingKg: number;
  remainingSheet: number;
  /** Waste dari bagian PO yang terpakai grup ini (kg) — INFORMASI. */
  wasteKg: number;
  /** Kg material PO terpakai (= penyebut persentase). */
  wasteBaseKg: number;
  /** Kelebihan lebar per potong (cm). */
  trimWidthCm: number;
}

function buildPoDetailRows(byWeek: OutstandingPoDetail[][]): PoDetailRow[] {
  const map = new Map<string, PoDetailRow>();
  for (const rows of byWeek) {
    for (const d of rows) {
      const key = d.poNumber
        ? `po|${d.poNumber}`
        : `item|${d.itemDesc}||${d.supplier}||${d.weekIndex}`;
      let row = map.get(key);
      if (!row) {
        row = {
          key,
          poNumber: d.poNumber ?? null,
          itemDescs: [],
          supplier: d.supplier,
          poolRefs: [],
          excluded: false,
          exclusionReason: null,
          weekIndex: d.weekIndex,
          planReceivedDate: d.planReceivedDate,
          units: [],
          qtyKg: 0,
          qtySheet: 0,
          excludedKg: 0,
          excludedSheet: 0,
          allocatedKg: 0,
          allocatedSheet: 0,
          remainingKg: 0,
          remainingSheet: 0,
          wasteKg: 0,
          wasteBaseKg: 0,
          trimWidthCm: 0,
        };
        map.set(key, row);
      }
      if (d.itemDesc && !row.itemDescs.includes(d.itemDesc)) row.itemDescs.push(d.itemDesc);
      if (d.unit && !row.units.includes(d.unit)) row.units.push(d.unit);
      if (d.poolRef && !row.poolRefs.includes(d.poolRef)) row.poolRefs.push(d.poolRef);
      if (d.excluded) {
        row.excluded = true;
        if (!row.exclusionReason && d.exclusionReason) row.exclusionReason = d.exclusionReason;
      }
      if (d.weekIndex < row.weekIndex) row.weekIndex = d.weekIndex;
      if (!row.planReceivedDate && d.planReceivedDate) row.planReceivedDate = d.planReceivedDate;
      row.qtyKg += d.qtyKg;
      row.qtySheet += d.qtySheet;
      row.excludedKg += d.excludedKg ?? 0;
      row.excludedSheet += d.excludedSheet ?? 0;
      row.allocatedKg += d.allocatedKg;
      row.allocatedSheet += d.allocatedSheet;
      row.remainingKg += d.remainingKg;
      row.remainingSheet += d.remainingSheet;
      row.wasteKg += d.wasteKg ?? 0;
      row.wasteBaseKg += d.wasteBaseKg ?? 0;
      row.trimWidthCm = Math.max(row.trimWidthCm, d.trimWidthCm ?? 0);
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      a.weekIndex - b.weekIndex ||
      (a.poNumber ?? '').localeCompare(b.poNumber ?? '') ||
      (a.itemDescs[0] ?? '').localeCompare(b.itemDescs[0] ?? ''),
  );
}

/**
 * Rincian Outstanding PO per **nomor PO** (dropdown baris `Outstanding PO`).
 * Kolom "Qty PO" sengaja menampilkan angka Master Data apa adanya
 * (qtyOrder − qtyDelivered) supaya PO yang sudah terpakai perhitungan tidak
 * hilang dari layar; kolom "Terpakai" yang menunjukkan bagian grup ini.
 */
function PoDetailPanel({
  rows,
  weekLabels,
  edit,
}: {
  rows: PoDetailRow[];
  weekLabels: string[];
  edit: PoolEdit;
}) {
  const { t, lang } = useTranslation();
  /** Alasan dari data pengecualian TERBARU (snapshot lama belum punya). */
  const reasonOf = (poolRefs: string[], fallback: string | null) =>
    edit.exclusions.find(
      (e) => e.kind === 'PO' && e.groupKey === edit.groupKey && poolRefs.includes(e.poolRef),
    )?.reason ?? fallback;
  return (
    <div className="rounded-md border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-1.5">
        <span className="text-[11px] font-semibold text-gray-600">{t('materialCalc.poDetail.title')}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-gray-500">{t('materialCalc.poDetail.empty')}</div>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-gray-500">
            <tr>
              <th className="px-3 py-1 text-left font-medium">{t('materialCalc.poDetail.poNumber')}</th>
              <th className="px-3 py-1 text-left font-medium">{t('materialCalc.poDetail.desc')}</th>
              <th className="px-3 py-1 text-left font-medium">{t('materialCalc.poDetail.supplier')}</th>
              <th className="px-3 py-1 text-left font-medium">{t('materialCalc.poDetail.arrival')}</th>
              <th className="px-3 py-1 text-right font-medium">{t('materialCalc.poDetail.qty')}</th>
              <th className="px-3 py-1 text-right font-medium">{t('materialCalc.poDetail.excluded')}</th>
              <th className="px-3 py-1 text-right font-medium">{t('materialCalc.poDetail.allocated')}</th>
              <th className="px-3 py-1 text-right font-medium" title={t('materialCalc.poDetail.wasteHint')}>
                {t('materialCalc.poDetail.waste')}
              </th>
              <th className="px-3 py-1 text-right font-medium">{t('materialCalc.poDetail.remaining')}</th>
              <th className="px-3 py-1 text-left font-medium">{t('materialCalc.poolEdit.action')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.key} className={r.excluded ? 'bg-amber-50/50' : undefined}>
                <td className="px-3 py-1 font-mono text-indigo-700">
                  {r.poNumber ?? <span className="text-gray-400">{t('materialCalc.poDetail.noPoNumber')}</span>}
                </td>
                <td className="px-3 py-1 text-gray-800">
                  {r.itemDescs.length > 0 ? r.itemDescs.join(', ') : '—'}
                  {r.units.length > 0 && (
                    <span className="ml-1 text-[10px] text-gray-400">({r.units.join(' / ')})</span>
                  )}
                </td>
                <td className="px-3 py-1 text-gray-600">{r.supplier || '—'}</td>
                <td className="px-3 py-1 text-gray-700">
                  {r.planReceivedDate
                    ? formatWeekDate(r.planReceivedDate, lang)
                    : t('materialCalc.poDetail.noArrival')}
                  <div className="text-[10px] text-gray-400">
                    {t('materialCalc.poDetail.week', { week: formatNum(r.weekIndex + 1, 0, lang) })}
                    {weekLabels[r.weekIndex] ? ` · ${weekLabels[r.weekIndex]}` : ''}
                  </div>
                </td>
                <td className="px-3 py-1 text-right text-gray-700">{stockQtyText(r.qtyKg, r.qtySheet, lang)}</td>
                <td className="px-3 py-1 text-right text-amber-700">
                  {r.excluded
                    ? t('materialCalc.poDetail.excludedAll')
                    : r.excludedKg > 0 || r.excludedSheet > 0
                      ? stockQtyText(r.excludedKg, r.excludedSheet, lang)
                      : '—'}
                </td>
                <td className="px-3 py-1 text-right font-medium text-gray-800">
                  {stockQtyText(r.allocatedKg, r.allocatedSheet, lang)}
                </td>
                <td className="px-3 py-1 text-right whitespace-nowrap">
                  {r.wasteKg > 0 ? (
                    <>
                      <span className="text-amber-700">{formatNum(r.wasteKg, 2, lang)} kg</span>
                      <div className="text-[10px] text-gray-500">
                        {r.wasteBaseKg + r.wasteKg > 0
                          ? formatNum((r.wasteKg / (r.wasteBaseKg + r.wasteKg)) * 100, 2, lang)
                          : '0'}
                        %
                        {r.trimWidthCm > 0 ? ` · +${formatNum(r.trimWidthCm, 1, lang)} cm` : ''}
                      </div>
                    </>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-1 text-right text-gray-700">
                  {stockQtyText(r.remainingKg, r.remainingSheet, lang)}
                </td>
                <td className="px-3 py-1 align-top">
                  <PoolRowActions
                    kind="PO"
                    poolRefs={r.poolRefs}
                    poolLabel={`${r.poNumber ?? '—'} · ${r.itemDescs.join(', ') || r.supplier}`}
                    excluded={r.excluded}
                    reason={reasonOf(r.poolRefs, r.exclusionReason)}
                    edit={edit}
                    // Baris gabungan (satu nomor PO berisi beberapa baris item)
                    // tidak punya satu total yang bisa dikeluarkan sebagian.
                    totalQty={r.poolRefs.length === 1 ? (r.qtyKg > 0 ? r.qtyKg : r.qtySheet) : null}
                    qtyUnit={r.qtyKg > 0 ? 'kg' : 'sheet'}
                    excludedQty={r.excludedKg > 0 ? r.excludedKg : r.excludedSheet || null}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

// ── Tabel mingguan 26 kolom (sesuai Gambar 3) ─────────────────────────────
function WeeklyMatrixTable({ matrix, edit }: { matrix: WeeklyMatrix; edit: PoolEdit }) {
  const { t, lang } = useTranslation();
  const width = matrix.columns.length;
  const { summary } = matrix;
  /** Buka/tutup rincian lot stok di bawah baris `Stock As Of`. */
  const [showStockDetail, setShowStockDetail] = useState(false);
  const stockDetails = summary.stockDetails ?? [];
  const maxMultiplier = stockDetails.reduce((max, d) => Math.max(max, d.multiplier || 1), 1);
  /** Buka/tutup rincian PO di bawah baris `Outstanding PO`. */
  const [showPoDetail, setShowPoDetail] = useState(false);
  /**
   * Hasil perhitungan LAMA (sebelum 2026-10-13) tidak punya field
   * `outstandingPoDetails`. Bedakan "tidak ada rincian" dari "memang tidak ada
   * PO yang cocok" supaya hasil lama tidak menulis "PO tidak cocok" palsu.
   */
  const hasPoDetails = summary.outstandingPoDetails !== undefined;
  const poDetailRows = useMemo(
    () => buildPoDetailRows(summary.outstandingPoDetails ?? []),
    [summary.outstandingPoDetails],
  );
  const weekLabels = useMemo(
    () => matrix.columns.map((c) => formatDayMonth(c.weekStartDate, lang)),
    [matrix.columns, lang],
  );
  /**
   * Kg/Lbr grup, diambil dari kolom **Kg/Lbr** baris pertama yang punya formula
   * material. Semua keterangan kg di bawah = nilai lbr × angka ini.
   */
  const groupFm = matrix.rows.find((r) => r.hasKg)?.kgPerSheet ?? 0;
  const hasGroupKg = groupFm > 0;

  /** Baris ringkasan yang mengikuti pola yang sama untuk semua bagian. */
  const summaryRows: {
    key: 'totalReq' | 'allowance' | 'totalPlusAllowance';
    sheet: number[];
    strong?: boolean;
  }[] = [
    { key: 'totalReq', sheet: summary.totalReqSheet, strong: true },
    { key: 'allowance', sheet: summary.allowanceSheet },
    { key: 'totalPlusAllowance', sheet: summary.totalPlusAllowanceSheet, strong: true },
  ];

  return (
    <div className="overflow-x-auto border-t border-gray-200">
      <table className="text-xs border-collapse">
        <thead className="bg-gray-100 text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-gray-100 z-10 min-w-[150px]">
              Part Number
            </th>
            <th className="px-3 py-2 text-left font-semibold min-w-[160px]">{t('common.description')}</th>
            <th className="px-2 py-2 text-left font-semibold">GSM</th>
            <th className="px-2 py-2 text-right font-semibold">Width</th>
            <th className="px-2 py-2 text-right font-semibold">Length</th>
            <th className="px-2 py-2 text-right font-semibold">Up</th>
            <th className="px-2 py-2 text-right font-semibold">{t('materialCalc.matrix.kgPerSheet')}</th>
            {matrix.columns.map((col) => (
              <th key={col.weekNumber} className="px-2 py-2 text-right font-semibold min-w-[74px]">
                <div className="text-[11px] font-medium text-gray-600">{formatDayMonth(col.weekStartDate, lang)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {matrix.rows.map((row) => (
            <tr key={row.partNumber} className="hover:bg-gray-50">
              <td className="px-3 py-1.5 font-medium text-gray-900 sticky left-0 bg-white z-10">{row.partNumber}</td>
              <td className="px-3 py-1.5 text-gray-600">{row.productName}</td>
              <td className="px-2 py-1.5 text-gray-700">{row.gsm}</td>
              <td className="px-2 py-1.5 text-right text-gray-700">{row.width ?? '—'}</td>
              <td className="px-2 py-1.5 text-right text-gray-700">{row.length ?? '—'}</td>
              <td className="px-2 py-1.5 text-right text-gray-700">{formatNum(row.up, 0, lang)}</td>
              <td className="px-2 py-1.5 text-right text-gray-700">{row.hasKg ? formatNum(row.kgPerSheet, 4, lang) : '—'}</td>
              {Array.from({ length: width }).map((_, i) => (
                <UnitCell key={i} sheet={row.weeksSheet[i]} kg={row.weeks[i]} hasKg={row.hasKg} />
              ))}
            </tr>
          ))}

          {summaryRows.map((r) => (
            <tr key={r.key} className={r.strong ? 'bg-indigo-50/40 font-semibold' : 'bg-gray-50/60'}>
              <td className="px-3 py-1.5 text-gray-700 sticky left-0 bg-inherit z-10" colSpan={7}>
                {t(`materialCalc.matrix.${r.key}`)}
                {r.key === 'totalReq' && <span className="ml-2 text-[10px] font-normal text-amber-600">{t('materialCalc.matrix.partiallyEstimated')}</span>}
              </td>
              {Array.from({ length: width }).map((_, i) => {
                const showKg = r.key === 'totalPlusAllowance';
                return (
                  <UnitCell
                    key={i}
                    sheet={r.sheet[i]}
                    kg={showKg ? (r.sheet[i] ?? 0) * groupFm : undefined}
                    hasKg={hasGroupKg}
                    showKg={showKg}
                  />
                );
              })}
            </tr>
          ))}

          <tr className="bg-gray-50/60">
            <td className="px-3 py-1.5 text-gray-700 sticky left-0 bg-inherit z-10" colSpan={7}>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowStockDetail((v) => !v)}
                  className="flex items-center gap-1 text-left font-medium hover:text-indigo-700"
                  title={t('materialCalc.stockDetail.title')}
                >
                  {t('materialCalc.matrix.stockAsOf')}
                  {stockDetails.length > 0 ? (
                    <>
                      <span className="text-[10px] font-normal text-indigo-600">
                        {t('materialCalc.stockDetail.toggle', { count: formatNum(stockDetails.length, 0, lang) })}
                      </span>
                      {showStockDetail ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </>
                  ) : (
                    <span className="text-[10px] font-normal text-gray-400">
                      {t('materialCalc.stockDetail.empty')}
                    </span>
                  )}
                </button>
                {(summary.stockWasteKg ?? 0) > 0 && (
                  <span
                    className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                    title={t('materialCalc.stockDetail.wasteHint')}
                  >
                    {t('materialCalc.stockDetail.wasteBadge', {
                      kg: formatNum(summary.stockWasteKg, 2, lang),
                      pct: formatNum((summary.stockWastePct ?? 0) * 100, 2, lang),
                    })}
                  </span>
                )}
              </div>
            </td>
            <UnitCell sheet={summary.stockAsOfSheet} kg={summary.stockAsOfSheet * groupFm} hasKg={hasGroupKg} showKg />
            {Array.from({ length: Math.max(0, width - 1) }).map((_, i) => (
              <td key={i} className="px-2 py-1.5 text-right text-gray-300">
                —
              </td>
            ))}
          </tr>

          {showStockDetail && stockDetails.length > 0 && (
            <tr className="bg-gray-50/40">
              <td colSpan={7 + width} className="px-3 py-2">
                <StockDetailPanel details={stockDetails} maxMultiplier={maxMultiplier} edit={edit} />
              </td>
            </tr>
          )}

          <tr className="bg-gray-50/60">
            <td className="px-3 py-1.5 text-gray-700 sticky left-0 bg-inherit z-10" colSpan={7}>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPoDetail((v) => !v)}
                  className="flex items-center gap-1 text-left font-medium hover:text-indigo-700"
                  title={t('materialCalc.poDetail.title')}
                >
                  {t('materialCalc.matrix.outstandingPo')}
                  {poDetailRows.length > 0 ? (
                    <>
                      <span className="text-[10px] font-normal text-indigo-600">
                        {t('materialCalc.poDetail.toggle', { count: formatNum(poDetailRows.length, 0, lang) })}
                      </span>
                      {showPoDetail ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </>
                  ) : hasPoDetails ? (
                    <span className="text-[10px] font-normal text-gray-400">
                      {t('materialCalc.poDetail.empty')}
                    </span>
                  ) : null}
                </button>
                {(summary.poWasteKg ?? 0) > 0 && (
                  <span
                    className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                    title={t('materialCalc.poDetail.wasteHint')}
                  >
                    {t('materialCalc.poDetail.wasteBadge', {
                      kg: formatNum(summary.poWasteKg, 2, lang),
                      pct: formatNum((summary.poWastePct ?? 0) * 100, 2, lang),
                    })}
                  </span>
                )}
              </div>
            </td>
            {Array.from({ length: width }).map((_, i) => (
              <UnitCell
                key={i}
                sheet={summary.outstandingPoSheet[i]}
                kg={(summary.outstandingPoSheet[i] ?? 0) * groupFm}
                hasKg={hasGroupKg}
                showKg
                poNumbers={summary.outstandingPoNumbers?.[i]}
              />
            ))}
          </tr>

          {showPoDetail && poDetailRows.length > 0 && (
            <tr className="bg-gray-50/40">
              <td colSpan={7 + width} className="px-3 py-2">
                <PoDetailPanel rows={poDetailRows} weekLabels={weekLabels} edit={edit} />
              </td>
            </tr>
          )}

          <tr className="bg-gray-100/70 font-semibold">
            <td className="px-3 py-1.5 text-gray-800 sticky left-0 bg-inherit z-10" colSpan={7}>
              {t('materialCalc.matrix.endInd')}
            </td>
            {Array.from({ length: width }).map((_, i) => (
              <UnitCell
                key={i}
                sheet={summary.endIndSheet[i]}
                kg={(summary.endIndSheet[i] ?? 0) * groupFm}
                hasKg={hasGroupKg}
                showKg
              />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Tabel rincian angka per part ──────────────────────────────────────────

function DetailTable({ details }: { details: PartNumberDetail[] }) {
  const { t, lang } = useTranslation();
  return (
    <div className="overflow-x-auto border-t border-gray-200">
      <table className="w-full text-xs">
        <thead className="bg-gray-100 text-gray-600 uppercase">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Part Number</th>
            <th className="px-3 py-2 text-right font-semibold">{t('materialCalc.detail.demandPcs')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('materialCalc.detail.netReq')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('materialCalc.detail.allocatedStock')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('materialCalc.detail.sheetsBuy')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('materialCalc.detail.pcsBuy')}</th>
            <th className="px-3 py-2 text-right font-semibold">{t('materialCalc.detail.kgBuy')}</th>
            <th className="px-3 py-2 text-center font-semibold">{t('common.status')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {details.map((d) => (
            <tr key={d.partNumber} className="hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-900">
                <div className="flex items-center gap-1">
                  {d.noNpofData && (
                    <span title={t('materialCalc.detail.noNpofTooltip')}>
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    </span>
                  )}
                  {d.partNumber}
                </div>
              </td>
              <td className="px-3 py-2 text-right text-gray-700">{formatNum(d.demandPcs, 0, lang)}</td>
              <td className="px-3 py-2 text-right text-gray-700">{formatNum(d.sheetsNet2, 0, lang)}</td>
              <td className="px-3 py-2 text-right text-gray-700">{formatNum(d.allocatedKg, 2, lang)}</td>
              {d.isSufficient ? (
                <>
                  <td className="px-3 py-2 text-center text-gray-400">—</td>
                  <td className="px-3 py-2 text-center text-gray-400">—</td>
                  <td className="px-3 py-2 text-center text-gray-400">—</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      <CheckCircle className="w-3 h-3" />
                      {t('materialCalc.detail.remainingKg', { value: formatNum(d.surplusKg, 2, lang) })}
                    </span>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2 text-right font-bold text-red-600">{formatNum(d.shortageSheet, 0, lang)}</td>
                  <td className="px-3 py-2 text-right font-bold text-red-600">{formatNum(d.shortagePcs, 0, lang)}</td>
                  <td className="px-3 py-2 text-right font-bold text-red-600">{formatNum(d.shortageKg, 2, lang)}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                      {t('materialCalc.detail.statusShort')}
                    </span>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Baris grup: klik untuk membuka tabel mingguan ─────────────────────────

/**
 * Key unik satu ukuran (grup) untuk pilihan export PDF. Memakai `groupKey` dari
 * engine bila ada supaya pilihan tetap stabil, dengan fallback yang sama seperti
 * di `MaterialCalc`.
 */
function sizeSelectionKey(group: MaterialGroup): string {
  return `${group.ukuran}||${group.gramatur || ''}||${group.supplier || ''}`;
}

/** Checkbox "pilih semua" dengan status indeterminate untuk pilihan sebagian. */
function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
  title,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  title: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      title={title}
      aria-label={title}
      className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-2 focus:ring-indigo-400"
    />
  );
}

function GroupRow({
  group,
  cycleId,
  canEdit,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  group: MaterialGroup;
  cycleId: string | null;
  /** true = boleh mengeluarkan / mengembalikan material (Admin / Material Planner). */
  canEdit: boolean;
  /** true = baris bisa dicentang untuk export PDF. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { t, lang } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'matrix' | 'detail' | 'recommend'>('matrix');
  const planningTimeline = group.planningTimeline || getFallbackTimeline(group.leadTimeMonths);
  const estimatedInGroup = group.details.filter((d) => d.noNpofData).length;

  /**
   * Kunci grup HARUS sama dengan `groupKeyOf()` di materialCalcEngine.ts.
   * Hasil perhitungan lama belum mengirim `groupKey`, jadi disusun di sini.
   */
  const groupKey = group.groupKey ?? `${group.ukuran}||${group.gramatur}||${group.supplier}`;
  const { data: exclusionsData } = useCycleExclusions(cycleId, canEdit);
  const poolEdit: PoolEdit = {
    cycleId,
    groupKey,
    groupLabel: `${group.ukuran} · ${group.gramatur || '—'} · ${group.supplier}`,
    canEdit,
    exclusions: exclusionsData?.data ?? [],
  };

  return (
    <>
      <tr
        className={`cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-200 ${
          expanded ? 'bg-indigo-50/30' : ''
        }`}
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-3 py-3 text-gray-400">
          <div className="flex items-center gap-2">
            {selectable && (
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                onClick={(e) => e.stopPropagation()}
                title={t('materialCalc.export.selectSize')}
                aria-label={t('materialCalc.export.selectSize')}
                className="h-3.5 w-3.5 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-2 focus:ring-indigo-400"
              />
            )}
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </div>
        </td>
        <td className="px-4 py-3 font-medium text-gray-900">
          <div>{group.ukuran}</div>
          {estimatedInGroup > 0 && (
            <div className="text-[11px] font-normal text-amber-600">
              {t('materialCalc.group.partsIncomplete', {
                estimated: formatNum(estimatedInGroup, 0, lang),
                total: formatNum(group.details.length, 0, lang),
              })}
            </div>
          )}
          {group.sizeRecommendation?.best && group.sizeRecommendation.best.wastePctPerSheet > 0.0005 && (
            <div
              className="text-[11px] font-normal text-gray-500"
              title={t('materialCalc.recommendation.rowBadgeTitle', {
                size: group.sizeRecommendation.best.size,
              })}
            >
              {t('materialCalc.recommendation.rowBadge', {
                value: formatNum(group.sizeRecommendation.best.wastePctPerSheet * 100, 1, lang),
              })}
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-gray-700">{group.gramatur || '—'}</td>
        <td className="px-4 py-3 text-gray-700">{group.supplier}</td>
        <td className="px-4 py-3 text-center">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
            {group.leadTimeMonths} {t('unit.months')}
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-gray-600">
          <div>
            {t('materialCalc.group.buy')}{' '}
            <span className="font-medium text-gray-800">{formatMonth(planningTimeline.purchaseMonth, lang)}</span>
          </div>
          <div>
            {t('materialCalc.group.arrive')}{' '}
            <span className="font-medium text-gray-800">{formatMonth(planningTimeline.arrivalMonth, lang)}</span>
          </div>
          <div>
            {t('materialCalc.group.use')}{' '}
            <span className="font-medium text-gray-800">{formatMonth(planningTimeline.usageMonth, lang)}</span>
          </div>
        </td>
        {group.isSufficient ? (
          <>
            <td className="px-4 py-3 text-center text-gray-400">—</td>
            <td className="px-4 py-3 text-center text-gray-400">—</td>
            <td className="px-4 py-3">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                <CheckCircle className="w-3.5 h-3.5" />
                {t('materialCalc.group.sufficientSurplus', { value: formatNum(group.surplusKg, 2, lang) })}
              </span>
            </td>
          </>
        ) : (
          <>
            <td className="px-4 py-3 text-right font-bold text-red-600">
              {formatNum(group.totalShortageSheet, 0, lang)} {t('unit.sheets')}
            </td>
            <td className="px-4 py-3 text-right font-bold text-red-600">
              {formatNum(group.totalShortageKg, 2, lang)} {t('unit.kg')}
            </td>
            <td className="px-4 py-3">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                {t('materialCalc.group.shortageKg', { value: formatNum(group.totalShortageKg, 2, lang) })}
              </span>
            </td>
          </>
        )}
        <td className="px-4 py-3 text-center text-gray-500 text-sm">
          {t('materialCalc.group.partCount', { count: group.details.length })}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="p-0 bg-gray-50/80">
            <div className="px-4 pt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTab('matrix')}
                className={`px-3 py-1.5 text-xs rounded-md ${
                  tab === 'matrix' ? 'bg-indigo-600 text-white' : 'bg-white border text-gray-700'
                }`}
              >
                {t('materialCalc.matrix.tab26Weeks')}
              </button>
              <button
                type="button"
                onClick={() => setTab('detail')}
                className={`px-3 py-1.5 text-xs rounded-md ${
                  tab === 'detail' ? 'bg-indigo-600 text-white' : 'bg-white border text-gray-700'
                }`}
              >
                {t('materialCalc.matrix.tabDetail')}
              </button>
              <button
                type="button"
                onClick={() => setTab('recommend')}
                className={`px-3 py-1.5 text-xs rounded-md ${
                  tab === 'recommend' ? 'bg-indigo-600 text-white' : 'bg-white border text-gray-700'
                }`}
              >
                {t('materialCalc.recommendation.tab')}
              </button>
              <span className="text-[11px] text-gray-500">
                {tab === 'recommend'
                  ? t('materialCalc.recommendation.disclaimerTitle')
                  : t('materialCalc.matrix.unitNote')}
              </span>
            </div>
            {tab === 'matrix' ? (
              <WeeklyMatrixTable matrix={group.weeklyMatrix} edit={poolEdit} />
            ) : tab === 'detail' ? (
              <DetailTable details={group.details} />
            ) : (
              <SizeRecommendationPanel recommendation={group.sizeRecommendation} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Folder card per jenis material ───────────────────────────────────────

/** Warna & emoji per jenis material. */
const MATERIAL_TYPE_META: Record<string, { emoji: string; color: string; iconColor: string; bg: string; selectedBg: string; border: string; selectedBorder: string }> = {
  Paper:   { emoji: '📄', color: 'text-blue-800',  iconColor: 'text-blue-500',  bg: 'bg-white',      selectedBg: 'bg-blue-50',   border: 'border-gray-200', selectedBorder: 'border-blue-400' },
  PET:     { emoji: '🧴', color: 'text-teal-800',  iconColor: 'text-teal-500',  bg: 'bg-white',      selectedBg: 'bg-teal-50',   border: 'border-gray-200', selectedBorder: 'border-teal-400' },
  Flute:   { emoji: '📦', color: 'text-amber-800', iconColor: 'text-amber-500', bg: 'bg-white',      selectedBg: 'bg-amber-50',  border: 'border-gray-200', selectedBorder: 'border-amber-400' },
  Lainnya: { emoji: '🗂️', color: 'text-gray-700',  iconColor: 'text-gray-400',  bg: 'bg-white',      selectedBg: 'bg-gray-100',  border: 'border-gray-200', selectedBorder: 'border-gray-400' },
};

function getMeta(materialType: string) {
  return MATERIAL_TYPE_META[materialType] ?? MATERIAL_TYPE_META['Lainnya'];
}

/**
 * Key unik sub-folder di dalam folder jenis material: kombinasi GRAMATUR + SUPPLIER.
 * Dipakai untuk mengelompokkan grup ukuran (lihat `gramSupplierFolders`).
 */
function gramSupplierKey(g: Pick<MaterialGroup, 'gramatur' | 'supplier'>): string {
  return `${g.gramatur || '—'}||${g.supplier || '—'}`;
}

/**
 * Label judul folder gramatur, mis. "450" -> "450 gsm"; kosong -> label pengganti
 * (diberikan pemanggil supaya bisa diterjemahkan).
 */
function formatGramatur(gramatur: string, emptyLabel: string): string {
  if (!gramatur || gramatur === '—') return emptyLabel;
  return /[a-z]/i.test(gramatur) ? gramatur : `${gramatur} gsm`;
}

/**
 * Normalisasi teks untuk kotak pencarian hasil perhitungan.
 * Ukuran di data tidak konsisten ("66 × 50 CM", "64 CM x 64 CM", "47X75.5CM"),
 * jadi pencarian dibuat toleran: huruf kecil, semua spasi dibuang, dan
 * karakter kali (× ✕ ✖) disamakan dengan huruf "x".
 * Contoh: "66 x 50" cocok dengan "66 × 50 CM".
 */
function searchKey(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[\u00d7\u2715\u2716]/g, 'x')
    .replace(/\s+/g, '');
}

/** Key i18n untuk nama jenis material yang tampil di kartu folder. */
const MATERIAL_TYPE_KEYS: Record<string, string> = {
  Paper: 'materialCalc.materialType.paper',
  PET: 'materialCalc.materialType.pet',
  Flute: 'materialCalc.materialType.flute',
  Lainnya: 'materialCalc.materialType.lainnya',
};

/** Satu kartu folder material — klik untuk memilih / deselect, atau export PDF-nya. */
function MaterialFolderCard({
  materialType,
  groups,
  isSelected,
  onClick,
  onExport,
  exporting,
}: {
  materialType: string;
  groups: MaterialGroup[];
  isSelected: boolean;
  onClick: () => void;
  onExport: () => void;
  exporting?: boolean;
}) {
  const meta = getMeta(materialType);
  const { t, lang } = useTranslation();
  const shortageCount   = groups.filter((g) => !g.isSufficient).length;
  const sufficientCount = groups.filter((g) =>  g.isSufficient).length;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`
        w-full text-left rounded-xl border-2 p-4 transition-all duration-150 cursor-pointer
        hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-300
        ${isSelected
          ? `${meta.selectedBg} ${meta.selectedBorder} shadow-sm`
          : `${meta.bg} ${meta.border} hover:border-gray-300`}
      `}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${meta.iconColor}`}>
          {isSelected
            ? <FolderOpen className="w-7 h-7" />
            : <Folder     className="w-7 h-7" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`font-semibold text-sm ${meta.color}`}>
            {MATERIAL_TYPE_KEYS[materialType] ? t(MATERIAL_TYPE_KEYS[materialType]) : materialType}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {t('materialCalc.group.sizeCount', { count: groups.length })}
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {shortageCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">
                {t('materialCalc.group.shortCount', { count: shortageCount })}
              </span>
            )}
            {sufficientCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">
                {t('materialCalc.group.sufficientCount', { count: sufficientCount })}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 border-t border-gray-100 pt-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExport();
          }}
          disabled={exporting || groups.length === 0}
          title={t('materialCalc.export.oneFileTooltip', { count: groups.length, label: materialTypeLabel(materialType, lang) })}
          className="inline-flex w-full items-center justify-center gap-1 px-2 py-1 text-[11px] rounded-md border border-gray-300 text-gray-700 hover:bg-white disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
          {exporting ? t('materialCalc.export.preparing') : t('materialCalc.export.pdf')}
        </button>
      </div>
    </div>
  );
}

/**
 * Satu kartu sub-folder di dalam folder jenis material: GRAMATUR + SUPPLIER
 * disatukan. Isi folder ini baru ukuran (dan part number) nya.
 */
function GramSupplierFolderCard({
  gramatur,
  supplier,
  groups,
  onClick,
  onExport,
  exporting,
}: {
  gramatur: string;
  supplier: string;
  groups: MaterialGroup[];
  onClick: () => void;
  onExport: () => void;
  exporting?: boolean;
}) {
  const { t } = useTranslation();
  const shortageCount   = groups.filter((g) => !g.isSufficient).length;
  const sufficientCount = groups.filter((g) =>  g.isSufficient).length;
  const partCount       = groups.reduce((acc, g) => acc + g.details.length, 0);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="w-full text-left rounded-xl border-2 border-gray-200 bg-white p-4 transition-all duration-150 cursor-pointer hover:shadow-md hover:border-amber-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-amber-500">
          <Folder className="w-6 h-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm text-gray-800">
            {formatGramatur(gramatur, t('materialCalc.gramFolder.noGramatur'))}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 truncate" title={supplier}>
            {supplier}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {t('materialCalc.gramFolder.sizesAndParts', { sizes: groups.length, parts: partCount })}
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {shortageCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">
                {t('materialCalc.group.shortCount', { count: shortageCount })}
              </span>
            )}
            {sufficientCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">
                {t('materialCalc.group.sufficientCount', { count: sufficientCount })}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 border-t border-gray-100 pt-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExport();
          }}
          disabled={exporting || groups.length === 0}
          title={t('materialCalc.gramFolder.exportTooltip', { count: groups.length })}
          className="inline-flex w-full items-center justify-center gap-1 px-2 py-1 text-[11px] rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
          {exporting ? t('materialCalc.export.preparing') : t('materialCalc.export.pdf')}
        </button>
      </div>
    </div>
  );
}

// ── Dialog konfirmasi sederhana ───────────────────────────────────────────

function ConfirmDialog({
  title,
  lines,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  lines: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="border-b px-6 py-4 font-semibold text-gray-900">{title}</div>
        <div className="px-6 py-4 space-y-2 text-sm text-gray-700">
          {lines.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <div className="border-t px-6 py-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded-md border text-gray-700">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white disabled:opacity-50"
          >
            {busy ? t('common.processing') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Halaman utama ─────────────────────────────────────────────────────────

/**
 * Kolom tabel untuk isi folder data master periode. Dipakai agar isi tiap folder
 * (MRP / WIP / HOT LIST / STOCK RM / OS PO) bisa dibuka dari halaman ini tanpa
 * menduplikasi data — sumbernya tetap endpoint Master Data dengan ?periodId=.
 */
const SOURCE_COLUMNS: Record<string, { key: string; labelKey: string; numeric?: boolean }[]> = {
  MRP: [
    { key: 'item.partNumber', labelKey: 'materialCalc.source.partNumber' },
    { key: 'item.itemName', labelKey: 'common.description' },
    { key: 'year', labelKey: 'materialCalc.source.year', numeric: true },
    { key: 'weekNumber', labelKey: 'materialCalc.source.week', numeric: true },
    { key: 'quantity', labelKey: 'materialCalc.source.qty', numeric: true },
    { key: 'weekStartDate', labelKey: 'materialCalc.source.weekStart' },
  ],
  WIP: [
    { key: 'item.partNumber', labelKey: 'materialCalc.source.partNumber' },
    { key: 'item.itemName', labelKey: 'common.description' },
    { key: 'location', labelKey: 'materialCalc.source.location' },
    { key: 'quantity', labelKey: 'materialCalc.source.qty', numeric: true },
    { key: 'status', labelKey: 'common.status' },
    { key: 'date', labelKey: 'common.date' },
  ],
  HOTLIST: [
    { key: 'partNumber', labelKey: 'materialCalc.source.partNumber' },
    { key: 'biTotal', labelKey: 'materialCalc.source.biTotal', numeric: true },
    { key: 'date', labelKey: 'common.date' },
    { key: 'previousDate', labelKey: 'materialCalc.source.previousDate' },
  ],
  STOCK_RM: [
    { key: 'itemDesc', labelKey: 'materialCalc.source.item' },
    { key: 'refB', labelKey: 'materialCalc.source.refB' },
    { key: 'supplier', labelKey: 'materialCalc.source.supplier' },
    { key: 'qty', labelKey: 'materialCalc.source.qty', numeric: true },
    { key: 'unit', labelKey: 'materialCalc.source.unit' },
    { key: 'date', labelKey: 'common.date' },
  ],
  OUTSTANDING_PO: [
    { key: 'poNumber', labelKey: 'materialCalc.source.poNumber' },
    { key: 'planReceivedDate', labelKey: 'materialCalc.source.planDate' },
    { key: 'supplierName', labelKey: 'materialCalc.source.supplier' },
    { key: 'itemDesc', labelKey: 'materialCalc.source.item' },
    { key: 'refB', labelKey: 'materialCalc.source.refB' },
    { key: 'qtyOrder', labelKey: 'materialCalc.source.qtyOrder', numeric: true },
    { key: 'qtyOrderUnit', labelKey: 'materialCalc.source.unit' },
    { key: 'qtyDelivered', labelKey: 'materialCalc.source.delivered', numeric: true },
  ],
};

function getPath(row: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[k];
  }, row);
}

/** Tabel isi folder data master. Dibatasi 300 baris agar MRP 16.000 baris tetap ringan. */
function SourceRowsTable({ sourceType, rows }: { sourceType: string; rows: Record<string, unknown>[] }) {
  const { t, lang } = useTranslation();
  const cols = SOURCE_COLUMNS[sourceType] ?? [];
  const LIMIT = 300;
  const shown = rows.slice(0, LIMIT);

  return (
    <div>
      <div className="px-4 py-3 border-b bg-gray-50 text-xs text-gray-500">
        {t('materialCalc.source.rowCount', { count: formatNum(rows.length, 0, lang) })}
        {rows.length > LIMIT ? ` ${t('materialCalc.source.showingFirst', { count: LIMIT })}` : ''}
      </div>
      <div className="overflow-x-auto max-h-[65vh]">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 uppercase bg-gray-50/70 sticky top-0">
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`px-4 py-2 font-semibold whitespace-nowrap ${c.numeric ? 'text-right' : 'text-left'}`}
                >
                  {t(c.labelKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50/60">
                {cols.map((c) => {
                  const v = getPath(r, c.key);
                  const text = v === null || v === undefined || v === '' ? '—' : String(v);
                  return (
                    <td
                      key={c.key}
                      className={`px-4 py-2 text-gray-700 whitespace-nowrap ${c.numeric ? 'text-right tabular-nums' : ''}`}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SOURCE_LABEL_KEYS: Record<string, string> = {
  MRP: 'materialCalc.source.mrp',
  HOTLIST: 'materialCalc.source.hotList',
  STOCK_RM: 'materialCalc.source.stockRm',
  OUTSTANDING_PO: 'materialCalc.source.outstandingPo',
  WIP: 'materialCalc.source.wip',
};

/** Sub-folder khusus: part MRP yang tidak ada / datanya kurang di NPOF. */
const NPOF_CHECK = 'NPOF_CHECK';

const NPOF_STATUS_META: Record<NpofCoverageRow['status'], { labelKey: string; badge: string }> = {
  MISSING: { labelKey: 'materialCalc.npof.missing', badge: 'bg-red-50 text-red-700 border-red-200' },
  INCOMPLETE: { labelKey: 'materialCalc.npof.incomplete', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
};

/** Key i18n untuk label field NPOF yang bisa kosong. */
const NPOF_FIELD_LABEL_KEYS: Record<NpofRequiredField, string> = {
  gramatur: 'materialCalc.npof.field.gramatur',
  ukuran: 'materialCalc.npof.field.ukuran',
  formula: 'materialCalc.npof.field.formula',
  ups: 'materialCalc.npof.field.ups',
  material: 'materialCalc.npof.field.material',
  supplier: 'materialCalc.npof.field.supplier',
};

/** Tabel part MRP yang tidak ada di NPOF / datanya kurang, dengan pencarian & filter. */
function NpofCoveragePanel({
  data,
  isLoading,
}: {
  data?: { summary: { mrpPartCount: number; missingNpofCount: number; incompleteNpofCount: number; completeNpofCount: number; criticalCount: number }; rows: NpofCoverageRow[]; npofTotalRows: number };
  isLoading: boolean;
}) {
  const { t, lang } = useTranslation();
  const [filter, setFilter] = useState<'ALL' | 'MISSING' | 'INCOMPLETE'>('ALL');
  const [search, setSearch] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);

  const allRows = data?.rows ?? [];
  const summary = data?.summary;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (filter !== 'ALL' && r.status !== filter) return false;
      if (criticalOnly && !r.critical) return false;
      if (!q) return true;
      return (
        r.partNumber.toLowerCase().includes(q) ||
        r.productName.toLowerCase().includes(q) ||
        (r.supplier ?? '').toLowerCase().includes(q)
      );
    });
  }, [allRows, filter, search, criticalOnly]);

  const LIMIT = 300;
  const shown = rows.slice(0, LIMIT);

  if (isLoading) {
    return (
      <div className="card p-10 text-center text-gray-400">
        <Loader2 className="w-6 h-6 mx-auto animate-spin" />
      </div>
    );
  }

  if (!summary || summary.mrpPartCount === 0) {
    return (
      <div className="card p-10 text-center text-gray-400">
        {t('materialCalc.npof.empty')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Ringkasan cakupan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-xs text-gray-500">{t('materialCalc.npof.mrpParts')}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{formatNum(summary.mrpPartCount, 0, lang)}</div>
        </div>
        <div className="card p-4 border-red-200 bg-red-50/40">
          <div className="text-xs text-red-700">{t('materialCalc.npof.missing')}</div>
          <div className="text-2xl font-bold text-red-700 mt-1">{formatNum(summary.missingNpofCount, 0, lang)}</div>
        </div>
        <div className="card p-4 border-amber-200 bg-amber-50/40">
          <div className="text-xs text-amber-700">{t('materialCalc.npof.inNpofIncomplete')}</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">{formatNum(summary.incompleteNpofCount, 0, lang)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">{t('materialCalc.npof.complete')}</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{formatNum(summary.completeNpofCount, 0, lang)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 text-xs text-blue-900">
        {t('materialCalc.npof.infoA', { rows: formatNum(data?.npofTotalRows ?? 0, 0, lang) })}{' '}
        <span className="font-medium">{t('materialCalc.group.partCount', { count: formatNum(summary.criticalCount, 0, lang) })}</span>
        {t('materialCalc.npof.infoB')}
        <div className="mt-1">
          {t('materialCalc.npof.infoWeekA')}<span className="font-medium">{t('materialCalc.npof.weekAll')}</span>{t('materialCalc.npof.infoWeekB')}
        </div>
      </div>

      {/* Filter & pencarian */}
      <div className="card p-3 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex rounded-md border overflow-hidden shrink-0">
          {([
            ['ALL', t('materialCalc.npof.filterAll', { count: formatNum(allRows.length, 0, lang) })],
            ['MISSING', t('materialCalc.npof.filterMissing', { count: formatNum(summary.missingNpofCount, 0, lang) })],
            ['INCOMPLETE', t('materialCalc.npof.filterIncomplete', { count: formatNum(summary.incompleteNpofCount, 0, lang) })],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                filter === key ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="inline-flex items-center gap-2 text-xs text-gray-600 shrink-0">
          <input
            type="checkbox"
            checked={criticalOnly}
            onChange={(e) => setCriticalOnly(e.target.checked)}
            className="rounded border-gray-300"
          />
          {t('materialCalc.npof.criticalOnly')}
        </label>

        <div className="flex-1" />

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('materialCalc.npof.searchPlaceholder')}
          className="input w-full lg:w-72"
        />
      </div>

      {/* Tabel */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 text-xs text-gray-500">
          {t('materialCalc.group.partCount', { count: formatNum(rows.length, 0, lang) })}
          {rows.length > LIMIT ? ` ${t('materialCalc.source.showingFirst', { count: LIMIT })}` : ''}
        </div>
        <div className="overflow-x-auto max-h-[65vh]">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50/70 sticky top-0">
              <tr>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">{t('materialCalc.source.partNumber')}</th>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">{t('common.description')}</th>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">{t('common.status')}</th>
                <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">{t('materialCalc.npof.demandWeeks')}</th>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">{t('materialCalc.npof.materialType')}</th>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">{t('materialCalc.source.supplier')}</th>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">{t('materialCalc.npof.missingData')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((r) => {
                const meta = NPOF_STATUS_META[r.status];
                return (
                  <tr key={r.partNumber} className="hover:bg-gray-50/60">
                    <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">
                      {r.partNumber}
                      {r.isNebeng && (
                        <span className="ml-2 text-[10px] font-normal text-gray-400" title={t('materialCalc.npof.nebengTitle')}>
                          {t('materialCalc.npof.nebeng')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600 max-w-[22rem] truncate" title={r.productName}>
                      {r.productName}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}>
                        {t(meta.labelKey)}
                      </span>
                      {r.critical && (
                        <span className="ml-1 text-[10px] text-amber-600" title={t('materialCalc.npof.estimatedTitle')}>
                          {t('materialCalc.npof.estimatedShort')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">
                      {t('materialCalc.npof.weekCount', { count: formatNum(r.demandWeekCount, 0, lang) })}
                    </td>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                      {r.materialType ?? '—'}
                      {r.material && <span className="ml-1 text-[10px] text-gray-400">({r.material})</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{r.supplier ?? '—'}</td>
                    <td className="px-4 py-2">
                      {r.status === 'MISSING' ? (
                        <span className="text-xs text-red-600">{t('materialCalc.npof.allMissing')}</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.missingFields.map((f: NpofRequiredField) => (
                            <span
                              key={f}
                              className="inline-flex rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
                            >
                              {t(NPOF_FIELD_LABEL_KEYS[f])}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                    {t('materialCalc.npof.noMatch')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function MaterialCalc() {
  const { t, lang } = useTranslation();
  const sourceLabel = (key: string) => (SOURCE_LABEL_KEYS[key] ? t(SOURCE_LABEL_KEYS[key]) : key);
  /** Admin, Super Admin, & Material Planner boleh mengubah pengecualian pool. */
  const { canEdit } = useAuthStore();
  const canEditMaterial = canEdit('material');
  const { data: cyclesData, isLoading: isLoadingCycles } = useCycles();
  const cycles = cyclesData?.data ?? [];

  const [selectedCycleId, setSelectedCycleId] = useState('');
  const activeCycle: CycleSummary | undefined = useMemo(
    () => cycles.find((c) => c.id === selectedCycleId),
    [cycles, selectedCycleId],
  );
  const cycleId = activeCycle?.id ?? null;

  /**
   * Jumlah baris NYATA tiap sumber di periode ini (endpoint /material-planning/periods),
   * bukan riwayat upload — data bisa berkurang setelah upload (edit/hapus manual),
   * sehingga angka riwayat upload akan menyesatkan.
   */
  const { data: periodsData } = usePeriods();
  const liveCounts = useMemo(
    () => periodsData?.data.find((p) => p.id === cycleId)?.counts ?? null,
    [periodsData, cycleId],
  );

  const { data: npofCheck } = useNpofCheck(cycleId, Boolean(activeCycle?.currentResult));
  const { data: expiredData } = useExpiredCycles(canEditMaterial);

  const createCycle = useCreateCycle();
  const calculate = useCalculateCycle();
  const retention = useCycleRetentionAction();

  const [calcResult, setCalcResult] = useState<CycleCalculationResult | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // Kalau user belum memilih run tertentu, tampilkan run yang sedang aktif
  // supaya hasil terakhir langsung terlihat begitu halaman dibuka.
  const { data: runDetail } = useCycleResultDetail(
    cycleId,
    selectedRunId ?? activeCycle?.currentResult?.id ?? null,
  );

  const [showAudit, setShowAudit] = useState(false);
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [newMonth, setNewMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [newLabel, setNewLabel] = useState('');
  const [confirmNpof, setConfirmNpof] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [retentionTarget, setRetentionTarget] = useState<ExpiredCycle | null>(null);
  const [retentionMonths, setRetentionMonths] = useState(6);
  /** null = tampilkan semua tipe, string = filter ke tipe tertentu */
  const [selectedMaterialType, setSelectedMaterialType] = useState<string | null>(null);
  /**
   * Sub-folder GRAMATUR + SUPPLIER yang sedang dibuka di dalam folder jenis material.
   *  null   -> tampilkan grid sub-folder (satu kartu per gramatur + supplier)
   *  string -> tampilkan tabel ukuran + part number di dalam sub-folder itu
   * Key = `${gramatur}||${supplier}` (lihat `gramSupplierKey`).
   */
  const [selectedGramSupplier, setSelectedGramSupplier] = useState<string | null>(null);
  /**
   * Ukuran (grup) yang dicentang user untuk export PDF. Pilihan berlaku lintas
   * sub-folder gramatur + supplier selama masih dalam JENIS MATERIAL yang sama;
   * pilihan dikosongkan saat jenis material diganti.
   */
  const [selectedSizeKeys, setSelectedSizeKeys] = useState<Set<string>>(() => new Set());
  /**
   * Filter hasil perhitungan (berlaku untuk seluruh isi folder Calculation):
   * dropdown gramatur, dropdown supplier, dan pencarian teks bebas
   * (ukuran / part number / deskripsi part). 'ALL' = tanpa filter.
   */
  const [filterGramatur, setFilterGramatur] = useState<string>('ALL');
  const [filterSupplier, setFilterSupplier] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  /**
   * Folder yang sedang dibuka di dalam periode terpilih:
   *  null    -> daftar sub-folder periode (Calculation / MRP / WIP / HOT LIST / STOCK RM / OS PO)
   *  'CALC'  -> isi folder Calculation (folder per material)
   *  lainnya -> tabel data master periode (MRP/WIP/HOTLIST/STOCK_RM/OUTSTANDING_PO)
   */
  const [openFolder, setOpenFolder] = useState<string | null>(null);

  // Validitas hasil perhitungan periode ini terhadap data master SEKARANG.
  const { data: dataStatusData } = useCycleDataStatus(cycleId);
  const dataStatus = dataStatusData?.data ?? null;

  // Cakupan NPOF: dipakai untuk badge di kartu sub-folder dan isi panelnya.
  const { data: npofCoverageData, isLoading: npofCoverageLoading } = useNpofCoverage(cycleId);

  const { data: sourceRowsData, isLoading: sourceRowsLoading } = usePeriodSourceRows(
    cycleId,
    openFolder && openFolder !== 'CALC' && openFolder !== NPOF_CHECK ? openFolder : null,
  );


  const { data: auditData } = useCycleAudit(cycleId, showAudit);

  const shown: CycleCalculationResult | MaterialCalcResponse | null =
    runDetail?.data.resultSnapshot ?? calcResult;

  const groups = shown?.groups ?? [];
  const shortageGroups = groups.filter((g) => !g.isSufficient).length;
  const sufficientGroups = groups.filter((g) => g.isSufficient).length;

  /** Kelompokkan groups per materialType, dengan urutan tampilan yang konsisten. */
  const MATERIAL_ORDER = ['Paper', 'PET', 'Flute', 'Lainnya'];
  const groupedByType = useMemo(() => {
    const map = new Map<string, MaterialGroup[]>();
    for (const g of groups) {
      const type = g.materialType || 'Lainnya';
      if (!map.has(type)) map.set(type, []);
      map.get(type)!.push(g);
    }
    // Urutkan: tipe yang ada di MATERIAL_ORDER dulu, sisanya diurutkan alfabet
    const knownOrder = MATERIAL_ORDER.filter((t) => map.has(t));
    const unknown    = [...map.keys()].filter((t) => !MATERIAL_ORDER.includes(t)).sort();
    return [...knownOrder, ...unknown].map((type) => ({ type, groups: map.get(type)! }));
  }, [groups]);

  /** Opsi dropdown gramatur — dari SELURUH grup, urut angka lalu teks. */
  const gramaturOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      const raw = g.gramatur || '';
      if (!map.has(raw)) map.set(raw, formatGramatur(raw || '—', t('materialCalc.gramFolder.noGramatur')));
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => {
        const na = Number.parseFloat(a.value);
        const nb = Number.parseFloat(b.value);
        const fa = Number.isFinite(na) ? na : Number.POSITIVE_INFINITY;
        const fb = Number.isFinite(nb) ? nb : Number.POSITIVE_INFINITY;
        if (fa !== fb) return fa - fb;
        return a.label.localeCompare(b.label, 'id');
      });
  }, [groups, t]);

  /** Opsi dropdown supplier — A→Z (supplier kosong jadi "—"). */
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) set.add(g.supplier || '—');
    return [...set].sort((a, b) => a.localeCompare(b, 'id'));
  }, [groups]);

  const hasActiveFilter =
    filterGramatur !== 'ALL' || filterSupplier !== 'ALL' || searchKey(searchQuery) !== '';

  const resetFilters = () => {
    setFilterGramatur('ALL');
    setFilterSupplier('ALL');
    setSearchQuery('');
  };

  /**
   * Hasil perhitungan setelah filter gramatur + supplier + pencarian.
   * Pencarian mencocokkan **ukuran** grup ATAU **part number** / deskripsi part
   * di dalam grup itu (jadi grup tetap tampil utuh bila ada part yang cocok).
   */
  const filteredGroups = useMemo(() => {
    const q = searchKey(searchQuery);
    return groups.filter((g) => {
      if (filterGramatur !== 'ALL' && (g.gramatur || '') !== filterGramatur) return false;
      if (filterSupplier !== 'ALL' && (g.supplier || '—') !== filterSupplier) return false;
      if (!q) return true;
      if (searchKey(g.ukuran).includes(q)) return true;
      return g.details.some(
        (d) => searchKey(d.partNumber).includes(q) || searchKey(d.productName).includes(q),
      );
    });
  }, [groups, filterGramatur, filterSupplier, searchQuery]);

  const filteredShortageGroups = filteredGroups.filter((g) => !g.isSufficient).length;
  const filteredSufficientGroups = filteredGroups.filter((g) => g.isSufficient).length;

  /** Groups di folder jenis material terpilih (semua groups kalau "Semua"). */
  const displayedGroups = useMemo(
    () => selectedMaterialType ? filteredGroups.filter((g) => (g.materialType || 'Lainnya') === selectedMaterialType) : filteredGroups,
    [filteredGroups, selectedMaterialType],
  );

  /**
   * Kartu folder jenis material untuk grid 'Pilih jenis material'.
   * Dibangun dari hasil filter supaya angka & isi kartu ikut menyesuaikan
   * (jenis material yang tidak punya hasil cocok tidak ditampilkan).
   */
  const filteredGroupedByType = useMemo(() => {
    const map = new Map<string, MaterialGroup[]>();
    for (const g of filteredGroups) {
      const type = g.materialType || 'Lainnya';
      if (!map.has(type)) map.set(type, []);
      map.get(type)!.push(g);
    }
    const knownOrder = MATERIAL_ORDER.filter((it) => map.has(it));
    const unknown = [...map.keys()].filter((it) => !MATERIAL_ORDER.includes(it)).sort();
    return [...knownOrder, ...unknown].map((type) => ({ type, groups: map.get(type)! }));
  }, [filteredGroups]);

  /**
   * Sub-folder di dalam folder jenis material: satu folder per kombinasi
   * GRAMATUR + SUPPLIER. Di dalamnya baru ada ukuran & part number.
   */
  const gramSupplierFolders = useMemo(() => {
    const map = new Map<string, { key: string; gramatur: string; supplier: string; groups: MaterialGroup[] }>();
    for (const g of displayedGroups) {
      const key = gramSupplierKey(g);
      if (!map.has(key)) {
        map.set(key, { key, gramatur: g.gramatur || '—', supplier: g.supplier || '—', groups: [] });
      }
      map.get(key)!.groups.push(g);
    }
    // Urut gramatur naik (angka), lalu supplier A→Z. Gramatur tak berbentuk angka ditaruh paling akhir.
    return [...map.values()].sort((a, b) => {
      const ga = Number.parseFloat(a.gramatur);
      const gb = Number.parseFloat(b.gramatur);
      const na = Number.isFinite(ga) ? ga : Number.POSITIVE_INFINITY;
      const nb = Number.isFinite(gb) ? gb : Number.POSITIVE_INFINITY;
      if (na !== nb) return na - nb;
      return a.supplier.localeCompare(b.supplier, 'id');
    });
  }, [displayedGroups]);

  /**
   * Sub-folder gramatur + supplier yang sedang dibuka. Otomatis menjadi null
   * kalau folder itu tersaring keluar oleh filter, sehingga UI kembali ke
   * daftar sub-folder (bukan menampilkan tabel kosong).
   */
  const activeGramSupplier = useMemo(
    () => gramSupplierFolders.find((f) => f.key === selectedGramSupplier) ?? null,
    [gramSupplierFolders, selectedGramSupplier],
  );

  /** Groups yang benar-benar ditampilkan di tabel — difilter lagi oleh sub-folder terpilih. */
  const tableGroups = useMemo(
    () => activeGramSupplier
      ? displayedGroups.filter((g) => gramSupplierKey(g) === activeGramSupplier.key)
      : displayedGroups,
    [displayedGroups, activeGramSupplier],
  );

  /** Seluruh ukuran pada jenis material terpilih, tanpa filter tabel — dasar pilihan export. */
  const materialTypeGroups = useMemo(
    () => (selectedMaterialType ? groups.filter((g) => (g.materialType || 'Lainnya') === selectedMaterialType) : []),
    [groups, selectedMaterialType],
  );

  /** Ukuran yang dicentang, termasuk yang berada di sub-folder gramatur/supplier lain. */
  const selectedSizeGroups = useMemo(
    () => materialTypeGroups.filter((g) => selectedSizeKeys.has(sizeSelectionKey(g))),
    [materialTypeGroups, selectedSizeKeys],
  );

  const tableAllSelected =
    tableGroups.length > 0 && tableGroups.every((g) => selectedSizeKeys.has(sizeSelectionKey(g)));
  const tableSomeSelected = tableGroups.some((g) => selectedSizeKeys.has(sizeSelectionKey(g)));

  const toggleSizeSelection = (group: MaterialGroup) => {
    const key = sizeSelectionKey(group);
    setSelectedSizeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllInTable = () => {
    setSelectedSizeKeys((prev) => {
      const next = new Set(prev);
      if (tableAllSelected) tableGroups.forEach((g) => next.delete(sizeSelectionKey(g)));
      else tableGroups.forEach((g) => next.add(sizeSelectionKey(g)));
      return next;
    });
  };

  const clearSizeSelection = () => setSelectedSizeKeys(new Set());

  // ── Export PDF (satu file per folder jenis material) ──
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  const exportMeta = useMemo(
    () => ({
      periodLabel: activeCycle ? periodDisplayLabel(activeCycle, lang) : null,
      periodStart: shown?.periodStartDate ?? activeCycle?.mrpStartDate ?? null,
      periodEnd: shown?.periodEndDate ?? activeCycle?.mrpEndDate ?? null,
      calculatedAt: shown?.calculatedAt ?? activeCycle?.currentResult?.calculatedAt ?? null,
    }),
    [activeCycle, shown, lang],
  );

  /**
   * Pembuatan PDF berjalan sinkron di main thread (ratusan ribu angka), jadi
   * status "Menyiapkan..." digambar dulu sebelum pekerjaan berat dimulai.
   */
  const runExport = (key: string, job: () => void) => {
    setExportingKey(key);
    setTimeout(() => {
      try {
        job();
        setToast({
          kind: 'ok',
          text: key === 'ALL' ? t('materialCalc.export.doneZip') : t('materialCalc.export.donePdf'),
        });
      } catch (e) {
        setToast({ kind: 'err', text: e instanceof Error ? e.message : t('materialCalc.export.failed') });
      } finally {
        setExportingKey(null);
      }
    }, 40);
  };

  /** Label file PDF untuk sekumpulan ukuran pilihan. */
  const selectedExportLabel = (label: string, count: number) =>
    `${label} · ${t('materialCalc.export.selectedLabel', { count })}`;

  /** Export HANYA ukuran yang dicentang (bisa dari gramatur/supplier berbeda). */
  const exportSelectedPdf = () => {
    if (!selectedMaterialType || selectedSizeGroups.length === 0) return;
    runExport('SELECTED', () =>
      exportMaterialTypePdf(
        selectedExportLabel(materialTypeLabel(selectedMaterialType, lang), selectedSizeGroups.length),
        selectedSizeGroups,
        exportMeta,
        lang,
      ),
    );
  };

  /**
   * Tombol export di header tabel: kalau ada ukuran yang dicentang, HANYA ukuran
   * itu yang diekspor. Kalau tidak ada, semua ukuran pada tabel yang diekspor.
   */
  const exportTablePdf = () => {
    if (!selectedMaterialType) return;
    const useSelected = selectedSizeGroups.length > 0;
    const groupsToExport = useSelected ? selectedSizeGroups : tableGroups;
    const baseLabel = activeGramSupplier
      ? `${materialTypeLabel(selectedMaterialType, lang)} · ${formatGramatur(activeGramSupplier.gramatur, t('materialCalc.gramFolder.noGramatur'))} · ${activeGramSupplier.supplier}`
      : materialTypeLabel(selectedMaterialType, lang);
    const exportLabel = useSelected ? selectedExportLabel(baseLabel, selectedSizeGroups.length) : baseLabel;
    runExport('TABLE', () => exportMaterialTypePdf(exportLabel, groupsToExport, exportMeta, lang));
  };

  const statusBadge = (() => {
    if (!activeCycle) return null;
    if (activeCycle.isLocked) {
      return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-700">{t('materialCalc.status.locked')}</span>;
    }
    if (activeCycle.derivedStatus === 'NOT_CALCULATED') {
      return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{t('materialCalc.status.notCalculated')}</span>;
    }
    if (activeCycle.derivedStatus === 'STALE') {
      return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{t('materialCalc.status.stale')}</span>;
    }
    return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">{t('materialCalc.status.calculated')}</span>;
  })();

  const doCalculate = async () => {
    if (!cycleId) return;
    try {
      const res = await calculate.mutateAsync({ cycleId });
      setCalcResult(res.data);
      setSelectedRunId(res.data.id);
      setConfirmNpof(false);
      setToast({ kind: 'ok', text: t('materialCalc.toast.runDone', { run: res.data.runNumber }) });
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : t('materialCalc.toast.calcFailed') });
    }
  };

  const handleCalculate = () => {
    if (npofCheck?.data.changedSinceCalculation) {
      setConfirmNpof(true);
      return;
    }
    void doCalculate();
  };

  const handleCreatePeriod = async () => {
    try {
      const res = (await createCycle.mutateAsync({ uploadMonth: newMonth, label: newLabel || undefined })) as {
        data: CycleSummary;
      };
      setShowNewPeriod(false);
      setNewLabel('');
      setSelectedCycleId(res.data.id);
      setCalcResult(null);
      setSelectedRunId(null);
      setToast({ kind: 'ok', text: t('materialCalc.toast.periodCreated', { label: res.data.label }) });
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : t('materialCalc.toast.periodFailed') });
    }
  };

  const expired = expiredData?.data ?? [];

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Calculator className="w-7 h-7 text-indigo-600" />
            {t('layout.menu.materialCalculation')}
          </h1>
          <p className="text-gray-500 mt-1">
            {t('materialCalc.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge}
          <button
            type="button"
            onClick={() => setShowAudit(true)}
            disabled={!cycleId}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-md border text-gray-700 disabled:opacity-40"
          >
            <History className="w-4 h-4" />
            {t('materialCalc.changeHistory')}
          </button>
        </div>
      </div>

      {toast && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            toast.kind === 'ok'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          Level 1 — daftar FOLDER PERIODE
         ══════════════════════════════════════════════════════════════ */}
      {!activeCycle && (
        <div className="space-y-4">
          {cycles.length === 0 && !isLoadingCycles && (
            <div className="card p-12 text-center text-gray-400">
              <Folder className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium text-gray-600">{t('materialCalc.periods.none')}</p>
              <p className="text-sm mt-1">
                {t('materialCalc.periods.noneHint')}
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cycles.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setSelectedCycleId(c.id);
                  setOpenFolder(null);
                  setSelectedRunId(null);
                  setCalcResult(null);
                }}
                className="card p-5 text-left hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors flex items-start gap-3"
              >
                <div className="p-2.5 rounded-lg bg-indigo-50 shrink-0">
                  <Folder className="w-7 h-7 text-indigo-600 fill-indigo-500/20" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate flex items-center gap-1.5">
                    {periodDisplayLabel(c, lang)}
                    {c.isLocked && <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {c.currentResult ? t('materialCalc.calculatedAt', { date: formatDateTime(c.currentResult.calculatedAt, lang) }) : t('materialCalc.notCalculated')}
                  </div>
                  {c.derivedStatus === 'STALE' && (
                    <div className="text-xs text-amber-600 font-medium mt-1">{t('materialCalc.needRecalc')}</div>
                  )}
                </div>
              </button>
            ))}

            {canEditMaterial && (
              <button
                type="button"
                onClick={() => setShowNewPeriod(true)}
                className="p-5 border-2 border-dashed rounded-lg bg-white hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors flex items-center gap-3 text-gray-500"
              >
                <Plus className="w-6 h-6" />
                <span className="font-medium">{t('materialCalc.periods.create')}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          Level 2/3 — isi folder periode
         ══════════════════════════════════════════════════════════════ */}
      {activeCycle && (
        <>
          <div className="card p-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <button
                type="button"
                onClick={() => {
                  if (openFolder) setOpenFolder(null);
                  else setSelectedCycleId('');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border text-gray-700 hover:bg-gray-50 shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                {openFolder ? t('materialCalc.periods.back') : t('materialCalc.periods.all')}
              </button>

              <div className="min-w-0">
                <div className="text-sm text-gray-800 flex items-center gap-1.5">
                  <Folder className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="font-semibold truncate">{periodDisplayLabel(activeCycle, lang)}</span>
                  {openFolder && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="truncate text-gray-600">
                        {openFolder === 'CALC'
                          ? t('materialCalc.folders.calculation')
                          : openFolder === NPOF_CHECK
                            ? t('materialCalc.folders.npof')
                            : sourceLabel(openFolder)}
                      </span>
                    </>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {activeCycle.displayText}
                  {activeCycle.mrpStartDate && activeCycle.mrpEndDate && (
                    <>
                      {' '}
                      · {t('materialCalc.periods.mrpWeeks', {
                        weeks: activeCycle.weekCount,
                        start: formatWeekDate(activeCycle.mrpStartDate, lang),
                        end: formatWeekDate(activeCycle.mrpEndDate, lang),
                      })}
                    </>
                  )}
                </div>
              </div>

              <div className="flex-1" />

              {canEditMaterial && (
                <button
                  type="button"
                  onClick={handleCalculate}
                  disabled={calculate.isPending || activeCycle.isLocked}
                  className="btn btn-primary shrink-0"
                >
                  {calculate.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  {calculate.isPending ? t('materialCalc.calculating') : dataStatus?.hasResult ? t('materialCalc.recalculate') : t('materialCalc.calculate')}
                </button>
              )}
            </div>
          </div>

          {/* Hasil tidak valid karena data master berubah setelah perhitungan */}
          {dataStatus?.isInvalid && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <div className="flex-1 text-sm text-amber-900">
                <div className="font-medium">{dataStatus.invalidReason}</div>
                {dataStatus.changedSources.length > 0 && (
                  <div className="text-xs mt-0.5">
                    {t('materialCalc.dataChanged', { sources: dataStatus.changedSources.map((s) => sourceLabel(s)).join(', ') })}
                  </div>
                )}
              </div>
              {canEditMaterial && (
                <button
                  type="button"
                  onClick={handleCalculate}
                  disabled={calculate.isPending || activeCycle.isLocked}
                  className="btn btn-primary shrink-0"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {t('materialCalc.recalculate')}
                </button>
              )}
            </div>
          )}

          {/* Level 2 — sub-folder periode */}
          {!openFolder && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <button
                type="button"
                onClick={() => setOpenFolder('CALC')}
                className="card p-5 text-left hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
              >
                <Calculator className="w-7 h-7 text-indigo-600 mb-2" />
                <div className="font-semibold text-gray-900">{t('materialCalc.folders.calculation')}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {dataStatus?.hasResult ? t('materialCalc.summary.groupCount', { count: formatNum(groups.length, 0, lang) }) : t('materialCalc.notCalculated')}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setOpenFolder(NPOF_CHECK)}
                className="card p-5 text-left hover:border-rose-400 hover:bg-rose-50/30 transition-colors"
              >
                <AlertTriangle className="w-7 h-7 text-rose-600 mb-2" />
                <div className="font-semibold text-gray-900">{t('materialCalc.folders.npofTitle')}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {npofCoverageLoading
                    ? t('materialCalc.folders.loading')
                    : npofCoverageData?.data
                      ? t('materialCalc.folders.partsToReview', {
                          count: formatNum(
                            npofCoverageData.data.summary.missingNpofCount +
                              npofCoverageData.data.summary.incompleteNpofCount,
                            0,
                            lang,
                          ),
                        })
                      : '—'}
                </div>
              </button>

              {(['MRP', 'WIP', 'HOTLIST', 'STOCK_RM', 'OUTSTANDING_PO'] as const).map((key) => {
                const rowCount =
                  liveCounts?.[key] ??
                  activeCycle.sources.find((s: CycleSourceRow) => s.sourceType === key)?.rowCount ??
                  0;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setOpenFolder(key)}
                    className="card p-5 text-left hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
                  >
                    <FolderOpen className="w-7 h-7 text-blue-600 mb-2" />
                    <div className="font-semibold text-gray-900">{sourceLabel(key)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {t('materialCalc.source.rowCount', { count: formatNum(rowCount, 0, lang) })}
                      {dataStatus?.changedSources.includes(key) && (
                        <span className="text-amber-600 font-medium"> {t('materialCalc.folders.changed')}</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Level 3b — isi folder data master periode ini */}
          {openFolder && openFolder !== 'CALC' && openFolder !== NPOF_CHECK && (
            <div className="card overflow-hidden">
              {sourceRowsLoading ? (
                <div className="p-10 text-center text-gray-400">
                  <Loader2 className="w-6 h-6 mx-auto animate-spin" />
                </div>
              ) : (sourceRowsData?.data ?? []).length === 0 ? (
                <div className="p-10 text-center text-gray-400">
                  {t('materialCalc.folders.noSourceData', { source: sourceLabel(openFolder) })}
                </div>
              ) : (
                <SourceRowsTable sourceType={openFolder} rows={sourceRowsData?.data ?? []} />
              )}
            </div>
          )}

          {/* Level 3c — panel cakupan NPOF (part MRP tanpa / kurang data NPOF) */}
          {openFolder === NPOF_CHECK && (
            <NpofCoveragePanel data={npofCoverageData?.data} isLoading={npofCoverageLoading} />
          )}
        </>
      )}

      {/* Hasil — hanya di dalam folder Calculation */}
      {openFolder === 'CALC' && groups.length > 0 && (
        <>
          {/* ── Ringkasan angka ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4">
              <div className="text-sm text-gray-500">{t('materialCalc.summary.totalGroups')}</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{groups.length}</div>
            </div>
            <div className="card p-4 border-red-200">
              <div className="text-sm text-gray-500">{t('materialCalc.summary.needPurchase')}</div>
              <div className="text-2xl font-bold text-red-600 mt-1">{t('materialCalc.summary.groupSuffix', { count: shortageGroups })}</div>
            </div>
            <div className="card p-4 border-green-200">
              <div className="text-sm text-gray-500">{t('materialCalc.summary.sufficient')}</div>
              <div className="text-2xl font-bold text-green-600 mt-1">{t('materialCalc.summary.groupSuffix', { count: sufficientGroups })}</div>
            </div>
          </div>

          {/* ── Filter hasil perhitungan: gramatur, supplier, pencarian ── */}
          <div className="card p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide pb-2">
                <Filter className="w-3.5 h-3.5" />
                {t('materialCalc.filter.title')}
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-gray-500">{t('materialCalc.table.gramatur')}</span>
                <select
                  value={filterGramatur}
                  onChange={(e) => setFilterGramatur(e.target.value)}
                  className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="ALL">{t('materialCalc.filter.allGramatur')}</option>
                  {gramaturOptions.map((o) => (
                    <option key={o.value || '__tanpa_gramatur__'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-gray-500">{t('materialCalc.table.supplier')}</span>
                <select
                  value={filterSupplier}
                  onChange={(e) => setFilterSupplier(e.target.value)}
                  className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="ALL">{t('materialCalc.filter.allSupplier')}</option>
                  {supplierOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
                <span className="text-[11px] font-medium text-gray-500">{t('materialCalc.filter.search')}</span>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('materialCalc.filter.searchPlaceholder')}
                    title={t('materialCalc.filter.searchTitle')}
                    className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                  {searchQuery !== '' && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      title={t('materialCalc.filter.clearSearch')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </label>

              <div className="flex items-center gap-2 pb-1">
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {t('materialCalc.filter.count', { filtered: filteredGroups.length, total: groups.length })}
                </span>
                {hasActiveFilter && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    {t('materialCalc.filter.reset')}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Grid folder card ── */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {t('materialCalc.folders.selectMaterialType')}
              </div>
              <button
                type="button"
                onClick={() =>
                  runExport('ALL', () =>
                    exportAllMaterialTypesZip(
                      groupedByType.map(({ type, groups: typeGroups }) => ({ materialType: type, groups: typeGroups })),
                      exportMeta,
                      lang,
                    ),
                  )
                }
                disabled={exportingKey !== null || groupedByType.length === 0}
                title={t('materialCalc.export.zipTooltip')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {exportingKey === 'ALL' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Files className="w-3.5 h-3.5" />
                )}
                {exportingKey === 'ALL' ? t('materialCalc.export.preparing') : t('materialCalc.export.exportAllZip')}
              </button>
            </div>
            {filteredGroups.length === 0 && (
              <div className="card p-8 text-center text-sm text-gray-500">
                {t('materialCalc.filter.noMatch')}{' '}
                <button type="button" onClick={resetFilters} className="text-indigo-600 font-medium hover:underline">
                  {t('materialCalc.filter.reset')}
                </button>
              </div>
            )}
            {filteredGroups.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Card "Semua" */}
              <button
                type="button"
                onClick={() => {
                  setSelectedGramSupplier(null);
                  setSelectedMaterialType(null);
                }}
                className={`
                  w-full text-left rounded-xl border-2 p-4 transition-all duration-150
                  hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-300
                  ${selectedMaterialType === null
                    ? 'bg-indigo-50 border-indigo-400 shadow-sm'
                    : 'bg-white border-gray-200 hover:border-gray-300'}
                `}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 ${selectedMaterialType === null ? 'text-indigo-500' : 'text-gray-400'}`}>
                    {selectedMaterialType === null
                      ? <FolderOpen className="w-7 h-7" />
                      : <Folder className="w-7 h-7" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`font-semibold text-sm ${selectedMaterialType === null ? 'text-indigo-800' : 'text-gray-700'}`}>
                      {t('common.all')}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{t('materialCalc.group.sizeCount', { count: filteredGroups.length })}</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {filteredShortageGroups > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">
                          {t('materialCalc.group.shortCount', { count: filteredShortageGroups })}
                        </span>
                      )}
                      {filteredSufficientGroups > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">
                          {t('materialCalc.group.sufficientCount', { count: filteredSufficientGroups })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {/* Card per jenis material */}
              {filteredGroupedByType.map(({ type, groups: typeGroups }) => (
                <MaterialFolderCard
                  key={type}
                  materialType={type}
                  groups={typeGroups}
                  isSelected={selectedMaterialType === type}
                  exporting={exportingKey === type}
                  onClick={() => {
                    setSelectedGramSupplier(null);
                    clearSizeSelection();
                    setSelectedMaterialType((prev) => (prev === type ? null : type));
                  }}
                  onExport={() => {
                    const useSelected = selectedMaterialType === type && selectedSizeGroups.length > 0;
                    const groupsToExport = useSelected ? selectedSizeGroups : typeGroups;
                    const exportLabel = useSelected
                      ? selectedExportLabel(materialTypeLabel(type, lang), selectedSizeGroups.length)
                      : type;
                    runExport(type, () => exportMaterialTypePdf(exportLabel, groupsToExport, exportMeta, lang));
                  }}
                />
              ))}
            </div>
            )}
          </div>

          {/* ── Sub-folder: satu folder per kombinasi gramatur + supplier ── */}
          {selectedMaterialType && !activeGramSupplier && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {t('materialCalc.gramFolder.title', { label: materialTypeLabel(selectedMaterialType, lang) })}
                </div>
                <span className="text-xs text-gray-400">
                  {t('materialCalc.gramFolder.count', { count: gramSupplierFolders.length })}
                </span>
              </div>
              {gramSupplierFolders.length === 0 ? (
                <div className="card p-8 text-center text-gray-400 text-sm">
                  {t('materialCalc.gramFolder.empty')}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {gramSupplierFolders.map((f) => (
                    <GramSupplierFolderCard
                      key={f.key}
                      gramatur={f.gramatur}
                      supplier={f.supplier}
                      groups={f.groups}
                      exporting={exportingKey === f.key}
                      onClick={() => setSelectedGramSupplier(f.key)}
                      onExport={() =>
                        runExport(f.key, () =>
                          exportMaterialTypePdf(
                            `${materialTypeLabel(selectedMaterialType, lang)} · ${formatGramatur(f.gramatur, t('materialCalc.gramFolder.noGramatur'))} · ${f.supplier}`,
                            f.groups,
                            exportMeta,
                            lang,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Tabel ukuran + part number (isi sub-folder, atau semua ukuran bila "Semua") ── */}
          {/* ── Bar aksi untuk ukuran yang dicentang (lintas gramatur + supplier) ── */}
          {selectedMaterialType && selectedSizeGroups.length > 0 && (
            <div className="card flex flex-wrap items-center gap-2 px-4 py-2 rounded-lg border border-indigo-200 bg-indigo-50/70">
              <CheckCircle className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-medium text-indigo-900">
                {t('materialCalc.export.selectedCount', { count: selectedSizeGroups.length })}
              </span>
              <span className="hidden sm:inline text-xs text-indigo-700/80">
                {t('materialCalc.export.selectedTooltip')}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearSizeSelection}
                  disabled={exportingKey !== null}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  {t('materialCalc.export.clearSelection')}
                </button>
                <button
                  type="button"
                  onClick={exportSelectedPdf}
                  disabled={exportingKey !== null}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {exportingKey === 'SELECTED' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" />
                  )}
                  {exportingKey === 'SELECTED'
                    ? t('materialCalc.export.preparing')
                    : t('materialCalc.export.exportSelected', { count: selectedSizeGroups.length })}
                </button>
              </div>
            </div>
          )}

          {(!selectedMaterialType || activeGramSupplier) && (
          <div className="card overflow-hidden">
            {selectedMaterialType && (
              <div className={`px-4 py-2 border-b text-xs font-medium flex items-center gap-2 ${getMeta(selectedMaterialType).bg} ${getMeta(selectedMaterialType).color}`}>
                <Folder className="w-3.5 h-3.5" />
                {activeGramSupplier ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedGramSupplier(null)}
                      title={t('materialCalc.gramFolder.back')}
                      className="inline-flex items-center gap-0.5 hover:underline"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      {materialTypeLabel(selectedMaterialType, lang)}
                    </button>
                    <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                    <span>
                      {t('materialCalc.table.showingGramFolder', {
                        label: materialTypeLabel(selectedMaterialType, lang),
                        gramatur: formatGramatur(activeGramSupplier.gramatur, t('materialCalc.gramFolder.noGramatur')),
                        supplier: activeGramSupplier.supplier,
                        count: tableGroups.length,
                      })}
                    </span>
                  </>
                ) : (
                  <span>
                    {t('materialCalc.table.showingFolder', { label: materialTypeLabel(selectedMaterialType, lang), count: tableGroups.length })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={exportTablePdf}
                  disabled={exportingKey !== null || (selectedSizeGroups.length === 0 && tableGroups.length === 0)}
                  title={
                    selectedSizeGroups.length > 0
                      ? t('materialCalc.export.selectedTooltip')
                      : t('materialCalc.export.oneFileTooltip', {
                          count: tableGroups.length,
                          label: materialTypeLabel(selectedMaterialType, lang),
                        })
                  }
                  className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {exportingKey === 'TABLE' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FileDown className="w-3.5 h-3.5" />
                  )}
                  {exportingKey === 'TABLE'
                    ? t('materialCalc.export.preparing')
                    : selectedSizeGroups.length > 0
                      ? t('materialCalc.export.exportSelected', { count: selectedSizeGroups.length })
                      : t('materialCalc.export.pdf')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedGramSupplier(null);
                    setSelectedMaterialType(null);
                    clearSizeSelection();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-500 uppercase bg-gray-50/80">
                  <tr>
                    <th className="px-3 py-3 w-16">
                      {selectedMaterialType && (
                        <SelectAllCheckbox
                          checked={tableAllSelected}
                          indeterminate={!tableAllSelected && tableSomeSelected}
                          onChange={toggleSelectAllInTable}
                          title={t('materialCalc.export.selectAll')}
                        />
                      )}
                    </th>
                    <th className="px-4 py-3 font-semibold">{t('materialCalc.table.size')}</th>
                    <th className="px-4 py-3 font-semibold">{t('materialCalc.table.gramatur')}</th>
                    <th className="px-4 py-3 font-semibold">{t('materialCalc.table.supplier')}</th>
                    <th className="px-4 py-3 font-semibold text-center">{t('materialCalc.table.leadTime')}</th>
                    <th className="px-4 py-3 font-semibold">{t('materialCalc.table.procurement')}</th>
                    <th className="px-4 py-3 font-semibold text-right">{t('materialCalc.table.totalSheets')}</th>
                    <th className="px-4 py-3 font-semibold text-right">{t('materialCalc.table.totalKg')}</th>
                    <th className="px-4 py-3 font-semibold">{t('common.status')}</th>
                    <th className="px-4 py-3 font-semibold text-center">{t('common.detail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tableGroups.map((group, idx) => (
                    <GroupRow
                      key={`${group.ukuran}-${group.gramatur}-${idx}`}
                      group={group}
                      cycleId={cycleId}
                      canEdit={canEditMaterial}
                      selectable={Boolean(selectedMaterialType)}
                      selected={selectedSizeKeys.has(sizeSelectionKey(group))}
                      onToggleSelect={() => toggleSizeSelection(group)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </>
      )}

      {openFolder === 'CALC' && groups.length === 0 && !calculate.isPending && (
        <div className="card p-12 text-center text-gray-400">
          <Calculator className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-600">
            {activeCycle?.currentResult ? t('materialCalc.empty.recalc') : t('materialCalc.empty.calculate')}
          </p>
          <p className="text-sm mt-1">
            {t('materialCalc.empty.hintBefore')}<span className="font-medium">Master Data</span>{t('materialCalc.empty.hintAfter')}
            <strong>{activeCycle ? periodDisplayLabel(activeCycle, lang) : ''}</strong>.
          </p>
        </div>
      )}

      {/* Modal: riwayat perubahan */}
      {showAudit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAudit(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">{t('materialCalc.auditTitle')}</h2>
              <button type="button" onClick={() => setShowAudit(false)} className="p-2 text-gray-500 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(85vh-80px)]">
              {auditData?.data.length ? (
                <ul className="space-y-3">
                  {auditData.data.map((a: CycleAuditEntry) => (
                    <li key={a.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span className="font-medium text-gray-700">
                          {a.action} · {a.sourceType ?? a.entityType}
                        </span>
                        <span>{formatDateTime(a.createdAt, lang)}</span>
                      </div>
                      <div className="text-sm text-gray-700 mt-1">{a.notes || '—'}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{t('materialCalc.byUser', { name: a.user?.name ?? '—' })}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="py-8 text-center text-gray-500 text-sm">{t('materialCalc.noAudit')}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: buat periode baru */}
      {showNewPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowNewPeriod(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-6 py-4 font-semibold text-gray-900">{t('materialCalc.periods.create')}</div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('materialCalc.periods.uploadMonth')}</label>
                <input type="month" value={newMonth} onChange={(e) => setNewMonth(e.target.value)} className="input w-full" />
                <p className="text-xs text-gray-500 mt-1">
                  {t('materialCalc.periods.uploadMonthHint')}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('materialCalc.periods.nameLabel')}</label>
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={formatMonth(newMonth, lang)}
                  className="input w-full"
                />
              </div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewPeriod(false)} className="px-4 py-2 text-sm rounded-md border">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleCreatePeriod}
                disabled={createCycle.isPending}
                className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white disabled:opacity-50"
              >
                {createCycle.isPending ? t('materialCalc.periods.creating') : t('materialCalc.periods.createBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog: NPOF berubah */}
      {confirmNpof && (
        <ConfirmDialog
          title={t('materialCalc.npofChanged.title')}
          lines={[
            t('materialCalc.npofChanged.line1', { date: formatDateTime(npofCheck?.data.npofLastUpdatedAt, lang) }),
            t('materialCalc.npofChanged.line2', { date: formatDateTime(npofCheck?.data.lastCalculatedAt, lang) }),
            t('materialCalc.npofChanged.line3'),
          ]}
          confirmLabel={t('materialCalc.npofChanged.confirm')}
          busy={calculate.isPending}
          onCancel={() => setConfirmNpof(false)}
          onConfirm={() => void doCalculate()}
        />
      )}

      {/* Modal retensi */}
      {canEditMaterial && retentionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRetentionTarget(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-6 py-4 font-semibold text-gray-900">{t('materialCalc.retention.title')}</div>
            <div className="px-6 py-4 space-y-3 text-sm text-gray-700">
              <p>
                {t('materialCalc.retention.before')}<strong>{periodDisplayLabel(retentionTarget, lang)}</strong>{t('materialCalc.retention.after', { count: retentionTarget.savedResults.length })}
              </p>
              <ul className="text-xs text-gray-600 list-disc pl-5">
                {retentionTarget.savedResults.map((r) => (
                  <li key={r.id}>
                    run #{r.runNumber} · {formatDateTime(r.calculatedAt, lang)}
                    {r.savedNote ? ` — "${r.savedNote}"` : ''}
                  </li>
                ))}
              </ul>
              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked
                    readOnly
                    className="accent-indigo-600"
                  />
                  <span>{t('materialCalc.retention.keepFor')}</span>
                  <select
                    value={retentionMonths}
                    onChange={(e) => setRetentionMonths(Number(e.target.value))}
                    className="input py-1"
                  >
                    {(expiredData?.extensions ?? [3, 6, 9, 12]).map((m) => (
                      <option key={m} value={m}>
                        {t('materialCalc.retention.monthsOption', { count: m })}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  void retention.mutateAsync({ cycleId: retentionTarget.id, action: 'delete' });
                  setRetentionTarget(null);
                }}
                className="px-4 py-2 text-sm rounded-md border text-red-600"
              >
                {t('materialCalc.retention.deleteNow')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void retention.mutateAsync({ cycleId: retentionTarget.id, action: 'keep', months: retentionMonths });
                  setRetentionTarget(null);
                }}
                className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white"
              >
                {t('common.apply')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pemberitahuan retensi (tidak menutupi halaman) */}
      {canEditMaterial && expired.length > 0 && !retentionTarget && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start justify-between gap-4">
          <div>
            {t('materialCalc.retention.notice', { count: expired.length })}
          </div>
          <button
            type="button"
            onClick={() => setRetentionTarget(expired[0])}
            className="px-3 py-1.5 text-xs rounded-md bg-amber-600 text-white whitespace-nowrap"
          >
            {t('materialCalc.retention.review')}
          </button>
        </div>
      )}

      {/* Info kunci manual */}
      {activeCycle?.isLocked && (
        <div className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-700 flex items-center gap-2">
          <Lock className="w-4 h-4" />
          {t('materialCalc.lockedNotice')}
          <Unlock className="w-4 h-4 ml-2" />
        </div>
      )}
    </div>
  );
}
