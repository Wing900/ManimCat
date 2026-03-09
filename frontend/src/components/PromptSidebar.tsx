/**
 * 提示词侧边栏 - 简洁风格
 */

import type { RoleType, SharedModuleType } from '../types/api';
import type { SelectionType } from '../hooks/usePrompts';
import { useI18n } from '../i18n';

// ============================================================================
// 配置
// ============================================================================

interface Props {
  selection: SelectionType;
  onSelect: (sel: SelectionType) => void;
}

export function PromptSidebar({ selection, onSelect }: Props) {
  const { t } = useI18n();

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
            {t('prompts.roleSection')}
          </h3>
          <div className="space-y-0.5">
            {(Object.keys(roleLabels) as RoleType[]).map(role => (
              <div key={role}>
                {/* 角色名 */}
                <div className="px-3 py-1.5 text-xs text-text-secondary/70">
                  {roleLabels[role]}
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
                    {t('common.system')}
                  </button>
                  <button
                    onClick={() => onSelect({ kind: 'role', role, promptType: 'user' })}
                    className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                      isRoleSelected(role, 'user')
                        ? 'bg-accent/20 text-accent'
                        : 'text-text-secondary/60 hover:bg-bg-tertiary/50 hover:text-text-secondary'
                    }`}
                  >
                    {t('common.user')}
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
            {t('prompts.sharedSection')}
          </h3>
          <div className="space-y-0.5">
            {(Object.keys(sharedLabels) as SharedModuleType[]).map(module => (
              <button
                key={module}
                onClick={() => onSelect({ kind: 'shared', module })}
                className={`w-full px-3 py-2 text-left text-sm rounded transition-colors ${
                  isSharedSelected(module)
                    ? 'bg-accent/20 text-accent'
                    : 'text-text-secondary/70 hover:bg-bg-tertiary/50 hover:text-text-secondary'
                }`}
              >
                {sharedLabels[module]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
