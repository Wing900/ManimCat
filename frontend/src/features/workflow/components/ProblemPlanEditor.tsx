import type { ProblemFramingPlan, ProblemFramingStep } from '../../../shared/types/api';
import { useI18n } from '../../../shared/i18n';

const DESIGN_FIELDS = ['audience', 'backgroundRules', 'selectedRoute', 'alternativeRoutes', 'outOfScope', 'specialCases', 'visualMotif', 'designerHint'] as const;

/** A linear, editable argument. Group headings never reorder the author's steps. */
export function ProblemPlanEditor({ plan, onChange, disabled = false }: {
  plan: ProblemFramingPlan;
  onChange: (plan: ProblemFramingPlan) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const editStep = (index: number, patch: Partial<ProblemFramingStep>) => {
    onChange({ ...plan, steps: plan.steps.map((step, i) => i === index ? { ...step, ...patch } : step) });
  };
  const fieldClass = 'w-full resize-y rounded-xl border border-bg-tertiary/40 bg-bg-primary/60 px-3 py-2 text-sm leading-6 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60';
  return <div className="mx-auto max-w-3xl space-y-6 pb-4">
    <header className="space-y-3">
      <h2 className="text-xl text-text-primary">{plan.headline}</h2>
      <p className="text-sm leading-6 text-text-secondary">{plan.summary}</p>
      {(['question', 'answer'] as const).map(field => plan[field] !== undefined && <label key={field} className="block space-y-1">
        <span className="text-sm text-text-secondary">{t(`problem.field.${field}`)}</span>
        <textarea className={fieldClass} rows={2} value={plan[field]} disabled={disabled} onChange={e => onChange({ ...plan, [field]: e.target.value })} />
      </label>)}
    </header>
    <ol className="space-y-3">
      {plan.steps.map((step, index) => <li key={index}>
        {(index === 0 || step.phase !== plan.steps[index - 1].phase) && <h3 className="mb-3 mt-6 text-sm font-medium text-text-secondary">{t(`problem.phase.${step.phase || 'steps'}`)}</h3>}
        <article className="flex gap-3 rounded-2xl border border-bg-tertiary/40 bg-bg-primary/50 p-4">
          <span className="pt-2 text-sm tabular-nums text-text-secondary" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <div className="min-w-0 flex-1 space-y-2">
            <input aria-label={`${t('problem.step')} ${index + 1} ${t('problem.stepTitle')}`} className={fieldClass} value={step.title} disabled={disabled} onChange={e => editStep(index, { title: e.target.value })} />
            <textarea aria-label={`${t('problem.step')} ${index + 1} ${t('problem.stepContent')}`} className={fieldClass} rows={3} value={step.content} disabled={disabled} onChange={e => editStep(index, { content: e.target.value })} />
          </div>
        </article>
      </li>)}
    </ol>
    <details className="rounded-2xl border border-bg-tertiary/40 p-4">
      <summary className="cursor-pointer text-sm text-text-primary">{t('problem.designBasis')}</summary>
      <div className="mt-4 space-y-4">{DESIGN_FIELDS.map(field => plan[field] !== undefined && <label key={field} className="block space-y-1">
        <span className="text-sm text-text-secondary">{t(`problem.field.${field}`)}</span>
        <textarea className={fieldClass} rows={3} value={plan[field]} disabled={disabled} onChange={e => onChange({ ...plan, [field]: e.target.value })} />
      </label>)}</div>
    </details>
  </div>;
}
