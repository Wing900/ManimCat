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
  /** Driven by App: leaves with the studio's own horizontal slide rather than unmounting in place. */
  exiting: boolean
  onClose: () => void
}

/**
 * Settings, as a page rather than a modal.
 *
 * Shape is copied from the studio and the Prompt Manager: a light bar on top with a bare left arrow,
 * a rail on the left, one centred content column on the right.
 *
 * Both ends of the visit are owned elsewhere: App runs the `page-assemble` stagger on entry and the
 * `page-slide-out` / `page-slide-in` pop on exit, exactly as it already does for the studio. Nothing
 * here animates on its own.
 */
export function SettingsPage({ exiting, onClose }: SettingsPageProps) {
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
    <div
      className={`fixed inset-0 z-[120] flex flex-col bg-bg-primary ${
        exiting ? 'page-slide-out' : 'page-assemble'
      }`}
    >
      <header
        data-assemble="header"
        className="flex h-16 shrink-0 items-center border-b border-border/5 bg-bg-secondary/50 px-6"
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
        <span className="ml-3 text-lg font-medium tracking-tight text-text-primary/90">
          {t('settings.title')}
        </span>
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
                    ? 'bg-ink/[0.06] font-medium text-text-primary'
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
          {/* key 换了才重挂，动画跟着内容走：切分区是“落位”，再点同一个分区不会再播一遍。 */}
          <div key={section} className="panel-in mx-auto w-full max-w-xl px-8 py-10">
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
