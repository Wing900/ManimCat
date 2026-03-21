import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from './messages';
import { I18nContext, type I18nContextValue } from './context';
import { setCurrentLocale, translate } from './runtime';

const STORAGE_KEY = 'manimcat_locale';
const DEFAULT_LOCALE: Locale = 'en-US';

function resolveInitialLocale(): Locale {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }

  const savedLocale = window.localStorage.getItem(STORAGE_KEY);
  if (savedLocale === 'zh-CN' || savedLocale === 'en-US') {
    return savedLocale;
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initialLocale = resolveInitialLocale();
    setCurrentLocale(initialLocale);
    return initialLocale;
  });

  useEffect(() => {
    setCurrentLocale(locale);
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale: setLocaleState,
    toggleLocale: () => setLocaleState((prev) => (prev === 'zh-CN' ? 'en-US' : 'zh-CN')),
    t: (key, params) => translate(key, params, locale),
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
