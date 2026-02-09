/**
 * 提示词模块入口
 * 统一导出所有提示词相关的 API
 */

// 新 API（推荐使用）
export {
  getRoleSystemPrompt,
  getRoleUserPrompt,
  getSharedModule,
  getAllDefaultTemplates,
  clearTemplateCache,
  type RoleType,
  type SharedModuleType,
  type TemplateVariables,
  type PromptOverrides
} from './loader'

// 兼容旧 API（过渡期）
export {
  generateConceptDesignerPrompt,
  generateCodeGenerationPrompt,
  generateCodeFixPrompt,
  generateCodeEditPrompt
} from './loader'

// 导入用于构建旧常量
import { getRoleSystemPrompt } from './loader'

// 旧的常量导出（逐步废弃）
export const SYSTEM_PROMPTS = {
  conceptDesigner: getRoleSystemPrompt('conceptDesigner'),
  codeGeneration: getRoleSystemPrompt('codeGeneration'),
  codeFix: getRoleSystemPrompt('codeRetry'),
  codeEdit: getRoleSystemPrompt('codeEdit')
}

// 保持旧的导出名（兼容）
export const SYSTEM_PROMPT_BASE = SYSTEM_PROMPTS.codeGeneration

// 从 AI 响应中提取代码
export function extractCodeFromResponse(text: string): string {
  if (!text) return ''
  const match = text.match(/```(?:python)?\n([\s\S]*?)```/i)
  if (match) {
    return match[1].trim()
  }
  return text.trim()
}

// 保留 API_INDEX 导出（可能被其他地方使用）
export { API_INDEX } from './api-index'
