// 主应用组件

import { useState, useEffect } from 'react';
import { useGeneration } from './hooks/useGeneration';
import { InputForm } from './components/InputForm';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ResultSection } from './components/ResultSection';
import { TimingPanel } from './components/TimingPanel';
import { AiModifyModal } from './components/AiModifyModal';
import { ThemeToggle } from './components/ThemeToggle';
import { SettingsModal } from './components/SettingsModal';
import { PromptsManager } from './components/PromptsManager';
import { DonationModal } from './components/DonationModal';
import ManimCatLogo from './components/ManimCatLogo';
import type { OutputMode, Quality, ReferenceImage } from './types/api';

function App() {
  const { status, result, error, jobId, stage, generate, renderWithCode, modifyWithAI, reset, cancel } = useGeneration();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentCode, setCurrentCode] = useState('');
  const [lastRequest, setLastRequest] = useState<{
    concept: string;
    quality: Quality;
    outputMode: OutputMode;
    referenceImages?: ReferenceImage[];
  } | null>(null);
  const [aiModifyOpen, setAiModifyOpen] = useState(false);
  const [aiModifyInput, setAiModifyInput] = useState('');

  const [promptsOpen, setPromptsOpen] = useState(false);
  const [donationOpen, setDonationOpen] = useState(false);

  useEffect(() => {
    if (result?.code) {
      setCurrentCode(result.code);
    }
  }, [result?.code]);

  const handleSubmit = (data: { concept: string; quality: Quality; outputMode: OutputMode; referenceImages?: ReferenceImage[] }) => {
    setLastRequest(data);
    generate(data);
  };

  const handleRerender = () => {
    if (!lastRequest || !currentCode.trim()) {
      return;
    }
    renderWithCode({ ...lastRequest, code: currentCode });
  };

  const handleAiModifySubmit = () => {
    if (!lastRequest || !currentCode.trim()) {
      return;
    }
    const instructions = aiModifyInput.trim();
    if (!instructions) {
      return;
    }
    setAiModifyOpen(false);
    setAiModifyInput('');
    modifyWithAI({
      concept: lastRequest.concept,
      outputMode: lastRequest.outputMode,
      quality: lastRequest.quality,
      instructions,
      code: currentCode
    });
  };

  const isBusy = status === 'processing';

  return (
    <div className="min-h-screen bg-bg-primary transition-colors duration-300 overflow-x-hidden">
      {/* 左上角图标 */}
      <div className="fixed top-4 left-4 z-50 flex items-center gap-2">
        <a
          href="https://github.com/Wing900/ManimCat"
          target="_blank"
          rel="noopener noreferrer"
          className="p-2.5 text-text-secondary/70 hover:text-text-secondary hover:bg-bg-secondary/50 rounded-full transition-all active:scale-90 active:duration-75"
          title="GitHub"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
          </svg>
        </a>
        <button
          onClick={() => setDonationOpen(true)}
          className="p-2.5 text-text-secondary/70 hover:text-text-secondary hover:bg-bg-secondary/50 rounded-full transition-all active:scale-90 active:duration-75"
          title="请喝可乐"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h1a4 4 0 010 8h-1m-3.413-8.866A6.501 6.501 0 0012 3c-1.93 0-3.694.84-4.9 2.176M4 20h16a1 1 0 001-1v-1a1 1 0 00-1-1H4a1 1 0 00-1 1v1a1 1 0 001 1zm1-9.5V12a3 3 0 003 3h8a3 3 0 003-3v-1.5M9 8h6" />
          </svg>
        </button>
      </div>

      {/* 右上角按钮 */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <button
          onClick={() => setPromptsOpen(true)}
          className="p-2.5 text-text-secondary/70 hover:text-text-secondary hover:bg-bg-secondary/50 rounded-full transition-all active:scale-90 active:duration-75"
          title="提示词管理"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-2.5 text-text-secondary/70 hover:text-text-secondary hover:bg-bg-secondary/50 rounded-full transition-all active:scale-90 active:duration-75"
          title="API 设置"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        <ThemeToggle />
      </div>

      {/* 主容器 - 使用黄金分割比例调整垂直位置 */}
      <div className="max-w-4xl mx-auto px-4 min-h-screen flex flex-col justify-center" style={{ paddingTop: '18vh', paddingBottom: '12vh' }}>
        {/* 标题 */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-4 mb-3">
            <ManimCatLogo className="w-16 h-16" />
            <h1 className="text-5xl sm:text-6xl font-light tracking-tight text-text-primary">
              ManimCat
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
            <div
              className="space-y-6 animate-fade-in"
              style={{
                animation: 'fadeInUp 0.5s ease-out forwards',
              }}
            >
              {/* 结果展示 */}
              <ResultSection
                code={currentCode || result.code || ''}
                outputMode={result.output_mode || lastRequest?.outputMode || 'video'}
                videoUrl={result.video_url || ''}
                imageUrls={result.image_urls || []}
                usedAI={result.used_ai || false}
                renderQuality={result.render_quality || ''}
                generationType={result.generation_type || ''}
                onCodeChange={setCurrentCode}
                onRerender={handleRerender}
                onAiModify={() => setAiModifyOpen(true)}
                isBusy={isBusy}
              />

              {/* 重新生成按钮 */}
              <div className="text-center">
                <button
                  onClick={() => {
                    reset();
                    setCurrentCode('');
                    setLastRequest(null);
                    setAiModifyInput('');
                    setAiModifyOpen(false);
                  }}
                  className="px-8 py-2.5 text-sm text-text-secondary/80 hover:text-accent transition-colors bg-bg-secondary/30 hover:bg-bg-secondary/50 rounded-full"
                >
                  生成新的内容
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
                  onClick={() => {
                    reset();
                    setCurrentCode('');
                    setLastRequest(null);
                    setAiModifyInput('');
                    setAiModifyOpen(false);
                  }}
                  className="px-4 py-2 text-sm text-accent hover:text-accent-hover transition-colors"
                >
                  重试
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {status === 'completed' && result?.timings && (
        <TimingPanel timings={result.timings} />
      )}

      {/* 添加淡入上浮动画 */}
      <style>{`
        @keyframes fadeInUp {
          0% {
            opacity: 0;
            transform: translateY(30px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      {/* 设置模态框 */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={(config) => {
          console.log('保存配置:', config);
        }}
      />

      {/* 提示词管理 */}
      <PromptsManager
        isOpen={promptsOpen}
        onClose={() => setPromptsOpen(false)}
      />

      {/* 捐赠模态框 */}
      <DonationModal
        isOpen={donationOpen}
        onClose={() => setDonationOpen(false)}
      />

      <AiModifyModal
        isOpen={aiModifyOpen}
        value={aiModifyInput}
        loading={isBusy}
        onChange={setAiModifyInput}
        onClose={() => setAiModifyOpen(false)}
        onSubmit={handleAiModifySubmit}
      />
    </div>
  );
}

export default App;
