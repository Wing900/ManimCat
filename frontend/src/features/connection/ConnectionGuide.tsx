import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../shared/i18n/index'
import type { ConnectionMode, ConnectionSettings } from './connection-types'
import { saveConnection, useConnection } from './connection-storage'
import { ConnectionChoice } from './ConnectionChoice'
import { CatKeyForm } from './CatKeyForm'
import { ByokForm } from './ByokForm'

type GuideStep = 'choice' | ConnectionMode

/** 主界面先自己待一会儿，这一屏再浮上来。 */
const GUIDE_APPEAR_DELAY_MS = 2_000
const GUIDE_EXIT_MS = 320

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface ConnectionGuideProps {
  /** 叉掉、按 Esc、点背景，或者选「先不选」：这一屏沉下去，主界面照常可用，只是还生成不了。 */
  onDismiss: () => void
  /** 验证成功后由 App 负责保存；连接要等退场动画结束才落盘，避免弹窗被立刻卸载。 */
  onSaved?: (connection: ConnectionSettings) => void
}

/**
 * The guide that floats over the app when there is no connection yet.
 *
 * It is an overlay, not a gate: the screen underneath never goes away, so "not now" is a real way
 * out. (As a gate it replaced the app entirely — with no connection you could not reach anything,
 * not even the settings page that configures one.)
 *
 * It also arrives late, on purpose: the home screen gets two seconds to itself first, then this
 * screen washes in over it. App decides *whether* to mount this at all — only App can see that a
 * closing settings page has finished sliding away.
 */
export function ConnectionGuide({ onDismiss, onSaved }: ConnectionGuideProps) {
  const { t } = useI18n()
  const connection = useConnection()
  const [step, setStep] = useState<GuideStep>('choice')
  const [shown, setShown] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), GUIDE_APPEAR_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  const closeWithAnimation = (after: () => void) => {
    if (readPrefersReducedMotion()) {
      after()
      return
    }
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      after()
    }, GUIDE_EXIT_MS)
  }

  const requestClose = () => {
    if (closing) return
    closeWithAnimation(onDismiss)
  }

  // It is a real dialog, so Esc has to close it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closing])

  if (!shown) return null

  const handleSaved = (next: ConnectionSettings) => {
    if (onSaved) {
      closeWithAnimation(() => onSaved(next))
      return
    }
    saveConnection(next)
    setStep('choice')
    closeWithAnimation(onDismiss)
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* 剩下的一切沉到玻璃底下——玻璃要薄，底下的主界面还看得见。 */}
      <div
        className={`${closing ? 'animate-overlay-wash-out' : 'animate-overlay-wash-in'} absolute inset-0 bg-bg-primary/40 backdrop-blur-sm`}
        onClick={requestClose}
      />

      <div className={`${closing ? 'animate-modal-pop-out' : 'animate-modal-pop-in'} relative w-full max-w-2xl rounded-[2.5rem] border border-border/5 bg-bg-secondary p-10 shadow-2xl`}>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t('common.close')}
          title={t('common.close')}
          className="absolute right-6 top-6 rounded-2xl p-2.5 text-text-secondary/50 transition-colors duration-200 ease-ui hover:bg-bg-primary/50 hover:text-text-primary active:scale-90"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* 表单里只剩一个动作按钮，所以退路提到卡片自己头上——否则进了 BYOK 就出不去。 */}
        {step !== 'choice' && (
          <div className="-ml-2 mb-6 flex items-center">
            <button
              type="button"
              onClick={() => setStep('choice')}
              aria-label={t('connection.back')}
              title={t('connection.back')}
              className="rounded-2xl p-2.5 text-text-secondary/60 transition-colors duration-200 ease-ui hover:bg-bg-primary/60 hover:text-text-primary active:scale-90"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        )}

        {/* 选择 → 表单也是一次换内容，方向和设置页一致：新的一屏从右边进来。 */}
        <div key={step} className="panel-in-right">
          {step === 'choice' && <ConnectionChoice onSelect={setStep} />}
          {step === 'catkey' && (
            <CatKeyForm
              connection={connection}
              submitLabel={t('connection.catkey.verify')}
              onSaved={handleSaved}
            />
          )}
          {step === 'byok' && <ByokForm connection={connection} onSaved={handleSaved} />}
        </div>

        {step === 'choice' && (
          <div className="mt-7 flex justify-center">
            <button
              type="button"
              onClick={requestClose}
              className="rounded-2xl px-4 py-2 text-sm text-text-secondary/70 transition-transform duration-200 ease-ui active:scale-95"
            >
              {t('connection.guide.dismiss')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
