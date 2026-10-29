import { FastifyReply, FastifyRequest } from 'fastify';
import { parseModuleType, type DataModule } from './periodScope';

/**
 * Sumber kebenaran tunggal untuk HAK AKSES per role di sisi API.
 *
 * Frontend (`apps/web/src/stores/authStore.ts`) memakai matriks yang sama untuk
 * menyembunyikan menu/tombol, tetapi penegakan sebenarnya ADA DI SINI — UI tidak
 * pernah dianggap sebagai pengaman.
 *
 * Aturan (lihat percakapan 2026-09-29):
 * - Production Planner : boleh edit data Production (Production Planning +
 *                        master data bertag Production) & master data bersama
 *                        (26-Week Demand / WIP) HANYA untuk moduleType
 *                        PRODUCTION. Modul Material = view only.
 * - Material Planner   : kebalikannya — edit data Material + bagian MATERIAL
 *                        pada master data bersama. Modul Production = view only.
 * - Admin / Super Admin: boleh edit semuanya.
 * - User / Viewer      : view only.
 */

/** Nilai sah kolom `User.role` — WAJIB sama dengan enum UserRole di schema.prisma. */
export const USER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'PRODUCTION_PLANNER',
  'MATERIAL_PLANNER',
  'USER',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

/** Role dengan akses edit penuh, tanpa batasan modul. */
export const FULL_ACCESS_ROLES: readonly string[] = ['SUPER_ADMIN', 'ADMIN'];

/**
 * Role yang boleh MENGUBAH data per domain.
 *
 * Catatan: `SUPER_ADMIN` selalu diloloskan oleh `requireRole()` di middleware,
 * tetapi tetap dicantumkan di sini supaya daftarnya bisa dibaca utuh.
 */
export const EDIT_ROLES: Record<'production' | 'material' | 'shared' | 'system', string[]> = {
  /** Production Planning + master data bertag "Production". */
  production: ['SUPER_ADMIN', 'ADMIN', 'PRODUCTION_PLANNER'],
  /** Material Planning + master data bertag "Material". */
  material: ['SUPER_ADMIN', 'ADMIN', 'MATERIAL_PLANNER'],
  /** Data bersama (26-Week Demand / WIP) — dibatasi lagi lewat `moduleType`. */
  shared: ['SUPER_ADMIN', 'ADMIN', 'PRODUCTION_PLANNER', 'MATERIAL_PLANNER'],
  /** Modul System (Dropdown Management, User Management). */
  system: ['SUPER_ADMIN', 'ADMIN'],
};

/**
 * Modul `moduleType` yang boleh disentuh role ini pada data BERSAMA.
 *
 * Admin/Super Admin selalu boleh. Planner hanya modul miliknya. Role lain
 * (User/Viewer) tidak boleh menulis sama sekali.
 */
export function allowedDataModules(role?: string): DataModule[] {
  if (!role) return [];
  if (FULL_ACCESS_ROLES.includes(role)) return ['PRODUCTION', 'MATERIAL'];
  if (role === 'PRODUCTION_PLANNER') return ['PRODUCTION'];
  if (role === 'MATERIAL_PLANNER') return ['MATERIAL'];
  return [];
}

/**
 * Boleh menulis ke `moduleType` tertentu?
 *
 * Dipakai untuk endpoint yang TIDAK menerima `moduleType` di body (mis. PUT /
 * DELETE `/:id`) — nilainya diambil dari baris yang sedang diubah.
 */
export function canWriteModule(role: string | undefined, moduleType: unknown): boolean {
  if (!role) return false;
  if (FULL_ACCESS_ROLES.includes(role)) return true;
  const allowed = allowedDataModules(role);
  const parsed = parseModuleType(moduleType);
  return !!parsed && allowed.includes(parsed);
}

/** Pesan 403 standar saat planner menyentuh modul milik planner lain. */
export function forbiddenModuleMessage(role?: string): string {
  if (role === 'PRODUCTION_PLANNER') {
    return 'Role Anda hanya boleh mengubah data Production Planning. Data Material Planning bersifat view-only.';
  }
  if (role === 'MATERIAL_PLANNER') {
    return 'Role Anda hanya boleh mengubah data Material Planning. Data Production Planning bersifat view-only.';
  }
  return 'Role Anda tidak memiliki hak untuk mengubah data ini.';
}

/**
 * Guard untuk endpoint TULIS pada tabel bersama (`weekly_schedules`, `wips`)
 * yang menerima `moduleType` di body/query.
 *
 * Dipakai SETELAH `authenticate`. Menolak planner yang mencoba menulis ke modul
 * milik planner lain.
 */
export function requireModuleAccess() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const role = request.user?.role;
    if (!role) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Admin/Super Admin: bebas.
    if (FULL_ACCESS_ROLES.includes(role)) return;

    const allowed = allowedDataModules(role);
    if (allowed.length === 0) {
      return reply.code(403).send({ error: 'Forbidden', message: forbiddenModuleMessage(role) });
    }

    const source = {
      ...((request.body as Record<string, unknown>) || {}),
      ...((request.query as Record<string, unknown>) || {}),
    };

    if (!canWriteModule(role, source.moduleType)) {
      return reply.code(403).send({ error: 'Forbidden', message: forbiddenModuleMessage(role) });
    }
  };
}
