/**
 * 提示词管理器 - 简洁风格
 */

import { useEffect, useState } from 'react';
import { PromptSidebar } from './PromptSidebar';
import { usePrompts } from '../hooks/usePrompts';
import type { RoleType, SharedModuleType } from '../types/api';
import { useI18n } from '../i18n';

// ============================================================================
// 配置
// ============================================================================

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function PromptsManager({ isOpen, onClose }: Props) {
  const { t } = useI18n();
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
    const roleLabels: Record<RoleType, string> = {
      conceptDesigner: t('prompts.role.conceptDesigner'),
      codeGeneration: t('prompts.role.codeGeneration'),
      codeRetry: t('prompts.role.codeRetry'),
      codeEdit: t('prompts.role.codeEdit')
    };

    const sharedLabels: Record<SharedModuleType, string> = {
      knowledge: t('prompts.shared.knowledge'),
      rules: t('prompts.shared.rules')
    };

    if (selection.kind === 'role') {
      const roleLabel = roleLabels[selection.role];
      return selection.promptType === 'system'
        ? t('prompts.role.systemTitle', { role: roleLabel })
        : t('prompts.role.userTitle', { role: roleLabel });
    }
    return sharedLabels[selection.module];
  };

  // 获取当前描述
  const getDescription = () => {
    if (selection.kind === 'role') {
      if (selection.promptType === 'system') {
        return t('prompts.role.systemDescription');
      }
      return t('prompts.role.userDescription');
    }
    return selection.module === 'knowledge'
      ? t('prompts.shared.knowledgeDescription')
      : t('prompts.shared.rulesDescription');
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
          <span className="text-sm text-text-primary font-medium">{t('prompts.title')}</span>
        </div>

        {/* 修改状态 + 恢复按钮 */}
        <div className="flex items-center gap-2">
          {isModified && (
            <>
              <span className="text-xs text-accent/70">{t('prompts.modified')}</span>
              <button
                onClick={restoreCurrent}
                className="px-3 py-1.5 text-xs text-text-secondary/70 hover:text-text-primary hover:bg-bg-tertiary/50 rounded-lg transition-colors"
              >
                {t('prompts.restore')}
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
                {t('common.loading')}
              </div>
            ) : (
              <textarea
                value={content}
                onChange={e => setCurrentContent(e.target.value)}
                className="w-full h-full px-4 py-3 bg-bg-secondary/30 border border-bg-tertiary/30 rounded-lg text-sm text-text-primary font-mono leading-relaxed resize-none focus:outline-none focus:border-accent/30 focus:ring-1 focus:ring-accent/20 transition-colors"
                placeholder={t('prompts.placeholder')}
              />
            )}
          </div>

          {/* 底栏 */}
          <div className="px-6 py-3 border-t border-bg-tertiary/30 flex items-center justify-between text-xs text-text-secondary/50">
            <span>{t('prompts.characters', { count: content.length })}</span>
            <span>{t('prompts.autosave')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
