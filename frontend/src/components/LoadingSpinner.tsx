// 加载动画组件 - 大猫头 + 波浪猫爪

import { useEffect, useState, useRef } from 'react';
import { useI18n } from '../i18n';

type Stage = 'analyzing' | 'generating' | 'refining' | 'rendering' | 'still-rendering';

interface LoadingSpinnerProps {
  stage: Stage;
  jobId?: string;
  onCancel?: () => void;
  onOpenGame?: () => void;
}

const STAGE_CONFIG = {
  analyzing:         { key: 'loading.analyzing', start: 0, target: 20 },
  generating:        { key: 'loading.generating', start: 20, target: 66 },
  refining:          { key: 'loading.refining', start: 66, target: 85 },
  rendering:         { key: 'loading.rendering', start: 85, target: 97 },
  'still-rendering': { key: 'loading.stillRendering', start: 85, target: 97 },
} as const;

function usePerceivedProgress(stage: Stage): number {
  const [progress, setProgress] = useState(0);
  const prevStageRef = useRef(stage);
  const stageStartProgressRef = useRef(0);
  const enteredAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (enteredAtRef.current === null) {
      enteredAtRef.current = Date.now();
    }

    if (stage !== prevStageRef.current) {
      prevStageRef.current = stage;
      enteredAtRef.current = Date.now();
      stageStartProgressRef.current = Math.max(stageStartProgressRef.current, progress, STAGE_CONFIG[stage].start);
    }
  }, [stage, progress]);

  useEffect(() => {
    const id = setInterval(() => {
      const enteredAt = enteredAtRef.current ?? Date.now();
      const elapsed = (Date.now() - enteredAt) / 1000;
      const { target } = STAGE_CONFIG[stage];
      const start = Math.max(stageStartProgressRef.current, STAGE_CONFIG[stage].start);
      const range = Math.max(0, target - start);
      const quickGain = range * 0.72 * (1 - Math.exp(-elapsed / 5));
      const comfortGain = elapsed > 10 ? Math.floor((elapsed - 10) / 4) : 0;
      const next = Math.min(target, start + quickGain + comfortGain);
      setProgress((current) => Math.max(current, next));
    }, 120);
    return () => clearInterval(id);
  }, [stage]);

  return Math.min(97, progress);
}

/** 大猫头 SVG - 眼睛灵敏转动 */
function CatHead() {
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // 灵敏算法：减小阻尼，增大范围
      const limit = 6; 
      const sensitivity = 20; // 越小越灵敏
      const moveX = (dx / (dist + sensitivity)) * limit;
      const moveY = (dy / (dist + sensitivity)) * limit;
      
      setEyeOffset({ x: moveX, y: moveY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <svg 
      ref={containerRef}
      width={100} height={100} viewBox="0 0 140 140" 
      className="drop-shadow-lg"
    >
      <g transform="translate(70, 70)">
        <path
          d="M -70 40 C -80 0, -80 -30, -50 -60 L -20 -30 L 20 -30 L 50 -60 C 80 -30, 80 0, 70 40 C 60 70, -60 70, -70 40 Z"
          fill="#455a64"
        />
        <circle cx="-35" cy="-5" r="18" fill="#fff" />
        <circle cx="35" cy="-5" r="18" fill="#fff" />
        <circle 
          cx="-38" cy="-5" r="6" fill="#455a64" 
          style={{ transform: `translate(${eyeOffset.x}px, ${eyeOffset.y}px)`, transition: 'transform 0.08s ease-out' }}
        />
        <circle 
          cx="32" cy="-5" r="6" fill="#455a64" 
          style={{ transform: `translate(${eyeOffset.x}px, ${eyeOffset.y}px)`, transition: 'transform 0.08s ease-out' }}
        />
      </g>
    </svg>
  );
}

function FloatingCat() {
  const [y, setY] = useState(0);
  useEffect(() => {
    let t = 0;
    let id: number;
    const animate = () => {
      t += 0.02;
      setY(Math.sin(t) * 5);
      id = requestAnimationFrame(animate);
    };
    id = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(id);
  }, []);
  return <div style={{ transform: `translateY(${y}px)` }}><CatHead /></div>;
}

function WavingPaw({ index, total }: { index: number; total: number }) {
  const [scale, setScale] = useState(1);
  const [y, setY] = useState(0);
  const [opacity, setOpacity] = useState(0.25);

  useEffect(() => {
    let t = 0;
    const phase = (index / total) * Math.PI * 2;
    let id: number;
    const animate = () => {
      t += 0.04;
      setY(Math.sin(t + phase) * 4);
      setScale(1 + Math.sin(t + phase) * 0.15);
      setOpacity(0.55 + Math.sin(t + phase) * 0.25);
      id = requestAnimationFrame(animate);
    };
    id = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(id);
  }, [index, total]);

  return (
    <div style={{ transform: `translateY(${y}px) scale(${scale})`, opacity }}>
      <svg width="24" height="24" viewBox="0 0 24 24">
        <ellipse cx="12" cy="15" rx="5" ry="4" className="fill-text-secondary" />
        <circle cx="7" cy="9" r="2.2" className="fill-text-secondary" />
        <circle cx="12" cy="7" r="2.2" className="fill-text-secondary" />
        <circle cx="17" cy="9" r="2.2" className="fill-text-secondary" />
      </svg>
    </div>
  );
}

export function LoadingSpinner({ stage, jobId, onCancel, onOpenGame }: LoadingSpinnerProps) {
  const { t } = useI18n();
  const progress = usePerceivedProgress(stage);
  const { key } = STAGE_CONFIG[stage];
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center py-6">
      <div className="relative">
        <FloatingCat />
        {onOpenGame && (
          <div className="absolute left-[100px] -top-[50px] flex flex-col-reverse items-start">
            <div className="w-[50px] h-[30px] border-l border-t border-text-secondary/35 rounded-tl-[4px] mt-1" />
            <p className="text-[13px] leading-snug tracking-[0.08em] font-light text-text-secondary/85 whitespace-nowrap">
              {t('game.invite.bubble')}{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); onOpenGame(); }} className="font-semibold text-text-primary underline underline-offset-4">
                2048
              </a>?
            </p>
          </div>
        )}
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-center gap-2">
          {Array.from({ length: 7 }, (_, i) => <WavingPaw key={i} index={i} total={7} />)}
        </div>
      </div>

      <div className="mt-4 text-center">
        <p className="text-base text-text-primary/80">{t(key)}</p>
        <p className="text-sm text-text-secondary/60 tabular-nums mt-1">{Math.round(progress)}%</p>
      </div>

      <div className="flex items-center gap-3 mt-3">
        {jobId && <span className="text-xs text-text-secondary/40 font-mono">{jobId.slice(0, 8)}</span>}
        {onCancel && (
          <button onClick={() => setConfirmCancelOpen(true)} className="text-xs text-text-secondary/40 hover:text-red-500">
            {t('common.cancel')}
          </button>
        )}
      </div>

      {confirmCancelOpen && onCancel ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setConfirmCancelOpen(false)} />
          <div className="relative w-full max-w-sm bg-bg-secondary rounded-2xl p-6 shadow-xl border border-bg-tertiary/30">
             <h2 className="text-base font-medium text-text-primary">中止任务？</h2>
             <p className="text-sm text-text-secondary mt-2">猫猫已经跑了一半了，确定要停下来吗？</p>
             <div className="flex items-center justify-end gap-3 mt-6">
               <button onClick={() => setConfirmCancelOpen(false)} className="px-4 py-2 text-sm text-text-secondary bg-bg-primary rounded-xl">取消</button>
               <button onClick={() => { setConfirmCancelOpen(false); onCancel(); }} className="px-4 py-2 text-sm text-white bg-red-500 rounded-xl">确定停止</button>
             </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
