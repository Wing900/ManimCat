import type { ComponentType, SVGProps } from 'react'
import type { TranslationKey } from '../../shared/i18n/index'
import { AiConnectionMark, VideoMark } from './settings-icons'

export type SettingsSection = 'ai' | 'video'

export interface SettingsNavItem {
  id: SettingsSection
  labelKey: TranslationKey
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

/** Left-rail entries of the Settings page. Only sections with real content are listed. */
export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { id: 'ai', labelKey: 'settings.nav.ai', icon: AiConnectionMark },
  { id: 'video', labelKey: 'settings.nav.video', icon: VideoMark },
]
