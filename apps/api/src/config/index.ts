import { config as loadEnv } from 'dotenv';
import path from 'path';

// Di development, ambil variabel dari .env di root monorepo.
// Di production JANGAN: variabel sudah disuntikkan oleh platform (Dokploy).
// `override: true` juga sengaja dihapus — kalau tidak, variabel dari platform
// bisa tertimpa oleh file .env yang tanpa sengaja ikut terbawa ke image.
if (process.env.NODE_ENV !== 'production') {
  loadEnv({ path: path.resolve(__dirname, '../../../../.env') });
}

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Nilai cadangan HANYA untuk development. Isinya sengaja berbeda dari nilai
 * lama yang dulu dipakai, supaya token lama tidak berlaku lagi.
 */
const DEV_ACCESS_SECRET = 'dev-only-access-secret-do-not-use-in-production';
const DEV_REFRESH_SECRET = 'dev-only-refresh-secret-do-not-use-in-production';

/**
 * Ambil secret JWT dan HENTIKAN proses kalau tidak layak dipakai.
 *
 * Kenapa harus berhenti, bukan sekadar memberi peringatan: sebelumnya nilai
 * cadangan dipakai diam-diam, sehingga server produksi bisa berjalan dengan
 * secret yang tertulis di repo. Akibatnya siapa pun bisa membuat token sendiri
 * dan masuk sebagai user mana pun tanpa login, tanpa satu pun tanda di log.
 */
function resolveSecret(name: string, raw: string | undefined, devFallback: string): string {
  const value = (raw ?? '').trim();

  if (value === '') {
    if (isProduction) {
      throw new Error(
        `${name} WAJIB diisi saat NODE_ENV=production. ` +
          'Buat nilainya dengan: openssl rand -base64 48'
      );
    }
    return devFallback;
  }

  if (isProduction && value.length < 32) {
    throw new Error(
      `${name} terlalu pendek (${value.length} karakter). Minimal 32 karakter saat produksi. ` +
        'Buat nilainya dengan: openssl rand -base64 48'
    );
  }

  return value;
}

const jwtSecret = resolveSecret('JWT_SECRET', process.env.JWT_SECRET, DEV_ACCESS_SECRET);
const jwtRefreshSecret = resolveSecret(
  'JWT_REFRESH_SECRET',
  process.env.JWT_REFRESH_SECRET,
  DEV_REFRESH_SECRET
);

if (isProduction && jwtSecret === jwtRefreshSecret) {
  throw new Error(
    'JWT_SECRET dan JWT_REFRESH_SECRET tidak boleh sama. ' +
      'Pakai dua nilai berbeda (masing-masing: openssl rand -base64 48).'
  );
}

/**
 * CORS_ORIGIN boleh berisi lebih dari satu domain, dipisah koma. Garis miring
 * di akhir dibuang karena browser mengirim Origin tanpa garis miring, sehingga
 * "https://app.domain.com/" tidak akan pernah cocok dan login gagal dengan
 * pesan CORS yang membingungkan.
 */
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter((origin) => origin !== '');

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  corsOrigin: corsOrigins[0],
  corsOrigins,

  // Database
  databaseUrl: process.env.DATABASE_URL!,

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // JWT
  jwt: {
    secret: jwtSecret,
    refreshSecret: jwtRefreshSecret,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '5h',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  // Refresh token disimpan di cookie httpOnly, tidak lagi di localStorage.
  // Path dibatasi ke /api/v1/auth supaya cookie tidak ikut terkirim pada
  // setiap request API biasa.
  refreshCookie: {
    name: 'pdits_rt',
    path: '/api/v1/auth',
    maxAgeSeconds: 7 * 24 * 60 * 60,
  },

  // VAPID (Web Push)
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },

  // Cache TTL (in seconds)
  cache: {
    fgStock: 120, // 2 minutes
    wip: 120, // 2 minutes
    tracking: 120, // 2 minutes
    items: 1800, // 30 minutes
  },

  // NPOF External API
  npofApi: {
    url: process.env.NPOF_API_URL || 'http://127.0.0.1:8008',
    key: process.env.NPOF_API_KEY || '',
  },

  // Akun SUPER_ADMIN pertama untuk database yang masih kosong (VPS/Dokploy).
  // Dibiarkan kosong = fitur dilewati. Lihat src/lib/bootstrapAdmin.ts.
  bootstrapAdmin: {
    email: process.env.ADMIN_EMAIL || '',
    password: process.env.ADMIN_PASSWORD || '',
  },

  // Parameter perhitungan material.
  materialCalc: {
    // Toleransi ukuran saat mencocokkan stok ke kebutuhan, dalam cm.
    sizeToleranceCm: parseInt(process.env.MATERIAL_SIZE_TOLERANCE_CM || '2', 10),
    // 1 rim dihitung 500 lembar. Dipakai untuk Outstanding PO bersatuan "rim".
    sheetsPerRim: parseInt(process.env.SHEETS_PER_RIM || '500', 10),
    // Apakah supplier harus sama agar stok/PO dianggap cocok.
    // true (DEFAULT sejak 2026-10-15) = pencocokan memakai Item Desc + Supplier,
    //   sesuai spesifikasi §2 (NPOF dihubungkan ke Stock Raw Material dan
    //   Outstanding PO lewat Item Desc + Supplier). Nama supplier dibandingkan
    //   setelah normalisasi `supplierAlias.ts`, jadi "PHIL CORPORATION" tetap
    //   terbaca sebagai HANCHANG dan "PT. MEGA SURYA ERATAMA" sebagai MEGA.
    //   Sebelum ini supplier tidak diperiksa, sehingga gulungan 450gsm/120cm
    //   milik MEGA ikut dipakai di ukuran `120 x 85.5 CM` milik HANCHANG.
    // false = kembali ke perilaku lama (hanya gramatur + ukuran yang menentukan).
    requireSupplierMatch: (process.env.MATERIAL_REQUIRE_SUPPLIER || 'true').toLowerCase() === 'true',
    // Fitur INFORMASI "Rekomendasi Ukuran Material & Waste". Tidak mengubah
    // angka perhitungan (alokasi, shortage, Stock As Of, End Ind).
    recommendation: {
      // Jumlah alternatif ukuran yang dikirim ke UI per grup.
      maxOptions: parseInt(process.env.MATERIAL_REC_MAX_OPTIONS || '8', 10),
      // Kelipatan ukuran maksimum yang diuji (mis. 180 cm untuk kebutuhan 59 cm = 3).
      maxMultiplier: parseInt(process.env.MATERIAL_REC_MAX_MULTIPLIER || '6', 10),
      // Sertakan ukuran dari NPOF yang belum ada di stok/PO.
      includeNpof: (process.env.MATERIAL_REC_INCLUDE_NPOF || 'true').toLowerCase() === 'true',
      // Ukuran standar (cm) yang selalu dipertimbangkan, dipisah koma.
      standardSizes: (process.env.MATERIAL_REC_STANDARD_SIZES || '180')
        .split(',')
        .map((v) => parseFloat(v.trim()))
        .filter((v) => Number.isFinite(v) && v > 0),
    },
  },
};

export default config;
