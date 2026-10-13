import { useLayoutEffect, useRef } from 'react';
import type { ProblemFramingPlan, ProblemFramingStep } from '../../../shared/types/api';
import { useI18n } from '../../../shared/i18n';

const DESIGN_FIELDS = ['audience', 'backgroundRules', 'selectedRoute', 'alternativeRoutes', 'outOfScope', 'specialCases', 'visualMotif', 'designerHint'] as const;

// 稿纸语言：字段不带自己的框，静息时只是一行字；悬停与聚焦由底色承接。
// 独立块自带底色反馈，行内字段把反馈让给整行。
const blockField = 'w-full overflow-hidden rounded-lg bg-transparent px-2 py-1.5 text-sm leading-6 text-text-primary transition-colors duration-200 hover:bg-bg-tertiary/15 focus:bg-bg-tertiary/20 focus:outline-none disabled:opacity-60';
const rowField = 'w-full overflow-hidden bg-transparent text-text-primary focus:outline-none disabled:opacity-60';

/** 稿纸里没有固定行高的框：文本有几行，这一行就多高。 */
function GrowingTextarea({ label, value, disabled, className, onChange }: {
  label: string;
  value: string;
  disabled: boolean;
  className: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    // 手写字体加载完成后行高会变，重算一次。
    void document.fonts?.ready.then(fit);
  }, [value, disabled]);
  return <textarea ref={ref} aria-label={label} rows={1} value={value} disabled={disabled} className={className} onChange={e => onChange(e.target.value)} />;
}

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
  return <div className="mx-auto max-w-3xl space-y-6 pb-4">
    <header className="space-y-3">
      <h2 className="text-xl text-text-primary">{plan.headline}</h2>
      <p className="text-sm leading-6 text-text-secondary">{plan.summary}</p>
      {(['question', 'answer'] as const).map(field => plan[field] !== undefined && <label key={field} className="block">
        <span className="text-xs tracking-[0.14em] text-text-tertiary">{t(`problem.field.${field}`)}</span>
        <GrowingTextarea label={t(`problem.field.${field}`)} className={blockField} value={plan[field]} disabled={disabled} onChange={value => onChange({ ...plan, [field]: value })} />
      </label>)}
    </header>
    {/* 时间轴：一条 rail 串起全部步骤，节点圆点落在 rail 上，步骤是一次论证，不是十二个盒子。
        颜色必须是裸字面量：类名一旦靠变量拼接，Tailwind 与运行时各拿一份，圆点会静默变透明。 */}
    <ol className="space-y-5">
      {plan.steps.map((step, index) => {
        const startsPhase = index === 0 || step.phase !== plan.steps[index - 1].phase;
        return <li key={index} className="group relative pl-9">
          {/* 线先渲染、圆点后渲染：节点压在 rail 上，而不是被 rail 划开 */}
          <span aria-hidden="true" className={`absolute left-1 w-px bg-text-tertiary/25 ${index === 0 ? 'top-[40px]' : 'top-0'} ${index === plan.steps.length - 1 ? 'hidden' : 'bottom-[-20px]'}`} />
          <span aria-hidden="true" className={`absolute left-0 h-[9px] w-[9px] rounded-full bg-text-tertiary/55 transition-colors duration-200 group-focus-within:bg-accent ${startsPhase ? 'top-[39.5px]' : 'top-[15.5px]'}`} />
          {startsPhase && <h3 className={`flex items-center gap-3 text-xs tracking-[0.18em] text-text-tertiary ${index === 0 ? 'mb-2' : 'mb-2 mt-8'}`}>
            {t(`problem.phase.${step.phase || 'steps'}`)}
            <span aria-hidden="true" className="h-px flex-1 bg-text-tertiary/15" />
          </h3>}
          <div className="rounded-lg px-2 py-1.5 transition-colors duration-200 group-focus-within:bg-bg-tertiary/20 group-hover:bg-bg-tertiary/10">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="w-6 shrink-0 text-xs tabular-nums text-text-tertiary">{String(index + 1).padStart(2, '0')}</span>
              <input aria-label={`${t('problem.step')} ${index + 1} ${t('problem.stepTitle')}`} className={`${rowField} text-base leading-7`} value={step.title} disabled={disabled} onChange={e => editStep(index, { title: e.target.value })} />
            </div>
            <GrowingTextarea label={`${t('problem.step')} ${index + 1} ${t('problem.stepContent')}`} className={`${rowField} pl-8 text-sm leading-6`} value={step.content} disabled={disabled} onChange={value => editStep(index, { content: value })} />
          </div>
        </li>;
      })}
    </ol>
    <details className="border-t border-text-tertiary/15 pt-4">
      <summary className="cursor-pointer text-sm text-text-secondary transition-colors hover:text-text-primary">{t('problem.designBasis')}</summary>
      <div className="mt-4 space-y-4">{DESIGN_FIELDS.map(field => plan[field] !== undefined && <label key={field} className="block">
        <span className="text-xs tracking-[0.14em] text-text-tertiary">{t(`problem.field.${field}`)}</span>
        <GrowingTextarea label={t(`problem.field.${field}`)} className={blockField} value={plan[field]} disabled={disabled} onChange={value => onChange({ ...plan, [field]: value })} />
      </label>)}</div>
    </details>
  </div>;
}
