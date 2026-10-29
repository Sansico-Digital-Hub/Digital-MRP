import * as XLSX from 'xlsx';
import { parse26WeekExcel, type ParsedWorkbook } from './mrpWeekImport';

/**
 * Baca file Excel MRP tanpa memblokir UI.
 *
 * Prioritas: Web Worker (main thread tetap responsif untuk spinner/loading).
 * Kalau Worker tidak tersedia (browser lama / lingkungan tanpa Worker), parsing
 * jatuh kembali ke main thread seperti sebelumnya.
 */
export function parseMrpExcelFile(
  file: File,
  fallbackYear: number,
): Promise<ParsedWorkbook & { sheetName?: string }> {
  if (typeof Worker === 'undefined') return parseOnMainThread(file, fallbackYear);

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/mrpParse.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      parseOnMainThread(file, fallbackYear).then(resolve, reject);
      return;
    }

    const finish = () => worker.terminate();

    worker.onmessage = (event: MessageEvent<any>) => {
      finish();
      const data = event.data;
      if (data?.ok) {
        resolve({ rows: data.rows ?? [], startDate: data.startDate ?? '', sheetName: data.sheetName });
      } else if (data?.reason === 'EMPTY') {
        resolve({ rows: [], startDate: '' });
      } else {
        reject(new Error(data?.message || 'Gagal memproses file Excel.'));
      }
    };

    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'Gagal memproses file Excel.'));
    };

    file
      .arrayBuffer()
      .then((buffer) => worker.postMessage({ buffer, fallbackYear }, [buffer]))
      .catch((error) => {
        finish();
        reject(error);
      });
  });
}

async function parseOnMainThread(file: File, fallbackYear: number): Promise<ParsedWorkbook> {
  // Beri kesempatan browser menggambar indikator loading sebelum kerja berat.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  for (const sheetName of workbook.SheetNames) {
    const parsed = parse26WeekExcel(workbook.Sheets[sheetName], fallbackYear);
    if (parsed.rows.length > 0) return parsed;
  }
  return { rows: [], startDate: '' };
}
