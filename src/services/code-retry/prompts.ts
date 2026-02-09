/**
 * Code Retry Service - Prompts
 * 使用新的模板加载器
 */

import { getRoleSystemPrompt, getRoleUserPrompt, getSharedModule, type PromptOverrides } from '../../prompts'

// System prompt - 使用新的加载器
export const CODE_RETRY_SYSTEM_PROMPT = getRoleSystemPrompt('codeRetry')

/**
 * 构建首次代码生成的用户提示词
 */
export function buildInitialCodePrompt(
  concept: string,
  seed: string,
  sceneDesign: string,
  overrides?: PromptOverrides
): string {
  return getRoleUserPrompt('codeGeneration', { concept, seed, sceneDesign }, overrides)
}
