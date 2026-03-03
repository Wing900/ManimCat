import { loadSettings } from './settings';

export interface CustomApiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface CustomApiProfile {
  customApiConfig: CustomApiConfig;
  manimcatApiKey: string;
}

const PROFILE_INDEX_KEY = 'manimcat_custom_profile_index';

function splitListInput(input: string): string[] {
  return input
    .split(/[\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function valueByIndex(values: string[], index: number): string {
  if (values.length === 0) {
    return '';
  }
  if (values.length === 1) {
    return values[0];
  }
  return values[index] || '';
}

export function buildCustomProfilesFromFields(fields: {
  apiUrl: string;
  apiKey: string;
  model: string;
  manimcatApiKey: string;
}): CustomApiProfile[] {
  const urls = splitListInput(fields.apiUrl);
  const keys = splitListInput(fields.apiKey);
  const models = splitListInput(fields.model);
  const manimcatKeys = splitListInput(fields.manimcatApiKey);
  const maxCount = Math.max(urls.length, keys.length, models.length, manimcatKeys.length, 0);

  if (maxCount === 0) {
    return [];
  }

  const profiles: CustomApiProfile[] = [];
  for (let i = 0; i < maxCount; i += 1) {
    const apiUrl = valueByIndex(urls, i);
    const apiKey = valueByIndex(keys, i);
    if (!apiUrl || !apiKey) {
      continue;
    }

    profiles.push({
      customApiConfig: {
        apiUrl,
        apiKey,
        model: valueByIndex(models, i),
      },
      manimcatApiKey: valueByIndex(manimcatKeys, i),
    });
  }

  return profiles;
}

export function loadCustomProfiles(): CustomApiProfile[] {
  const { api } = loadSettings();
  return buildCustomProfilesFromFields({
    apiUrl: api.apiUrl,
    apiKey: api.apiKey,
    model: api.model,
    manimcatApiKey: api.manimcatApiKey,
  });
}

function readProfileIndex(): number {
  const raw = localStorage.getItem(PROFILE_INDEX_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

export function pickNextCustomProfile(): CustomApiProfile | null {
  const profiles = loadCustomProfiles();
  if (profiles.length === 0) {
    return null;
  }

  const index = readProfileIndex() % profiles.length;
  localStorage.setItem(PROFILE_INDEX_KEY, String((index + 1) % profiles.length));
  return profiles[index] || null;
}
