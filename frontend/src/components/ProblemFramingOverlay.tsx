import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ProblemFramingPlan } from '../types/api';
import { useI18n } from '../i18n';

interface ProblemFramingOverlayProps {
  open: boolean;
  status: 'loading' | 'ready' | 'error';
  plan: ProblemFramingPlan | null;
  error: string | null;
  adjustment: string;
  generating: boolean;
  onAdjustmentChange: (value: string) => void;
  onRetry: () => void;
  onGenerate: () => void;
  onClose: () => void;
}

const CARD_LAYOUTS = [
  { x: 6, y: 14, rotate: -6 },
  { x: 21, y: 57, rotate: 4 },
  { x: 42, y: 22, rotate: -4 },
  { x: 62, y: 52, rotate: 5 },
  { x: 79, y: 18, rotate: -3 },
  { x: 74, y: 66, rotate: 3 },
];

const COLLAPSED_CARD = { width: 120, height: 86 };
const EXPANDED_CARD = { width: 272, height: 236 };
const ACTIVE_REPEL_DISTANCE = 14;
const ACTIVE_CARD_CENTER_PULL = 0.28;

type CardPosition = {
  x: number;
  y: number;
  rotate: number;
};

type DragState = {
  index: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

function PawStamp({ delay = 0 }: { delay?: number }) {
  return (
    <div
      className="problem-paw text-text-secondary/55"
      style={{ animationDelay: `${delay}s` }}
    >
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
    <div className="pointer-events-none absolute right-6 top-5 flex items-center gap-2 opacity-80">
      <PawStamp />
      <PawStamp delay={0.18} />
      <PawStamp delay={0.36} />
    </div>
  );
}

function CanvasTransition() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute left-[12%] top-[24%] h-28 w-28 rounded-full bg-bg-primary/35 blur-2xl animate-pulse" />
      <div className="absolute right-[16%] top-[18%] h-20 w-36 rounded-full bg-bg-primary/30 blur-2xl animate-pulse [animation-delay:180ms]" />
      <div className="absolute left-[36%] bottom-[18%] h-24 w-40 rounded-full bg-bg-primary/28 blur-2xl animate-pulse [animation-delay:320ms]" />
    </div>
  );
}

export function ProblemFramingOverlay({
  open,
  status,
  plan,
  error,
  adjustment,
  generating,
  onAdjustmentChange,
  onRetry,
  onGenerate,
  onClose,
}: ProblemFramingOverlayProps) {
  if (!open) {
    return null;
  }

  const planKey = plan
    ? `${status}-${plan.summary}-${plan.steps.map((step) => `${step.title}:${step.content}`).join('|')}`
    : `empty-${status}`;

  return (
    <ProblemFramingOverlayContent
      key={planKey}
      status={status}
      plan={plan}
      error={error}
      adjustment={adjustment}
      generating={generating}
      onAdjustmentChange={onAdjustmentChange}
      onRetry={onRetry}
      onGenerate={onGenerate}
      onClose={onClose}
    />
  );
}

interface ProblemFramingOverlayContentProps {
  status: 'loading' | 'ready' | 'error';
  plan: ProblemFramingPlan | null;
  error: string | null;
  adjustment: string;
  generating: boolean;
  onAdjustmentChange: (value: string) => void;
  onRetry: () => void;
  onGenerate: () => void;
  onClose: () => void;
}

function ProblemFramingOverlayContent({
  status,
  plan,
  error,
  adjustment,
  generating,
  onAdjustmentChange,
  onRetry,
  onGenerate,
  onClose,
}: ProblemFramingOverlayContentProps) {
  const { t } = useI18n();
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [draftSteps, setDraftSteps] = useState<Array<{ title: string; content: string }>>(() =>
    plan ? plan.steps.map((step) => ({ title: step.title, content: step.content })) : []
  );
  const [cardPositions, setCardPositions] = useState<CardPosition[]>(() =>
    plan
      ? plan.steps.map((_, index) => {
          const layout = CARD_LAYOUTS[index] || CARD_LAYOUTS[index % CARD_LAYOUTS.length];
          return { x: layout.x, y: layout.y, rotate: layout.rotate };
        })
      : []
  );
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const statusKey =
    status === 'loading'
      ? 'problem.status.loading'
      : status === 'ready'
        ? 'problem.status.ready'
        : 'problem.status.error';

  useEffect(() => {
    dragStateRef.current = null;
  }, []);

  const stepCount = plan?.steps.length || 4;

  const updateCardPosition = (index: number, clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const current = cardPositions[index];
    if (!canvas || !current) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const isActive = activeStepIndex === index;
    const cardSize = isActive ? EXPANDED_CARD : COLLAPSED_CARD;
    const maxX = Math.max(0, rect.width - cardSize.width);
    const maxY = Math.max(0, rect.height - cardSize.height);
    const nextX = Math.min(Math.max(0, clientX), maxX);
    const nextY = Math.min(Math.max(0, clientY), maxY);

    setCardPositions((previous) =>
      previous.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              x: rect.width > 0 ? (nextX / rect.width) * 100 : item.x,
              y: rect.height > 0 ? (nextY / rect.height) * 100 : item.y,
            }
          : item
      )
    );
  };

  const getRenderedPosition = (index: number, position: CardPosition): CardPosition => {
    if (activeStepIndex === index) {
      const centeredX = position.x + (50 - position.x) * ACTIVE_CARD_CENTER_PULL;
      const centeredY = position.y + (44 - position.y) * ACTIVE_CARD_CENTER_PULL;

      return {
        x: Math.max(2, Math.min(72, centeredX)),
        y: Math.max(3, Math.min(58, centeredY)),
        rotate: 0,
      };
    }

    if (activeStepIndex === null || activeStepIndex === index) {
      return position;
    }

    const active = cardPositions[activeStepIndex];
    if (!active) {
      return position;
    }

    const dx = position.x - active.x;
    const dy = position.y - active.y;
    const distance = Math.hypot(dx, dy) || 1;
    const push = ACTIVE_REPEL_DISTANCE / distance;

    return {
      x: Math.max(0, Math.min(88, position.x + dx * push)),
      y: Math.max(0, Math.min(78, position.y + dy * push)),
      rotate: position.rotate,
    };
  };

  const handleCardPointerDown = (index: number, event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('textarea')) {
      return;
    }

    const canvas = canvasRef.current;
    const current = cardPositions[index];
    if (!canvas || !current) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const pointerOriginX = (current.x / 100) * rect.width;
    const pointerOriginY = (current.y / 100) * rect.height;

    dragStateRef.current = {
      index,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: pointerOriginX,
      originY: pointerOriginY,
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleCardPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startClientX;
    const deltaY = event.clientY - dragState.startClientY;
    if (!dragState.moved && Math.abs(deltaX) + Math.abs(deltaY) > 3) {
      dragState.moved = true;
    }

    updateCardPosition(dragState.index, dragState.originX + deltaX, dragState.originY + deltaY);
  };

  const handleCardPointerUp = (index: number, event: ReactPointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (!dragState.moved) {
      setActiveStepIndex((current) => (current === index ? null : index));
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  };

  return (
    <div className="fixed inset-0 z-[80]">
      <div className="animate-overlay-wash-in absolute inset-0 bg-bg-primary/28 backdrop-blur-[6px]" />

      <div className="relative flex min-h-screen items-center justify-center p-4 sm:p-8">
        <div className="animate-fade-in-soft relative flex h-[min(82vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-bg-tertiary/30 bg-bg-secondary">
          <div className="absolute inset-0 opacity-35 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.05)_1px,transparent_0)] bg-[length:24px_24px]" />
          <WaitingPaws />

          <div className="relative flex flex-1 flex-col px-5 pb-5 pt-6 sm:px-8 sm:pb-6 sm:pt-7">
            <div className="flex items-start justify-between gap-4 pb-2">
              <button
                type="button"
                onClick={() => setConfirmDiscardOpen(true)}
                className="inline-flex items-center gap-2 px-1 py-1 text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                <span aria-hidden="true">←</span>
                {t('problem.back')}
              </button>
            </div>

            <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden">
              <section className="min-h-0 flex-1 overflow-hidden px-4 pb-2 pt-2 sm:px-6 sm:pb-3 sm:pt-3">
                <div className="mx-auto h-full max-w-5xl">
                  <div className="h-full">
                    {status === 'loading' && (
                      <div ref={canvasRef} className="relative h-full min-h-[470px] overflow-hidden">
                        <CanvasTransition />
                        <p className="absolute right-0 top-0 text-sm text-text-secondary">{t(statusKey)}</p>
                        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-35" viewBox="0 0 1100 620" preserveAspectRatio="none">
                          <path d="M 40 220 C 180 90, 280 90, 370 230 S 560 420, 670 250 S 860 90, 1060 250" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="6 8" className="text-text-secondary/35" />
                        </svg>
                        {Array.from({ length: stepCount }, (_, index) => {
                          const layout = CARD_LAYOUTS[index] || CARD_LAYOUTS[CARD_LAYOUTS.length - 1];
                          return (
                            <div
                              key={index}
                              className="absolute h-[86px] w-[120px] rounded-[1.2rem] border border-dashed border-text-secondary/35 bg-bg-primary/76 p-4"
                              style={{
                                left: `${layout.x}%`,
                                top: `${layout.y}%`,
                                transform: `rotate(${layout.rotate}deg)`,
                                animation: `fadeInUp 0.38s ease-out ${0.28 + index * 0.16}s both`
                              }}
                            >
                              <div className="h-4 w-14 animate-pulse rounded-full bg-bg-secondary/80" />
                              <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-bg-secondary/70" />
                              <div className="mt-2 h-3 w-4/5 animate-pulse rounded-full bg-bg-secondary/60" />
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {status !== 'loading' && plan && (
                      <div ref={canvasRef} className="relative h-full min-h-[470px] overflow-hidden">
                        <p className="absolute right-0 top-0 text-sm text-text-secondary">{t(statusKey)}</p>
                        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-35" viewBox="0 0 1100 620" preserveAspectRatio="none">
                          <path d="M 40 220 C 180 90, 280 90, 370 230 S 560 420, 670 250 S 860 90, 1060 250" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="6 8" className="text-text-secondary/35" />
                        </svg>

                        {draftSteps.map((step, index) => {
                          const isActive = index === activeStepIndex;
                          const position = cardPositions[index] || CARD_LAYOUTS[index] || CARD_LAYOUTS[CARD_LAYOUTS.length - 1];
                          const renderedPosition = getRenderedPosition(index, position);
                          const collapsedTitle = step.title.slice(0, 6);

                          return (
                            <article
                              key={`${step.title}-${index}`}
                              onPointerDown={(event) => handleCardPointerDown(index, event)}
                              onPointerMove={handleCardPointerMove}
                              onPointerUp={(event) => handleCardPointerUp(index, event)}
                              onPointerCancel={(event) => handleCardPointerUp(index, event)}
                              className={`absolute rounded-[1.2rem] border border-dashed bg-bg-primary/78 p-4 transition-all duration-500 ease-out ${
                                isActive
                                  ? 'z-20 h-[236px] w-[272px] border-accent/45'
                                  : 'z-10 h-[86px] w-[120px] border-text-secondary/35 cursor-grab select-none'
                              }`}
                              style={{
                                left: `${renderedPosition.x}%`,
                                top: `${renderedPosition.y}%`,
                                transform: isActive ? 'rotate(0deg)' : `rotate(${position.rotate}deg)`,
                                animation: `fadeInUp 0.32s ease-out ${index * 0.12}s both`
                              }}
                            >
                              <p className="pointer-events-none text-[11px] uppercase tracking-[0.24em] text-text-secondary/55">
                                {String(index + 1).padStart(2, '0')}
                              </p>
                              <h3 className="pointer-events-none mt-1 text-sm leading-5 text-text-primary">
                                {isActive ? step.title : collapsedTitle}
                              </h3>

                              {isActive ? (
                                <textarea
                                  value={step.content}
                                  onChange={(event) => {
                                    const nextSteps = draftSteps.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, content: event.target.value } : item
                                    );
                                    setDraftSteps(nextSteps);
                                  }}
                                  rows={7}
                                  spellCheck={false}
                                  className="mt-3 min-h-[140px] w-full resize-none bg-transparent text-sm leading-6 text-text-secondary outline-none overflow-hidden"
                                />
                              ) : null}
                            </article>
                          );
                        })}

                        {status === 'error' && (
                          <div className="absolute bottom-0 left-0 text-sm leading-6 text-red-700">
                            {error || t('generation.problemFramingFailed')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <aside className="px-5 pb-5 pt-1 sm:px-7 sm:pb-6">
                <div className="mx-auto grid max-w-[860px] gap-4 lg:grid-cols-[minmax(0,520px)_auto] lg:items-center lg:translate-x-8">
                  <div className="lg:translate-y-3">
                    <textarea
                      value={adjustment}
                      onChange={(event) => onAdjustmentChange(event.target.value)}
                      rows={2}
                      placeholder={t('problem.adjustPlaceholder')}
                      className="mt-3 min-h-[68px] w-full resize-none rounded-2xl bg-bg-secondary/50 px-4 py-3 text-sm leading-6 text-text-primary placeholder-text-secondary/40 outline-none transition-all focus:bg-bg-secondary/70 focus:ring-2 focus:ring-accent/20"
                    />
                  </div>

                  <div className="flex items-center justify-center gap-5 lg:justify-start lg:translate-x-3 lg:translate-y-3">
                    <button
                      type="button"
                      onClick={onRetry}
                      disabled={status === 'loading' || !adjustment.trim()}
                      className="px-6 py-3.5 text-sm font-medium text-text-secondary hover:text-text-primary bg-bg-secondary/50 hover:bg-bg-secondary/70 rounded-2xl transition-all disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-accent/20"
                    >
                      {t('problem.adjustAction')}
                    </button>
                    <button
                      type="button"
                      onClick={onGenerate}
                      disabled={!plan || status === 'loading' || generating}
                      className="group relative px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-full shadow-sm shadow-accent/10 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-md hover:shadow-accent/15 active:scale-[0.97] overflow-hidden"
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        {generating ? (
                          <>
                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            {t('form.submitting')}
                          </>
                        ) : (
                          <>
                            {t('problem.start')}
                            <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                          </>
                        )}
                      </span>
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          </div>

          {confirmDiscardOpen && (
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
              <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={() => setConfirmDiscardOpen(false)}
              />
              <div className="relative w-full max-w-sm rounded-2xl border border-bg-tertiary/30 bg-bg-secondary p-6 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-medium text-text-primary">{t('problem.discardTitle')}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-text-secondary">{t('problem.discardDescription')}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmDiscardOpen(false)}
                    className="rounded-full p-1.5 text-text-secondary/70 transition-all hover:bg-bg-primary/50 hover:text-text-secondary"
                    aria-label={t('common.close')}
                    title={t('common.close')}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setConfirmDiscardOpen(false)}
                    className="rounded-xl bg-bg-primary px-4 py-2 text-sm text-text-secondary transition-all hover:bg-bg-tertiary hover:text-text-primary"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDiscardOpen(false);
                      onClose();
                    }}
                    className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-bg-primary transition-all hover:bg-red-600"
                  >
                    {t('common.confirm')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
