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

/**
 * Which credential the app talks to the backend with.
 *
 * The mode switch is a segmented control (a light track, a lighter active pill) rather than two
 * solid blocks: on a settings page the only filled thing is the action you press. The solid ink
 * button lives in the form below, where it belongs.
 */
export function AiConnectionSettings({ connection, onSaved }: AiConnectionSettingsProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<ConnectionMode>(connection.activeMode ?? 'catkey')
  const [direction, setDirection] = useState<'left' | 'right'>('right')

  // 药丸往哪边滑，下面的表单就从哪边进来，两步读成一个动作。
  const selectMode = (next: ConnectionMode) => {
    if (next === mode) return
    setDirection(next === 'byok' ? 'right' : 'left')
    setMode(next)
  }

  const disconnect = () => onSaved({ ...connection, activeMode: null })

  return (
    <div className="space-y-8">
      <div className="relative flex rounded-2xl bg-bg-secondary/50 p-1">
        {/* 药丸自己滑过去，而不是两个背景互相关。位移是这里唯一的运动，所以它读得出来。 */}
        <span
          aria-hidden="true"
          className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl bg-bg-primary shadow-sm transition-transform duration-300 ease-move ${
            mode === 'byok' ? 'translate-x-full' : 'translate-x-0'
          }`}
        />
        {(['catkey', 'byok'] as const).map((item) => {
          const active = mode === item
          return (
            <button
              key={item}
              type="button"
              onClick={() => selectMode(item)}
              aria-pressed={active}
              className={`relative flex-1 rounded-xl px-4 py-2.5 text-sm transition-colors duration-200 ease-ui ${
                active ? 'font-medium text-text-primary' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t(MODE_LABEL_KEYS[item])}
            </button>
          )
        })}
      </div>

      {/* 换模式 = 换表单，所以这里重挂；顺带把上一张表单的校验报错也清掉，方向交给上面的 direction。 */}
      <div key={mode} className={direction === 'right' ? 'panel-in-right' : 'panel-in-left'}>
        {mode === 'catkey' && (
          <div className="space-y-8">
            {connection.activeMode === 'catkey' && (
              <div className="flex items-center justify-between rounded-2xl bg-bg-secondary/50 px-4 py-3">
                <span className="text-sm text-text-primary">{t('connection.catkey.status.connected')}</span>
                <button
                  type="button"
                  onClick={disconnect}
                  className="text-sm font-medium text-red-600 transition-colors duration-200 ease-ui hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
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
          </div>
        )}

        {mode === 'byok' && <ByokForm connection={connection} onSaved={onSaved} />}
      </div>
    </div>
  )
}
