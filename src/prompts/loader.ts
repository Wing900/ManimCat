/**
 * 提示词模板加载器
 * 读取 .md 模板文件，替换占位符，组装最终提示词
 */

import fs from 'fs'
import path from 'path'
import { API_INDEX, SOUL_INDEX } from './api-index'

// 使用项目根目录，兼容开发和生产环境
const TEMPLATES_DIR = path.join(process.cwd(), 'src', 'prompts', 'templates')
const ENGLISH_TEMPLATES_DIR = path.join(TEMPLATES_DIR, 'en-US')

// ============================================================================
// 类型定义
// ============================================================================

/** 角色类型 */
export type RoleType = 'problemFraming' | 'conceptDesigner' | 'codeGeneration' | 'codeRetry' | 'codeEdit'
export type PromptLocale = 'zh-CN' | 'en-US'

/** 共享模块类型 */
export type SharedModuleType = 'apiIndex' | 'specification'

/** 模板变量 */
export interface TemplateVariables {
  concept?: string
  seed?: string
  sceneDesign?: string
  feedbackHistory?: string
  errorMessage?: string
  attempt?: number
  instructions?: string
  code?: string
  codeSnippet?: string
  outputMode?: 'video' | 'image'
  isImage?: boolean
  isVideo?: boolean
}

/** 提示词覆盖配置 */
export interface PromptOverrides {
  locale?: PromptLocale
  roles?: Partial<Record<RoleType, { system?: string; user?: string }>>
  shared?: Partial<Record<SharedModuleType, string>>
}

// ============================================================================
// 文件路径
// ============================================================================

const ROLE_FILE_RELATIVE_PATHS: Record<RoleType, { system: string; user: string }> = {
  problemFraming: {
    system: path.join('roles', 'problem-framing.system.md'),
    user: path.join('roles', 'problem-framing.md')
  },
  conceptDesigner: {
    system: path.join('roles', 'concept-designer.system.md'),
    user: path.join('roles', 'concept-designer.md')
  },
  codeGeneration: {
    system: path.join('roles', 'code-generation.system.md'),
    user: path.join('roles', 'code-generation.md')
  },
  codeRetry: {
    system: path.join('roles', 'code-retry.system.md'),
    user: path.join('roles', 'code-retry.md')
  },
  codeEdit: {
    system: path.join('roles', 'code-edit.system.md'),
    user: path.join('roles', 'code-edit.md')
  }
}

const SHARED_FILE_RELATIVE_PATHS: Record<SharedModuleType, string> = {
  apiIndex: path.join('shared', 'api-index.md'),
  specification: path.join('shared', 'specification.md')
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

function resolveLocale(overrides?: PromptOverrides): PromptLocale {
  return overrides?.locale === 'en-US' ? 'en-US' : 'zh-CN'
}

function resolveTemplateFile(relativePath: string, locale: PromptLocale): string {
  if (locale === 'en-US') {
    const localizedPath = path.join(ENGLISH_TEMPLATES_DIR, relativePath)
    if (fs.existsSync(localizedPath)) {
      return localizedPath
    }
  }

  return path.join(TEMPLATES_DIR, relativePath)
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

/**
 * 纯文本占位符替换。
 * 不用 String.replace，因为替换串里的 $`、$'、$&、$1 等会被解释成特殊语义
 * （例如 API 索引里的 LaTeX `$...$` 含 $`，会把匹配点之前的全文插入进来）。
 */
function replaceLiteral(source: string, placeholder: string, value: string): string {
  return source.split(placeholder).join(value)
}

function resolveIndexPlaceholders(template: string): string {
  return replaceLiteral(
    replaceLiteral(template, '{{apiIndex}}', API_INDEX.trim()),
    '{{soulIndex}}',
    SOUL_INDEX.trim()
  )
}

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
  const apiIndex = getSharedModule('apiIndex', overrides)
  const specification = getSharedModule('specification', overrides)

  // 2. 替换共享模块占位符
  let result = replaceLiteral(
    replaceLiteral(template, '{{apiIndexModule}}', apiIndex),
    '{{sharedSpecification}}',
    specification
  )

  // 3. 处理条件块
  result = processConditionals(result, variables as Record<string, TemplateValue>)

  // 4. 替换变量占位符
  result = replaceVariables(result, variables as Record<string, TemplateValue>)

  // 5. 解析索引占位符（用于 shared 模板与 override）
  result = resolveIndexPlaceholders(result)

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
  const locale = resolveLocale(overrides)
  const basePrompt = override ?? readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS[role].system, locale))
  return assembleTemplate(basePrompt, {}, overrides)
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
  const locale = resolveLocale(overrides)
  const template = override ?? readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS[role].user, locale))

  return assembleTemplate(template, variables, overrides)
}

/**
 * 获取共享模块内容
 */
export function getSharedModule(
  module: SharedModuleType,
  overrides?: PromptOverrides
): string {
  const locale = resolveLocale(overrides)
  const raw = overrides?.shared?.[module] ?? readTemplate(resolveTemplateFile(SHARED_FILE_RELATIVE_PATHS[module], locale))
  return resolveIndexPlaceholders(raw)
}

/**
 * 获取所有默认模板（用于前端展示）
 */
export function getAllDefaultTemplates(locale: PromptLocale = 'zh-CN'): {
  roles: Record<RoleType, { system: string; user: string }>
  shared: Record<SharedModuleType, string>
} {
  const localizedOverrides: PromptOverrides = { locale }

  return {
    roles: {
      problemFraming: {
        system: readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS.problemFraming.system, locale)),
        user: readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS.problemFraming.user, locale))
      },
      conceptDesigner: {
        system: readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS.conceptDesigner.system, locale)),
        user: readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS.conceptDesigner.user, locale))
      },
      codeGeneration: {
        system: readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS.codeGeneration.system, locale)),
        user: readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS.codeGeneration.user, locale))
      },
      codeRetry: {
        system: readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS.codeRetry.system, locale)),
        user: readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS.codeRetry.user, locale))
      },
      codeEdit: {
        system: readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS.codeEdit.system, locale)),
        user: readTemplate(resolveTemplateFile(ROLE_FILE_RELATIVE_PATHS.codeEdit.user, locale))
      }
    },
    shared: {
      apiIndex: getSharedModule('apiIndex', localizedOverrides),
      specification: getSharedModule('specification', localizedOverrides)
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
