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
  analyzing:         { index: 0, text: '正在分析概念...' },
  generating:        { index: 1, text: '正在生成代码...' },
  refining:          { index: 2, text: '正在优化结果...' },
  rendering:         { index: 3, text: '正在渲染内容...' },
  'still-rendering': { index: 3, text: '仍在渲染中...' },
} as const;

const TOTAL_STAGES = 4;

// ============================================================================
// 进度算法 - 对数曲线 + 安慰机制
// ============================================================================

function usePerceivedProgress(stage: Stage): number {
  const [elapsed, setElapsed] = useState(0);
  const [prevStage, setPrevStage] = useState(stage);

  // 阶段变化时重置计时
  useEffect(() => {
    if (stage !== prevStage) {
      setElapsed(0);
      setPrevStage(stage);
    }
  }, [stage, prevStage]);

  // 持续计时
  useEffect(() => {
    const start = Date.now();
    const tick = () => setElapsed((Date.now() - start) / 1000);
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [stage]);

  // 计算进度
  const stageIndex = STAGE_CONFIG[stage].index;
  const stageBase = (stageIndex / TOTAL_STAGES) * 100;
  const stageSpace = 100 / TOTAL_STAGES; // 每阶段 25%

  // 对数曲线：快启动（前15秒主要靠这个）
  const k = 0.25;
  let stageProgress = stageSpace * 0.75 * (1 - 1 / (1 + k * elapsed));

  // 安慰机制：超过15秒后，每8秒+1%，让用户看到"还在动"
  if (elapsed > 15) {
    const comfortBonus = Math.floor((elapsed - 15) / 8); // 每8秒+1%
    stageProgress += Math.min(comfortBonus, stageSpace * 0.2); // 最多再加20%阶段空间
  }

  const progress = stageBase + stageProgress;

  // 永远不到100%
  return Math.min(98, progress);
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
