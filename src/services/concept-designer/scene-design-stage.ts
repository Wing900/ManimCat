import OpenAI from 'openai'
import { createLogger } from '../../utils/logger'
import { SYSTEM_PROMPTS, generateConceptDesignerPrompt } from '../../prompts'
import type { OutputMode, PromptOverrides, ReferenceImage } from '../../types'
import {
  applyPromptTemplate,
  buildCompletionDiagnostics,
  buildVisionUserMessage,
  cleanDesignText,
  extractDesignFromResponse,
  generateUniqueSeed,
  normalizeMessageContent,
  shouldRetryWithoutImages
} from '../concept-designer-utils'

const logger = createLogger('SceneDesignStage')

interface SceneDesignStageParams {
  client: OpenAI
  concept: string
  outputMode: OutputMode
  model: string
  promptOverrides?: PromptOverrides
  referenceImages?: ReferenceImage[]
  designerTemperature: number
  designerMaxTokens: number
}

export async function generateSceneDesignStage(params: SceneDesignStageParams): Promise<string> {
  const {
    client,
    concept,
    outputMode,
    model,
    promptOverrides,
    referenceImages,
    designerTemperature,
    designerMaxTokens
  } = params

  try {
    const seed = generateUniqueSeed(concept)
    const systemPrompt = promptOverrides?.roles?.conceptDesigner?.system || SYSTEM_PROMPTS.conceptDesigner
    const userPromptOverride = promptOverrides?.roles?.conceptDesigner?.user
    const userPrompt = userPromptOverride
      ? applyPromptTemplate(userPromptOverride, { concept, seed, outputMode }, promptOverrides)
      : generateConceptDesignerPrompt(concept, seed, outputMode)

    logger.info('开始阶段1：生成场景设计方案', {
      concept,
      outputMode,
      seed,
      hasImages: !!referenceImages?.length
    })

    let response: Awaited<ReturnType<typeof client.chat.completions.create>>

    try {
      response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: buildVisionUserMessage(userPrompt, referenceImages) }
        ],
        temperature: designerTemperature,
        max_tokens: designerMaxTokens
      })
    } catch (error) {
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
          temperature: designerTemperature,
          max_tokens: designerMaxTokens
        })
      } else {
        throw error
      }
    }

    const content = normalizeMessageContent(response.choices[0]?.message?.content)
    if (!content) {
      logger.warn('设计者返回空内容', {
        concept,
        seed,
        model,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        diagnostics: buildCompletionDiagnostics(response)
      })
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
      designLength: cleanedDesign.text.length
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
