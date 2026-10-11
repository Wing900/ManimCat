import { useState } from 'react'
import { useI18n } from '../../shared/i18n/index'
import type { ConnectionMode, ConnectionSettings } from '../connection/connection-types'
import { clearConnection } from '../connection/connection-storage'
import { CatKeyForm } from '../connection/CatKeyForm'
import { ByokForm } from '../connection/ByokForm'
import { ClearAiSettingsDialog } from './ClearAiSettingsDialog'
import { TrashMark } from './settings-icons'

interface AiConnectionSettingsProps {
  connection: ConnectionSettings
  onSaved: (next: ConnectionSettings) => void
  /** 清空之后离开设置页：主界面回来了，引导页才浮上来。 */
  onCleared: () => void
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
export function AiConnectionSettings({ connection, onSaved, onCleared }: AiConnectionSettingsProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<ConnectionMode>(connection.activeMode ?? 'catkey')
  const [direction, setDirection] = useState<'left' | 'right'>('right')
  const [confirmingClear, setConfirmingClear] = useState(false)

  // 药丸往哪边滑，下面的表单就从哪边进来，两步读成一个动作。
  const selectMode = (next: ConnectionMode) => {
    if (next === mode) return
    setDirection(next === 'byok' ? 'right' : 'left')
    setMode(next)
  }

  /**
   * 清空之后不停在这一页，而是回主界面——那一屏才浮出来问你选哪种方式。顺序不能反：只有设置页走完了，
   * App 才会把引导页放出来（见 App 的 `showGuide`）。
   */
  const handleClearAll = () => {
    setConfirmingClear(false)
    clearConnection()
    onCleared()
  }

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
          <CatKeyForm
            connection={connection}
            submitLabel={t('connection.catkey.verifyAndSave')}
            onSaved={onSaved}
          />
        )}

        {mode === 'byok' && <ByokForm connection={connection} onSaved={onSaved} />}
      </div>

      {/* 破坏性动作放在离表单最远的右下角，用文字的重量而不是填充块——它是这页唯一的减法。 */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setConfirmingClear(true)}
          className="flex items-center gap-2 rounded-2xl px-3 py-2 text-sm text-text-secondary/70 transition-colors duration-200 ease-ui hover:bg-red-500/5 hover:text-red-600"
        >
          <TrashMark className="h-4 w-4" />
          {t('settings.ai.clearAll')}
        </button>
      </div>

      <ClearAiSettingsDialog
        isOpen={confirmingClear}
        onCancel={() => setConfirmingClear(false)}
        onConfirm={handleClearAll}
      />
    </div>
  )
}
