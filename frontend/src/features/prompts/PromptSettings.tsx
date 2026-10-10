/**
 * Prompt Settings - 提示词管理面板
 */

import { usePrompts } from './hooks/usePrompts';
import { PromptSidebar } from './PromptSidebar';
import type { RoleType, SharedModuleType } from '../../shared/types/api';
import { useI18n } from '../../shared/i18n/index';
import { useModalTransition } from '../../shared/hooks/useModalTransition';

interface PromptSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PromptSettings({ isOpen, onClose }: PromptSettingsProps) {
  const { t } = useI18n();
  const { shouldRender, isExiting } = useModalTransition(isOpen, 650);

  const {
    isLoading: promptsLoading,
    selection,
    setSelection,
    getCurrentContent,
    setCurrentContent,
    restoreCurrent,
    hasOverride,
  } = usePrompts();

  if (!shouldRender) return null;

  const getPromptTitle = () => {
    const roleLabels: Record<RoleType, string> = {
      problemFraming: t('prompts.role.problemFraming'),
      conceptDesigner: t('prompts.role.conceptDesigner'),
      codeGeneration: t('prompts.role.codeGeneration'),
      codeRetry: t('prompts.role.codeRetry'),
      codeEdit: t('prompts.role.codeEdit'),
    };
    const sharedLabels: Record<SharedModuleType, string> = {
      apiIndex: t('prompts.shared.apiIndex'),
      specification: t('prompts.shared.specification'),
    };

    if (selection.kind === 'role') {
      const roleLabel = roleLabels[selection.role];
      return selection.promptType === 'system'
        ? t('prompts.role.systemTitle', { role: roleLabel })
        : t('prompts.role.userTitle', { role: roleLabel });
    }
    return sharedLabels[selection.module];
  };

  const getPromptDescription = () => {
    if (selection.kind === 'role') {
      return selection.promptType === 'system'
        ? t('prompts.role.systemDescription')
        : t('prompts.role.userDescription');
    }
    return selection.module === 'apiIndex'
      ? t('prompts.shared.apiIndexDescription')
      : t('prompts.shared.specificationDescription');
  };

  const promptContent = getCurrentContent();
  const isModified = hasOverride();

  return (
    <div
      className={`fixed inset-0 z-[120] flex flex-col bg-bg-primary ${
        isExiting ? 'animate-workspace-exit' : 'animate-studio-entrance'
      }`}
    >
      {/* 顶栏 */}
      <div className="h-16 bg-bg-secondary/50 border-b border-border/5 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="p-2.5 text-text-secondary/50 hover:text-text-primary hover:bg-bg-primary/50 rounded-2xl transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-rgb/40" />
            <span className="text-lg font-medium text-text-primary/90 tracking-tight">{t('prompts.settingsTitle')}</span>
          </div>
        </div>

        {isModified && (
          <div className="flex items-center gap-3 animate-fade-in">
            <span className="text-[10px] uppercase tracking-widest text-accent-rgb/60">{t('prompts.modified')}</span>
            <button
              onClick={restoreCurrent}
              className="px-4 py-1.5 text-[10px] uppercase tracking-widest bg-accent-rgb/5 text-accent-rgb/70 hover:bg-accent-rgb/10 hover:text-accent-rgb rounded-full transition-all"
            >
              {t('prompts.restore')}
            </button>
          </div>
        )}
      </div>

      {/* 核心交互区 */}
      <div className="flex-1 flex overflow-hidden">
        <PromptSidebar selection={selection} onSelect={setSelection} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-10 py-8 border-b border-border/5">
            <h2 className="text-xl font-medium text-text-primary/90 tracking-tight">{getPromptTitle()}</h2>
            <p className="text-sm text-text-secondary/50 mt-2 font-light">{getPromptDescription()}</p>
          </div>
          <div className="flex-1 p-8 overflow-hidden">
            {promptsLoading ? (
              <div className="h-full flex items-center justify-center text-text-secondary/30 text-sm tracking-widest uppercase">
                {t('common.loading')}
              </div>
            ) : (
              <textarea
                value={promptContent}
                onChange={e => setCurrentContent(e.target.value)}
                className="w-full h-full px-8 py-8 bg-bg-secondary/30 border border-border/5 rounded-[2rem] text-[15px] text-text-primary/80 font-mono leading-relaxed resize-none focus:outline-none focus:border-accent-rgb/20 focus:bg-bg-secondary/50 transition-all shadow-inner scrollbar-hide"
                placeholder={t('prompts.placeholder')}
              />
            )}
          </div>
          <div className="px-10 py-5 border-t border-border/5 flex items-center justify-between text-[10px] uppercase tracking-widest text-text-secondary/30 font-light">
            <span>{t('prompts.characters', { count: promptContent.length })}</span>
            <span className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-green-500/40 animate-pulse" />
              {t('prompts.autosave')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
