import bcrypt from 'bcryptjs';
import prisma from './prisma';
import { config } from '../config';

/**
 * Membuat akun SUPER_ADMIN pertama saat database masih benar-benar kosong.
 *
 * Kenapa ini perlu:
 * Database di VPS (Dokploy) dibuat baru dan kosong. `prisma migrate deploy`
 * hanya membuat struktur tabel, tanpa isi. Tanpa langkah ini tidak ada satu pun
 * akun yang bisa dipakai login, dan halaman "Users" juga tidak bisa dibuka
 * karena butuh login terlebih dahulu.
 *
 * Sifatnya idempoten dan aman dijalankan berulang setiap container start:
 *  - kalau tabel users sudah berisi data  -> langsung keluar, tidak menyentuh apa pun
 *  - kalau ADMIN_EMAIL/ADMIN_PASSWORD kosong -> hanya memberi peringatan
 *
 * Password dibaca dari environment, TIDAK ditulis di kode. Jangan pakai
 * password contoh dari prisma/seed.ts untuk server produksi.
 */
export async function bootstrapAdmin(): Promise<void> {
  const { email, password } = config.bootstrapAdmin;

  if (!email || !password) {
    console.warn(
      '[bootstrap] ADMIN_EMAIL / ADMIN_PASSWORD belum diisi. ' +
        'Bila database masih kosong, belum ada akun yang bisa login.'
    );
    return;
  }

  if (password.length < 8) {
    console.warn('[bootstrap] ADMIN_PASSWORD minimal 8 karakter. Pembuatan admin dilewati.');
    return;
  }

  try {
    const existingUsers = await prisma.user.count();
    if (existingUsers > 0) return;

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: 'Super Admin',
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });

    console.log(
      `[bootstrap] Akun SUPER_ADMIN awal dibuat: ${email}. ` +
        'Segera ganti password setelah login pertama.'
    );
  } catch (error) {
    // Kegagalan bootstrap tidak boleh membuat container gagal start,
    // karena sisa aplikasi tetap berjalan normal.
    console.error('[bootstrap] Gagal membuat admin awal:', error);
  }
}

export default bootstrapAdmin;
