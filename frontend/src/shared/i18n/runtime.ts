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
  if (message.includes('无法识别的 API 密钥格式')) {
    return 'Unrecognized API key format. Use a CatKey (mc_…) or a local BYOK id (byok_…).';
  }
  if (message.includes('该 CatKey 已被停用')) {
    return 'This CatKey has been revoked.';
  }
  if (message.includes('服务端未配置 CatKey 上游')) {
    return 'The service has no CatKey upstream configured.';
  }
  if (message.includes('自定义 API 配置不完整')) {
    return 'Incomplete provider configuration: apiUrl, apiKey and model are all required.';
  }
  if (message.includes('任务已失效')) {
    return 'The job expired, possibly after a server restart. Please submit it again.';
  }
  if (message.includes('未找到任务')) {
    return 'Job not found.';
  }

  // The address itself only redirects. The target is carried through, because that is the fix.
  const redirect = /上游地址发生了重定向（(\d+)(?: → (\S+?))?）/.exec(message);
  if (redirect) {
    return redirect[2]
      ? `The upstream address redirects (${redirect[1]} → ${redirect[2]}). Use that final address as the Base URL.`
      : `The upstream address redirects (${redirect[1]}). Use the final address as the Base URL.`;
  }

  return message;
}
