import { useState } from 'react'
import { useI18n } from '../../shared/i18n/index'
import { CustomSelect } from '../../shared/components/CustomSelect'
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
}

function defaultUrlFor(provider: 'openai-compatible' | 'google'): string {
  return provider === 'google' ? GOOGLE_OPENAI_COMPAT_URL : OPENAI_DEFAULT_URL
}

export function ByokForm({ connection, onSaved }: ByokFormProps) {
  const { t } = useI18n()
  const [provider, setProvider] = useState(connection.byok.provider)
  // Base URL is a required field, so it is never hidden and never empty: it starts at the chosen
  // provider's own endpoint and stays editable.
  const [apiUrl, setApiUrl] = useState(
    () => connection.byok.apiUrl || defaultUrlFor(connection.byok.provider),
  )
  const [apiKey, setApiKey] = useState(connection.byok.apiKey)
  const [model, setModel] = useState(connection.byok.model)
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

  /**
   * One action, and it is not a way around the check: the credentials are proven against
   * `/api/access/verify` first, and only a proven set is written. There is deliberately no plain
   * "save" — a half-working provider must not be able to walk through the door.
   */
  const handleSubmit = async () => {
    setError(null)
    if (!complete) {
      setError(t('connection.test.requiredUrlKeyModel'))
      return
    }
    const next = build()
    if (await verify(next)) onSaved(next)
  }

  const changeProvider = (next: 'openai-compatible' | 'google') => {
    setProvider(next)
    setError(null)
    // Follow the switch only while the address is still sitting on a stock endpoint; an address the
    // person typed themselves is never overwritten.
    setApiUrl((previous) =>
      !previous.trim() || previous === OPENAI_DEFAULT_URL || previous === GOOGLE_OPENAI_COMPAT_URL
        ? defaultUrlFor(next)
        : previous,
    )
  }

  const status = result.status === 'success'
    ? t('connection.test.success')
    : result.status === 'error'
      ? result.message
      : null

  return (
    <div className="space-y-6">
      <CustomSelect
        label={t('connection.byok.provider')}
        options={[
          { value: 'openai-compatible' as const, label: t('connection.byok.provider.openai') },
          { value: 'google' as const, label: t('connection.byok.provider.google') },
        ]}
        value={provider}
        onChange={changeProvider}
      />

      {/* 必填项不藏在“高级”里：地址就在 Provider 下面，一直看得见、一直可改。 */}
      <FloatingInput
        id="byok-base-url"
        type="text"
        label={t('connection.byok.baseUrl')}
        value={apiUrl}
        placeholder={defaultUrlFor(provider)}
        onChange={(value) => {
          setApiUrl(value)
          setError(null)
        }}
      />

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
        {testing ? t('connection.testing') : t('connection.byok.testAndSave')}
      </button>
    </div>
  )
}
