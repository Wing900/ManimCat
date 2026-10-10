// 自动滚动示例组件

import { useState, useEffect } from 'react';

interface ExampleButtonsProps {
  onSelect: (example: string) => void;
  disabled: boolean;
}

/** 示例列表 */
const EXAMPLES = [
  '演示勾股定理，带动画三角形和正方形',
  '可视化二次函数及其属性并带动画',
  '在单位圆上展示正弦和余弦的关系，带动画角度',
  '创建 3D 曲面图，展示 z = x² + y²',
  '计算并可视化半径为 r 的球体体积',
  '展示如何用动画求立方体的表面积',
  '将导数可视化切线斜率',
  '用动画展示曲线下面积的工作原理',
  '用动画变换演示矩阵运算',
  '可视化 2x2 矩阵的特征值和特征向量',
  '展示复数乘法使用旋转和缩放',
  '动画展示简单微分方程的解',
];

export function ExampleButtons({ onSelect, disabled }: ExampleButtonsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (disabled) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % EXAMPLES.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [disabled]);

  return (
    <div className="w-full">
      {/* 自动滚动示例卡片 */}
      <div className="relative overflow-hidden rounded-2xl bg-bg-secondary/40">
        {/* 当前显示的示例 */}
        <div className="p-5 sm:p-6 min-h-[80px] flex items-center justify-center transition-all duration-500">
          <button
            type="button"
            onClick={() => onSelect(EXAMPLES[currentIndex])}
            disabled={disabled}
            className="text-center text-sm sm:text-base text-text-primary/90 hover:text-text-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            {EXAMPLES[currentIndex]}
          </button>
        </div>

        {/* 左右导航按钮 */}
        <div className="absolute top-1/2 left-3 -translate-y-1/2">
          <button
            type="button"
            onClick={() => setCurrentIndex((prev) => (prev - 1 + EXAMPLES.length) % EXAMPLES.length)}
            disabled={disabled}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-bg-secondary text-text-secondary hover:text-accent hover:bg-bg-secondary/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        <div className="absolute top-1/2 right-3 -translate-y-1/2">
          <button
            type="button"
            onClick={() => setCurrentIndex((prev) => (prev + 1) % EXAMPLES.length)}
            disabled={disabled}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-bg-secondary text-text-secondary hover:text-accent hover:bg-bg-secondary/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
