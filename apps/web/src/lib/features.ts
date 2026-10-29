/**
 * Feature flag untuk frontend.
 *
 * PENTING: nilai di sini ditanam SAAT BUILD oleh Vite, bukan dibaca saat
 * runtime. Jadi mengubahnya di Dokploy harus lewat tab Environment ->
 * "Build Time Arguments", lalu deploy ulang.
 */

function readFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
}

export const FEATURES = {
  /**
   * Menu & halaman Material Calculation.
   *
   * Default NYALA (true) — sedang dalam tahap pengujian.
   *
   * Untuk menyembunyikannya (mis. saat deploy produksi sebelum angkanya
   * disetujui tim bisnis), set `VITE_ENABLE_MATERIAL_CALC=false` lewat
   * "Build Time Arguments" di Dokploy, atau lewat `apps/web/.env` untuk lokal.
   *
   *  - true  : menu tampil di sidebar, URL /material-calculation bisa dibuka
   *  - false : menu disembunyikan & URL dialihkan ke dashboard
   *            (endpoint API-nya tetap ada, jadi masih bisa diuji lewat alat lain)
   */
  materialCalculation: readFlag(import.meta.env.VITE_ENABLE_MATERIAL_CALC, true),
} as const;

export type FeatureName = keyof typeof FEATURES;

export function isFeatureEnabled(name: FeatureName): boolean {
  return FEATURES[name];
}
