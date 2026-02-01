// 提示词管理主页面组件
// 包含侧边栏导航和主编辑区的完整布局

import { useEffect, useState } from 'react';
import { PromptSidebar } from './PromptSidebar';
import { PromptInput } from './PromptInput';
import { usePrompts } from '../hooks/usePrompts';

interface PromptsManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

// 提示词类型配置
const PROMPT_CONFIG = {
  system: {
    conceptDesigner: {
      label: '概念设计系统提示词',
      placeholder: '输入概念设计阶段的系统提示词...',
      description: '用于指导 AI 理解数学概念并设计动画场景'
    },
    codeGeneration: {
      label: '代码生成系统提示词',
      placeholder: '输入代码生成阶段的系统提示词...',
      description: '用于指导 AI 生成符合规范的 Manim 代码'
    },
    codeRetry: {
      label: '系统重试提示词',
      placeholder: '输入系统重试阶段的提示词...',
      description: '用于指导 AI 在代码失败时进行重试和优化'
    },
    codeEdit: {
      label: 'AI修改系统提示词',
      placeholder: '用于 AI 修改阶段的系统提示词...',
      description: '用于指导 AI 基于现有代码进行修改'
    }
  },
  user: {
    conceptDesigner: {
      label: '概念设计用户提示词',
      placeholder: '输入概念设计阶段的用户提示词...',
      description: '补充说明概念设计的具体需求和风格'
    },
    codeGeneration: {
      label: '代码生成用户提示词',
      placeholder: '输入代码生成阶段的用户提示词...',
      description: '补充说明代码生成的具体要求和规范'
    },
    codeRetryInitial: {
      label: '代码修复初始重试提示词',
      placeholder: '输入代码修复初始重试阶段的提示词...',
      description: '代码第一次失败时的修复指导'
    },
    codeRetryFix: {
      label: '代码修复提示词',
      placeholder: '输入代码修复阶段的提示词...',
      description: '代码第二次失败时的详细修复指导'
    },
    codeEdit: {
      label: 'AI修改用户提示词',
      placeholder: '用于 AI 修改阶段的用户提示词...',
      description: '用于描述修改目标、约束与期望效果'
    }
  }
};

export function PromptsManager({ isOpen, onClose }: PromptsManagerProps) {
  const {
    isLoading,
    activeSection,
    activePrompt,
    setActiveSection,
    setActivePrompt,
    getCurrentPrompt,
    setCurrentPrompt,
    restoreDefault
  } = usePrompts();

    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

    const TRANSITION_MS = 400;

    const [shouldRender, setShouldRender] = useState(isOpen);

    const [isVisible, setIsVisible] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      // 延迟一帧再显示，确保初始 opacity-0 生效
      setTimeout(() => setIsVisible(true), 50);
    } else {
      setIsVisible(false);
      const timeout = window.setTimeout(() => setShouldRender(false), 400);
      return () => window.clearTimeout(timeout);
    }
  }, [isOpen]);

  // 处理侧边栏导航
  const handleSectionChange = (section: string, prompt: string) => {
    setActiveSection(section);
    setActivePrompt(prompt);
    setSaveStatus('idle');
  };

  // 处理保存
  const handleSave = () => {
    setSaveStatus('saving');
    setTimeout(() => {
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 500);
  };

  // 处理恢复默认
  const handleRestoreDefault = () => {
    restoreDefault();
    setSaveStatus('success');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  // 获取当前配置
  const currentConfig = activeSection === 'system'
    ? PROMPT_CONFIG.system[activePrompt as keyof typeof PROMPT_CONFIG.system]
    : PROMPT_CONFIG.user[activePrompt as keyof typeof PROMPT_CONFIG.user];

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-bg-primary transition-all duration-[400ms] ease-out ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95 pointer-events-none'}`}
    >
      {/* 顶部导航栏 */}
      <div className="h-16 bg-bg-secondary border-b border-bg-secondary/50 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="p-2 text-text-secondary hover:text-text-primary hover:bg-bg-secondary/50 rounded-lg transition-colors"
            title="返回主界面"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-medium text-text-primary">提示词管理</h1>
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === 'success' && (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>保存成功</span>
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {saveStatus === 'saving' ? (
              <>
                <svg className="animate-spin w-4 h-4 inline mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                保存中...
              </>
            ) : (
              '保存'
            )}
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 侧边栏 */}
        <PromptSidebar
          activeSection={activeSection}
          activePrompt={activePrompt}
          onSectionChange={handleSectionChange}
        />

        {/* 主编辑区 */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* 当前提示词信息 */}
            <div className="bg-bg-secondary/30 rounded-xl p-6">
              <h2 className="text-xl font-medium text-text-primary mb-2">
                {currentConfig?.label || '提示词编辑'}
              </h2>
              <p className="text-sm text-text-secondary/70">
                {currentConfig?.description || '在此处编辑提示词，它将用于指导 AI 生成和优化动画'}
              </p>
            </div>

            {/* 输入组件 */}
            <div className="space-y-6">
              <PromptInput
                value={getCurrentPrompt()}
                onChange={setCurrentPrompt}
                label={currentConfig?.label || '提示词'}
                placeholder={currentConfig?.placeholder}
                showWordCount
                disabled={isLoading}
                onSave={handleSave}
                onRestoreDefault={handleRestoreDefault}
              />

            </div>
          </div>
        </div>
      </div>

      {/* 底部状态栏 */}
      <div className="h-10 bg-bg-secondary border-t border-bg-secondary/50 flex items-center justify-between px-6 text-xs text-text-secondary">
        <span>提示词管理</span>
        <span>字符限制：20000</span>
      </div>
    </div>
  );
}

