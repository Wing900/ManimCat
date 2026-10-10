import { useState } from 'react'
import { useI18n } from '../../shared/i18n/index'
import type { ConnectionMode, ConnectionSettings } from '../connection/connection-types'
import { CatKeyForm } from '../connection/CatKeyForm'
import { ByokForm } from '../connection/ByokForm'

interface AiConnectionSettingsProps {
  connection: ConnectionSettings
  onSaved: (next: ConnectionSettings) => void
}

const MODE_LABEL_KEYS = {
  catkey: 'connection.choice.catkey.title',
  byok: 'connection.choice.byok.title',
} as const

export function AiConnectionSettings({ connection, onSaved }: AiConnectionSettingsProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<ConnectionMode>(connection.activeMode ?? 'catkey')

  const disconnect = () => onSaved({ ...connection, activeMode: null })

  return (
    <div className="max-w-xl space-y-8">
      <div className="flex gap-2">
        {(['catkey', 'byok'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setMode(item)}
            className={`flex-1 rounded-2xl px-4 py-3 text-sm transition-colors ${
              mode === item
                ? 'bg-accent text-bg-primary font-medium'
                : 'bg-bg-secondary/40 text-text-secondary hover:text-text-primary'
            }`}
          >
            {t(MODE_LABEL_KEYS[item])}
          </button>
        ))}
      </div>

      {mode === 'catkey' && (
        <>
          {connection.activeMode === 'catkey' && (
            <div className="flex items-center justify-between rounded-2xl bg-bg-secondary/40 px-4 py-3">
              <span className="text-sm text-text-primary">{t('connection.catkey.status.connected')}</span>
              <button
                type="button"
                onClick={disconnect}
                className="text-sm font-medium text-red-600 transition-colors hover:text-red-700 dark:text-red-400"
              >
                {t('connection.catkey.disconnect')}
              </button>
            </div>
          )}
          <CatKeyForm
            connection={connection}
            submitLabel={t('connection.catkey.verifyAndSave')}
            onSaved={onSaved}
          />
        </>
      )}

      {mode === 'byok' && <ByokForm connection={connection} onSaved={onSaved} />}
    </div>
  )
}
