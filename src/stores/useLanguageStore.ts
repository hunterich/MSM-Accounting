import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AppLanguage } from '../i18n/language';

interface LanguageStore {
  language: AppLanguage | null;
  setLanguage: (language: AppLanguage) => void;
}

// This is a browser preference, not the organization's accounting locale.
export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set) => ({ language: null, setLanguage: (language) => set({ language }) }),
    {
      name: 'msm-ui-language',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ language: state.language }),
    },
  ),
);
