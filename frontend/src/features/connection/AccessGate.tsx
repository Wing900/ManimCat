import { useState, type ReactNode } from 'react'
import { useI18n } from '../../shared/i18n/index'
import { hasConnection, type ConnectionMode, type ConnectionSettings } from './connection-types'
import { saveConnection, useConnection } from './connection-storage'
import { ConnectionChoice } from './ConnectionChoice'
import { CatKeyForm } from './CatKeyForm'
import { ByokForm } from './ByokForm'

type GateStep = 'choice' | ConnectionMode

interface AccessGateProps {
  children: ReactNode
}

export function AccessGate({ children }: AccessGateProps) {
  const { t } = useI18n()
  const connection = useConnection()
  const [step, setStep] = useState<GateStep>('choice')

  if (hasConnection(connection)) {
    return <>{children}</>
  }

  const handleSaved = (next: ConnectionSettings) => {
    saveConnection(next)
    setStep('choice')
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-bg-primary/80 backdrop-blur-md" />
      <div className="relative w-full max-w-2xl rounded-[2.5rem] border border-border/5 bg-bg-secondary p-10 shadow-2xl">
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
      </div>
    </div>
  )
}
