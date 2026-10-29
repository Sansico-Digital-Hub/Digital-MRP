/**
 * Titik masuk export PDF Material Calculation untuk BROWSER (ada DOM).
 *
 * Modul builder-nya (`materialCalcPdf.ts`) sengaja bebas DOM supaya bisa diuji
 * dari Node; di sini hanya bagian unduh file.
 */
import type { MaterialGroup } from '../hooks/useMaterialCalc';
import { translate, type Lang } from '../i18n';
import { buildMaterialTypePdf, isoDate, pdfFileName, type PdfExportMeta } from './materialCalcPdf';
import { createZip } from './pdf/zipStore';

export function downloadBlob(data: Uint8Array, fileName: string, mime: string): void {
  const blob = new Blob([data as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Satu folder jenis material -> satu file PDF (semua ukuran di dalamnya). */
export function exportMaterialTypePdf(
  materialType: string,
  groups: MaterialGroup[],
  meta: PdfExportMeta = {},
  lang: Lang = 'id',
): void {
  const exportedAt = meta.exportedAt ?? new Date();
  const bytes = buildMaterialTypePdf(materialType, groups, { ...meta, exportedAt }, lang);
  downloadBlob(bytes, pdfFileName(materialType, exportedAt), 'application/pdf');
}

/**
 * Export Semua: beberapa PDF TERPISAH (satu per jenis material) di dalam ZIP —
 * TIDAK pernah digabung menjadi satu PDF.
 */
export function exportAllMaterialTypesZip(
  items: Array<{ materialType: string; groups: MaterialGroup[] }>,
  meta: PdfExportMeta = {},
  lang: Lang = 'id',
): void {
  const exportedAt = meta.exportedAt ?? new Date();
  const entries = items
    .filter((item) => item.groups.length > 0)
    .map((item) => ({
      name: pdfFileName(item.materialType, exportedAt),
      data: buildMaterialTypePdf(item.materialType, item.groups, { ...meta, exportedAt }, lang),
    }));
  if (!entries.length) return;
  const zipName = `${translate(lang, 'materialCalc.export.allZipName')}`;
  downloadBlob(
    createZip(entries, exportedAt),
    `MaterialCalc_${zipName}_${isoDate(exportedAt)}.zip`,
    'application/zip',
  );
}
