import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'PRODUCTION_PLANNER'
  | 'MATERIAL_PLANNER'
  | 'USER'
  | 'VIEWER';

export type ModuleName = 'production' | 'material' | 'masterdata' | 'system';

/** Modul pemilik data pada tabel bersama (`weekly_schedules`, `wips`). */
export type DataModuleScope = 'PRODUCTION' | 'MATERIAL';

/** Scope tampilan Master Data untuk sebuah role. */
export type MasterDataScope = 'all' | 'production' | 'material';

/**
 * Modul data yang boleh DIUBAH oleh role.
 *
 * - Admin & Super Admin : semua modul
 * - Production Planner  : hanya data Production
 * - Material Planner    : hanya data Material
 * - User / Viewer       : tidak boleh mengubah data apa pun
 */
export function editableDataModules(role?: Role | null): DataModuleScope[] {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'ADMIN':
      return ['PRODUCTION', 'MATERIAL'];
    case 'PRODUCTION_PLANNER':
      return ['PRODUCTION'];
    case 'MATERIAL_PLANNER':
      return ['MATERIAL'];
    default:
      return [];
  }
}

/**
 * Modul "rumah" role pada halaman bersama (26-Week Demand & WIP).
 *
 * Kalau bukan `null`, pemilih modul di halaman tersebut DIKUNCI ke modul ini
 * supaya planner tidak bisa menulis ke modul milik planner lain. `null` berarti
 * bebas memilih (Admin / Super Admin / User view-only).
 */
export function lockedDataModule(role?: Role | null): DataModuleScope | null {
  if (role === 'PRODUCTION_PLANNER') return 'PRODUCTION';
  if (role === 'MATERIAL_PLANNER') return 'MATERIAL';
  return null;
}

/**
 * Subset Master Data yang boleh diakses role ini.
 * Item Master Data bertag "Production & Material" tetap terlihat oleh keduanya.
 */
export function masterDataScopeForRole(role?: Role | null): MasterDataScope {
  if (role === 'PRODUCTION_PLANNER') return 'production';
  if (role === 'MATERIAL_PLANNER') return 'material';
  return 'all';
}

interface User {
  id: string;
  name: string;
  email: string;
  role: Role; // Updated to specific Role type
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  
  // Actions
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  logout: () => void;
  updateAccessToken: (token: string) => void;
  
  // Permissions derived from current user role
  canEdit: (module: ModuleName) => boolean;
  canView: (module: ModuleName) => boolean;
  /** Boleh mengubah data pada modul bersama (26-Week Demand / WIP)? */
  canEditDataModule: (module: DataModuleScope) => boolean;
  /** Subset Master Data yang boleh diakses role ini. */
  masterDataScope: () => MasterDataScope;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      
      setAuth: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
      updateAccessToken: (accessToken) => set({ accessToken }),
      
      /**
       * Boleh MENGUBAH data di modul ini?
       *
       * Catatan: `masterdata` mengembalikan `true` untuk kedua planner karena
       * mereka berhak mengedit SUBSET-nya (Production vs Material). Untuk tahu
       * subset mana yang boleh diedit, gunakan `masterDataScope()` /
       * `canEditDataModule()`.
       */
      canEdit: (module) => {
        const user = get().user;
        if (!user) return false;

        switch (user.role) {
          case 'SUPER_ADMIN':
          case 'ADMIN':
            return true;
          case 'PRODUCTION_PLANNER':
            return module === 'production' || module === 'masterdata';
          case 'MATERIAL_PLANNER':
            return module === 'material' || module === 'masterdata';
          case 'USER':
          case 'VIEWER':
            return false;
          default:
            return false;
        }
      },

      /**
       * Boleh MELIHAT modul ini?
       *
       * Planner boleh melihat modul planner lain (view only) sesuai aturan:
       * - Production Planner melihat Material Planning tanpa hak edit
       * - Material Planner melihat Production Planning tanpa hak edit
       * Modul `system` hanya untuk Admin & Super Admin.
       */
      canView: (module) => {
        const user = get().user;
        if (!user) return false;

        switch (user.role) {
          case 'SUPER_ADMIN':
          case 'ADMIN':
            return true;
          case 'PRODUCTION_PLANNER':
          case 'MATERIAL_PLANNER':
          case 'USER':
          case 'VIEWER':
            return module !== 'system';
          default:
            return false;
        }
      },

      canEditDataModule: (module) => editableDataModules(get().user?.role).includes(module),

      masterDataScope: () => masterDataScopeForRole(get().user?.role),
    }),
    {
      name: 'auth-storage',
    }
  )
);
