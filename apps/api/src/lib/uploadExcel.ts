import { FastifyRequest } from 'fastify';

/**
 * Pembacaan file Excel hasil upload dengan validasi.
 *
 * Sebelumnya setiap route memanggil `request.file()` lalu `toBuffer()` langsung.
 * Akibatnya: file apa pun (termasuk non-spreadsheet) diteruskan ke parser, dan
 * seluruh isi file ditampung di memori tanpa batas ukuran per file.
 *
 * Di sini file diperiksa tiga lapis sebelum menyentuh parser:
 *   1. ekstensi nama file
 *   2. ukuran (dibatasi saat streaming, bukan setelah selesai)
 *   3. magic bytes — memastikan isinya benar-benar berkas ZIP (xlsx/xlsm) atau
 *      OLE2 (xls), bukan file lain yang hanya diganti namanya
 */

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_EXTENSIONS = ['.xlsx', '.xlsm', '.xls'];

// XLSX/XLSM adalah arsip ZIP: "PK\x03\x04"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
// XLS lama (BIFF/OLE2): D0 CF 11 E0 A1 B1 1A E1
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export type ExcelUploadResult =
  | { ok: true; buffer: Buffer; filename: string }
  | { ok: false; status: number; message: string };

function magicBytesMatch(buffer: Buffer, magic: number[]): boolean {
  if (buffer.length < magic.length) return false;
  return magic.every((byte, index) => buffer[index] === byte);
}

function hasSpreadsheetSignature(buffer: Buffer): boolean {
  return magicBytesMatch(buffer, ZIP_MAGIC) || magicBytesMatch(buffer, OLE2_MAGIC);
}

export function maxUploadBytes(): number {
  const fromEnv = Number.parseInt(process.env.MAX_UPLOAD_MB || '', 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv * 1024 * 1024 : DEFAULT_MAX_BYTES;
}

export async function readExcelUpload(request: FastifyRequest): Promise<ExcelUploadResult> {
  const maxBytes = maxUploadBytes();
  const maxMb = Math.round(maxBytes / (1024 * 1024));

  let part;
  try {
    part = await request.file({ limits: { fileSize: maxBytes, files: 1 } });
  } catch {
    return {
      ok: false,
      status: 400,
      message: 'Permintaan harus berupa multipart/form-data dengan tepat satu file.',
    };
  }

  if (!part) {
    return { ok: false, status: 400, message: 'No file uploaded' };
  }

  const filename = part.filename || '';
  const dotIndex = filename.lastIndexOf('.');
  const extension = dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : '';

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return {
      ok: false,
      status: 400,
      message: `Ekstensi file tidak didukung (${filename || 'tanpa nama'}). Gunakan .xlsx, .xlsm, atau .xls.`,
    };
  }

  let buffer: Buffer;
  try {
    buffer = await part.toBuffer();
  } catch {
    return { ok: false, status: 413, message: `File terlalu besar. Maksimum ${maxMb} MB.` };
  }

  if (part.file.truncated) {
    return { ok: false, status: 413, message: `File terlalu besar. Maksimum ${maxMb} MB.` };
  }

  if (!hasSpreadsheetSignature(buffer)) {
    return {
      ok: false,
      status: 400,
      message: 'Isi file bukan spreadsheet Excel yang valid.',
    };
  }

  return { ok: true, buffer, filename };
}
