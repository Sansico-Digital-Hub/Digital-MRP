import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Bahasa yang didukung aplikasi. `id` = Bahasa Indonesia, `en` = English. */
export type Lang = 'id' | 'en';

/** Nama bahasa untuk ditampilkan di pemilih bahasa. */
export const LANG_OPTIONS: { value: Lang; label: string; short: string }[] = [
  { value: 'id', label: 'Bahasa Indonesia', short: 'ID' },
  { value: 'en', label: 'English', short: 'EN' },
];

interface LanguageState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

/**
 * Preferensi bahasa disimpan di localStorage supaya pilihan user bertahan
 * setelah refresh atau pindah halaman.
 */
export const useLanguageStore = create<LanguageState>()(
  persist(
    (set, get) => ({
      lang: 'id',
      setLang: (lang) => set({ lang }),
      toggleLang: () => set({ lang: get().lang === 'id' ? 'en' : 'id' }),
    }),
    { name: 'pdits-language' },
  ),
);
