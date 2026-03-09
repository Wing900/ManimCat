import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { messages, type Locale, type TranslationKey } from './messages';

const STORAGE_KEY = 'manimcat_locale';
const DEFAULT_LOCALE: Locale = 'en-US';

interface TranslateParams {
  [key: string]: number | string;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey, params?: TranslateParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

let currentLocale: Locale = DEFAULT_LOCALE;

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

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

export function getCurrentLocale(): Locale {
  return currentLocale;
}

export function translate(key: TranslationKey, params?: TranslateParams, locale: Locale = currentLocale): string {
  const template = messages[locale][key] ?? messages[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, params);
}

export function localizeApiMessage(message: string): string {
  if (!message || currentLocale === 'zh-CN') {
    return message;
  }

  if (message.includes('缺少 API 密钥')) {
    return 'Missing API key. Provide a Bearer token in the Authorization header.';
  }
  if (message.includes('无效的 authorization 头格式')) {
    return 'Invalid Authorization header format. Use: Bearer <api-key>.';
  }
  if (message.includes('无效的 API 密钥')) {
    return 'Invalid API key.';
  }
  if (message.includes('服务未配置 MANIMCAT_ROUTE_KEYS')) {
    return 'The service is not configured with MANIMCAT_ROUTE_KEYS.';
  }
  if (message.includes('任务已失效')) {
    return 'The job expired, possibly after a server restart. Please submit it again.';
  }
  if (message.includes('未找到任务')) {
    return 'Job not found.';
  }

  return message;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initialLocale = resolveInitialLocale();
    currentLocale = initialLocale;
    return initialLocale;
  });

  useEffect(() => {
    currentLocale = locale;
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale: setLocaleState,
    toggleLocale: () => setLocaleState((prev) => (prev === 'zh-CN' ? 'en-US' : 'zh-CN')),
    t: (key, params) => translate(key, params, locale)
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
