import OpenAI from 'openai'
import { createLogger } from '../../utils/logger'
import { generateConceptDesignerPrompt, getRoleSystemPrompt } from '../../prompts'
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
import { createChatCompletionText } from '../openai-stream'
import { buildTokenParams } from '../../utils/reasoning-model'

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
  designerThinkingTokens: number
  onCheckpoint?: () => Promise<void>
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
    designerMaxTokens,
    designerThinkingTokens,
    onCheckpoint
  } = params

  try {
    const seed = generateUniqueSeed(concept)
    const systemPrompt = getRoleSystemPrompt('conceptDesigner', promptOverrides)
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

    let content = ''
    let mode: 'stream' | 'stream-partial' | 'non-stream' = 'stream'
    let fallbackResponse: OpenAI.Chat.Completions.ChatCompletion | undefined
    if (onCheckpoint) await onCheckpoint()

    try {
      const completion = await createChatCompletionText(
        client,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: buildVisionUserMessage(userPrompt, referenceImages) }
          ],
          temperature: designerTemperature,
          ...buildTokenParams(designerThinkingTokens, designerMaxTokens)
        },
        { fallbackToNonStream: true, usageLabel: 'scene-design' }
      )
      content = completion.content
      mode = completion.mode
      fallbackResponse = completion.response
    } catch (error) {
      if (referenceImages && referenceImages.length > 0 && shouldRetryWithoutImages(error)) {
        logger.warn('模型不支持图片输入，使用纯文本重试', {
          concept,
          seed,
          error: error instanceof Error ? error.message : String(error)
        })
        const completion = await createChatCompletionText(
          client,
          {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: designerTemperature,
            ...buildTokenParams(designerThinkingTokens, designerMaxTokens)
          },
          { fallbackToNonStream: true, usageLabel: 'scene-design-text-fallback' }
        )
        content = completion.content
        mode = completion.mode
        fallbackResponse = completion.response
      } else {
        throw error
      }
    }
    if (onCheckpoint) await onCheckpoint()

    const normalizedContent = normalizeMessageContent(content)
    if (!normalizedContent) {
      logger.warn('设计者返回空内容', {
        concept,
        seed,
        mode,
        model,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        diagnostics: fallbackResponse ? buildCompletionDiagnostics(fallbackResponse) : { mode: 'stream' }
      })
      throw new Error('Scene design stage returned empty content from AI response')
    }

    const extractedDesign = extractDesignFromResponse(normalizedContent)
    const cleanedDesign = cleanDesignText(extractedDesign)
    if (cleanedDesign.changes.length > 0) {
      logger.info('设计方案已清洗', {
        concept,
        seed,
        mode,
        changes: cleanedDesign.changes,
        originalLength: normalizedContent.length,
        cleanedLength: cleanedDesign.text.length
      })
    }

    if (!cleanedDesign.text) {
      logger.warn('设计者返回空方案')
      throw new Error('Scene design stage produced empty design after cleaning')
    }

    logger.info('阶段1：场景设计方案生成成功', {
      concept,
      seed,
      mode,
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
    throw new Error(`Scene design stage failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
