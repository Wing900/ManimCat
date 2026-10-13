import { useState } from 'react';
import type { ProblemFramingPlan } from '../../../shared/types/api';
import { useI18n } from '../../../shared/i18n';
import { ProblemPlanEditor } from './ProblemPlanEditor';

interface ProblemFramingOverlayProps {
  open: boolean;
  status: 'loading' | 'ready' | 'error';
  plan: ProblemFramingPlan | null;
  error: string | null;
  adjustment: string;
  generating: boolean;
  onAdjustmentChange: (value: string) => void;
  onRetry: () => void;
  onInitialRetry: () => void;
  onPlanChange: (plan: ProblemFramingPlan) => void;
  onGenerate: () => void;
  onClose: () => void;
}

/** 等待时卡片右上角的三只猫爪：猫在整理结构。方案就绪后隐去，不抢位。*/
function PawStamp({ delay = 0 }: { delay?: number }) {
  return (
    <div className="problem-paw text-text-secondary/55" style={{ animationDelay: `${delay}s` }}>
      <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor">
        <ellipse cx="12" cy="15" rx="5.2" ry="4.1" />
        <circle cx="7" cy="9.1" r="2.15" />
        <circle cx="12" cy="6.8" r="2.15" />
        <circle cx="17" cy="9.1" r="2.15" />
      </svg>
    </div>
  );
}

function WaitingPaws() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute right-5 top-2.5 flex items-center gap-2 opacity-80">
      <PawStamp />
      <PawStamp delay={0.18} />
      <PawStamp delay={0.36} />
    </div>
  );
}

export function ProblemFramingOverlay(props: ProblemFramingOverlayProps) {
  return props.open ? <ProblemFramingOverlayContent {...props} /> : null;
}

function ProblemFramingOverlayContent({ status, plan, error, adjustment, generating,
  onAdjustmentChange, onRetry, onInitialRetry, onPlanChange, onGenerate, onClose,
}: ProblemFramingOverlayProps) {
  const { t } = useI18n();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const busy = status === 'loading' || generating;
  const statusKey = status === 'loading'
    ? plan ? 'problem.status.refining' : 'problem.status.loading'
    : status === 'ready' ? 'problem.status.ready' : 'problem.status.error';
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-bg-primary/75 p-3 backdrop-blur-sm sm:p-8">
    <section role="dialog" aria-modal="true" aria-label={t('problem.badge')} className="relative flex h-[min(88dvh,900px)] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] border border-bg-tertiary/40 bg-bg-secondary shadow-xl">
      {status === 'loading' && <WaitingPaws />}
      <header className={`flex shrink-0 items-center justify-between gap-4 px-5 py-4 sm:px-8 ${status === 'loading' ? 'pr-[10rem] sm:pr-[10.5rem]' : ''}`}>
        <button type="button" onClick={() => setConfirmDiscard(true)} className="rounded-xl px-3 py-2 text-sm text-text-secondary hover:bg-bg-primary focus-visible:ring-2 focus-visible:ring-accent">← {t('problem.back')}</button>
        <p role="status" className="text-sm text-text-secondary">{t(statusKey)}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 sm:px-8" aria-busy={status === 'loading'}>
        {plan ? <ProblemPlanEditor plan={plan} onChange={onPlanChange} disabled={busy} /> : status === 'loading' ? <div className="mx-auto max-w-3xl space-y-5" aria-hidden="true">
          {/* 骨架也用 rail 说话：圆点、竖线、长短不一的灰条，避免等待态回到卡片墙 */}
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="relative pl-9">
            <span className="absolute left-0 top-[6px] h-[9px] w-[9px] rounded-full bg-text-tertiary/25" />
            {i < 3 && <span className="absolute left-1 top-[26px] bottom-[-20px] w-px bg-text-tertiary/15" />}
            <div className="h-4 w-36 animate-pulse rounded bg-text-tertiary/20" style={{ animationDelay: `${i * 120}ms` }} />
            <div className="mt-2.5 h-3 w-full max-w-lg animate-pulse rounded bg-text-tertiary/15" style={{ animationDelay: `${i * 120 + 60}ms` }} />
            <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-text-tertiary/15" style={{ animationDelay: `${i * 120 + 120}ms` }} />
          </div>)}
        </div> : <div className="py-16 text-center">
          <h2 className="text-lg text-text-primary">{t('problem.initialErrorTitle')}</h2>
          <p role="alert" className="mt-3 text-sm text-red-700">{error || t('problem.initialErrorDescription')}</p>
          <button type="button" onClick={onInitialRetry} className="mt-6 rounded-xl bg-accent px-5 py-3 text-white">{t('problem.retry')}</button>
        </div>}
        {plan && status === 'error' && <p role="alert" className="py-3 text-sm text-red-700">{error || t('generation.problemFramingFailed')}</p>}
      </div>
      {plan && <footer className="shrink-0 border-t border-bg-tertiary/30 px-5 py-4 sm:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <textarea aria-label={t('problem.adjustLabel')} value={adjustment} onChange={e => onAdjustmentChange(e.target.value)} rows={2} disabled={busy} placeholder={t('problem.adjustPlaceholder')} className="min-w-0 flex-1 resize-none rounded-2xl bg-bg-primary/60 px-4 py-3 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent/30" />
          <div className="flex shrink-0 justify-end gap-3">
            <button type="button" onClick={onRetry} disabled={busy || !adjustment.trim()} className="rounded-xl bg-bg-primary px-4 py-3 text-sm text-text-secondary disabled:opacity-45">{t('problem.adjustAction')}</button>
            <button type="button" onClick={onGenerate} disabled={busy} className="rounded-full bg-accent px-5 py-3 text-sm text-white disabled:opacity-45">{generating ? t('form.submitting') : t('problem.start')}</button>
          </div>
        </div>
      </footer>}
      {confirmDiscard && <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-secondary/95 p-6">
        <div role="alertdialog" aria-modal="true" aria-labelledby="discard-plan-title" className="w-full max-w-sm rounded-2xl border border-bg-tertiary/40 bg-bg-primary p-6">
          <h2 id="discard-plan-title" className="text-text-primary">{t('problem.discardTitle')}</h2>
          <p className="mt-3 text-sm text-text-secondary">{t('problem.discardDescription')}</p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" autoFocus onClick={() => setConfirmDiscard(false)} className="rounded-xl px-4 py-2 text-text-secondary">{t('common.cancel')}</button>
            <button type="button" onClick={onClose} className="rounded-xl bg-accent px-4 py-2 text-white">{t('common.confirm')}</button>
          </div>
        </div>
      </div>}
    </section>
  </div>;
}
