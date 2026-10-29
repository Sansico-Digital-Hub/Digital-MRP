/**
 * Parser Excel MRP yang berjalan di Web Worker.
 *
 * `XLSX.read` + `parse26WeekExcel` untuk file 2.000+ part x 35 minggu bisa
 * memakan beberapa detik. Dulu keduanya dijalankan di main thread sehingga
 * browser menampilkan "Page Unresponsive" saat import. Dengan worker, UI tetap
 * responsif dan bisa menampilkan indikator loading.
 */
import * as XLSX from 'xlsx';
import { parse26WeekExcel, type ParsedWorkbook } from '../lib/mrpWeekImport';

export interface MrpParseRequest {
  buffer: ArrayBuffer;
  fallbackYear: number;
}

export type MrpParseResponse =
  | { ok: true; rows: ParsedWorkbook['rows']; startDate: string; sheetName: string }
  | { ok: false; reason: 'EMPTY' | 'ERROR'; message?: string };

// `self` di-typing manual agar file ini tidak butuh lib "webworker" (yang
// bertabrakan dengan lib DOM milik app).
const scope = self as unknown as {
  postMessage: (message: MrpParseResponse) => void;
  onmessage: ((event: MessageEvent<MrpParseRequest>) => void) | null;
};

scope.onmessage = (event: MessageEvent<MrpParseRequest>) => {
  const { buffer, fallbackYear } = event.data ?? ({} as MrpParseRequest);
  try {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    for (const sheetName of workbook.SheetNames) {
      const parsed = parse26WeekExcel(workbook.Sheets[sheetName], fallbackYear);
      if (parsed.rows.length > 0) {
        scope.postMessage({ ok: true, rows: parsed.rows, startDate: parsed.startDate, sheetName });
        return;
      }
    }
    scope.postMessage({ ok: false, reason: 'EMPTY' });
  } catch (error) {
    scope.postMessage({
      ok: false,
      reason: 'ERROR',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
