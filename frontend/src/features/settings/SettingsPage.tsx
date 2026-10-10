import { useState } from 'react'
import { useI18n } from '../../shared/i18n/index'
import type { SettingsConfig, VideoConfig } from '../../shared/types/api'
import { loadSettings, saveSettings } from '../../infrastructure/storage/settings'
import { useSettingsAutosave } from '../../infrastructure/storage/use-settings-autosave'
import { saveConnection, useConnection } from '../connection/connection-storage'
import { SETTINGS_NAV_ITEMS, type SettingsSection } from './settings-navigation'
import { AiConnectionSettings } from './AiConnectionSettings'
import { VideoSettings } from './VideoSettings'

interface SettingsPageProps {
  onClose: () => void
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { t } = useI18n()
  const connection = useConnection()
  const [section, setSection] = useState<SettingsSection>('ai')
  const [config, setConfig] = useState<SettingsConfig>(() => loadSettings())

  // Debounced autosave while the page is open; `handleClose` also flushes, so a tweak made in the
  // last fraction of a second before closing is never lost.
  useSettingsAutosave({ config, isOpen: true, onSave: () => undefined })

  const updateVideo = (updates: Partial<VideoConfig>) => {
    setConfig((prev) => ({ ...prev, video: { ...prev.video, ...updates } }))
  }

  const handleClose = () => {
    saveSettings(config)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-bg-primary">
      <header className="flex items-center justify-between border-b border-bg-tertiary/30 px-6 py-5">
        <span className="text-base font-medium text-text-primary">{t('settings.title')}</span>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-xl px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-secondary/50 hover:text-text-primary"
        >
          {t('settings.page.back')}
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-56 shrink-0 space-y-1 border-r border-bg-tertiary/30 p-4">
          {SETTINGS_NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`w-full rounded-xl px-4 py-2.5 text-left text-sm transition-colors ${
                section === item.id
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'text-text-secondary hover:bg-bg-secondary/40 hover:text-text-primary'
              }`}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto p-8">
          {section === 'ai' ? (
            <AiConnectionSettings connection={connection} onSaved={saveConnection} />
          ) : (
            <VideoSettings videoConfig={config.video} onUpdate={updateVideo} />
          )}
        </main>
      </div>
    </div>
  )
}
