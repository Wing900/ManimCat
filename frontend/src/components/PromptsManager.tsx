/**
 * 提示词管理器 - 简洁风格
 */

import { useEffect, useState } from 'react';
import { PromptSidebar } from './PromptSidebar';
import { usePrompts } from '../hooks/usePrompts';
import type { RoleType, SharedModuleType } from '../types/api';

// ============================================================================
// 配置
// ============================================================================

const ROLE_LABELS: Record<RoleType, string> = {
  conceptDesigner: '概念设计者',
  codeGeneration: '代码生成者',
  codeRetry: '重试者',
  codeEdit: '修改者'
};

const SHARED_LABELS: Record<SharedModuleType, string> = {
  knowledge: '知识层',
  rules: '规范层'
};

const SHARED_DESCRIPTIONS: Record<SharedModuleType, string> = {
  knowledge: '在角色提示词中使用 {{knowledge}} 引用此内容',
  rules: '在角色提示词中使用 {{rules}} 引用此内容'
};

// ============================================================================
// 组件
// ============================================================================

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function PromptsManager({ isOpen, onClose }: Props) {
  const {
    isLoading,
    selection,
    setSelection,
    getCurrentContent,
    setCurrentContent,
    restoreCurrent,
    hasOverride
  } = usePrompts();

  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(isOpen);

  // 动画控制
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setTimeout(() => setIsVisible(true), 50);
    } else {
      setIsVisible(false);
      const timeout = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timeout);
    }
  }, [isOpen]);

  // 获取当前标题
  const getTitle = () => {
    if (selection.kind === 'role') {
      const roleLabel = ROLE_LABELS[selection.role];
      const typeLabel = selection.promptType === 'system' ? 'System Prompt' : 'User Prompt';
      return `${roleLabel} - ${typeLabel}`;
    }
    return SHARED_LABELS[selection.module];
  };

  // 获取当前描述
  const getDescription = () => {
    if (selection.kind === 'role') {
      if (selection.promptType === 'system') {
        return '定义 AI 的角色和行为准则';
      }
      return '定义具体的任务指令，可使用 {{knowledge}} 和 {{rules}} 引用共享模块';
    }
    return SHARED_DESCRIPTIONS[selection.module];
  };

  if (!shouldRender) return null;

  const content = getCurrentContent();
  const isModified = hasOverride();

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-bg-primary transition-all duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* 顶栏 */}
      <div className="h-14 bg-bg-secondary/50 border-b border-bg-tertiary/30 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 text-text-secondary/70 hover:text-text-primary hover:bg-bg-tertiary/50 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm text-text-primary font-medium">提示词管理</span>
        </div>

        {/* 修改状态 + 恢复按钮 */}
        <div className="flex items-center gap-2">
          {isModified && (
            <>
              <span className="text-xs text-accent/70">已修改</span>
              <button
                onClick={restoreCurrent}
                className="px-3 py-1.5 text-xs text-text-secondary/70 hover:text-text-primary hover:bg-bg-tertiary/50 rounded-lg transition-colors"
              >
                恢复默认
              </button>
            </>
          )}
        </div>
      </div>

      {/* 主内容 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 侧边栏 */}
        <PromptSidebar selection={selection} onSelect={setSelection} />

        {/* 编辑区 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 标题区 */}
          <div className="px-6 py-4 border-b border-bg-tertiary/30">
            <h2 className="text-base font-medium text-text-primary">{getTitle()}</h2>
            <p className="text-xs text-text-secondary/60 mt-1">{getDescription()}</p>
          </div>

          {/* 编辑器 */}
          <div className="flex-1 p-4 overflow-hidden">
            {isLoading ? (
              <div className="h-full flex items-center justify-center text-text-secondary/50 text-sm">
                加载中...
              </div>
            ) : (
              <textarea
                value={content}
                onChange={e => setCurrentContent(e.target.value)}
                className="w-full h-full px-4 py-3 bg-bg-secondary/30 border border-bg-tertiary/30 rounded-lg text-sm text-text-primary font-mono leading-relaxed resize-none focus:outline-none focus:border-accent/30 focus:ring-1 focus:ring-accent/20 transition-colors"
                placeholder="输入提示词内容..."
              />
            )}
          </div>

          {/* 底栏 */}
          <div className="px-6 py-3 border-t border-bg-tertiary/30 flex items-center justify-between text-xs text-text-secondary/50">
            <span>{content.length} 字符</span>
            <span>修改自动保存到本地</span>
          </div>
        </div>
      </div>
    </div>
  );
}
