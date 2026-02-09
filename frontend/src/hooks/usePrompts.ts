/**
 * 提示词管理 Hook
 * 适配新的 roles + shared 数据结构
 */

import { useState, useEffect, useCallback } from 'react';
import { getPromptDefaults } from '../lib/api';
import type { RoleType, SharedModuleType, PromptDefaults, PromptOverrides } from '../types/api';

const STORAGE_KEY = 'manimcat_prompt_overrides';

// ============================================================================
// 存储
// ============================================================================

function loadStoredOverrides(): PromptOverrides | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('Failed to load prompts:', e);
  }
  return null;
}

function saveOverrides(overrides: PromptOverrides): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch (e) {
    console.error('Failed to save prompts:', e);
  }
}

/** 供 useGeneration 使用，导出当前覆盖配置 */
export function loadPrompts(): PromptOverrides {
  return loadStoredOverrides() || {};
}

// ============================================================================
// 选择项类型
// ============================================================================

export type SelectionType =
  | { kind: 'role'; role: RoleType; promptType: 'system' | 'user' }
  | { kind: 'shared'; module: SharedModuleType };

// ============================================================================
// Hook
// ============================================================================

export function usePrompts() {
  const [defaults, setDefaults] = useState<PromptDefaults | null>(null);
  const [overrides, setOverrides] = useState<PromptOverrides>({});
  const [isLoading, setIsLoading] = useState(true);
  const [selection, setSelection] = useState<SelectionType>({
    kind: 'role',
    role: 'codeGeneration',
    promptType: 'user'
  });

  // 加载默认值和覆盖配置
  useEffect(() => {
    let active = true;

    const load = async () => {
      setIsLoading(true);
      try {
        const [defaultsData, storedOverrides] = await Promise.all([
          getPromptDefaults(),
          Promise.resolve(loadStoredOverrides())
        ]);
        if (active) {
          setDefaults(defaultsData);
          setOverrides(storedOverrides || {});
        }
      } catch (e) {
        console.error('Failed to load prompts:', e);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();
    return () => { active = false; };
  }, []);

  // 保存覆盖配置
  useEffect(() => {
    if (!isLoading) {
      saveOverrides(overrides);
    }
  }, [overrides, isLoading]);

  // 获取当前选择的默认内容
  const getDefaultContent = useCallback((): string => {
    if (!defaults) return '';

    if (selection.kind === 'role') {
      const { role, promptType } = selection;
      return defaults.roles[role]?.[promptType] || '';
    } else {
      return defaults.shared[selection.module] || '';
    }
  }, [defaults, selection]);

  // 获取当前选择的覆盖内容
  const getOverrideContent = useCallback((): string => {
    if (selection.kind === 'role') {
      const { role, promptType } = selection;
      return overrides.roles?.[role]?.[promptType] || '';
    } else {
      return overrides.shared?.[selection.module] || '';
    }
  }, [overrides, selection]);

  // 获取当前内容（覆盖优先，否则默认）
  const getCurrentContent = useCallback((): string => {
    const override = getOverrideContent();
    return override || getDefaultContent();
  }, [getOverrideContent, getDefaultContent]);

  // 设置当前内容
  const setCurrentContent = useCallback((value: string) => {
    const defaultValue = getDefaultContent();
    // 如果和默认值相同，则清除覆盖
    const newValue = value === defaultValue ? '' : value;

    setOverrides(prev => {
      const next = { ...prev };

      if (selection.kind === 'role') {
        const { role, promptType } = selection;
        if (!next.roles) next.roles = {};
        if (!next.roles[role]) next.roles[role] = {};
        next.roles[role]![promptType] = newValue || undefined;
        // 清理空对象
        if (!next.roles[role]?.system && !next.roles[role]?.user) {
          delete next.roles[role];
        }
      } else {
        if (!next.shared) next.shared = {};
        next.shared[selection.module] = newValue || undefined;
        // 清理
        if (!newValue) delete next.shared[selection.module];
      }

      return next;
    });
  }, [selection, getDefaultContent]);

  // 恢复当前选择的默认值
  const restoreCurrent = useCallback(() => {
    setCurrentContent(getDefaultContent());
  }, [setCurrentContent, getDefaultContent]);

  // 恢复全部默认值
  const restoreAll = useCallback(() => {
    setOverrides({});
  }, []);

  // 检查当前是否有覆盖
  const hasOverride = useCallback((): boolean => {
    return !!getOverrideContent();
  }, [getOverrideContent]);

  return {
    defaults,
    overrides,
    isLoading,
    selection,
    setSelection,
    getCurrentContent,
    setCurrentContent,
    restoreCurrent,
    restoreAll,
    hasOverride
  };
}
