/**
 * 提示词侧边栏 - 简洁风格
 */

import type { RoleType, SharedModuleType } from '../types/api';
import type { SelectionType } from '../hooks/usePrompts';

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

// ============================================================================
// 组件
// ============================================================================

interface Props {
  selection: SelectionType;
  onSelect: (sel: SelectionType) => void;
}

export function PromptSidebar({ selection, onSelect }: Props) {
  const isRoleSelected = (role: RoleType, promptType: 'system' | 'user') =>
    selection.kind === 'role' &&
    selection.role === role &&
    selection.promptType === promptType;

  const isSharedSelected = (module: SharedModuleType) =>
    selection.kind === 'shared' && selection.module === module;

  return (
    <div className="w-56 bg-bg-secondary/20 border-r border-bg-tertiary/30 overflow-y-auto">
      <div className="p-3 space-y-4">
        {/* 角色提示词 */}
        <div>
          <h3 className="px-3 py-1.5 text-xs font-medium text-text-secondary/50 uppercase tracking-wider">
            角色
          </h3>
          <div className="space-y-0.5">
            {(Object.keys(ROLE_LABELS) as RoleType[]).map(role => (
              <div key={role}>
                {/* 角色名 */}
                <div className="px-3 py-1.5 text-xs text-text-secondary/70">
                  {ROLE_LABELS[role]}
                </div>
                {/* System / User 按钮 */}
                <div className="flex gap-1 px-3 pb-1">
                  <button
                    onClick={() => onSelect({ kind: 'role', role, promptType: 'system' })}
                    className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                      isRoleSelected(role, 'system')
                        ? 'bg-accent/20 text-accent'
                        : 'text-text-secondary/60 hover:bg-bg-tertiary/50 hover:text-text-secondary'
                    }`}
                  >
                    System
                  </button>
                  <button
                    onClick={() => onSelect({ kind: 'role', role, promptType: 'user' })}
                    className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                      isRoleSelected(role, 'user')
                        ? 'bg-accent/20 text-accent'
                        : 'text-text-secondary/60 hover:bg-bg-tertiary/50 hover:text-text-secondary'
                    }`}
                  >
                    User
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 分隔线 */}
        <div className="border-t border-bg-tertiary/30" />

        {/* 共享模块 */}
        <div>
          <h3 className="px-3 py-1.5 text-xs font-medium text-text-secondary/50 uppercase tracking-wider">
            共享模块
          </h3>
          <div className="space-y-0.5">
            {(Object.keys(SHARED_LABELS) as SharedModuleType[]).map(module => (
              <button
                key={module}
                onClick={() => onSelect({ kind: 'shared', module })}
                className={`w-full px-3 py-2 text-left text-sm rounded transition-colors ${
                  isSharedSelected(module)
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-secondary/70 hover:bg-bg-tertiary/50 hover:text-text-secondary'
                }`}
              >
                {SHARED_LABELS[module]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
