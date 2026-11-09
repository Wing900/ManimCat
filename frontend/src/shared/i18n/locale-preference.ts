import type { Locale } from './messages';

const STORAGE_KEY = 'manimcat_locale';

export function readLocalePreference(): Locale | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'zh-CN' || saved === 'en-US' ? saved : null;
  } catch {
    return null;
  }
}

export function saveLocalePreference(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // A blocked storage area must not prevent an in-memory language change.
  }
}

export function resolveBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en-US';
  const language = navigator.languages?.[0] || navigator.language;
  return /^zh(?:-|$)/i.test(language) ? 'zh-CN' : 'en-US';
}
