/* eslint-disable no-console */
/**
 * Verifikasi export PDF Material Calculation (satu PDF per folder jenis material).
 *
 * Pemeriksaan TIDAK mengulang logika layout: hasil PDF dibaca ulang dari content
 * stream-nya, lalu dipastikan
 *   1. struktur PDF valid (setiap offset xref menunjuk objek yang benar),
 *   2. seluruh teks berada di dalam area cetak — jadi tidak ada kolom minggu yang
 *      terpotong dan 26 kolom benar-benar muat dalam 1 halaman landscape,
 *   3. tidak ada teks yang melewati batas bawah area cetak (page-break benar;
 *      footer punya zona sendiri),
 *   4. isolasi jenis material: seluruh part dari kelompok ukuran jenis material A
 *      ada di PDF A, dan tidak satu pun part jenis material lain masuk ke PDF A.
 *
 * Pakai: pnpm --filter @pdits/api verify:pdf-export
 */
import { PrismaClient } from '@prisma/client';
import { buildMaterialTypePdf } from '../web/src/lib/materialCalcPdf';
import { textWidth, type PdfFontName } from '../web/src/lib/pdf/pdfWriter';
import type { MaterialGroup } from '../web/src/hooks/useMaterialCalc';

const prisma = new PrismaClient();

const PAGE_W = 841.89; // A4 landscape
const PAGE_H = 595.28;
const MARGIN_X = 22.7;
/** Footer digambar di bawah area konten — batas bawah teks yang diizinkan. */
const BOTTOM_LIMIT = PAGE_H - 10;

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

interface TextOp {
  x: number;
  y: number;
  size: number;
  font: PdfFontName;
  text: string;
}

function parseContent(content: string): { texts: TextOp[]; maxY: number; maxX: number } {
  const texts: TextOp[] = [];
  let size = 6;
  let font: PdfFontName = 'regular';
  let x = 0;
  let y = 0;
  let maxY = 0;
  let maxX = 0;

  for (const line of content.split('\n')) {
    if (line.endsWith(' Tf')) {
      const [fontName, sizeValue] = line.split(' ');
      font = fontName === '/F2' ? 'bold' : 'regular';
      size = Number(sizeValue);
      continue;
    }
    if (line.endsWith(' Td')) {
      const [xValue, yValue] = line.split(' ');
      x = Number(xValue);
      y = Number(yValue);
      continue;
    }
    if (line.endsWith(' Tj')) {
      const raw = line.slice(line.indexOf('(') + 1, line.lastIndexOf(')'));
      const text = raw.replace(/\\([()\\])/g, '$1');
      texts.push({ x, y, size, font, text });
      maxX = Math.max(maxX, x + textWidth(text, size, font));
      maxY = Math.max(maxY, PAGE_H - y);
      continue;
    }
    if (line.endsWith(' re')) {
      const [rx, ry, rw, rh] = line.split(' ').map(Number);
      if (Number.isFinite(rx)) {
        maxX = Math.max(maxX, rx + rw);
        maxY = Math.max(maxY, PAGE_H - (ry + rh));
      }
    }
  }
  return { texts, maxY, maxX };
}

async function main() {
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM cycle_results WHERE isCurrent = 1 ORDER BY calculatedAt DESC LIMIT 1`;
  if (!ids.length) {
    console.log('Tidak ada hasil perhitungan (cycle_results.isCurrent) — tidak ada yang bisa diperiksa.');
    return;
  }
  const result = await prisma.cycleResult.findUniqueOrThrow({ where: { id: ids[0].id } });
  const snapshot = result.resultSnapshot as unknown as { groups: MaterialGroup[] };
  const groups = snapshot.groups ?? [];
  check('ada grup material pada hasil perhitungan', groups.length > 0, `${groups.length} grup`);

  const byType = new Map<string, MaterialGroup[]>();
  for (const group of groups) {
    const type = group.materialType || 'Lainnya';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(group);
  }

  const partsByType = new Map<string, string[]>();
  for (const [type, typeGroups] of byType.entries()) {
    partsByType.set(
      type,
      typeGroups.flatMap((g) => (g.weeklyMatrix?.rows ?? []).map((r) => r.partNumber)),
    );
  }

  let totalTexts = 0;
  let leftOverflow = 0;
  let rightOverflow = 0;
  let bottomOverflow = 0;
  let worstRightText = '';

  for (const [type, typeGroups] of byType.entries()) {
    const started = Date.now();
    const bytes = buildMaterialTypePdf(type, typeGroups, { periodLabel: 'Verifikasi' });
    const raw = Buffer.from(bytes).toString('latin1');

    const objectCount = (raw.match(/\n\d+ 0 obj/g) ?? []).length;
    const pageCount = (raw.match(/\/Type \/Page[^s]/g) ?? []).length;
    const xrefStart = Number(raw.slice(raw.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
    const offsets = [...raw.slice(xrefStart).matchAll(/^(\d{10}) 00000 n/gm)].map((m) => Number(m[1]));
    const offsetsValid = offsets.every((offset, index) => raw.startsWith(`${index + 1} 0 obj`, offset));

    const streams = [...raw.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)].map((m) => m[2]);
    const parsedPages = streams.map((stream) => parseContent(stream));
    const texts = parsedPages.flatMap((parsed) => parsed.texts);
    const textSet = new Set(texts.map((t) => t.text));
    const pageRight = Math.max(...parsedPages.map((p) => p.maxX));
    const pageBottom = Math.max(...parsedPages.map((p) => p.maxY));

    for (const op of texts) {
      if (op.x < MARGIN_X - 0.6) leftOverflow += 1;
      const end = op.x + textWidth(op.text, op.size, op.font);
      if (end > PAGE_W - MARGIN_X + 0.6) {
        rightOverflow += 1;
        worstRightText = `${op.text} @${op.size.toFixed(1)}pt`;
      }
    }
    if (pageBottom > BOTTOM_LIMIT) bottomOverflow += 1;
    totalTexts += texts.length;

    console.log(
      `\n[${type}] ${typeGroups.length} ukuran · ${pageCount} halaman · ${(bytes.length / 1024 / 1024).toFixed(2)} MB · ${Date.now() - started} ms`,
    );
    check(
      `[${type}] struktur PDF valid (${objectCount} objek, ${pageCount} halaman)`,
      objectCount === offsets.length && offsetsValid && pageCount === streams.length,
    );
    check(
      `[${type}] semua kolom muat lebar halaman (teks terjauh ${pageRight.toFixed(1)} <= ${(PAGE_W - MARGIN_X).toFixed(1)})`,
      pageRight <= PAGE_W - MARGIN_X + 0.6,
    );
    check(
      `[${type}] tidak ada teks melewati batas bawah halaman (${pageBottom.toFixed(1)} <= ${BOTTOM_LIMIT.toFixed(1)})`,
      pageBottom <= BOTTOM_LIMIT,
    );

    // ── Isi: semua part milik jenis material ini ada di PDF ini…
    const ownParts = partsByType.get(type) ?? [];
    const missing = ownParts.filter((partNumber) => !textSet.has(partNumber));
    check(`[${type}] seluruh ${ownParts.length} part ikut ter-export`, missing.length === 0, missing.slice(0, 3).join(', '));

    // …dan part jenis material LAIN tidak ikut masuk (tidak tercampur).
    const leaked: string[] = [];
    for (const [otherType, otherParts] of partsByType.entries()) {
      if (otherType === type) continue;
      leaked.push(...otherParts.filter((partNumber) => textSet.has(partNumber)));
    }
    check(`[${type}] tidak ada part jenis material lain yang tercampur`, leaked.length === 0, leaked.slice(0, 3).join(', '));
  }

  check('\ntidak ada teks melewati margin kiri', leftOverflow === 0, `${leftOverflow} potong`);
  check(
    'semua angka muat dalam lebar kolomnya (tidak terpotong)',
    rightOverflow === 0,
    rightOverflow ? `${rightOverflow} sel; contoh ${worstRightText}` : '',
  );
  check('tidak ada halaman yang meluber ke bawah', bottomOverflow === 0, `${bottomOverflow} halaman`);
  console.log(`\ntotal ${totalTexts.toLocaleString('id-ID')} potong teks diperiksa pada ${byType.size} jenis material`);
  console.log(failures === 0 ? 'SEMUA PEMERIKSAAN LULUS' : `${failures} PEMERIKSAAN GAGAL`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
