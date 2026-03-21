/**
 * 工作空间 - 合并 历史记录 / 提示词管理 / 用量统计
 */

import { useState, type ReactNode } from 'react';
import { HistoryPanel } from './HistoryPanel';
import { usePrompts } from '../hooks/usePrompts';
import { PromptSidebar } from './PromptSidebar';
import { UsageDashboardContent } from './UsageDashboard';
import type { RoleType, SharedModuleType } from '../types/api';
import { useI18n } from '../i18n';
import { useModalTransition } from '../hooks/useModalTransition';

type WorkspaceModule = 'history' | 'prompts' | 'usage';

interface WorkspaceProps {
  isOpen: boolean;
  onClose: () => void;
  initialModule?: WorkspaceModule;
  onReusePrompt?: (prompt: string) => void;
}

export function Workspace({ isOpen, onClose, initialModule = 'history', onReusePrompt }: WorkspaceProps) {
  const { t } = useI18n();
  const { shouldRender, isExiting } = useModalTransition(isOpen, 400);
  const [activeModule, setActiveModule] = useState<WorkspaceModule>(initialModule);

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

  const breadcrumbMap: Record<WorkspaceModule, string> = {
    history: t('workspace.breadcrumb.history'),
    prompts: t('workspace.breadcrumb.prompts'),
    usage: t('workspace.breadcrumb.usage'),
  };

  const railItems: { id: WorkspaceModule; label: string; icon: ReactNode }[] = [
    {
      id: 'history',
      label: t('workspace.rail.history'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: 'prompts',
      label: t('workspace.rail.prompts'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
        </svg>
      ),
    },
    {
      id: 'usage',
      label: t('workspace.rail.usage'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 19h16M6 16V9m6 7V5m6 11v-4" />
        </svg>
      ),
    },
  ];

  const getPromptTitle = () => {
    const roleLabels: Record<RoleType, string> = {
      problemFraming: t('prompts.role.problemFraming'),
      conceptDesigner: t('prompts.role.conceptDesigner'),
      codeGeneration: t('prompts.role.codeGeneration'),
      codeRetry: t('prompts.role.codeRetry'),
      codeEdit: t('prompts.role.codeEdit'),
    };
    const sharedLabels: Record<SharedModuleType, string> = {
      knowledge: t('prompts.shared.knowledge'),
      rules: t('prompts.shared.rules'),
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
    return selection.module === 'knowledge'
      ? t('prompts.shared.knowledgeDescription')
      : t('prompts.shared.rulesDescription');
  };

  const promptContent = getCurrentContent();
  const isModified = hasOverride();

  return (
    <div
      className={`fixed inset-0 z-[120] flex flex-col bg-bg-primary transition-all duration-500 ${
        isExiting ? 'opacity-0 scale-[1.02] blur-xl' : 'opacity-100 scale-100 blur-0 animate-studio-entrance'
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
            <span className="text-lg font-medium text-text-primary/90 tracking-tight">{t('workspace.title')}</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {activeModule === 'prompts' && isModified && (
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
          <div className="text-[10px] text-text-secondary/30 uppercase tracking-[0.25em] font-light">
            Workspace / <span className="text-text-secondary/60 font-medium">{breadcrumbMap[activeModule]}</span>
          </div>
        </div>
      </div>

      {/* 核心交互区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧 Rail 导航 */}
        <aside className="w-20 bg-bg-secondary/20 border-r border-border/5 flex flex-col items-center py-8 gap-4">
          {railItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveModule(item.id)}
              className={`w-12 h-12 flex items-center justify-center rounded-2xl transition-all duration-300 ${
                activeModule === item.id
                  ? 'bg-bg-tertiary text-text-primary shadow-sm'
                  : 'text-text-secondary/40 hover:text-text-primary hover:bg-bg-secondary/50'
              }`}
              title={item.label}
            >
              {item.icon}
            </button>
          ))}
        </aside>

        {/* 模块展示区 */}
        <div className="flex-1 flex overflow-hidden">
          {activeModule === 'history' && (
            <main className="flex-1 p-10 overflow-y-auto bg-bg-primary/30 animate-fade-in">
              <HistoryPanel isActive={activeModule === 'history'} onReusePrompt={onReusePrompt} />
            </main>
          )}

          {activeModule === 'prompts' && (
            <div className="flex-1 flex overflow-hidden animate-fade-in">
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
          )}

          {activeModule === 'usage' && (
            <main className="flex-1 overflow-y-auto bg-bg-primary/30 animate-fade-in">
              <UsageDashboardContent isActive={activeModule === 'usage'} />
            </main>
          )}
        </div>
      </div>
    </div>
  );
}
