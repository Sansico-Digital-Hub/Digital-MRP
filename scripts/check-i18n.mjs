// Pemeriksa konsistensi key i18n.
// 1. Kumpulkan semua key dari file kamus di src/i18n/**.
// 2. Kumpulkan semua key yang dipakai lewat t('...') / translate(lang, '...').
// 3. Laporkan key yang dipakai tapi tidak ada, dan key yang tidak terpakai.
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2];
const SRC = join(ROOT, 'apps/web/src');
const I18N = join(SRC, 'i18n');

function walk(dir, filter) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

function flatten(tree, prefix, target) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, path, target);
    else target.add(path);
  }
}

const dictFiles = walk(
  I18N,
  (f) => f.endsWith('.ts') && !['index.ts', 'types.ts'].includes(basename(f)),
);

const tmp = mkdtempSync(join(tmpdir(), 'i18ncheck-'));
const defined = { id: new Set(), en: new Set() };
const namespaces = new Set();

for (const file of dictFiles) {
  const namespace = basename(file).replace(/\.ts$/, '');
  namespaces.add(namespace);
  const source = readFileSync(file, 'utf8');
  const target = join(tmp, `${namespace}.mjs`);
  writeFileSync(target, source);
  const mod = await import(pathToFileURL(target).href);
  const tree = mod.default ?? mod;
  for (const lang of ['id', 'en']) {
    flatten(tree[lang] ?? {}, namespace, defined[lang]);
  }
}

const srcFiles = walk(
  SRC,
  (f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.startsWith(I18N),
);

// Literal string apa pun yang segmen pertamanya adalah nama namespace kamus.
const LITERAL_RE = /['"`]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)['"`]/g;
const used = new Map();

for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8');
  LITERAL_RE.lastIndex = 0;
  let m;
  while ((m = LITERAL_RE.exec(text)) !== null) {
    const key = m[1];
    const ns = key.split('.')[0];
    if (!namespaces.has(ns)) continue;
    if (!used.has(key)) used.set(key, []);
    used.get(key).push(relative(SRC, file));
  }
}

const missingId = [...used.keys()].filter((k) => !defined.id.has(k)).sort();
const missingEn = [...used.keys()].filter((k) => !defined.en.has(k)).sort();
const unused = [...defined.id].filter((k) => !used.has(k)).sort();
const enOnly = [...defined.en].filter((k) => !defined.id.has(k)).sort();
const idOnly = [...defined.id].filter((k) => !defined.en.has(k)).sort();

const report = (label, list, withFiles = false) => {
  console.log(`\n### ${label}: ${list.length}`);
  for (const item of list.slice(0, 150)) {
    console.log(withFiles ? `  ${item}   <- ${[...new Set(used.get(item))].join(', ')}` : `  ${item}`);
  }
  if (list.length > 150) console.log(`  ... ${list.length - 150} more`);
};

console.log(`Kamus: ${dictFiles.length} file | key id=${defined.id.size} en=${defined.en.size}`);
console.log(`Pemakaian: ${used.size} key unik di ${srcFiles.length} file`);
report('DIPAKAI TAPI TIDAK ADA (id)', missingId, true);
report('DIPAKAI TAPI TIDAK ADA (en)', missingEn, true);
report('ADA DI en TAPI TIDAK ADA DI id', enOnly);
report('ADA DI id TAPI TIDAK ADA DI en', idOnly);
report('TIDAK TERPAKAI', unused);
