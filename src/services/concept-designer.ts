/**
 * 概念设计者服务 - 两阶段 AI 生成架构
 * 第一阶段：设计者/思考者 - 将抽象概念转化为详细的场景设计方案
 * 第二阶段：代码生成者 - 将设计方案转化为 Manim 代码
 */

import OpenAI from 'openai'
import crypto from 'crypto'
import { createLogger } from '../utils/logger'
import { SYSTEM_PROMPTS, generateConceptDesignerPrompt, generateCodeGenerationPrompt, getSharedModule } from '../prompts'
import type { CustomApiConfig, PromptOverrides, ReferenceImage, VisionImageDetail } from '../types'

const logger = createLogger('ConceptDesigner')

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'glm-4-flash'
const DESIGNER_TEMPERATURE = parseFloat(process.env.DESIGNER_TEMPERATURE || '0.8')
const CODER_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '1200', 10)
const DESIGNER_MAX_TOKENS = parseInt(process.env.DESIGNER_MAX_TOKENS || '800', 10)
const OPENAI_TIMEOUT = parseInt(process.env.OPENAI_TIMEOUT || '600000', 10)

const CUSTOM_API_URL = process.env.CUSTOM_API_URL?.trim()

let openaiClient: OpenAI | null = null

try {
  const baseConfig = {
    timeout: OPENAI_TIMEOUT,
    defaultHeaders: {
      'User-Agent': 'ManimCat/1.0'
    }
  }

  if (CUSTOM_API_URL) {
    openaiClient = new OpenAI({
      ...baseConfig,
      baseURL: CUSTOM_API_URL,
      apiKey: process.env.OPENAI_API_KEY
    })
  } else {
    openaiClient = new OpenAI(baseConfig)
  }
} catch (error) {
  logger.warn('OpenAI 客户端初始化失败', { error })
}

/**
 * 创建自定义 OpenAI 客户端
 */
function createCustomClient(config: CustomApiConfig): OpenAI {
  return new OpenAI({
    baseURL: config.apiUrl.trim().replace(/\/+$/, ''),
    apiKey: config.apiKey,
    timeout: OPENAI_TIMEOUT,
    defaultHeaders: {
      'User-Agent': 'ManimCat/1.0'
    }
    })
}

/**
 * 基于概念和时间戳生成唯一种子
 */
function generateUniqueSeed(concept: string): string {
  const timestamp = Date.now()
  const randomPart = crypto.randomBytes(4).toString('hex')
  return crypto.createHash('md5').update(`${concept}-${timestamp}-${randomPart}`).digest('hex').slice(0, 8)
}

function applyPromptTemplate(
  template: string,
  values: Record<string, string>,
  promptOverrides?: PromptOverrides
): string {
  let output = template

  // 替换共享模块占位符
  output = output.replace(/\{\{knowledge\}\}/g, getSharedModule('knowledge', promptOverrides))
  output = output.replace(/\{\{rules\}\}/g, getSharedModule('rules', promptOverrides))

  // 替换变量占位符
  for (const [key, value] of Object.entries(values)) {
    output = output.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value || '')
  }
  return output
}

/**
 * 构建包含图片的用户消息（Vision API 格式）
 */
function buildVisionUserMessage(
  userPrompt: string,
  referenceImages?: ReferenceImage[]
): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: VisionImageDetail } }> {
  if (!referenceImages || referenceImages.length === 0) {
    return userPrompt
  }

  return [
    {
      type: 'text' as const,
      text: `${userPrompt}\n\n你还会收到参考图片。请根据图片中显示的对象、结构和关系来设计动画。`
    },
    ...referenceImages.map((image) => ({
      type: 'image_url' as const,
      image_url: {
        url: image.url,
        detail: image.detail || 'auto'
      }
    }))
  ]
}

/**
 * 判断是否应该在不带图片的情况下重试
 */
function shouldRetryWithoutImages(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) {
    return false
  }

  // 服务器错误不重试
  if (error.status && error.status >= 500) {
    return false
  }

  // 检查错误信息是否与图片/视觉相关
  return /image|vision|multimodal|content.?part|unsupported/i.test(error.message || '')
}

function extractDesignFromResponse(text: string): string {
  if (!text) return ''
  const sanitized = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const match = sanitized.match(/<design>([\s\S]*?)<\/design>/i)
  if (match) {
    return match[1].trim()
  }
  return sanitized.trim()
}

function extractCodeFromResponse(text: string): string {
  if (!text) return ''
  const sanitized = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const anchorMatch = sanitized.match(/### START ###([\s\S]*?)### END ###/)
  if (anchorMatch) {
    return anchorMatch[1].trim()
  }
  const codeMatch = sanitized.match(/```(?:python)?([\s\S]*?)```/i)
  if (codeMatch) {
    return codeMatch[1].trim()
  }
  return sanitized.trim()
}

/**
 * 清洗设计方案文本
 */
interface CleanDesignResult {
  text: string
  changes: string[]
}

function cleanDesignText(text: string): CleanDesignResult {
  const changes: string[] = []
  let cleaned = text

  // 移除多余的空白行
  const beforeLength = cleaned.length
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  if (cleaned.length !== beforeLength) {
    changes.push('remove-extra-newlines')
  }

  // 移除首尾空白
  cleaned = cleaned.trim()

  return { text: cleaned, changes }
}

/**
 * 阶段1：设计者/思考者
 * 接收用户的抽象概念，输出详细的场景设计方案
 */
async function generateSceneDesign(
  concept: string,
  customApiConfig?: CustomApiConfig,
  promptOverrides?: PromptOverrides,
  referenceImages?: ReferenceImage[]
): Promise<string> {
  const client = customApiConfig ? createCustomClient(customApiConfig) : openaiClient

  if (!client) {
    logger.warn('OpenAI 客户端不可用')
    return ''
  }

  try {
    const seed = generateUniqueSeed(concept)

    const systemPrompt = promptOverrides?.roles?.conceptDesigner?.system || SYSTEM_PROMPTS.conceptDesigner
    const userPromptOverride = promptOverrides?.roles?.conceptDesigner?.user
    const userPrompt = userPromptOverride
      ? applyPromptTemplate(userPromptOverride, { concept, seed }, promptOverrides)
      : generateConceptDesignerPrompt(concept, seed)

    logger.info('开始阶段1：生成场景设计方案', { concept, seed, hasImages: !!referenceImages?.length })

    const model = customApiConfig?.model?.trim() || OPENAI_MODEL

    let response: Awaited<ReturnType<typeof client.chat.completions.create>>

    try {
      response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: buildVisionUserMessage(userPrompt, referenceImages) }
        ],
        temperature: DESIGNER_TEMPERATURE,
        max_tokens: DESIGNER_MAX_TOKENS
      })
    } catch (error) {
      // 如果模型不支持图片，尝试不带图片重试
      if (referenceImages && referenceImages.length > 0 && shouldRetryWithoutImages(error)) {
        logger.warn('模型不支持图片输入，使用纯文本重试', {
          concept,
          seed,
          error: error instanceof Error ? error.message : String(error)
        })
        response = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: DESIGNER_TEMPERATURE,
          max_tokens: DESIGNER_MAX_TOKENS
        })
      } else {
        throw error
      }
    }

    const content = response.choices[0]?.message?.content || ''
    if (!content) {
      logger.warn('设计者返回空内容')
      return ''
    }

    const extractedDesign = extractDesignFromResponse(content)
    const cleanedDesign = cleanDesignText(extractedDesign)
    if (cleanedDesign.changes.length > 0) {
      logger.info('设计方案已清洗', {
        concept,
        seed,
        changes: cleanedDesign.changes,
        originalLength: content.length,
        cleanedLength: cleanedDesign.text.length
      })
    }

    if (!cleanedDesign.text) {
      logger.warn('设计者返回空方案')
      return ''
    }

    logger.info('阶段1：场景设计方案生成成功', {
      concept,
      seed,
      designLength: cleanedDesign.text.length,
      design: cleanedDesign.text
    })

    return cleanedDesign.text
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error('设计者 API 错误', {
        concept,
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message
      })
    } else if (error instanceof Error) {
      logger.error('设计者生成失败', {
        concept,
        errorName: error.name,
        errorMessage: error.message
      })
    } else {
      logger.error('设计者生成失败（未知错误）', { concept, error: String(error) })
    }
    return ''
  }
}

/**
 * 阶段2：代码生成者
 * 接收场景设计方案，输出 Manim 代码
 */
async function generateCodeFromDesign(
  concept: string,
  sceneDesign: string,
  customApiConfig?: CustomApiConfig,
  promptOverrides?: PromptOverrides
): Promise<string> {
  const client = customApiConfig ? createCustomClient(customApiConfig) : openaiClient

  if (!client) {
    logger.warn('OpenAI 客户端不可用')
    return ''
  }

  try {
    const seed = generateUniqueSeed(`${concept}-${sceneDesign.slice(0, 20)}`)

    const systemPrompt = promptOverrides?.roles?.codeGeneration?.system || SYSTEM_PROMPTS.codeGeneration
    const userPromptOverride = promptOverrides?.roles?.codeGeneration?.user
    const userPrompt = userPromptOverride
      ? applyPromptTemplate(userPromptOverride, { concept, seed, sceneDesign }, promptOverrides)
      : generateCodeGenerationPrompt(concept, seed, sceneDesign)

    logger.info('开始阶段2：根据设计方案生成代码', { concept, seed })

    const model = customApiConfig?.model?.trim() || OPENAI_MODEL

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: CODER_TEMPERATURE,
      max_tokens: MAX_TOKENS
    })

    const content = response.choices[0]?.message?.content || ''
    if (!content) {
      logger.warn('代码生成者返回空内容')
      return ''
    }

    logger.info('阶段2：代码生成成功', {
      concept,
      seed,
      codeLength: content.length,
      code: content
    })

    return content
  } catch (error) {
    // ✅ 正确：将完整的判断表达式放在括号内
    if (error instanceof OpenAI.APIError) {
      logger.error('代码生成者 API 错误', {
        concept,
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message
      })
    } else if (error instanceof Error) {
      logger.error('代码生成者失败', {
        concept,
        errorName: error.name,
        errorMessage: error.message
      })
    } else {
      logger.error('代码生成者失败（未知错误）', { concept, error: String(error) })
    }
    return ''
  }

}

/**
 * 两阶段 AI 生成
 * 1. 设计者生成场景设计方案
 * 2. 代码生成者根据设计方案生成代码
 */
export async function generateTwoStageAIManimCode(
  concept: string,
  customApiConfig?: CustomApiConfig,
  promptOverrides?: PromptOverrides,
  referenceImages?: ReferenceImage[]
): Promise<{ code: string; sceneDesign: string }>
 {
  logger.info('开始两阶段 AI 生成流程', { concept, hasImages: !!referenceImages?.length })

  // 阶段1：生成场景设计方案（支持图片）
  const sceneDesign = await generateSceneDesign(concept, customApiConfig, promptOverrides, referenceImages)

  if (!sceneDesign) {
    logger.warn('场景设计方案生成失败，中止流程')
    return { code: '', sceneDesign: '' }
  }

  // 阶段2：根据设计方案生成代码
  const code = await generateCodeFromDesign(concept, sceneDesign, customApiConfig, promptOverrides)

  logger.info('两阶段 AI 生成流程完成', {
    concept,
    hasSceneDesign: !!sceneDesign,
    hasCode: !!code
  })

  return { code, sceneDesign }
}

/**
 * 检查 OpenAI 客户端是否可用
 */
export function isOpenAIAvailable(): boolean {
  return openaiClient !== null
}
