// 主应用组件

import { useGeneration } from './hooks/useGeneration';
import { InputForm } from './components/InputForm';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ResultSection } from './components/ResultSection';
import { ThemeToggle } from './components/ThemeToggle';
import ManimGoLogo from './components/ManimGoLogo';
import type { Quality } from './types/api';

function App() {
  const { status, result, error, jobId, stage, generate, reset, cancel } = useGeneration();

  const handleSubmit = (data: { concept: string; quality: Quality; forceRefresh: boolean }) => {
    generate(data);
  };

  return (
    <div className="min-h-screen bg-bg-primary transition-colors duration-300">
      {/* 主题切换按钮 */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      {/* 主容器 */}
      <div className="max-w-4xl mx-auto px-4 py-16 sm:py-20">
        {/* 标题 */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-4 mb-3">
            <ManimGoLogo className="w-16 h-16" />
            <h1 className="text-5xl sm:text-6xl font-light tracking-tight text-text-primary">
              ManimGO
            </h1>
          </div>
          <p className="text-sm text-text-secondary/70 max-w-lg mx-auto">
            用 AI 驱动 Manim 生成数学动画
          </p>
        </div>

        {/* 状态显示区域 */}
        <div className="mb-6">
          {status === 'idle' && (
            <InputForm
              onSubmit={handleSubmit}
              loading={false}
            />
          )}

          {status === 'processing' && (
            <div className="bg-bg-secondary/20 rounded-2xl p-8">
              <LoadingSpinner stage={stage} jobId={jobId || undefined} onCancel={cancel} />
            </div>
          )}

          {status === 'completed' && result && (
            <div className="space-y-6">
              {/* 结果展示 */}
              <ResultSection
                code={result.code || ''}
                videoUrl={result.video_url || ''}
                usedAI={result.used_ai || false}
                renderQuality={result.render_quality || ''}
                generationType={result.generation_type || ''}
              />

              {/* 重新生成按钮 */}
              <div className="text-center">
                <button
                  onClick={reset}
                  className="px-8 py-2.5 text-sm text-text-secondary/80 hover:text-accent transition-colors bg-bg-secondary/30 hover:bg-bg-secondary/50 rounded-full"
                >
                  生成新的动画
                </button>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="bg-red-50/80 dark:bg-red-900/20 rounded-2xl p-6">
              <div className="flex items-start gap-3">
                <div className="text-red-500 mt-0.5">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-text-primary font-medium mb-1">出错了</p>
                  <p className="text-text-secondary text-sm">{error || '生成失败，请重试'}</p>
                </div>
              </div>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={reset}
                  className="px-4 py-2 text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  重试
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
