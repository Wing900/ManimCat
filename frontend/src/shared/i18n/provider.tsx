import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Locale } from './messages';
import { I18nContext, type I18nContextValue } from './context';
import { setCurrentLocale, translate } from './runtime';
import { syncNarrationVoiceToLocale } from '../../infrastructure/storage/settings';
import { loadVisitorCountry } from '../../infrastructure/api/visitor-country';
import { readLocalePreference, resolveBrowserLocale, saveLocalePreference } from './locale-preference';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [savedLocale] = useState(readLocalePreference);
  const hasManualPreference = useRef(savedLocale !== null);
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initialLocale = savedLocale ?? resolveBrowserLocale();
    setCurrentLocale(initialLocale);
    return initialLocale;
  });

  const setLocale = useCallback((nextLocale: Locale) => {
    hasManualPreference.current = true;
    saveLocalePreference(nextLocale);
    setLocaleState(nextLocale);
  }, []);

  useEffect(() => {
    if (hasManualPreference.current) return;
    const controller = new AbortController();
    void loadVisitorCountry(controller.signal).then((country) => {
      // An in-flight detection must never overwrite a subsequent manual choice.
      if (controller.signal.aborted || hasManualPreference.current || !country) return;
      setLocaleState(country === 'CN' ? 'zh-CN' : 'en-US');
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setCurrentLocale(locale);
    document.documentElement.lang = locale;
    // Keep the spoken language aligned with the interface language, including on
    // first load: a stored voice from the other language is replaced by this
    // language's default. Same-language choices (Yunxi/Guy) survive untouched.
    syncNarrationVoiceToLocale(locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    toggleLocale: () => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN'),
    t: (key, params) => translate(key, params, locale),
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
