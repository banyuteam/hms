import { create } from 'zustand';
import { detectInitialLocale, saveLocale, type Locale } from './locales';

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectInitialLocale(safeStorage()),
  setLocale: (locale) => {
    saveLocale(locale, safeStorage());
    set({ locale });
  },
}));
