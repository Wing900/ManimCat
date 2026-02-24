// 加载动画组件 - 大猫头 + 波浪猫爪

import { useEffect, useState } from 'react';

// ============================================================================
// 类型 & 配置
// ============================================================================

type Stage = 'analyzing' | 'generating' | 'refining' | 'rendering' | 'still-rendering';

interface LoadingSpinnerProps {
  stage: Stage;
  jobId?: string;
  onCancel?: () => void;
}

const STAGE_CONFIG = {
  analyzing:         { text: '正在分析概念...', start: 0, target: 20 },
  generating:        { text: '正在生成代码...', start: 20, target: 66 },
  refining:          { text: '正在优化结果...', start: 66, target: 85 },
  rendering:         { text: '正在渲染内容...', start: 85, target: 97 },
  'still-rendering': { text: '仍在渲染中...', start: 85, target: 97 },
} as const;

// ============================================================================
// 进度算法 - 阶段目标值 + 持续增长安慰机制
// ============================================================================

function usePerceivedProgress(stage: Stage): number {
  const [progress, setProgress] = useState(0);
  const [prevStage, setPrevStage] = useState(stage);
  const [stageStartProgress, setStageStartProgress] = useState(0);
  const [enteredAt, setEnteredAt] = useState(Date.now());

  // 阶段变化时记录起点，确保进度单调递增不回退
  useEffect(() => {
    if (stage !== prevStage) {
      setPrevStage(stage);
      setEnteredAt(Date.now());
      setStageStartProgress((current) => Math.max(current, progress, STAGE_CONFIG[stage].start));
    }
  }, [stage, prevStage, progress]);

  // 按阶段目标值推进：前快后慢 + 长耗时每4秒+1%
  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = (Date.now() - enteredAt) / 1000;
      const { target } = STAGE_CONFIG[stage];
      const start = Math.max(stageStartProgress, STAGE_CONFIG[stage].start);
      const range = Math.max(0, target - start);

      // 前段快速接近目标（不一次冲到顶）
      const quickGain = range * 0.72 * (1 - Math.exp(-elapsed / 5));

      // 长耗时阶段：超过10秒后每4秒+1%，避免“卡死感”
      const comfortGain = elapsed > 10 ? Math.floor((elapsed - 10) / 4) : 0;

      const next = Math.min(target, start + quickGain + comfortGain);
      setProgress((current) => Math.max(current, next));
    }, 120);

    return () => clearInterval(id);
  }, [stage, enteredAt, stageStartProgress]);

  // processing 阶段最高展示 97%，完成后由结果态切换
  return Math.min(97, progress);
}

// ============================================================================
// 子组件
// ============================================================================

/** 大猫头 SVG */
function CatHead() {
  return (
    <svg width={100} height={100} viewBox="0 0 140 140" className="drop-shadow-lg">
      <g transform="translate(70, 70)">
        <path
          d="M -70 40 C -80 0, -80 -30, -50 -60 L -20 -30 L 20 -30 L 50 -60 C 80 -30, 80 0, 70 40 C 60 70, -60 70, -70 40 Z"
          fill="#455a64"
        />
        <circle cx="-35" cy="-5" r="18" fill="#fff" />
        <circle cx="35" cy="-5" r="18" fill="#fff" />
        <circle cx="-38" cy="-5" r="6" fill="#455a64" />
        <circle cx="32" cy="-5" r="6" fill="#455a64" />
      </g>
    </svg>
  );
}

/** 浮动猫头 */
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

  return (
    <div style={{ transform: `translateY(${y}px)` }}>
      <CatHead />
    </div>
  );
}

/** 单个猫爪印 - 带波浪动画 */
function WavingPaw({ index, total }: { index: number; total: number }) {
  const [scale, setScale] = useState(1);
  const [y, setY] = useState(0);
  const [opacity, setOpacity] = useState(0.25);

  useEffect(() => {
    let t = 0;
    const phase = (index / total) * Math.PI * 2; // 错开相位
    let id: number;

    const animate = () => {
      t += 0.04;

      // 波浪上下起伏
      const wave = Math.sin(t + phase) * 4;
      setY(wave);

      // 大小脉动 (1.0 ~ 1.3)
      const pulse = 1 + Math.sin(t + phase) * 0.15;
      setScale(pulse);

      // 透明度变化 (0.3 ~ 0.8)
      const alpha = 0.55 + Math.sin(t + phase) * 0.25;
      setOpacity(alpha);

      id = requestAnimationFrame(animate);
    };

    id = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(id);
  }, [index, total]);

  return (
    <div
      style={{
        transform: `translateY(${y}px) scale(${scale})`,
        opacity,
        transition: 'opacity 0.1s',
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24">
        <ellipse cx="12" cy="15" rx="5" ry="4" className="fill-text-secondary" />
        <circle cx="7" cy="9" r="2.2" className="fill-text-secondary" />
        <circle cx="12" cy="7" r="2.2" className="fill-text-secondary" />
        <circle cx="17" cy="9" r="2.2" className="fill-text-secondary" />
      </svg>
    </div>
  );
}

/** 波浪猫爪行 */
function WavingPaws() {
  const count = 7;

  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: count }, (_, i) => (
        <WavingPaw key={i} index={i} total={count} />
      ))}
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export function LoadingSpinner({ stage, jobId, onCancel }: LoadingSpinnerProps) {
  const progress = usePerceivedProgress(stage);
  const { text } = STAGE_CONFIG[stage];

  return (
    <div className="flex flex-col items-center justify-center py-6">
      {/* 大猫头 */}
      <FloatingCat />

      {/* 波浪猫爪 */}
      <div className="mt-3">
        <WavingPaws />
      </div>

      {/* 状态文字 + 百分比 */}
      <div className="mt-4 text-center">
        <p className="text-base text-text-primary/80">{text}</p>
        <p className="text-sm text-text-secondary/60 tabular-nums mt-1">
          {Math.round(progress)}%
        </p>
      </div>

      {/* Job ID + 取消 */}
      <div className="flex items-center gap-3 mt-3">
        {jobId && (
          <span className="text-xs text-text-secondary/40 font-mono">
            {jobId.slice(0, 8)}
          </span>
        )}
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-xs text-text-secondary/40 hover:text-red-500 transition-colors"
          >
            取消
          </button>
        )}
      </div>
    </div>
  );
}
