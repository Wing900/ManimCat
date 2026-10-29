import { useI18n } from '../../shared/i18n/index'
import { CustomSelect } from '../../shared/components/CustomSelect'
import { REASONING_EFFORTS, type ConnectionSettings } from '../connection/connection-types'

export function ReasoningSettings({ connection, onSaved }: {
  connection: ConnectionSettings
  onSaved: (next: ConnectionSettings) => void
}) {
  const { t } = useI18n()
  return (
    <div className="space-y-3 border-t border-border/10 pt-7">
      <CustomSelect
        label={t('settings.ai.reasoning.label')}
        labelLayout="stacked"
        options={REASONING_EFFORTS.map((value) => ({ value, label: value === 'provider-default' ? 'default' : value }))}
        value={connection.reasoningEffort ?? 'high'}
        onChange={(reasoningEffort) => onSaved({ ...connection, reasoningEffort })}
      />
    </div>
  )
}
