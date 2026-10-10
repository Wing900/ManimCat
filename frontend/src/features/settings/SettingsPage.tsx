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

/**
 * Settings, as a page rather than a modal.
 *
 * Shape is copied from the two screens that already work this way (`PromptSettings`, and the studio
 * shell behind it): a light bar on top with a bare left arrow, a rail on the left, content on the
 * right. The content column is centred instead of hugging the rail, so the page reads as one thing
 * rather than a sidebar with a leftover.
 *
 * Entry is the same `page-assemble` contract the studio uses (`index.css`): every part carries a
 * `data-assemble` name and arrives on its own stagger. Nothing here animates on its own.
 */
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
    <div className="page-assemble fixed inset-0 z-[120] flex flex-col bg-bg-primary">
      <header
        data-assemble="header"
        className="flex h-16 shrink-0 items-center gap-3 border-b border-border/5 bg-bg-secondary/50 px-6"
      >
        <button
          type="button"
          onClick={handleClose}
          aria-label={t('common.back')}
          title={t('common.back')}
          className="rounded-2xl p-2.5 text-text-secondary/50 transition-colors duration-200 ease-ui hover:bg-bg-primary/50 hover:text-text-primary active:scale-90"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-1.5 rounded-full bg-accent/40" />
          <span className="text-lg font-medium tracking-tight text-text-primary/90">{t('settings.title')}</span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav data-assemble="rail" className="w-56 shrink-0 space-y-2 border-r border-border/5 p-4">
          {SETTINGS_NAV_ITEMS.map((item) => {
            const Mark = item.icon
            const active = section === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm transition-colors duration-200 ease-ui ${
                  active
                    ? 'bg-ink/[0.07] font-medium text-text-primary'
                    : 'text-text-secondary hover:bg-bg-secondary/60 hover:text-text-primary'
                }`}
              >
                <Mark className="h-[1.15rem] w-[1.15rem] shrink-0 opacity-80" />
                {t(item.labelKey)}
              </button>
            )
          })}
        </nav>

        <main data-assemble="panel" className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-xl px-8 py-10">
            {section === 'ai' ? (
              <AiConnectionSettings connection={connection} onSaved={saveConnection} />
            ) : (
              <VideoSettings videoConfig={config.video} onUpdate={updateVideo} />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
