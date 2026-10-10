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
        {step === 'choice' && <ConnectionChoice onSelect={setStep} />}
        {step === 'catkey' && (
          <CatKeyForm
            connection={connection}
            submitLabel={t('connection.catkey.verify')}
            onSaved={handleSaved}
            onBack={() => setStep('choice')}
          />
        )}
        {step === 'byok' && (
          <ByokForm connection={connection} onSaved={handleSaved} onBack={() => setStep('choice')} />
        )}
      </div>
    </div>
  )
}
