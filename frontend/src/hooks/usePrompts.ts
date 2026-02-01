// 提示词管理 Hook
// 负责提示词的状态管理、存储和加载

import { useState, useEffect, useCallback } from 'react';
import { getPromptDefaults } from '../lib/api';
import type { PromptOverrides } from '../types/api';

/** 存储在 localStorage 中的键名 */
const PROMPTS_STORAGE_KEY = 'manimcat_prompt_overrides';

/** 默认提示词配置 */
const DEFAULT_PROMPTS: PromptOverrides = {
  system: {
    conceptDesigner: '',
    codeGeneration: '',
    codeRetry: '',
    codeEdit: '',
  },
  user: {
    conceptDesigner: '',
    codeGeneration: '',
    codeRetryInitial: '',
    codeRetryFix: '',
    codeEdit: '',
  },
};

/** 从 localStorage 加载提示词配置 */
/** Load prompt overrides from localStorage if available. */
export function loadStoredPrompts(): PromptOverrides | null {
  try {
    const saved = localStorage.getItem(PROMPTS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        system: { ...DEFAULT_PROMPTS.system, ...parsed.system },
        user: { ...DEFAULT_PROMPTS.user, ...parsed.user },
      };
    }
  } catch (error) {
    console.error('Failed to load prompts:', error);
  }
  return null;
}

export function loadPrompts(): PromptOverrides {
  return loadStoredPrompts() || DEFAULT_PROMPTS;
}

/** 保存提示词配置到 localStorage */
export function savePrompts(prompts: PromptOverrides): void {
  try {
    localStorage.setItem(PROMPTS_STORAGE_KEY, JSON.stringify(prompts));
  } catch (error) {
    console.error('Failed to save prompts:', error);
  }
}

/** 提示词管理 Hook */
export function usePrompts() {
  const [prompts, setPrompts] = useState<PromptOverrides>(DEFAULT_PROMPTS);
  const [defaultPrompts, setDefaultPrompts] = useState<PromptOverrides>(DEFAULT_PROMPTS);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeSection, setActiveSection] = useState<string>('system');
  const [activePrompt, setActivePrompt] = useState<string>('conceptDesigner');

  // 从 localStorage 加载配置
  useEffect(() => {
    const savedPrompts = loadStoredPrompts();
    if (savedPrompts) {
      setPrompts(savedPrompts);
    }

    let isActive = true;
    const loadDefaults = async () => {
      setIsLoading(true);
      try {
        const defaults = await getPromptDefaults();
        if (isActive) {
          setDefaultPrompts(defaults);
        }
      } catch (error) {
        console.error('Failed to load prompt defaults:', error);
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadDefaults();
    return () => {
      isActive = false;
    };
  }, []);

  // 保存到 localStorage
  useEffect(() => {
    savePrompts(prompts);
  }, [prompts]);

  // 更新提示词
  const updatePrompt = useCallback((section: string, type: string, value: string) => {
    setPrompts(prev => {
      const newPrompts = { ...prev };

      if (section === 'system') {
        if (!newPrompts.system) {
          newPrompts.system = {};
        }
        newPrompts.system[type as keyof PromptOverrides['system']] = value;
      } else if (section === 'user') {
        if (!newPrompts.user) {
          newPrompts.user = {};
        }
        newPrompts.user[type as keyof PromptOverrides['user']] = value;
      }

      return newPrompts;
    });
  }, []);

  // 恢复默认值
  const restoreDefault = useCallback(() => {
    setPrompts(DEFAULT_PROMPTS);
  }, []);

  // 获取当前编辑的提示词
  const getDefaultPrompt = useCallback((section: string, type: string) => {
    if (section === 'system') {
      return defaultPrompts.system?.[type as keyof PromptOverrides['system']] || '';
    }
    if (section === 'user') {
      return defaultPrompts.user?.[type as keyof PromptOverrides['user']] || '';
    }
    return '';
  }, [defaultPrompts]);

  // 
  const getCurrentPrompt = useCallback(() => {
    let current = '';
    if (activeSection === 'system') {
      current = prompts.system?.[activePrompt as keyof PromptOverrides['system']] || '';
    } else if (activeSection === 'user') {
      current = prompts.user?.[activePrompt as keyof PromptOverrides['user']] || '';
    }

    if (current && current.trim().length > 0) {
      return current;
    }

    return getDefaultPrompt(activeSection, activePrompt);
  }, [prompts, activeSection, activePrompt, getDefaultPrompt]);

  // 
  const setCurrentPrompt = useCallback((value: string) => {
    const defaultValue = getDefaultPrompt(activeSection, activePrompt);
    const nextValue = value === defaultValue ? '' : value;
    updatePrompt(activeSection, activePrompt, nextValue);
  }, [activeSection, activePrompt, getDefaultPrompt, updatePrompt]);

  return {
    prompts,
    defaultPrompts,
    isLoading,
    activeSection,
    activePrompt,
    setActiveSection,
    setActivePrompt,
    updatePrompt,
    restoreDefault,
    getCurrentPrompt,
    setCurrentPrompt,
  };
}
