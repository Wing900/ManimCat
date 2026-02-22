/**
 * 提示词模板加载器
 * 读取 .md 模板文件，替换占位符，组装最终提示词
 */

import fs from 'fs'
import path from 'path'

// 使用项目根目录，兼容开发和生产环境
const TEMPLATES_DIR = path.join(process.cwd(), 'src', 'prompts', 'templates')

// ============================================================================
// 类型定义
// ============================================================================

/** 角色类型 */
export type RoleType = 'conceptDesigner' | 'codeGeneration' | 'codeRetry' | 'codeEdit'

/** 共享模块类型 */
export type SharedModuleType = 'knowledge' | 'rules'

/** 模板变量 */
export interface TemplateVariables {
  concept?: string
  seed?: string
  sceneDesign?: string
  errorMessage?: string
  attempt?: number
  instructions?: string
  code?: string
  outputMode?: 'video' | 'image'
  isImage?: boolean
  isVideo?: boolean
}

/** 提示词覆盖配置 */
export interface PromptOverrides {
  roles?: Partial<Record<RoleType, { system?: string; user?: string }>>
  shared?: Partial<Record<SharedModuleType, string>>
}

// ============================================================================
// 文件路径
// ============================================================================

const ROLE_FILES: Record<RoleType, { system: string; user: string }> = {
  conceptDesigner: {
    system: path.join(TEMPLATES_DIR, 'roles', 'concept-designer.system.md'),
    user: path.join(TEMPLATES_DIR, 'roles', 'concept-designer.md')
  },
  codeGeneration: {
    system: path.join(TEMPLATES_DIR, 'roles', 'code-generation.system.md'),
    user: path.join(TEMPLATES_DIR, 'roles', 'code-generation.md')
  },
  codeRetry: {
    system: path.join(TEMPLATES_DIR, 'roles', 'code-retry.system.md'),
    user: path.join(TEMPLATES_DIR, 'roles', 'code-retry.md')
  },
  codeEdit: {
    system: path.join(TEMPLATES_DIR, 'roles', 'code-edit.system.md'),
    user: path.join(TEMPLATES_DIR, 'roles', 'code-edit.md')
  }
}

const SHARED_FILES: Record<SharedModuleType, string> = {
  knowledge: path.join(TEMPLATES_DIR, 'shared', 'knowledge.md'),
  rules: path.join(TEMPLATES_DIR, 'shared', 'rules.md')
}

// ============================================================================
// 缓存
// ============================================================================

const templateCache = new Map<string, string>()

function readTemplate(filePath: string): string {
  if (templateCache.has(filePath)) {
    return templateCache.get(filePath)!
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    templateCache.set(filePath, content)
    return content
  } catch (error) {
    console.error(`Failed to read template: ${filePath}`, error)
    return ''
  }
}

/** 清除缓存（开发时热更新用） */
export function clearTemplateCache(): void {
  templateCache.clear()
}

// ============================================================================
// 模板处理
// ============================================================================

/**
 * 替换简单变量占位符 {{variable}}
 */
type TemplateValue = string | number | boolean | undefined

function replaceVariables(template: string, variables: Record<string, TemplateValue>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key]
    return value !== undefined ? String(value) : match
  })
}

/**
 * 处理条件块 {{#if variable}}...{{/if}}
 */
function processConditionals(template: string, variables: Record<string, TemplateValue>): string {
  return template.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, key, content) => {
      const value = variables[key]
      if (typeof value === 'boolean') {
        return value ? content : ''
      }
      return value !== undefined && value !== '' ? content : ''
    }
  )
}

/**
 * 组装完整模板
 */
function assembleTemplate(
  template: string,
  variables: TemplateVariables,
  overrides?: PromptOverrides
): string {
  // 1. 加载共享模块
  const knowledge = overrides?.shared?.knowledge ?? readTemplate(SHARED_FILES.knowledge)
  const rules = overrides?.shared?.rules ?? readTemplate(SHARED_FILES.rules)

  // 2. 替换共享模块占位符
  let result = template
    .replace(/\{\{knowledge\}\}/g, knowledge)
    .replace(/\{\{rules\}\}/g, rules)

  // 3. 处理条件块
  result = processConditionals(result, variables as Record<string, TemplateValue>)

  // 4. 替换变量占位符
  result = replaceVariables(result, variables as Record<string, TemplateValue>)

  return result.trim()
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 获取角色的 system prompt
 */
export function getRoleSystemPrompt(
  role: RoleType,
  overrides?: PromptOverrides
): string {
  const override = overrides?.roles?.[role]?.system
  if (override) return override

  return readTemplate(ROLE_FILES[role].system)
}

/**
 * 获取角色的 user prompt（带变量替换）
 */
export function getRoleUserPrompt(
  role: RoleType,
  variables: TemplateVariables,
  overrides?: PromptOverrides
): string {
  const override = overrides?.roles?.[role]?.user
  const template = override ?? readTemplate(ROLE_FILES[role].user)

  return assembleTemplate(template, variables, overrides)
}

/**
 * 获取共享模块内容
 */
export function getSharedModule(
  module: SharedModuleType,
  overrides?: PromptOverrides
): string {
  return overrides?.shared?.[module] ?? readTemplate(SHARED_FILES[module])
}

/**
 * 获取所有默认模板（用于前端展示）
 */
export function getAllDefaultTemplates(): {
  roles: Record<RoleType, { system: string; user: string }>
  shared: Record<SharedModuleType, string>
} {
  return {
    roles: {
      conceptDesigner: {
        system: readTemplate(ROLE_FILES.conceptDesigner.system),
        user: readTemplate(ROLE_FILES.conceptDesigner.user)
      },
      codeGeneration: {
        system: readTemplate(ROLE_FILES.codeGeneration.system),
        user: readTemplate(ROLE_FILES.codeGeneration.user)
      },
      codeRetry: {
        system: readTemplate(ROLE_FILES.codeRetry.system),
        user: readTemplate(ROLE_FILES.codeRetry.user)
      },
      codeEdit: {
        system: readTemplate(ROLE_FILES.codeEdit.system),
        user: readTemplate(ROLE_FILES.codeEdit.user)
      }
    },
    shared: {
      knowledge: readTemplate(SHARED_FILES.knowledge),
      rules: readTemplate(SHARED_FILES.rules)
    }
  }
}

// ============================================================================
// 兼容旧 API（过渡期使用）
// ============================================================================

/** @deprecated 使用 getRoleUserPrompt('conceptDesigner', { concept, seed }) */
export function generateConceptDesignerPrompt(
  concept: string,
  seed: string,
  outputMode: 'video' | 'image' = 'video'
): string {
  return getRoleUserPrompt('conceptDesigner', {
    concept,
    seed,
    outputMode,
    isImage: outputMode === 'image',
    isVideo: outputMode === 'video'
  })
}

/** @deprecated 使用 getRoleUserPrompt('codeGeneration', { concept, seed, sceneDesign }) */
export function generateCodeGenerationPrompt(
  concept: string,
  seed: string,
  sceneDesign?: string,
  outputMode: 'video' | 'image' = 'video'
): string {
  return getRoleUserPrompt('codeGeneration', {
    concept,
    seed,
    sceneDesign,
    outputMode,
    isImage: outputMode === 'image',
    isVideo: outputMode === 'video'
  })
}

/** @deprecated 使用 getRoleUserPrompt('codeRetry', { concept, errorMessage, code, attempt }) */
export function generateCodeFixPrompt(
  concept: string,
  errorMessage: string,
  code: string,
  attempt: number
): string {
  return getRoleUserPrompt('codeRetry', { concept, errorMessage, code, attempt })
}

/** @deprecated 使用 getRoleUserPrompt('codeEdit', { concept, instructions, code }) */
export function generateCodeEditPrompt(
  concept: string,
  instructions: string,
  code: string,
  outputMode: 'video' | 'image' = 'video'
): string {
  return getRoleUserPrompt('codeEdit', {
    concept,
    instructions,
    code,
    outputMode,
    isImage: outputMode === 'image',
    isVideo: outputMode === 'video'
  })
}
