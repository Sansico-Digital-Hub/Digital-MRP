import { config as loadEnv } from 'dotenv';
import path from 'path';

// Di development, ambil variabel dari .env di root monorepo.
// Di production JANGAN: variabel sudah disuntikkan oleh platform (Dokploy).
// `override: true` juga sengaja dihapus — kalau tidak, variabel dari platform
// bisa tertimpa oleh file .env yang tanpa sengaja ikut terbawa ke image.
if (process.env.NODE_ENV !== 'production') {
  loadEnv({ path: path.resolve(__dirname, '../../../../.env') });
}

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  // Database
  databaseUrl: process.env.DATABASE_URL!,

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '5h',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
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
  },
};

export default config;
