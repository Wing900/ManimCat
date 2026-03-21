import { createContext } from 'react';
import type { Locale, TranslationKey } from './messages';

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey, params?: Record<string, number | string>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);
