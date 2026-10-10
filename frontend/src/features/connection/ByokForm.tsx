import { useState } from 'react'
import { useI18n } from '../../shared/i18n/index'
import { FloatingInput } from '../../shared/components/FloatingInput'
import {
  BYOK_PATTERN,
  GOOGLE_OPENAI_COMPAT_URL,
  OPENAI_DEFAULT_URL,
  createBrowserSecret,
  type ConnectionSettings,
} from './connection-types'
import { useConnectionTest } from './use-connection-test'

interface ByokFormProps {
  connection: ConnectionSettings
  onSaved: (connection: ConnectionSettings) => void
  onBack?: () => void
}

export function ByokForm({ connection, onSaved, onBack }: ByokFormProps) {
  const { t } = useI18n()
  const [provider, setProvider] = useState(connection.byok.provider)
  const [apiKey, setApiKey] = useState(connection.byok.apiKey)
  const [model, setModel] = useState(connection.byok.model)
  const [apiUrl, setApiUrl] = useState(connection.byok.apiUrl)
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { result, verify } = useConnectionTest()

  const trimmedUrl = apiUrl.trim()
  const trimmedKey = apiKey.trim()
  const trimmedModel = model.trim()
  const complete = Boolean(trimmedUrl && trimmedKey && trimmedModel)
  const testing = result.status === 'testing'

  const build = (): ConnectionSettings => ({
    ...connection,
    activeMode: 'byok',
    byok: {
      browserSecret: BYOK_PATTERN.test(connection.byok.browserSecret)
        ? connection.byok.browserSecret
        : createBrowserSecret(),
      provider,
      apiUrl: trimmedUrl,
      apiKey: trimmedKey,
      model: trimmedModel,
    },
  })

  const handleTest = async () => {
    setError(null)
    if (!complete) {
      setError(t('connection.test.requiredUrlKeyModel'))
      return
    }
    await verify(build())
  }

  const handleSave = () => {
    setError(null)
    if (!complete) {
      setError(t('connection.test.requiredUrlKeyModel'))
      return
    }
    onSaved(build())
  }

  const changeProvider = (next: 'openai-compatible' | 'google') => {
    setProvider(next)
    setError(null)
    if (!trimmedUrl) setApiUrl(next === 'google' ? GOOGLE_OPENAI_COMPAT_URL : OPENAI_DEFAULT_URL)
  }

  const status = result.status === 'success'
    ? t('connection.test.success')
    : result.status === 'error'
      ? result.message
      : null

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="byok-provider" className="text-xs font-medium text-text-secondary">
          {t('connection.byok.provider')}
        </label>
        <select
          id="byok-provider"
          value={provider}
          onChange={(event) => changeProvider(event.target.value as 'openai-compatible' | 'google')}
          className="w-full rounded-2xl bg-bg-secondary/50 px-4 py-4 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          <option value="openai-compatible">{t('connection.byok.provider.openai')}</option>
          <option value="google">{t('connection.byok.provider.google')}</option>
        </select>
      </div>

      <FloatingInput
        id="byok-api-key"
        type="password"
        label={t('connection.byok.apiKey')}
        value={apiKey}
        placeholder="sk-…"
        onChange={(value) => {
          setApiKey(value)
          setError(null)
        }}
      />

      <FloatingInput
        id="byok-model"
        type="text"
        label={t('connection.byok.model')}
        value={model}
        placeholder="model-name"
        onChange={(value) => {
          setModel(value)
          setError(null)
        }}
      />

      <button
        type="button"
        onClick={() => setAdvanced((prev) => !prev)}
        className="text-xs font-medium text-accent"
      >
        {t('connection.byok.advanced')}
      </button>

      {advanced && (
        <FloatingInput
          id="byok-base-url"
          type="text"
          label={t('connection.byok.baseUrl')}
          value={apiUrl}
          placeholder="https://…/v1"
          onChange={(value) => {
            setApiUrl(value)
            setError(null)
          }}
        />
      )}

      {(error || status) && (
        <p className={`text-sm ${result.status === 'success' ? 'text-green-500' : 'text-red-600 dark:text-red-400'}`}>
          {error ?? status}
        </p>
      )}

      <div className="flex gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={testing}
            className="rounded-2xl bg-bg-primary/50 px-6 py-4 text-sm font-medium text-text-secondary transition-all hover:bg-bg-tertiary hover:text-text-primary active:scale-95 disabled:opacity-50"
          >
            {t('connection.back')}
          </button>
        )}
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="rounded-2xl bg-bg-secondary/50 px-6 py-4 text-sm font-medium text-text-primary transition-all hover:bg-bg-tertiary active:scale-95 disabled:opacity-50"
        >
          {testing ? t('connection.testing') : t('connection.byok.test')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={testing}
          className="flex-1 rounded-2xl bg-accent px-6 py-4 text-sm font-medium text-bg-primary shadow-md shadow-accent/10 transition-all hover:bg-accent/90 active:scale-95 disabled:opacity-50"
        >
          {t('connection.byok.save')}
        </button>
      </div>
    </div>
  )
}
