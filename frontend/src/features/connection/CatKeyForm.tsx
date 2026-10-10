import { useState } from 'react'
import { useI18n } from '../../shared/i18n/index'
import { FloatingInput } from '../../shared/components/FloatingInput'
import { CATKEY_PATTERN, type ConnectionSettings } from './connection-types'
import { useConnectionTest } from './use-connection-test'

interface CatKeyFormProps {
  connection: ConnectionSettings
  submitLabel: string
  onSaved: (connection: ConnectionSettings) => void
}

export function CatKeyForm({ connection, submitLabel, onSaved }: CatKeyFormProps) {
  const { t } = useI18n()
  const [key, setKey] = useState(connection.catkey.key)
  const [error, setError] = useState<string | null>(null)
  const { result, verify } = useConnectionTest()

  const trimmed = key.trim()
  const testing = result.status === 'testing'

  const handleSubmit = async () => {
    setError(null)
    if (!CATKEY_PATTERN.test(trimmed)) {
      setError(t('connection.test.invalidCatkey'))
      return
    }
    const next: ConnectionSettings = { ...connection, activeMode: 'catkey', catkey: { key: trimmed } }
    if (await verify(next)) onSaved(next)
  }

  const status = (() => {
    if (result.status === 'success') return t('connection.catkey.status.connected')
    if (result.status === 'error') return result.revoked ? t('connection.catkey.status.revoked') : result.message
    return null
  })()

  return (
    <div className="space-y-6">
      <FloatingInput
        id="catkey"
        type="password"
        label={t('connection.catkey.label')}
        value={key}
        placeholder={t('connection.catkey.placeholder')}
        onChange={(value) => {
          setKey(value)
          setError(null)
        }}
      />

      {(error || status) && (
        <p className={`text-sm ${result.status === 'success' ? 'text-green-500' : 'text-red-600 dark:text-red-400'}`}>
          {error ?? status}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={testing}
        className="w-full rounded-2xl bg-accent px-6 py-4 text-sm font-medium text-bg-primary shadow-md shadow-accent/10 transition-colors duration-200 ease-ui hover:bg-accent/90 active:scale-95 disabled:opacity-50"
      >
        {testing ? t('connection.testing') : submitLabel}
      </button>
    </div>
  )
}
