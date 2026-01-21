// 加载动画组件 - Logo 小猫头飘荡

import { useEffect, useState } from 'react';

interface LoadingSpinnerProps {
  stage: 'analyzing' | 'generating' | 'refining' | 'rendering' | 'still-rendering';
  jobId?: string;
  onCancel?: () => void;
}

/** 处理阶段文案 */
const STAGE_TEXT: Record<LoadingSpinnerProps['stage'], { text: string; sub: string }> = {
  analyzing: { text: '分析概念中', sub: '检测 LaTeX 和匹配模板' },
  generating: { text: '生成代码中', sub: '创建动画脚本' },
  refining: { text: 'AI 完善中', sub: '正在优化生成结果...' },
  rendering: { text: '渲染动画中', sub: '这可能需要一些时间' },
  'still-rendering': { text: '仍在渲染中', sub: '复杂动画需要更长时间' },
};

/** Logo 同款小猫头 - 100% 复制原版 */
function CatHead() {
  return (
    <svg width="80" height="80" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-lg">
      <g transform="translate(70, 70)">
        {/* 猫头主体 - 完全复制 Logo 原路径 */}
        <path
          d="M -70 40 C -80 0, -80 -30, -50 -60 L -20 -30 L 20 -30 L 50 -60 C 80 -30, 80 0, 70 40 C 60 70, -60 70, -70 40 Z"
          fill="#455a64"
        />
        {/* 左眼白 */}
        <circle cx="-35" cy="-5" r="18" fill="#ffffff" />
        {/* 右眼白 */}
        <circle cx="35" cy="-5" r="18" fill="#ffffff" />
        {/* 左眼珠 */}
        <circle cx="-38" cy="-5" r="6" fill="#455a64" />
        {/* 右眼珠 */}
        <circle cx="32" cy="-5" r="6" fill="#455a64" />
      </g>
    </svg>
  );
}

/** 浮动小猫头 */
function FloatingCat() {
  const [yOffset, setYOffset] = useState(0);

  useEffect(() => {
    let time = 0;
    const animate = () => {
      time += 0.025;
      const y = Math.sin(time) * 5;
      setYOffset(y);
      requestAnimationFrame(animate);
    };
    const animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, []);

  return <div style={{ transform: `translateY(${yOffset}px)` }}><CatHead /></div>;
}

export function LoadingSpinner({ stage, jobId, onCancel }: LoadingSpinnerProps) {
  const { text, sub } = STAGE_TEXT[stage];

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="mb-5">
        <FloatingCat />
      </div>
      <p className="text-base font-medium text-text-primary mb-1">{text}</p>
      <p className="text-sm text-text-secondary/70 mb-3">{sub}</p>
      {jobId && (
        <p className="text-xs text-text-secondary/60 font-mono bg-bg-secondary/40 px-3 py-1 rounded-full">
          {jobId.slice(0, 8)}
        </p>
      )}
      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-5 px-5 py-1.5 text-sm text-text-secondary/70 hover:text-red-500 transition-colors bg-bg-secondary/30 hover:bg-bg-secondary/50 rounded-full"
        >
          取消生成
        </button>
      )}
    </div>
  );
}
