import { useCallback } from 'react';
import { enUS, id as idLocale } from 'date-fns/locale';
import { useLanguageStore, type Lang } from '../stores/languageStore';
import type { FlatDictionary, TranslateParams, TranslationTree } from './types';

export type { Lang } from '../stores/languageStore';
export type { TranslateParams } from './types';

/**
 * Semua file terjemahan di folder ini (dan subfoldernya) otomatis dimuat.
 *
 * Setiap file harus meng-export default `{ id: {...}, en: {...} }`. Nama file
 * menjadi namespace-nya, jadi `pages/dashboard.ts` -> `dashboard.*`. Menambah
 * bahasa baru cukup dengan membuat file baru di sini, tanpa mengubah file ini.
 */
const modules = import.meta.glob(['./**/*.ts', '!./index.ts', '!./types.ts'], {
  eager: true,
}) as Record<string, { default?: TranslationTree } & TranslationTree>;

const dictionaries: Record<Lang, FlatDictionary> = { id: {}, en: {} };

function flatten(tree: TranslationTree, prefix: string, target: FlatDictionary) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      flatten(value as TranslationTree, path, target);
    } else if (value !== undefined) {
      target[path] = String(value);
    }
  }
}

for (const [filePath, mod] of Object.entries(modules)) {
  const namespace = filePath.split('/').pop()!.replace(/\.ts$/, '');
  const source = (mod.default ?? mod) as TranslationTree;
  for (const lang of ['id', 'en'] as Lang[]) {
    const tree = source?.[lang];
    if (tree && typeof tree === 'object') {
      flatten(tree as TranslationTree, namespace, dictionaries[lang]);
    }
  }
}

/**
 * Terjemahkan sebuah key. Key ditulis sebagai `namespace.path.ke.teks`.
 *
 * Kalau key tidak ditemukan di bahasa aktif, fallback ke Bahasa Indonesia lalu
 * ke key itu sendiri, sehingga UI tidak pernah menampilkan `undefined`.
 */
export function translate(lang: Lang, key: string, params?: TranslateParams): string {
  const text = dictionaries[lang]?.[key] ?? dictionaries.id[key];
  if (text === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] key tidak ditemukan: ${key}`);
    return key;
  }
  if (!params) return text;

  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Kode locale BCP-47 untuk `toLocaleString` / `toLocaleDateString`. */
export function localeCode(lang: Lang): string {
  return lang === 'id' ? 'id-ID' : 'en-US';
}

/** Locale date-fns yang dipakai saat memanggil `format()`. */
export function dateLocale(lang: Lang) {
  return lang === 'id' ? idLocale : enUS;
}

/**
 * Hook utama penerjemahan.
 *
 * ```tsx
 * const { t, lang, locale } = useTranslation();
 * <h1>{t('layout.logout')}</h1>
 * ```
 */
export function useTranslation() {
  const lang = useLanguageStore((s) => s.lang);
  const setLang = useLanguageStore((s) => s.setLang);

  const t = useCallback(
    (key: string, params?: TranslateParams) => translate(lang, key, params),
    [lang],
  );

  return {
    t,
    lang,
    setLang,
    /** Kode locale siap pakai, mis. `id-ID` / `en-US`. */
    locale: localeCode(lang),
    /** Locale date-fns untuk `format(date, pattern, { locale })`. */
    dateLocale: dateLocale(lang),
  };
}

/** Daftar key yang tersedia — berguna untuk debugging & pencarian teks. */
export function availableKeys(): string[] {
  return Object.keys(dictionaries.id).sort();
}
