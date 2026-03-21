import { messages, type Locale, type TranslationKey } from './messages';

const DEFAULT_LOCALE: Locale = 'en-US';

interface TranslateParams {
  [key: string]: number | string;
}

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

export function setCurrentLocale(locale: Locale): void {
  currentLocale = locale;
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
