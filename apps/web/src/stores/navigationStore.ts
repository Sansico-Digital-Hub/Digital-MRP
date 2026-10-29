import { create } from 'zustand';
import type { ModuleName } from './authStore';

interface NavigationState {
  activeModule: ModuleName;
  setActiveModule: (module: ModuleName) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activeModule: 'production', // default
  setActiveModule: (module) => set({ activeModule: module }),
}));
