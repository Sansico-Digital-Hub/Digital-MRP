/**
 * Normalisasi data NPOF dari Integration API SNF (read-only).
 *
 * Kontrak terbaru (November 2026):
 *   GET /npof/integration/materials?plant_id=<plant>
 *
 * Endpoint mengirim SEMUA status NPOF (Draft / Waiting for Approval /
 * Completed), sehingga setiap baris membawa:
 *   - status_label, is_approved, ups_counted
 *   - effective_spec + spec_source ("own" / "parent" / "none")
 *
 * Endpoint legacy `/npof/process-a/materials` TIDAK lagi dipakai.
 *
 * Prinsip penting:
 *   - PART NUMBER tidak pernah diisi dari part_name / npof_title.
 *   - PRODUCT NAME selalu product_name, bukan judul NPOF.
 *   - UPS hanya dihitung bila `ups_counted = true` (baris approved).
 *   - Kolom spec memakai `effective_spec`, bukan merge endpoint legacy.
 */

/** Prefix kunci untuk baris tanpa part number (agar tetap unik & bisa ditampilkan). */
export const EMPTY_PART_NUMBER_KEY_PREFIX = '__NO_PART__';

export interface SnfSpec {
  sheeted_size?: string | null;
  gramatur?: string | null;
  width?: number | string | null;
  material?: string | null;
  material_desc?: string | null;
  supplier?: string | null;
  formula_material?: string | null;
}

export interface SnfSourceNpof {
  npof_id?: number | string | null;
  npof_no?: string | null;
  rev?: string | null;
  rev_raw?: string | null;
  is_alt?: boolean | null;
  status?: string | null;
  status_label?: string | null;
  approval_status?: string | null;
  approval_status_label?: string | null;
  approved_by?: number | string | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
}

/** Baris `/npof/integration/materials`. */
export interface SnfMainRow {
  part_number?: string | number | null;
  part_name?: string | null;
  npof_title?: string | null;
  product_name?: string | null;
  scenario?: string | null;
  plant_id?: number | string | null;

  status?: string | null;
  status_label?: string | null;
  approval_status?: string | null;
  approval_status_label?: string | null;
  is_approved?: boolean | null;
  ups_counted?: boolean | null;

  removed_in_latest_rev?: boolean | null;
  selected_npof_id?: number | string | null;
  selected_rev?: string | null;
  source_npofs?: SnfSourceNpof[] | null;
  has_alt?: boolean | null;
  alt_possibly_stale?: boolean | null;
  newer_rev_pending_approval?: boolean | null;
  is_gang_print?: boolean | null;
  is_gang_print_parent?: boolean | null;
  gang_print_parent?: string | null;
  gang_print_group_id?: number | string | null;
  group_status?: string | null;
  pending_npofs?: unknown[] | null;
  ups_original?: number | string | null;
  ups_combined?: number | string | null;
  group_members?: unknown[] | null;
  parent_specs?: SnfSpec | null;

  /** Spesifikasi milik NPOF ini apa adanya (bisa kosong/placeholder). */
  spec?: SnfSpec | null;
  /** Spesifikasi yang sudah diresolusi SNF (termasuk warisan induk). */
  effective_spec?: SnfSpec | null;
  /** "own" | "parent" | "none" (bisa null pada data lama). */
  spec_source?: string | null;

  has_conflict?: boolean | null;
  conflicts?: unknown[] | null;
}

export interface SheetSizeInfo {
  /** Nilai siap tampil, mis. "48 × 60 CM". */
  display: string | null;
  /** Teks asli (sudah dirapikan spasinya) untuk tooltip. */
  raw: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  /** "(LG)" / "NEBENG DI <part>" yang dipisahkan dari ukuran. */
  note: string | null;
}

export interface SpecSelection {
  material: string | null;
  gramatur: string | null;
  supplier: string | null;
  sheetedSize: string | null;
  sheetedSizeRaw: string | null;
  lengthCm: number | null;
  widthCm: number | null;
  sheetedSizeNote: string | null;
  formulaMaterial: string | null;
  /** false = `effective_spec` null ("—"). */
  specAvailable: boolean;
}

const EMPTY_TOKENS = new Set(['-', 'N/A', 'NA', '#N/A', 'NULL']);

/** Rapikan spasi (NBSP, tab, newline) tanpa mengubah isi teks. */
function tidyWhitespace(value: string): string {
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2007\u202F]/g, ' ')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Teks bebas: rapikan spasi dan anggap "", "-", "N/A" sebagai null.
 * Karakter seperti "²" (m²) TIDAK dihapus karena bagian dari satuan.
 */
export function cleanNpofText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = tidyWhitespace(String(value));
  if (!text) return null;
  if (EMPTY_TOKENS.has(text.toUpperCase())) return null;
  return text;
}

/** part_number_norm = trim + collapse whitespace/tab/newline + UPPERCASE. */
export function normalizePartNumber(value: unknown): string {
  const cleaned = cleanNpofText(value);
  return cleaned ? cleaned.toUpperCase() : '';
}

/**
 * Kunci unik part number. Baris tanpa part number tetap disimpan (ditampilkan
 * dengan badge dan dikecualikan dari total/ekspor), jadi diberi kunci sentinel
 * deterministik per NPOF supaya tidak saling menimpa.
 */
export function buildPartNumberKey(value: unknown, npofId: number | null): string {
  const normalized = normalizePartNumber(value);
  if (normalized) return normalized;
  return `${EMPTY_PART_NUMBER_KEY_PREFIX}#${npofId ?? 'unknown'}`;
}

/** Apakah baris punya part number asli (bukan kosong / "-" / "N/A"). */
export function hasRealPartNumber(value: unknown): boolean {
  return normalizePartNumber(value) !== '';
}

/** Angka dari SNF bisa berupa number, string, "3", "3.0", atau "3,5". */
export function toNpofInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric =
    typeof value === 'number'
      ? value
      : Number.parseFloat(String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0] ?? '');
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
}

/** Scenario boleh "main"/"alt"; nilai lain disimpan apa adanya dalam lowercase. */
export function normalizeScenario(value: unknown): string {
  const scenario = tidyWhitespace(value === null || value === undefined ? '' : String(value)).toLowerCase();
  if (!scenario) return 'main';
  return scenario.slice(0, 16);
}

/** "450 g/m²" / "450gsm" / " 450   gsm " -> dirapikan, satuan dipertahankan. */
export function normalizeGramatur(value: unknown): string | null {
  return cleanNpofText(value);
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

/**
 * Normalisasi sheeted size:
 *   "48 x 60 cm"        -> display "48 × 60 CM", length 48, width 60
 *   "73,5 × 57,5 CM"    -> display "73.5 × 57.5 CM"
 *   "48 x 60 (LG)"      -> note "LG"
 *   "48 x 60 NEBENG DI JKG66-0930" -> note "NEBENG DI JKG66-0930"
 *   "73.5ˣ 57.5ˣ"       -> superscript ˣ dibaca sebagai pemisah "x"
 */
export function parseSheetedSize(value: unknown): SheetSizeInfo {
  const raw = value === null || value === undefined ? null : tidyWhitespace(String(value));
  if (!raw) {
    return { display: null, raw: null, lengthCm: null, widthCm: null, note: null };
  }

  const notes: string[] = [];
  let working = raw;
  working = working.replace(/\(\s*LG\s*\)/gi, () => {
    notes.push('LG');
    return ' ';
  });
  working = working.replace(/NEBENG\s+DI\s+([^\s,;)]+)/gi, (_match, part: string) => {
    notes.push(`NEBENG DI ${part.toUpperCase()}`);
    return ' ';
  });

  // Superscript ˣ pada data SNF adalah penanda footnote untuk tanda "x".
  const cleaned = cleanNpofText(working.replace(/[\u02E3]/g, 'x'));
  const note = notes.length > 0 ? notes.join('; ') : null;

  if (!cleaned) {
    return { display: null, raw, lengthCm: null, widthCm: null, note };
  }

  const match = cleaned.match(
    /^(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*[x×*]\s*(\d+(?:[.,]\d+)?)(?:\s*cm)?/i
  );
  if (!match) {
    return { display: cleaned, raw, lengthCm: null, widthCm: null, note };
  }

  const lengthCm = Number.parseFloat(match[1].replace(',', '.'));
  const widthCm = Number.parseFloat(match[2].replace(',', '.'));
  if (!Number.isFinite(lengthCm) || !Number.isFinite(widthCm) || lengthCm <= 0 || widthCm <= 0) {
    return { display: cleaned, raw, lengthCm: null, widthCm: null, note };
  }

  return {
    display: `${trimNumber(lengthCm)} × ${trimNumber(widthCm)} CM`,
    raw,
    lengthCm,
    widthCm,
    note,
  };
}

/**
 * UPS: hanya dihitung bila `ups_counted = true` DAN baris approved.
 * `ups_combined` disimpan null untuk baris yang tidak dihitung, sehingga
 * total UPS/ekspor tidak pernah memakai nilai yang belum approved.
 */
export function resolveUps(row: Pick<SnfMainRow, 'is_approved' | 'ups_counted' | 'ups_original' | 'ups_combined'>): {
  upsOriginal: number | null;
  upsCombined: number | null;
  upsCounted: boolean;
  display: string | null;
} {
  const upsCounted = row.ups_counted === true && row.is_approved !== false;
  const upsOriginal = toNpofInteger(row.ups_original);
  const combinedRaw = toNpofInteger(row.ups_combined);
  if (!upsCounted) {
    return { upsOriginal, upsCombined: null, upsCounted: false, display: null };
  }
  const chosen = combinedRaw ?? upsOriginal;
  return {
    upsOriginal,
    upsCombined: combinedRaw,
    upsCounted: true,
    display: chosen === null ? null : String(chosen),
  };
}

/** UPS yang boleh masuk total: baris tanpa part number / removed / not counted dikecualikan. */
export function billableUps(
  row: Pick<SnfMainRow, 'is_approved' | 'ups_counted' | 'ups_original' | 'ups_combined'> & {
    partNumber?: string | null;
    removedInLatestRev?: boolean | null;
  }
): number {
  if (row.removedInLatestRev) return 0;
  if (!hasRealPartNumber(row.partNumber)) return 0;
  const ups = resolveUps(row);
  return ups.upsCounted ? ups.upsCombined ?? ups.upsOriginal ?? 0 : 0;
}

/**
 * Total UPS untuk SATU scenario saja. "main" dan "alt" tidak pernah
 * dijumlahkan, dan baris yang tidak `upsCounted` tidak ikut dihitung.
 */
export function sumUpsForScenario(
  rows: Array<{
    scenario: string;
    partNumber: string;
    removedInLatestRev: boolean;
    upsCounted: boolean;
    upsCombined: number | null;
    upsOriginal: number | null;
    ups: string | null;
  }>,
  scenario: string
): number {
  return rows.reduce((total, row) => {
    if (row.scenario !== scenario) return total;
    if (row.removedInLatestRev) return total;
    if (!row.upsCounted) return total;
    if (!hasRealPartNumber(row.partNumber)) return total;
    const value =
      row.upsCombined ?? toNpofInteger(row.ups) ?? row.upsOriginal ?? 0;
    return total + value;
  }, 0);
}

/**
 * SNF menulis judul NPOF dengan label revisi di depan, mis. `"IR - JRP25-..."`
 * atau `"NPOF - ..."` bila revisi kosong. `source_npofs` / `pending_npofs`
 * hanya membawa `npof_id`, jadi judul revisi lain direkonstruksi dengan
 * mengganti label revisi di judul baris. Bila format judul tidak dikenal,
 * judul baris dikembalikan apa adanya (tidak menebak).
 */
export function buildNpofTitleForRev(
  baseTitle: string | null | undefined,
  baseRev: string | null | undefined,
  targetRev: string | null | undefined
): string | null {
  const title = cleanNpofText(baseTitle);
  if (!title) return null;

  const baseLabel = cleanNpofText(baseRev) ?? 'NPOF';
  const target = cleanNpofText(targetRev);
  if (!target || target === baseLabel) return title;

  const prefix = `${baseLabel} - `;
  if (!title.startsWith(prefix)) return title;
  return `${target} - ${title.slice(prefix.length)}`;
}

/**
 * Tambahkan `npof_title` ke setiap item `source_npofs` / `pending_npofs` agar
 * panel detail bisa menampilkan judul NPOF, bukan id mentah.
 */
export function attachNpofTitles(
  items: unknown,
  baseTitle: string | null | undefined,
  baseRev: string | null | undefined
): unknown {
  if (!Array.isArray(items)) return items;

  return items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    const ownTitle = typeof record.npof_title === 'string' ? record.npof_title : null;
    if (cleanNpofText(ownTitle)) return record;

    const title = buildNpofTitleForRev(
      baseTitle,
      baseRev,
      typeof record.rev === 'string' ? record.rev : null
    );
    return title ? { ...record, npof_title: title } : record;
  });
}

/** Ambil kolom spec dari `effective_spec` (bukan endpoint legacy). */
export function normalizeEffectiveSpec(spec: SnfSpec | null | undefined): SpecSelection {
  if (!spec) {
    return {
      material: null,
      gramatur: null,
      supplier: null,
      sheetedSize: null,
      sheetedSizeRaw: null,
      lengthCm: null,
      widthCm: null,
      sheetedSizeNote: null,
      formulaMaterial: null,
      specAvailable: false,
    };
  }

  const sheetedSize = parseSheetedSize(spec.sheeted_size);
  return {
    material: cleanNpofText(spec.material),
    gramatur: normalizeGramatur(spec.gramatur),
    supplier: cleanNpofText(spec.supplier),
    sheetedSize: sheetedSize.display,
    sheetedSizeRaw: sheetedSize.raw,
    lengthCm: sheetedSize.lengthCm,
    widthCm: sheetedSize.widthCm,
    sheetedSizeNote: sheetedSize.note,
    formulaMaterial: cleanNpofText(spec.formula_material),
    specAvailable: true,
  };
}

/** Nilai normalisasi satu baris endpoint utama (tanpa plantId pemanggil). */
export interface NormalizedMainRow {
  partNumber: string;
  partNumberNorm: string;
  partName: string | null;
  productName: string;
  npofTitle: string | null;
  npofId: number | null;
  scenario: string;
  selectedRev: string | null;

  statusLabel: string | null;
  isApproved: boolean;
  upsCounted: boolean;

  removedInLatestRev: boolean;
  isGangPrint: boolean;
  isGangPrintParent: boolean;
  gangPrintParent: string | null;
  gangPrintGroupId: number | null;
  groupStatus: string | null;
  hasAlt: boolean;
  altPossiblyStale: boolean;
  newerRevPendingApproval: boolean;
  hasConflict: boolean;
  conflicts: unknown[];
  groupMembers: unknown[];
  pendingNpofs: unknown[];
  sourceNpofs: unknown[];

  spec: SpecSelection;
  specSource: string | null;
  /** Nilai `spec.*` mentah untuk tooltip "Mengikuti induk". */
  rawSpec: Record<string, unknown> | null;

  upsOriginal: number | null;
  upsCombined: number | null;
  ups: string | null;
}

export function normalizeMainRow(row: SnfMainRow): NormalizedMainRow {
  const npofId = toNpofInteger(row.selected_npof_id);
  const partNumber = cleanNpofText(row.part_number) ?? '';
  const ups = resolveUps(row);
  const rawSpec =
    row.spec && typeof row.spec === 'object' && !Array.isArray(row.spec)
      ? (row.spec as Record<string, unknown>)
      : null;

  return {
    // PART NUMBER tidak pernah diisi dari part_name (aturan kontrak).
    partNumber,
    partNumberNorm: buildPartNumberKey(row.part_number, npofId),
    partName: cleanNpofText(row.part_name),
    productName: cleanNpofText(row.product_name) ?? '',
    npofTitle: cleanNpofText(row.npof_title),
    npofId,
    scenario: normalizeScenario(row.scenario),
    selectedRev: cleanNpofText(row.selected_rev),

    statusLabel: cleanNpofText(row.status_label),
    isApproved: Boolean(row.is_approved),
    upsCounted: ups.upsCounted,

    removedInLatestRev: Boolean(row.removed_in_latest_rev),
    isGangPrint: Boolean(row.is_gang_print),
    isGangPrintParent: Boolean(row.is_gang_print_parent),
    gangPrintParent: cleanNpofText(row.gang_print_parent),
    gangPrintGroupId: toNpofInteger(row.gang_print_group_id),
    groupStatus: cleanNpofText(row.group_status),
    hasAlt: Boolean(row.has_alt),
    altPossiblyStale: Boolean(row.alt_possibly_stale),
    newerRevPendingApproval: Boolean(row.newer_rev_pending_approval),
    hasConflict: Boolean(row.has_conflict),
    conflicts: Array.isArray(row.conflicts) ? row.conflicts : [],
    groupMembers: Array.isArray(row.group_members) ? row.group_members : [],
    pendingNpofs: Array.isArray(row.pending_npofs) ? row.pending_npofs : [],
    sourceNpofs: Array.isArray(row.source_npofs) ? row.source_npofs : [],

    spec: normalizeEffectiveSpec(row.effective_spec),
    specSource: cleanNpofText(row.spec_source),
    rawSpec,

    upsOriginal: ups.upsOriginal,
    upsCombined: ups.upsCombined,
    ups: ups.display,
  };
}

/**
 * Validasi plant per baris.
 *
 * - plant_id pada baris (bila ada) HARUS sama dengan plant yang sedang di-sync.
 * - plant harus ada di daftar yang diizinkan.
 * - plant_id tidak ada -> pakai plant pemanggil (endpoint tidak selalu
 *   mengirim plant_id, tapi request-nya selalu eksplisit).
 */
export function resolveRowPlantId(
  rowPlantId: unknown,
  requestedPlantId: number,
  allowedPlantIds: readonly number[]
): { plantId: number | null; reason: string | null } {
  if (!allowedPlantIds.includes(requestedPlantId)) {
    return { plantId: null, reason: `plant ${requestedPlantId} tidak ada di SNF_ALLOWED_PLANT_IDS` };
  }

  const rowPlantIdNumber = toNpofInteger(rowPlantId);
  if (rowPlantIdNumber !== null) {
    if (rowPlantIdNumber !== requestedPlantId) {
      return {
        plantId: null,
        reason: `plant_id baris (${rowPlantIdNumber}) tidak sama dengan plant sync (${requestedPlantId})`,
      };
    }
    if (!allowedPlantIds.includes(rowPlantIdNumber)) {
      return { plantId: null, reason: `plant ${rowPlantIdNumber} tidak ada di SNF_ALLOWED_PLANT_IDS` };
    }
  }

  return { plantId: requestedPlantId, reason: null };
}
