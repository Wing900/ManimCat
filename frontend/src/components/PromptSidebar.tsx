// 提示词管理侧边栏组件

import type { ReactNode } from 'react';

interface SidebarItemProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  indent?: boolean;
}

function SidebarItem({
  icon,
  label,
  active = false,
  onClick,
  children,
  expanded = true,
  onToggle,
  indent = false
}: SidebarItemProps) {
  const hasChildren = !!children;

  return (
    <div className={`${indent ? 'ml-4' : ''}`}>
      <button
        onClick={() => hasChildren ? onToggle?.() : onClick?.()}
        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
          active
            ? 'text-accent bg-bg-secondary/50 rounded-lg'
            : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary/30 rounded-lg'
        }`}
      >
        <span className="w-5 h-5 flex items-center justify-center">{icon}</span>
        <span className="flex-1 text-left">{label}</span>
        {hasChildren && (
          <svg
            className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {hasChildren && expanded && (
        <div className="mt-1 space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}

interface PromptSidebarProps {
  activeSection: string;
  activePrompt: string;
  onSectionChange: (section: string, prompt: string) => void;
}

export function PromptSidebar({
  activeSection,
  activePrompt,
  onSectionChange
}: PromptSidebarProps) {
  return (
    <div className="w-64 bg-bg-secondary/30 border-r border-bg-secondary/50 overflow-y-auto">
      <div className="p-4 space-y-6">
        {/* 概念设计提示词 */}
        <div>
          <h3 className="px-4 text-xs font-medium text-text-secondary/60 uppercase tracking-wider mb-2">
            概念设计
          </h3>
          <div className="space-y-1">
            <SidebarItem
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
              }
              label="系统提示词"
              active={activeSection === 'system' && activePrompt === 'conceptDesigner'}
              onClick={() => onSectionChange('system', 'conceptDesigner')}
              indent
            />
            <SidebarItem
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              }
              label="用户提示词"
              active={activeSection === 'user' && activePrompt === 'conceptDesigner'}
              onClick={() => onSectionChange('user', 'conceptDesigner')}
              indent
            />
          </div>
        </div>

        {/* 代码生成提示词 */}
        <div>
          <h3 className="px-4 text-xs font-medium text-text-secondary/60 uppercase tracking-wider mb-2">
            代码生成
          </h3>
          <div className="space-y-1">
            <SidebarItem
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
                </svg>
              }
              label="系统提示词"
              active={activeSection === 'system' && activePrompt === 'codeGeneration'}
              onClick={() => onSectionChange('system', 'codeGeneration')}
              indent
            />
            <SidebarItem
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              }
              label="用户提示词"
              active={activeSection === 'user' && activePrompt === 'codeGeneration'}
              onClick={() => onSectionChange('user', 'codeGeneration')}
              indent
            />
          </div>
        </div>

        {/* 代码修复提示词 */}
        <div>
          <h3 className="px-4 text-xs font-medium text-text-secondary/60 uppercase tracking-wider mb-2">
            代码修复
          </h3>
          <div className="space-y-1">
            <SidebarItem
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              }
              label="初始重试提示词"
              active={activeSection === 'user' && activePrompt === 'codeRetryInitial'}
              onClick={() => onSectionChange('user', 'codeRetryInitial')}
              indent
            />
            <SidebarItem
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              }
              label="修复提示词"
              active={activeSection === 'user' && activePrompt === 'codeRetryFix'}
              onClick={() => onSectionChange('user', 'codeRetryFix')}
              indent
            />
          </div>
        </div>

        {/* AI修改提示词 */}
        <div>
          <h3 className="px-4 text-xs font-medium text-text-secondary/60 uppercase tracking-wider mb-2">
            AI修改
          </h3>
          <div className="space-y-1">
            <SidebarItem
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 15.292M15 21H9m6 0a3 3 0 01-6 0m6 0H9" />
                </svg>
              }
              label="系统提示词"
              active={activeSection === 'system' && activePrompt === 'codeEdit'}
              onClick={() => onSectionChange('system', 'codeEdit')}
              indent
            />
            <SidebarItem
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              }
              label="用户提示词"
              active={activeSection === 'user' && activePrompt === 'codeEdit'}
              onClick={() => onSectionChange('user', 'codeEdit')}
              indent
            />
          </div>
        </div>

        {/* 系统重试提示词 */}
        <div>
          <h3 className="px-4 text-xs font-medium text-text-secondary/60 uppercase tracking-wider mb-2">
            系统重试
          </h3>
          <div className="space-y-1">
            <SidebarItem
              icon={
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              }
              label="重试提示词"
              active={activeSection === 'system' && activePrompt === 'codeRetry'}
              onClick={() => onSectionChange('system', 'codeRetry')}
              indent
            />
          </div>
        </div>
      </div>
    </div>
  );
}
