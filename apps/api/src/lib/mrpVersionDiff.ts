/**
 * Mesin perbandingan dua snapshot MRP.
 *
 * Prinsip utama: minggu dicocokkan berdasarkan TANGGAL AWAL MINGGU, bukan nomor
 * W1â€“W26. Rentang tanggal antar upload bisa bergeser (upload minggu ke-2 biasanya
 * bergeser satu minggu ke depan), sehingga membandingkan "W1 lama vs W1 baru"
 * akan melaporkan perubahan palsu di seluruh kolom.
 *
 * Kolom hasil = gabungan tanggal dari kedua versi (urut naik). Tanggal yang hanya
 * ada di satu versi tetap muncul sebagai kolom dengan qty 0 di sisi lain, supaya
 * minggu yang masuk/keluar rentang terlihat sebagai perubahan.
 */

export interface MrpWeekQuantity {
  weekStartDate: string; // ISO 'YYYY-MM-DD' (boleh berisi jam; dipotong)
  quantity: number;
  /** Nomor minggu dari file Excel (opsional; dipakai hanya untuk label kolom). */
  weekNumber?: number;
}

export interface MrpPartInput {
  partNumber: string;
  description?: string | null;
  weeks: MrpWeekQuantity[];
}

/** Baris snapshot dari tabel `mrp_version_rows` (atau `weekly_schedules`). */
export interface MrpSnapshotRow {
  partNumber: string;
  description?: string | null;
  weekNumber: number;
  weekStartDate: string | Date;
  quantity: number;
}

export type MrpDiffStatus = 'NEW' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';

export interface MrpDiffColumn {
  weekStartDate: string;
  /** Nomor minggu (W1..W26) di versi pembanding lama, NULL bila tidak ada. */
  beforeWeekNumber: number | null;
  /** Nomor minggu (W1..W26) di versi baru, NULL bila tidak ada. */
  afterWeekNumber: number | null;
}

export interface MrpDiffPart {
  partNumber: string;
  description: string;
  status: MrpDiffStatus;
  beforeTotal: number;
  afterTotal: number;
  /** Jumlah kolom minggu yang nilainya berbeda. */
  changedWeeks: number;
  /**
   * Sejajar dengan `MrpDiffSummary` -> `columns`: `[qty sebelum, qty sesudah]`.
   * Format array-of-pairs dipakai agar payload tetap ringan (ribuan part x 26 minggu).
   */
  weeks: Array<[number, number]>;
}

export interface MrpDiffSummary {
  partsBefore: number;
  partsAfter: number;
  newParts: number;
  removedParts: number;
  changedParts: number;
  unchangedParts: number;
  totalBefore: number;
  totalAfter: number;
  totalDelta: number;
  /** Jumlah sel (part x minggu) yang nilainya berubah, termasuk part baru/hilang. */
  changedCells: number;
  weekCountBefore: number;
  weekCountAfter: number;
  /** Tanggal minggu yang hanya ada di versi baru. */
  weeksAdded: string[];
  /** Tanggal minggu yang hanya ada di versi lama. */
  weeksRemoved: string[];
  beforeWeekStartDate: string | null;
  afterWeekStartDate: string | null;
}

export interface MrpDiffResult {
  columns: MrpDiffColumn[];
  summary: MrpDiffSummary;
  parts: MrpDiffPart[];
}

interface PartSeries {
  partNumber: string;
  description: string;
  quantities: Map<string, number>;
  weekNumbers: Map<string, number>;
}

/** Deret qty per part untuk satu snapshot. */
export type MrpSeriesMap = Map<string, PartSeries>;

/** Ambil bagian tanggal saja ('YYYY-MM-DD') tanpa memedulikan zona waktu. */
export function normalizeWeekDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function emptySeries(partNumber: string, description: string): PartSeries {
  return { partNumber, description, quantities: new Map(), weekNumbers: new Map() };
}

function setCell(series: PartSeries, date: string, quantity: number, weekNumber: number) {
  series.quantities.set(date, (series.quantities.get(date) ?? 0) + quantity);
  if (!series.weekNumbers.has(date) || weekNumber < (series.weekNumbers.get(date) ?? Infinity)) {
    series.weekNumbers.set(date, weekNumber);
  }
}

/** Bangun deret per part dari payload upload (bentuk bersarang). */
export function seriesFromParts(parts: MrpPartInput[]): MrpSeriesMap {
  const map = new Map<string, PartSeries>();
  for (const part of parts) {
    const partNumber = String(part.partNumber ?? '').trim();
    if (!partNumber) continue;
    // Duplikat PN: kemunculan pertama yang dipakai (lihat collectMrpPayloadWarnings).
    if (map.has(partNumber)) continue;
    const series = emptySeries(partNumber, String(part.description ?? '').trim());
    part.weeks.forEach((week, weekIndex) => {
      const date = normalizeWeekDate(week.weekStartDate);
      if (!date) return;
      const quantity = Number(week.quantity);
      const weekNumber = Number(week.weekNumber) || weekIndex + 1;
      setCell(series, date, Number.isFinite(quantity) ? quantity : 0, weekNumber);
    });
    map.set(partNumber, series);
  }
  return map;
}

/** Bangun deret per part dari baris snapshot tersimpan. */
export function seriesFromRows(rows: MrpSnapshotRow[]): MrpSeriesMap {
  const map = new Map<string, PartSeries>();
  for (const row of rows) {
    const partNumber = String(row.partNumber ?? '').trim();
    if (!partNumber) continue;
    const date = normalizeWeekDate(row.weekStartDate);
    if (!date) continue;
    const series = map.get(partNumber) ?? emptySeries(partNumber, String(row.description ?? '').trim());
    const quantity = Number(row.quantity);
    setCell(series, date, Number.isFinite(quantity) ? quantity : 0, Number(row.weekNumber) || 0);
    if (!series.description && row.description) series.description = String(row.description).trim();
    map.set(partNumber, series);
  }
  return map;
}

const STATUS_ORDER: Record<MrpDiffStatus, number> = {
  NEW: 0,
  REMOVED: 1,
  CHANGED: 2,
  UNCHANGED: 3,
};

/**
 * Bandingkan dua snapshot. `before` = versi lama (pembanding), `after` = versi baru.
 */
export function diffMrpSeries(before: MrpSeriesMap, after: MrpSeriesMap): MrpDiffResult {
  const dateSet = new Set<string>();
  for (const series of before.values()) for (const date of series.quantities.keys()) dateSet.add(date);
  for (const series of after.values()) for (const date of series.quantities.keys()) dateSet.add(date);
  const dates = Array.from(dateSet).sort();

  const columns: MrpDiffColumn[] = dates.map((date) => {
    let beforeWeekNumber: number | null = null;
    let afterWeekNumber: number | null = null;
    for (const series of before.values()) {
      const weekNumber = series.weekNumbers.get(date);
      if (weekNumber !== undefined && (beforeWeekNumber === null || weekNumber < beforeWeekNumber)) {
        beforeWeekNumber = weekNumber;
      }
    }
    for (const series of after.values()) {
      const weekNumber = series.weekNumbers.get(date);
      if (weekNumber !== undefined && (afterWeekNumber === null || weekNumber < afterWeekNumber)) {
        afterWeekNumber = weekNumber;
      }
    }
    return { weekStartDate: date, beforeWeekNumber, afterWeekNumber };
  });

  const partNumbers = new Set<string>([...before.keys(), ...after.keys()]);
  const parts: MrpDiffPart[] = [];
  let newParts = 0;
  let removedParts = 0;
  let changedParts = 0;
  let unchangedParts = 0;
  let totalBefore = 0;
  let totalAfter = 0;
  let changedCells = 0;

  for (const partNumber of partNumbers) {
    const oldSeries = before.get(partNumber);
    const newSeries = after.get(partNumber);

    let beforeTotal = 0;
    let afterTotal = 0;
    let changedWeeks = 0;
    const weeks: Array<[number, number]> = [];

    for (const date of dates) {
      const oldQty = oldSeries?.quantities.get(date) ?? 0;
      const newQty = newSeries?.quantities.get(date) ?? 0;
      beforeTotal += oldQty;
      afterTotal += newQty;
      // Data qty berupa bilangan bulat; ambang kecil mencegah "perubahan" dari sisa float.
      if (Math.abs(newQty - oldQty) > 1e-9) changedWeeks += 1;
      weeks.push([oldQty, newQty]);
    }
    totalBefore += beforeTotal;
    totalAfter += afterTotal;
    changedCells += changedWeeks;

    let status: MrpDiffStatus;
    if (!oldSeries) {
      status = 'NEW';
      newParts += 1;
    } else if (!newSeries) {
      status = 'REMOVED';
      removedParts += 1;
    } else if (changedWeeks > 0) {
      status = 'CHANGED';
      changedParts += 1;
    } else {
      status = 'UNCHANGED';
      unchangedParts += 1;
    }

    parts.push({
      partNumber,
      description: newSeries?.description || oldSeries?.description || '',
      status,
      beforeTotal,
      afterTotal,
      changedWeeks,
      weeks,
    });
  }

  parts.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return a.partNumber.localeCompare(b.partNumber);
  });

  const beforeDates = new Set<string>();
  for (const series of before.values()) for (const date of series.quantities.keys()) beforeDates.add(date);
  const afterDates = new Set<string>();
  for (const series of after.values()) for (const date of series.quantities.keys()) afterDates.add(date);

  return {
    columns,
    summary: {
      partsBefore: before.size,
      partsAfter: after.size,
      newParts,
      removedParts,
      changedParts,
      unchangedParts,
      totalBefore,
      totalAfter,
      totalDelta: totalAfter - totalBefore,
      changedCells,
      weekCountBefore: beforeDates.size,
      weekCountAfter: afterDates.size,
      weeksAdded: dates.filter((date) => !beforeDates.has(date)),
      weeksRemoved: dates.filter((date) => !afterDates.has(date)),
      beforeWeekStartDate: dates.find((date) => beforeDates.has(date)) ?? null,
      afterWeekStartDate: dates.find((date) => afterDates.has(date)) ?? null,
    },
    parts,
  };
}

/** Peringatan PN duplikat di dalam satu file upload. `null` bila tidak ada. */
export function duplicatePartWarning(partNumbers: string[]): string | null {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const code of partNumbers) {
    const trimmed = String(code ?? '').trim();
    if (!trimmed) continue;
    const key = trimmed.toUpperCase();
    if (seen.has(key)) duplicates.add(trimmed);
    else seen.add(key);
  }
  if (duplicates.size === 0) return null;

  const sample = Array.from(duplicates).slice(0, 5).join(', ');
  return `${duplicates.size} Part Number duplikat di file (${sample}${
    duplicates.size > 5 ? ', â€¦' : ''
  }). Hanya kemunculan pertama yang disimpan.`;
}

/** Validasi payload upload: jarak tanggal minggu yang tidak wajar. */
export function collectMrpPayloadWarnings(parts: MrpPartInput[]): string[] {
  const warnings: string[] = [];
  let partsWithGaps = 0;
  let partsWithoutDates = 0;
  const sampleGaps: number[] = [];

  for (const part of parts) {
    const dates = part.weeks.map((week) => normalizeWeekDate(week.weekStartDate)).filter(Boolean);
    if (dates.length === 0) {
      partsWithoutDates += 1;
      continue;
    }
    for (let index = 1; index < dates.length; index += 1) {
      const previous = Date.parse(`${dates[index - 1]}T00:00:00Z`);
      const current = Date.parse(`${dates[index]}T00:00:00Z`);
      const days = Math.round((current - previous) / 86400000);
      if (days !== 7) {
        partsWithGaps += 1;
        if (sampleGaps.length < 3) sampleGaps.push(days);
        break;
      }
    }
  }

  if (parts.length > 0 && partsWithoutDates === parts.length) {
    warnings.push(
      'Tanggal minggu tidak terbaca dari file. Pastikan baris tanggal ada di bawah nomor minggu.',
    );
  } else if (partsWithGaps > 0) {
    warnings.push(
      `${partsWithGaps} part memiliki jarak tanggal antar minggu yang tidak seragam (contoh: ${sampleGaps.join(
        ', ',
      )} hari, seharusnya 7). Periksa baris tanggal pada file Excel.`,
    );
  }

  return warnings;
}
