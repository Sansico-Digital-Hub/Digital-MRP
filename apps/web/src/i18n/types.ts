export type Lang = 'id' | 'en';

/** Nilai daun di dalam kamus terjemahan. */
export type TranslationValue = string | number;

/** Struktur kamus bersarang yang ditulis di tiap modul terjemahan. */
export interface TranslationTree {
  readonly [key: string]: TranslationValue | TranslationTree;
}

/** Hasil akhir setelah semua modul di-flatten menjadi `namespace.key`. */
export type FlatDictionary = Record<string, string>;

export type TranslateParams = Record<string, string | number | undefined | null>;
