/**
 * Penulis PDF minimal tanpa dependensi eksternal.
 *
 * Dipakai untuk "Export PDF" Material Calculation: kita perlu kendali penuh atas
 * pagination (blok ukuran tidak terpotong, header kolom diulang) dan nomor
 * halaman, yang tidak bisa dijamin kalau memakai `window.print()`.
 *
 * Hanya memakai font standar PDF (Helvetica / Helvetica-Bold, WinAnsiEncoding)
 * sehingga tidak perlu menyematkan file font.
 */

/** Lebar karakter Helvetica (per 1000 unit) untuk kode WinAnsi 32..126. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778,
  722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Lebar karakter Helvetica-Bold (per 1000 unit) untuk kode WinAnsi 32..126. */
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778,
  722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Lebar karakter di luar ASCII yang lazim muncul di data. */
const EXTRA_WIDTHS: Record<string, [number, number]> = {
  '\u20ac': [556, 556], // €
  '\u2013': [556, 556], // –
  '\u2014': [1000, 1000], // —
  '\u2018': [222, 278], // '
  '\u2019': [222, 278], // '
  '\u201c': [333, 500], // "
  '\u201d': [333, 500], // "
  '\u2022': [350, 350], // •
  '\u2026': [1000, 1000], // …
  '\u00b0': [400, 400], // °
  '\u00d7': [584, 584], // ×
  '\u00b7': [278, 278], // ·
  '\u00a0': [278, 278], // spasi tak-putus
};

/** Peta karakter non-Latin1 ke kode WinAnsi (Latin1 sama dengan kode Unicode). */
const WINANSI_MAP: Record<string, number> = {
  '\u20ac': 0x80,
  '\u201a': 0x82,
  '\u0192': 0x83,
  '\u201e': 0x84,
  '\u2026': 0x85,
  '\u2020': 0x86,
  '\u2021': 0x87,
  '\u02c6': 0x88,
  '\u2030': 0x89,
  '\u0160': 0x8a,
  '\u2039': 0x8b,
  '\u0152': 0x8c,
  '\u017d': 0x8e,
  '\u2018': 0x91,
  '\u2019': 0x92,
  '\u201c': 0x93,
  '\u201d': 0x94,
  '\u2022': 0x95,
  '\u2013': 0x96,
  '\u2014': 0x97,
  '\u02dc': 0x98,
  '\u2122': 0x99,
  '\u0161': 0x9a,
  '\u203a': 0x9b,
  '\u0153': 0x9c,
  '\u017e': 0x9e,
  '\u0178': 0x9f,
};

export type PdfFontName = 'regular' | 'bold';

/** Nama resource font di dalam content stream. */
const FONT_RESOURCE: Record<PdfFontName, string> = { regular: 'F1', bold: 'F2' };

/** Ubah string menjadi byte-string WinAnsi (semua kode <= 255). */
export function toWinAnsi(value: string): string {
  let out = '';
  for (const char of String(value ?? '')) {
    const code = char.codePointAt(0) ?? 63;
    if (code === 0x0a || code === 0x0d) {
      out += ' ';
    } else if (WINANSI_MAP[char] !== undefined) {
      out += String.fromCharCode(WINANSI_MAP[char]);
    } else if (code >= 32 && code <= 255) {
      out += char;
    } else if (code === 9) {
      out += ' ';
    } else {
      out += '?';
    }
  }
  return out;
}

/** Lebar teks (dalam poin) untuk font & ukuran tertentu. */
export function textWidth(value: string, size: number, font: PdfFontName = 'regular'): number {
  const table = font === 'bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let total = 0;
  for (const char of toWinAnsi(value)) {
    const code = char.charCodeAt(0);
    let width: number;
    if (code >= 32 && code <= 126) {
      width = table[code - 32];
    } else {
      const extra = EXTRA_WIDTHS[char];
      width = extra ? (font === 'bold' ? extra[1] : extra[0]) : 556;
    }
    total += width;
  }
  return (total / 1000) * size;
}

/** Ukuran font terbesar (<= maxSize) yang membuat teks muat dalam maxWidth. */
export function fitFontSize(
  value: string,
  maxWidth: number,
  maxSize: number,
  minSize = 3.2,
  font: PdfFontName = 'regular',
): number {
  if (textWidth(value, maxSize, font) <= maxWidth) return maxSize;
  let size = maxSize;
  while (size > minSize) {
    size = Math.max(minSize, size - 0.1);
    if (textWidth(value, size, font) <= maxWidth) return size;
  }
  return minSize;
}

/** Pangkas teks dengan "…" agar muat dalam maxWidth. */
export function ellipsize(value: string, maxWidth: number, size: number, font: PdfFontName = 'regular'): string {
  if (textWidth(value, size, font) <= maxWidth) return value;
  const chars = [...value];
  while (chars.length > 1) {
    chars.pop();
    const candidate = `${chars.join('')}…`;
    if (textWidth(candidate, size, font) <= maxWidth) return candidate;
  }
  return '…';
}

/** Pecah teks menjadi beberapa baris (maks `maxLines`). */
export function wrapText(
  value: string,
  maxWidth: number,
  size: number,
  maxLines: number,
  font: PdfFontName = 'regular',
): string[] {
  const words = toWinAnsi(value).split(/\s+/).filter(Boolean);
  if (!words.length) return ['—'];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, size, font) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (!lines.length) return ['—'];
  // Baris terakhir: pastikan tidak melebihi lebar kolom (potong dengan "…").
  const last = lines.length - 1;
  lines[last] = ellipsize(lines[last], maxWidth, size, font);
  return lines.slice(0, maxLines);
}

/** Escape karakter khusus di dalam string literal PDF. */
function escapePdfText(value: string): string {
  return toWinAnsi(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Ubah warna hex (#rrggbb) menjadi operator angka PDF `r g b`. */
function rgbOperator(hex: string): string {
  const clean = hex.replace('#', '').padEnd(6, '0');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`;
}

export interface TextOptions {
  font?: PdfFontName;
  size?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** Kalau diisi, ukuran font otomatis dikecilkan agar muat. */
  maxWidth?: number;
  minSize?: number;
  /**
   * Angka tidak boleh dipotong — lebih baik sedikit melewati batas kolom
   * daripada menampilkan angka yang salah. Dipakai untuk sel angka.
   */
  overflow?: boolean;
}

/** Satu halaman: kumpulan operator content stream. */
export class PdfPage {
  private ops: string[] = [];
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  /** Y dari atas halaman -> koordinat PDF (origin kiri-bawah). */
  toPdfY(yFromTop: number): number {
    return this.height - yFromTop;
  }

  /** Gambar teks; `y` adalah jarak baseline dari ATAS halaman. */
  text(x: number, y: number, value: string, options: TextOptions = {}): number {
    const font = options.font ?? 'regular';
    const raw = String(value ?? '');
    const maxWidth = options.maxWidth;
    const size =
      maxWidth && raw
        ? fitFontSize(raw, maxWidth, options.size ?? 6, options.minSize ?? 3.2, font)
        : (options.size ?? 6);
    const shown = maxWidth && !options.overflow ? ellipsize(raw, maxWidth, size, font) : raw;
    const width = textWidth(shown, size, font);
    let startX = x;
    if (options.align === 'right') startX = x - width;
    else if (options.align === 'center') startX = x - width / 2;
    this.ops.push(
      `${rgbOperator(options.color ?? '#000000')} rg`,
      'BT',
      `/${FONT_RESOURCE[font]} ${size.toFixed(2)} Tf`,
      `${startX.toFixed(2)} ${this.toPdfY(y).toFixed(2)} Td`,
      `(${escapePdfText(shown)}) Tj`,
      'ET',
    );
    return width;
  }

  /** Lebar teks tanpa menggambar. */
  measure(value: string, size: number, font: PdfFontName = 'regular'): number {
    return textWidth(value, size, font);
  }

  rect(x: number, y: number, w: number, h: number, options: { fill?: string; stroke?: string; lineWidth?: number } = {}): void {
    const bottom = this.toPdfY(y + h);
    if (options.fill) this.ops.push(`${rgbOperator(options.fill)} rg`);
    if (options.stroke) {
      this.ops.push(`${rgbOperator(options.stroke)} RG`, `${(options.lineWidth ?? 0.5).toFixed(2)} w`);
    }
    this.ops.push(`${x.toFixed(2)} ${bottom.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    if (options.fill && options.stroke) this.ops.push('B');
    else if (options.fill) this.ops.push('f');
    else this.ops.push('S');
  }

  line(x1: number, y1: number, x2: number, y2: number, options: { color?: string; lineWidth?: number } = {}): void {
    this.ops.push(
      `${rgbOperator(options.color ?? '#9ca3af')} RG`,
      `${(options.lineWidth ?? 0.5).toFixed(2)} w`,
      `${x1.toFixed(2)} ${this.toPdfY(y1).toFixed(2)} m`,
      `${x2.toFixed(2)} ${this.toPdfY(y2).toFixed(2)} l`,
      'S',
    );
  }

  content(): string {
    return this.ops.join('\n');
  }
}

/** Dokumen PDF: kumpulan halaman + font standar. */
export class PdfDocument {
  private pageList: PdfPage[] = [];
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  addPage(): PdfPage {
    const page = new PdfPage(this.width, this.height);
    this.pageList.push(page);
    return page;
  }

  /** Semua halaman (dipakai untuk menggambar footer setelah layout selesai). */
  getPages(): PdfPage[] {
    return this.pageList;
  }

  get pageCount(): number {
    return this.pageList.length;
  }

  /** Rakit file PDF (latin1 byte-string -> Uint8Array). */
  build(): Uint8Array {
    const chunks: string[] = [];
    const offsets: number[] = [];
    let length = 0;

    const push = (text: string) => {
      chunks.push(text);
      length += text.length;
    };
    /** Mulai objek baru: tulis offset + header `N 0 obj` dan kembalikan nomornya. */
    const startObject = (): number => {
      const number = offsets.length + 1;
      offsets.push(length);
      push(`${number} 0 obj\n`);
      return number;
    };

    push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');

    // 1: Catalog, 2: Pages, 3: Helvetica, 4: Helvetica-Bold
    startObject();
    push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    const pageObjectNumbers = this.pageList.map((_, i) => 5 + i * 2);
    startObject();
    push(`<< /Type /Pages /Count ${this.pageList.length} /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] >>\nendobj\n`);

    startObject();
    push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');

    startObject();
    push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n');

    this.pageList.forEach((page, index) => {
      const contentNumber = 6 + index * 2;
      startObject();
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width.toFixed(2)} ${this.height.toFixed(2)}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>\nendobj\n`,
      );
      const content = page.content();
      startObject();
      push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    });

    const xrefOffset = length;
    const total = offsets.length + 1;
    push(`xref\n0 ${total}\n`);
    push('0000000000 65535 f \n');
    for (const offset of offsets) {
      push(`${String(offset).padStart(10, '0')} 00000 n \n`);
    }
    push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    const joined = chunks.join('');
    const bytes = new Uint8Array(joined.length);
    for (let i = 0; i < joined.length; i += 1) bytes[i] = joined.charCodeAt(i) & 0xff;
    return bytes;
  }
}
