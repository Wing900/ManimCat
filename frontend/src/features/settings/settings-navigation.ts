import type { TranslationKey } from '../../shared/i18n/index'

export type SettingsSection = 'ai' | 'video'

export interface SettingsNavItem {
  id: SettingsSection
  labelKey: TranslationKey
}

/** Left-rail entries of the Settings page. Only sections with real content are listed. */
export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { id: 'ai', labelKey: 'settings.nav.ai' },
  { id: 'video', labelKey: 'settings.nav.video' },
]
