import { useMemo, useState } from 'react';
import {
  useCalculateCycle,
  useCreateCycle,
  useCycleAudit,
  useCycleDataStatus,
  useCycleResultDetail,
  useCycles,
  useCycleRetentionAction,
  useExpiredCycles,
  useNpofCheck,
  useNpofCoverage,
  usePeriodSourceRows,
  NPOF_FIELD_LABELS,
  type CycleAuditEntry,
  type CycleCalculationResult,
  type CycleSourceRow,
  type CycleSummary,
  type ExpiredCycle,
  type MaterialGroup,
  type MaterialCalcResponse,
  type NpofCoverageRow,
  type NpofRequiredField,
  type PartNumberDetail,
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
import { id as indonesianLocale } from 'date-fns/locale';
import { usePeriods } from '../hooks/usePeriods';
import { exportAllMaterialTypesZip, exportMaterialTypePdf } from '../lib/materialCalcExport';
import { materialTypeLabel } from '../lib/materialCalcPdf';

// ── Format angka & tanggal ────────────────────────────────────────────────

function formatNum(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function formatMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00`);
  return Number.isNaN(date.getTime())
    ? 'Bulan tidak tersedia'
    : format(date, 'MMMM yyyy', { locale: indonesianLocale });
}

function formatWeekDate(date: string): string {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? '-' : format(parsed, 'dd MMM yyyy', { locale: indonesianLocale });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : format(parsed, 'dd MMM yyyy HH:mm', { locale: indonesianLocale });
}

/** Label pendek untuk kepala kolom minggu, mis. "19 Sep". */
function formatDayMonth(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '-' : format(parsed, 'dd MMM', { locale: indonesianLocale });
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
  const sheets = sheet ?? 0;
  const kilos = kg ?? 0;
  return (
    <td className={`px-2 py-1.5 text-right align-top tabular-nums ${sheets < 0 ? 'text-red-600' : 'text-gray-700'}`}>
      <div className="text-[11px] font-medium">{formatNum(sheets, 0)} lbr</div>
      {showKg && <div className="text-[11px] font-medium">{hasKg ? `${formatNum(kilos)} kg` : '—'}</div>}
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

// ── Tabel mingguan 26 kolom (sesuai Gambar 3) ─────────────────────────────

function WeeklyMatrixTable({ matrix }: { matrix: WeeklyMatrix }) {
  const width = matrix.columns.length;
  const { summary } = matrix;
  /**
   * Kg/Lbr grup, diambil dari kolom **Kg/Lbr** baris pertama yang punya formula
   * material. Semua keterangan kg di bawah = nilai lbr × angka ini.
   */
  const groupFm = matrix.rows.find((r) => r.hasKg)?.kgPerSheet ?? 0;
  const hasGroupKg = groupFm > 0;

  /** Baris ringkasan yang mengikuti pola yang sama untuk semua bagian. */
  const summaryRows: { label: string; sheet: number[]; strong?: boolean }[] = [
    { label: 'Total Req', sheet: summary.totalReqSheet, strong: true },
    { label: 'Allowance (5%)', sheet: summary.allowanceSheet },
    { label: 'Total + Allowance', sheet: summary.totalPlusAllowanceSheet, strong: true },
  ];

  return (
    <div className="overflow-x-auto border-t border-gray-200">
      <table className="text-xs border-collapse">
        <thead className="bg-gray-100 text-gray-600">
          <tr>
            <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-gray-100 z-10 min-w-[150px]">
              Part Number
            </th>
            <th className="px-3 py-2 text-left font-semibold min-w-[160px]">Deskripsi</th>
            <th className="px-2 py-2 text-left font-semibold">GSM</th>
            <th className="px-2 py-2 text-right font-semibold">Width</th>
            <th className="px-2 py-2 text-right font-semibold">Length</th>
            <th className="px-2 py-2 text-right font-semibold">Up</th>
            <th className="px-2 py-2 text-right font-semibold">Kg/Lbr</th>
            {matrix.columns.map((col) => (
              <th key={col.weekNumber} className="px-2 py-2 text-right font-semibold min-w-[74px]">
                <div className="text-[11px] text-indigo-600">{col.poMonthLabel}</div>
                <div className="text-[10px] text-gray-400">{formatDayMonth(col.weekStartDate)}</div>
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
              <td className="px-2 py-1.5 text-right text-gray-700">{formatNum(row.up, 0)}</td>
              <td className="px-2 py-1.5 text-right text-gray-700">{row.hasKg ? formatNum(row.kgPerSheet, 4) : '—'}</td>
              {Array.from({ length: width }).map((_, i) => (
                <UnitCell key={i} sheet={row.weeksSheet[i]} kg={row.weeks[i]} hasKg={row.hasKg} />
              ))}
            </tr>
          ))}

          {summaryRows.map((r) => (
            <tr key={r.label} className={r.strong ? 'bg-indigo-50/40 font-semibold' : 'bg-gray-50/60'}>
              <td className="px-3 py-1.5 text-gray-700 sticky left-0 bg-inherit z-10" colSpan={7}>
                {r.label}
                {r.label === 'Total Req' && <span className="ml-2 text-[10px] font-normal text-amber-600">sebagian estimasi</span>}
              </td>
              {Array.from({ length: width }).map((_, i) => {
                const showKg = r.label === 'Total + Allowance';
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
              Stock As Of
            </td>
            <UnitCell sheet={summary.stockAsOfSheet} kg={summary.stockAsOfSheet * groupFm} hasKg={hasGroupKg} showKg />
            {Array.from({ length: Math.max(0, width - 1) }).map((_, i) => (
              <td key={i} className="px-2 py-1.5 text-right text-gray-300">
                —
              </td>
            ))}
          </tr>

          <tr className="bg-gray-50/60">
            <td className="px-3 py-1.5 text-gray-700 sticky left-0 bg-inherit z-10" colSpan={7}>
              Outstanding PO
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

          <tr className="bg-gray-100/70 font-semibold">
            <td className="px-3 py-1.5 text-gray-800 sticky left-0 bg-inherit z-10" colSpan={7}>
              End Ind
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
  return (
    <div className="overflow-x-auto border-t border-gray-200">
      <table className="w-full text-xs">
        <thead className="bg-gray-100 text-gray-600 uppercase">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Part Number</th>
            <th className="px-3 py-2 text-right font-semibold">Demand (pcs)</th>
            <th className="px-3 py-2 text-right font-semibold">Keb. Bersih (lbr)</th>
            <th className="px-3 py-2 text-right font-semibold">Stok Teralokasi (kg)</th>
            <th className="px-3 py-2 text-right font-semibold">Sheet Beli</th>
            <th className="px-3 py-2 text-right font-semibold">Pcs Beli</th>
            <th className="px-3 py-2 text-right font-semibold">Kg Beli</th>
            <th className="px-3 py-2 text-center font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {details.map((d) => (
            <tr key={d.partNumber} className="hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-900">
                <div className="flex items-center gap-1">
                  {d.noNpofData && (
                    <span title="Belum ada data NPOF — dihitung dengan estimasi jumbo roll 180 cm">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    </span>
                  )}
                  {d.partNumber}
                </div>
              </td>
              <td className="px-3 py-2 text-right text-gray-700">{formatNum(d.demandPcs, 0)}</td>
              <td className="px-3 py-2 text-right text-gray-700">{formatNum(d.sheetsNet2, 0)}</td>
              <td className="px-3 py-2 text-right text-gray-700">{formatNum(d.allocatedKg)}</td>
              {d.isSufficient ? (
                <>
                  <td className="px-3 py-2 text-center text-gray-400">—</td>
                  <td className="px-3 py-2 text-center text-gray-400">—</td>
                  <td className="px-3 py-2 text-center text-gray-400">—</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      <CheckCircle className="w-3 h-3" />
                      Sisa {formatNum(d.surplusKg)} kg
                    </span>
                  </td>
                </>
              ) : (
                <>
                  <td className="px-3 py-2 text-right font-bold text-red-600">{formatNum(d.shortageSheet, 0)}</td>
                  <td className="px-3 py-2 text-right font-bold text-red-600">{formatNum(d.shortagePcs, 0)}</td>
                  <td className="px-3 py-2 text-right font-bold text-red-600">{formatNum(d.shortageKg)}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                      Kurang
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

function GroupRow({ group }: { group: MaterialGroup }) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'matrix' | 'detail'>('matrix');
  const planningTimeline = group.planningTimeline || getFallbackTimeline(group.leadTimeMonths);
  const estimatedInGroup = group.details.filter((d) => d.noNpofData).length;

  return (
    <>
      <tr
        className={`cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-200 ${
          expanded ? 'bg-indigo-50/30' : ''
        }`}
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3 text-gray-400">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </td>
        <td className="px-4 py-3 font-medium text-gray-900">
          <div>{group.ukuran}</div>
          {estimatedInGroup > 0 && (
            <div className="text-[11px] font-normal text-amber-600">
              ⚠️ {formatNum(estimatedInGroup, 0)} dari {formatNum(group.details.length, 0)} part datanya belum lengkap (estimasi)
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-gray-700">{group.gramatur || '—'}</td>
        <td className="px-4 py-3 text-gray-700">{group.supplier}</td>
        <td className="px-4 py-3 text-center">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
            {group.leadTimeMonths} bln
          </span>
        </td>
        <td className="px-4 py-3 text-xs text-gray-600">
          <div>
            Beli: <span className="font-medium text-gray-800">{formatMonth(planningTimeline.purchaseMonth)}</span>
          </div>
          <div>
            Tiba: <span className="font-medium text-gray-800">{formatMonth(planningTimeline.arrivalMonth)}</span>
          </div>
          <div>
            Pakai: <span className="font-medium text-gray-800">{formatMonth(planningTimeline.usageMonth)}</span>
          </div>
        </td>
        {group.isSufficient ? (
          <>
            <td className="px-4 py-3 text-center text-gray-400">—</td>
            <td className="px-4 py-3 text-center text-gray-400">—</td>
            <td className="px-4 py-3">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                <CheckCircle className="w-3.5 h-3.5" />
                Tercukupi, sisa {formatNum(group.surplusKg)} kg
              </span>
            </td>
          </>
        ) : (
          <>
            <td className="px-4 py-3 text-right font-bold text-red-600">
              {formatNum(group.totalShortageSheet, 0)} lbr
            </td>
            <td className="px-4 py-3 text-right font-bold text-red-600">{formatNum(group.totalShortageKg)} kg</td>
            <td className="px-4 py-3">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                ⚠️ Kurang {formatNum(group.totalShortageKg)} kg
              </span>
            </td>
          </>
        )}
        <td className="px-4 py-3 text-center text-gray-500 text-sm">{group.details.length} part</td>
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
                Tabel 26 Minggu
              </button>
              <button
                type="button"
                onClick={() => setTab('detail')}
                className={`px-3 py-1.5 text-xs rounded-md ${
                  tab === 'detail' ? 'bg-indigo-600 text-white' : 'bg-white border text-gray-700'
                }`}
              >
                Rincian per Part
              </button>
              <span className="text-[11px] text-gray-500">
                Satuan: lembar (lbr). Keterangan kg (= lbr × Kg/Lbr) ditampilkan pada baris Total + Allowance,
                Stock As Of, Outstanding PO, dan End Ind.
              </span>
            </div>
            {tab === 'matrix' ? <WeeklyMatrixTable matrix={group.weeklyMatrix} /> : <DetailTable details={group.details} />}
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

/** Label judul folder gramatur, mis. "450" -> "450 gsm"; kosong -> "Tanpa gramatur". */
function formatGramatur(gramatur: string): string {
  if (!gramatur || gramatur === '—') return 'Tanpa gramatur';
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
            {materialType}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {groups.length} ukuran
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {shortageCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">
                ⚠️ {shortageCount} kurang
              </span>
            )}
            {sufficientCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">
                ✅ {sufficientCount} cukup
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
          title={`Satu file PDF berisi ${groups.length} ukuran di folder ${materialTypeLabel(materialType)}`}
          className="inline-flex w-full items-center justify-center gap-1 px-2 py-1 text-[11px] rounded-md border border-gray-300 text-gray-700 hover:bg-white disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
          {exporting ? 'Menyiapkan...' : 'Export PDF'}
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
          <div className="font-semibold text-sm text-gray-800">{formatGramatur(gramatur)}</div>
          <div className="text-xs text-gray-500 mt-0.5 truncate" title={supplier}>
            {supplier}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {groups.length} ukuran · {partCount} part
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {shortageCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">
                ⚠️ {shortageCount} kurang
              </span>
            )}
            {sufficientCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">
                ✅ {sufficientCount} cukup
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
          title={`Satu file PDF berisi ${groups.length} ukuran untuk gramatur & supplier ini`}
          className="inline-flex w-full items-center justify-center gap-1 px-2 py-1 text-[11px] rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
          {exporting ? 'Menyiapkan...' : 'Export PDF'}
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
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white disabled:opacity-50"
          >
            {busy ? 'Memproses...' : confirmLabel}
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
const SOURCE_COLUMNS: Record<string, { key: string; label: string; numeric?: boolean }[]> = {
  MRP: [
    { key: 'item.partNumber', label: 'Part Number' },
    { key: 'item.itemName', label: 'Description' },
    { key: 'year', label: 'Tahun', numeric: true },
    { key: 'weekNumber', label: 'Minggu', numeric: true },
    { key: 'quantity', label: 'Qty', numeric: true },
    { key: 'weekStartDate', label: 'Mulai Minggu' },
  ],
  WIP: [
    { key: 'item.partNumber', label: 'Part Number' },
    { key: 'item.itemName', label: 'Description' },
    { key: 'location', label: 'Lokasi' },
    { key: 'quantity', label: 'Qty', numeric: true },
    { key: 'status', label: 'Status' },
    { key: 'date', label: 'Tanggal' },
  ],
  HOTLIST: [
    { key: 'partNumber', label: 'Part Number' },
    { key: 'biTotal', label: 'BI Total', numeric: true },
    { key: 'date', label: 'Tanggal' },
    { key: 'previousDate', label: 'Tanggal Sebelumnya' },
  ],
  STOCK_RM: [
    { key: 'itemDesc', label: 'Item' },
    { key: 'refB', label: 'Ref-B' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'qty', label: 'Qty', numeric: true },
    { key: 'unit', label: 'Satuan' },
    { key: 'date', label: 'Tanggal' },
  ],
  OUTSTANDING_PO: [
    { key: 'poNumber', label: 'PO Number' },
    { key: 'planReceivedDate', label: 'Tgl Rencana' },
    { key: 'supplierName', label: 'Supplier' },
    { key: 'itemDesc', label: 'Item' },
    { key: 'refB', label: 'Ref-B' },
    { key: 'qtyOrder', label: 'Qty Order', numeric: true },
    { key: 'qtyOrderUnit', label: 'Satuan' },
    { key: 'qtyDelivered', label: 'Terkirim', numeric: true },
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
  const cols = SOURCE_COLUMNS[sourceType] ?? [];
  const LIMIT = 300;
  const shown = rows.slice(0, LIMIT);

  return (
    <div>
      <div className="px-4 py-3 border-b bg-gray-50 text-xs text-gray-500">
        {formatNum(rows.length, 0)} baris
        {rows.length > LIMIT ? ` · menampilkan ${LIMIT} baris pertama` : ''}
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
                  {c.label}
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

const SOURCE_LABELS: Record<string, string> = {
  MRP: 'MRP 26 weeks',
  HOTLIST: 'Hot List',
  STOCK_RM: 'Stock Raw Material',
  OUTSTANDING_PO: 'Outstanding PO',
  WIP: 'WIP',
};

/** Sub-folder khusus: part MRP yang tidak ada / datanya kurang di NPOF. */
const NPOF_CHECK = 'NPOF_CHECK';

const NPOF_STATUS_META: Record<NpofCoverageRow['status'], { label: string; badge: string }> = {
  MISSING: { label: 'Tidak ada di NPOF', badge: 'bg-red-50 text-red-700 border-red-200' },
  INCOMPLETE: { label: 'Data NPOF kurang', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
};

/** Tabel part MRP yang tidak ada di NPOF / datanya kurang, dengan pencarian & filter. */
function NpofCoveragePanel({
  data,
  isLoading,
}: {
  data?: { summary: { mrpPartCount: number; missingNpofCount: number; incompleteNpofCount: number; completeNpofCount: number; criticalCount: number }; rows: NpofCoverageRow[]; npofTotalRows: number };
  isLoading: boolean;
}) {
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
        Belum ada data MRP untuk periode ini, jadi belum ada part yang bisa dibandingkan dengan NPOF.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Ringkasan cakupan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-xs text-gray-500">Part di MRP periode ini (26 minggu penuh)</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{formatNum(summary.mrpPartCount, 0)}</div>
        </div>
        <div className="card p-4 border-red-200 bg-red-50/40">
          <div className="text-xs text-red-700">Tidak ada di NPOF</div>
          <div className="text-2xl font-bold text-red-700 mt-1">{formatNum(summary.missingNpofCount, 0)}</div>
        </div>
        <div className="card p-4 border-amber-200 bg-amber-50/40">
          <div className="text-xs text-amber-700">Ada di NPOF, data kurang</div>
          <div className="text-2xl font-bold text-amber-700 mt-1">{formatNum(summary.incompleteNpofCount, 0)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-gray-500">Data NPOF lengkap</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{formatNum(summary.completeNpofCount, 0)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 text-xs text-blue-900">
        NPOF adalah referensi bersama semua periode ({formatNum(data?.npofTotalRows ?? 0, 0)} baris).{' '}
        <span className="font-medium">{formatNum(summary.criticalCount, 0)} part</span> di antaranya tidak punya formula
        material dan/atau ups, sehingga kebutuhan kg-nya dihitung dengan nilai default (estimasi jumbo roll 180 cm).
        <div className="mt-1">
          Perhitungan mencakup <span className="font-medium">seluruh 26 minggu periode</span>, termasuk minggu yang
          sudah lewat. Halaman Master Data → 26-Week Demand hanya menampilkan minggu yang belum lewat, jadi jumlah item
          di sana bisa lebih kecil dari angka di atas.
        </div>
      </div>

      {/* Filter & pencarian */}
      <div className="card p-3 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex rounded-md border overflow-hidden shrink-0">
          {([
            ['ALL', `Semua (${formatNum(allRows.length, 0)})`],
            ['MISSING', `Tanpa NPOF (${formatNum(summary.missingNpofCount, 0)})`],
            ['INCOMPLETE', `Data kurang (${formatNum(summary.incompleteNpofCount, 0)})`],
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
          Hanya yang estimasi (formula/ups kosong)
        </label>

        <div className="flex-1" />

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari part number / description / supplier…"
          className="input w-full lg:w-72"
        />
      </div>

      {/* Tabel */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 text-xs text-gray-500">
          {formatNum(rows.length, 0)} part
          {rows.length > LIMIT ? ` · menampilkan ${LIMIT} baris pertama` : ''}
        </div>
        <div className="overflow-x-auto max-h-[65vh]">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50/70 sticky top-0">
              <tr>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">Part Number</th>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">Description</th>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">Status</th>
                <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">Minggu Demand</th>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">Jenis Material</th>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">Supplier</th>
                <th className="px-4 py-2 font-semibold text-left whitespace-nowrap">Data NPOF Kurang</th>
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
                        <span className="ml-2 text-[10px] font-normal text-gray-400" title="Dicetak nebeng pada part lain">
                          nebeng
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600 max-w-[22rem] truncate" title={r.productName}>
                      {r.productName}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.badge}`}>
                        {meta.label}
                      </span>
                      {r.critical && (
                        <span className="ml-1 text-[10px] text-amber-600" title="Kebutuhan kg dihitung dengan nilai default (estimasi)">
                          ⚠ estimasi
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700 whitespace-nowrap">
                      {formatNum(r.demandWeekCount, 0)} minggu
                    </td>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                      {r.materialType ?? '—'}
                      {r.material && <span className="ml-1 text-[10px] text-gray-400">({r.material})</span>}
                    </td>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{r.supplier ?? '—'}</td>
                    <td className="px-4 py-2">
                      {r.status === 'MISSING' ? (
                        <span className="text-xs text-red-600">Seluruh data NPOF belum ada</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.missingFields.map((f: NpofRequiredField) => (
                            <span
                              key={f}
                              className="inline-flex rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"
                            >
                              {NPOF_FIELD_LABELS[f]}
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
                    Tidak ada part yang cocok dengan filter/pencarian.
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
  const { data: expiredData } = useExpiredCycles();

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
      if (!map.has(raw)) map.set(raw, formatGramatur(raw || '—'));
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
  }, [groups]);

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
    const knownOrder = MATERIAL_ORDER.filter((t) => map.has(t));
    const unknown = [...map.keys()].filter((t) => !MATERIAL_ORDER.includes(t)).sort();
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

  // ── Export PDF (satu file per folder jenis material) ──
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  const exportMeta = useMemo(
    () => ({
      periodLabel: activeCycle?.label ?? null,
      periodStart: shown?.periodStartDate ?? activeCycle?.mrpStartDate ?? null,
      periodEnd: shown?.periodEndDate ?? activeCycle?.mrpEndDate ?? null,
      calculatedAt: shown?.calculatedAt ?? activeCycle?.currentResult?.calculatedAt ?? null,
    }),
    [activeCycle, shown],
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
          text: key === 'ALL' ? 'Export selesai: beberapa PDF dalam satu file ZIP.' : 'Export PDF selesai.',
        });
      } catch (e) {
        setToast({ kind: 'err', text: e instanceof Error ? e.message : 'Gagal membuat PDF' });
      } finally {
        setExportingKey(null);
      }
    }, 40);
  };

  const statusBadge = (() => {
    if (!activeCycle) return null;
    if (activeCycle.isLocked) {
      return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-700">🔒 Terkunci</span>;
    }
    if (activeCycle.derivedStatus === 'NOT_CALCULATED') {
      return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">🔵 Belum dihitung</span>;
    }
    if (activeCycle.derivedStatus === 'STALE') {
      return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">🟠 Perlu dihitung ulang</span>;
    }
    return <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">🟢 Sudah dihitung</span>;
  })();

  const doCalculate = async () => {
    if (!cycleId) return;
    try {
      const res = await calculate.mutateAsync({ cycleId });
      setCalcResult(res.data);
      setSelectedRunId(res.data.id);
      setConfirmNpof(false);
      setToast({ kind: 'ok', text: `Perhitungan run #${res.data.runNumber} selesai.` });
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : 'Gagal menghitung' });
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
      setToast({ kind: 'ok', text: `Periode "${res.data.label}" dibuat. Sekarang isi datanya.` });
    } catch (e) {
      setToast({ kind: 'err', text: e instanceof Error ? e.message : 'Gagal membuat periode' });
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
            Material Calculation
          </h1>
          <p className="text-gray-500 mt-1">
            Perhitungan per periode, mencakup MRP penuh. Setiap periode terisolasi dari periode lain.
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
            Riwayat Perubahan
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
              <p className="font-medium text-gray-600">Belum ada periode</p>
              <p className="text-sm mt-1">
                Buat periode dulu (mis. September 2026), upload data master-nya di menu Master Data, lalu hitung di sini.
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
                    {c.label}
                    {c.isLocked && <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {c.currentResult ? `Dihitung ${formatDateTime(c.currentResult.calculatedAt)}` : 'Belum dihitung'}
                  </div>
                  {c.derivedStatus === 'STALE' && (
                    <div className="text-xs text-amber-600 font-medium mt-1">⚠ Perlu dihitung ulang</div>
                  )}
                </div>
              </button>
            ))}

            <button
              type="button"
              onClick={() => setShowNewPeriod(true)}
              className="p-5 border-2 border-dashed rounded-lg bg-white hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors flex items-center gap-3 text-gray-500"
            >
              <Plus className="w-6 h-6" />
              <span className="font-medium">Buat Periode Baru</span>
            </button>
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
                {openFolder ? 'Kembali ke periode' : 'Semua periode'}
              </button>

              <div className="min-w-0">
                <div className="text-sm text-gray-800 flex items-center gap-1.5">
                  <Folder className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span className="font-semibold truncate">{activeCycle.label}</span>
                  {openFolder && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="truncate text-gray-600">
                        {openFolder === 'CALC'
                          ? 'Calculation'
                          : openFolder === NPOF_CHECK
                            ? 'Part tanpa / kurang NPOF'
                            : (SOURCE_LABELS[openFolder] ?? openFolder)}
                      </span>
                    </>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {activeCycle.displayText}
                  {activeCycle.mrpStartDate && activeCycle.mrpEndDate && (
                    <>
                      {' '}
                      · MRP {activeCycle.weekCount} minggu: {formatWeekDate(activeCycle.mrpStartDate)} –{' '}
                      {formatWeekDate(activeCycle.mrpEndDate)}
                    </>
                  )}
                </div>
              </div>

              <div className="flex-1" />

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
                {calculate.isPending ? 'Menghitung...' : dataStatus?.hasResult ? 'Hitung Ulang' : 'Hitung'}
              </button>
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
                    Data berubah: {dataStatus.changedSources.map((s) => SOURCE_LABELS[s] ?? s).join(', ')}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleCalculate}
                disabled={calculate.isPending || activeCycle.isLocked}
                className="btn btn-primary shrink-0"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Hitung Ulang
              </button>
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
                <div className="font-semibold text-gray-900">Calculation</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {dataStatus?.hasResult ? `${formatNum(groups.length, 0)} grup material` : 'Belum dihitung'}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setOpenFolder(NPOF_CHECK)}
                className="card p-5 text-left hover:border-rose-400 hover:bg-rose-50/30 transition-colors"
              >
                <AlertTriangle className="w-7 h-7 text-rose-600 mb-2" />
                <div className="font-semibold text-gray-900">Part tanpa NPOF</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {npofCoverageLoading
                    ? 'Memuat…'
                    : npofCoverageData?.data
                      ? `${formatNum(
                          npofCoverageData.data.summary.missingNpofCount +
                            npofCoverageData.data.summary.incompleteNpofCount,
                          0,
                        )} part perlu ditinjau`
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
                    <div className="font-semibold text-gray-900">{SOURCE_LABELS[key] ?? key}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {formatNum(rowCount, 0)} baris
                      {dataStatus?.changedSources.includes(key) && (
                        <span className="text-amber-600 font-medium"> · berubah</span>
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
                  Belum ada data {SOURCE_LABELS[openFolder] ?? openFolder} untuk periode ini.
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
              <div className="text-sm text-gray-500">Total Grup Material</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{groups.length}</div>
            </div>
            <div className="card p-4 border-red-200">
              <div className="text-sm text-gray-500">Perlu Dibeli</div>
              <div className="text-2xl font-bold text-red-600 mt-1">{shortageGroups} grup</div>
            </div>
            <div className="card p-4 border-green-200">
              <div className="text-sm text-gray-500">Stok Tercukupi</div>
              <div className="text-2xl font-bold text-green-600 mt-1">{sufficientGroups} grup</div>
            </div>
          </div>

          {/* ── Filter hasil perhitungan: gramatur, supplier, pencarian ── */}
          <div className="card p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide pb-2">
                <Filter className="w-3.5 h-3.5" />
                Filter hasil
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-gray-500">Gramatur</span>
                <select
                  value={filterGramatur}
                  onChange={(e) => setFilterGramatur(e.target.value)}
                  className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="ALL">Semua gramatur</option>
                  {gramaturOptions.map((o) => (
                    <option key={o.value || '__tanpa_gramatur__'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-gray-500">Supplier</span>
                <select
                  value={filterSupplier}
                  onChange={(e) => setFilterSupplier(e.target.value)}
                  className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  <option value="ALL">Semua supplier</option>
                  {supplierOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
                <span className="text-[11px] font-medium text-gray-500">Cari ukuran / part number</span>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="mis. 66 x 50 CM atau JPT87-0940"
                    title="Mencari pada ukuran, part number, dan deskripsi part"
                    className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                  {searchQuery !== '' && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      title="Bersihkan pencarian"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </label>

              <div className="flex items-center gap-2 pb-1">
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {filteredGroups.length} / {groups.length} ukuran
                </span>
                {hasActiveFilter && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Grid folder card ── */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Pilih jenis material
              </div>
              <button
                type="button"
                onClick={() =>
                  runExport('ALL', () =>
                    exportAllMaterialTypesZip(
                      groupedByType.map(({ type, groups: typeGroups }) => ({ materialType: type, groups: typeGroups })),
                      exportMeta,
                    ),
                  )
                }
                disabled={exportingKey !== null || groupedByType.length === 0}
                title="Beberapa PDF terpisah (satu per jenis material) di dalam satu file ZIP"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {exportingKey === 'ALL' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Files className="w-3.5 h-3.5" />
                )}
                {exportingKey === 'ALL' ? 'Menyiapkan...' : 'Export Semua (ZIP)'}
              </button>
            </div>
            {filteredGroups.length === 0 && (
              <div className="card p-8 text-center text-sm text-gray-500">
                Tidak ada hasil perhitungan yang cocok dengan filter.{' '}
                <button type="button" onClick={resetFilters} className="text-indigo-600 font-medium hover:underline">
                  Reset filter
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
                      Semua
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{filteredGroups.length} ukuran</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {shortageGroups > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700">
                          ⚠️ {filteredShortageGroups} kurang
                        </span>
                      )}
                      {sufficientGroups > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-700">
                          ✅ {filteredSufficientGroups} cukup
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
                    setSelectedMaterialType((prev) => (prev === type ? null : type));
                  }}
                  onExport={() =>
                    runExport(type, () => exportMaterialTypePdf(type, typeGroups, exportMeta))
                  }
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
                  Folder gramatur &amp; supplier di {materialTypeLabel(selectedMaterialType)}
                </div>
                <span className="text-xs text-gray-400">{gramSupplierFolders.length} folder</span>
              </div>
              {gramSupplierFolders.length === 0 ? (
                <div className="card p-8 text-center text-gray-400 text-sm">
                  Tidak ada grup material di folder ini.
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
                            `${materialTypeLabel(selectedMaterialType)} · ${formatGramatur(f.gramatur)} · ${f.supplier}`,
                            f.groups,
                            exportMeta,
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
                        title="Kembali ke daftar gramatur & supplier"
                        className="inline-flex items-center gap-0.5 hover:underline"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        {materialTypeLabel(selectedMaterialType)}
                      </button>
                      <ChevronRight className="w-3.5 h-3.5 opacity-60" />
                      <span>
                        {formatGramatur(activeGramSupplier.gramatur)} · {activeGramSupplier.supplier} ({tableGroups.length} ukuran)
                      </span>
                    </>
                  ) : (
                    <span>
                      Menampilkan folder: {materialTypeLabel(selectedMaterialType)} ({tableGroups.length} ukuran)
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      runExport('TABLE', () =>
                        exportMaterialTypePdf(
                          activeGramSupplier
                            ? `${materialTypeLabel(selectedMaterialType)} · ${formatGramatur(activeGramSupplier.gramatur)} · ${activeGramSupplier.supplier}`
                            : selectedMaterialType,
                          tableGroups,
                          exportMeta,
                        ),
                      )
                    }
                    disabled={exportingKey !== null}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {exportingKey === 'TABLE' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileDown className="w-3.5 h-3.5" />
                    )}
                    {exportingKey === 'TABLE' ? 'Menyiapkan...' : 'Export PDF'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGramSupplier(null);
                      setSelectedMaterialType(null);
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
                      <th className="px-4 py-3 w-10"></th>
                      <th className="px-4 py-3 font-semibold">Ukuran Material</th>
                      <th className="px-4 py-3 font-semibold">Gramatur</th>
                      <th className="px-4 py-3 font-semibold">Supplier</th>
                      <th className="px-4 py-3 font-semibold text-center">Lead Time</th>
                      <th className="px-4 py-3 font-semibold">Estimasi Pengadaan</th>
                      <th className="px-4 py-3 font-semibold text-right">Total Sheet Beli</th>
                      <th className="px-4 py-3 font-semibold text-right">Total Kg Beli</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-center">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableGroups.map((group, idx) => (
                      <GroupRow key={`${group.ukuran}-${group.gramatur}-${idx}`} group={group} />
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
            {activeCycle?.currentResult ? 'Klik "Hitung Ulang" untuk menghitung ulang periode ini' : 'Klik "Hitung" untuk menjalankan kalkulasi'}
          </p>
          <p className="text-sm mt-1">
            Kalau data periode masih kosong, upload dulu di menu <span className="font-medium">Master Data</span> (26-Week
            Demand, WIP, Hot List, Stock Raw Material, Outstanding PO) dan pilih periode{' '}
            <strong>{activeCycle?.label}</strong>.
          </p>
        </div>
      )}

      {/* Modal: riwayat perubahan */}
      {showAudit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAudit(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Riwayat Perubahan Periode</h2>
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
                        <span>{formatDateTime(a.createdAt)}</span>
                      </div>
                      <div className="text-sm text-gray-700 mt-1">{a.notes || '—'}</div>
                      <div className="text-xs text-gray-500 mt-0.5">oleh {a.user?.name ?? '—'}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="py-8 text-center text-gray-500 text-sm">Belum ada catatan perubahan.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: buat periode baru */}
      {showNewPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowNewPeriod(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-6 py-4 font-semibold text-gray-900">Buat Periode Baru</div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bulan upload</label>
                <input type="month" value={newMonth} onChange={(e) => setNewMonth(e.target.value)} className="input w-full" />
                <p className="text-xs text-gray-500 mt-1">
                  Periode ditentukan oleh bulan upload, bukan tanggal di dalam data. Satu bulan upload = satu periode.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nama periode (opsional)</label>
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={formatMonth(newMonth)}
                  className="input w-full"
                />
              </div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewPeriod(false)} className="px-4 py-2 text-sm rounded-md border">
                Batal
              </button>
              <button
                type="button"
                onClick={handleCreatePeriod}
                disabled={createCycle.isPending}
                className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white disabled:opacity-50"
              >
                {createCycle.isPending ? 'Membuat...' : 'Buat Periode'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog: NPOF berubah */}
      {confirmNpof && (
        <ConfirmDialog
          title="ℹ️ NPOF sudah berubah"
          lines={[
            `Data NPOF terakhir diubah ${formatDateTime(npofCheck?.data.npofLastUpdatedAt)}.`,
            `Periode ini terakhir dihitung ${formatDateTime(npofCheck?.data.lastCalculatedAt)}.`,
            'Perhitungan akan mengikuti NPOF yang sudah berubah, sehingga angka periode ini bisa berbeda dari sebelumnya. Periode lain tidak terpengaruh.',
          ]}
          confirmLabel="Lanjutkan Hitung"
          busy={calculate.isPending}
          onCancel={() => setConfirmNpof(false)}
          onConfirm={() => void doCalculate()}
        />
      )}

      {/* Modal retensi */}
      {retentionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRetentionTarget(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-6 py-4 font-semibold text-gray-900">⏳ Periode melewati retensi 18 bulan</div>
            <div className="px-6 py-4 space-y-3 text-sm text-gray-700">
              <p>
                Periode <strong>{retentionTarget.label}</strong> sudah melewati batas retensi dan punya{' '}
                {retentionTarget.savedResults.length} hasil tersimpan.
              </p>
              <ul className="text-xs text-gray-600 list-disc pl-5">
                {retentionTarget.savedResults.map((r) => (
                  <li key={r.id}>
                    run #{r.runNumber} · {formatDateTime(r.calculatedAt)}
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
                  <span>Tetap simpan selama</span>
                  <select
                    value={retentionMonths}
                    onChange={(e) => setRetentionMonths(Number(e.target.value))}
                    className="input py-1"
                  >
                    {(expiredData?.extensions ?? [3, 6, 9, 12]).map((m) => (
                      <option key={m} value={m}>
                        {m} bulan
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
                Hapus sekarang
              </button>
              <button
                type="button"
                onClick={() => {
                  void retention.mutateAsync({ cycleId: retentionTarget.id, action: 'keep', months: retentionMonths });
                  setRetentionTarget(null);
                }}
                className="px-4 py-2 text-sm rounded-md bg-indigo-600 text-white"
              >
                Terapkan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pemberitahuan retensi (tidak menutupi halaman) */}
      {expired.length > 0 && !retentionTarget && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start justify-between gap-4">
          <div>
            Ada {expired.length} periode yang sudah melewati retensi 18 bulan dan punya hasil tersimpan. Data tidak
            dihapus otomatis — silakan pilih mau tetap disimpan atau dihapus.
          </div>
          <button
            type="button"
            onClick={() => setRetentionTarget(expired[0])}
            className="px-3 py-1.5 text-xs rounded-md bg-amber-600 text-white whitespace-nowrap"
          >
            Tinjau
          </button>
        </div>
      )}

      {/* Info kunci manual */}
      {activeCycle?.isLocked && (
        <div className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-700 flex items-center gap-2">
          <Lock className="w-4 h-4" />
          Periode ini terkunci. Data dan perhitungan tidak bisa diubah sampai kunci dibuka oleh SUPER_ADMIN.
          <Unlock className="w-4 h-4 ml-2" />
        </div>
      )}
    </div>
  );
}
