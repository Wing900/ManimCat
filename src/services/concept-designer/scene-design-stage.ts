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
    onCheckpoint
  } = params

  try {
    const seed = generateUniqueSeed(concept)
    const systemPrompt = getRoleSystemPrompt('conceptDesigner', promptOverrides)
    const userPromptOverride = promptOverrides?.roles?.conceptDesigner?.user
    const userPrompt = userPromptOverride
      ? applyPromptTemplate(userPromptOverride, { concept, seed, outputMode }, promptOverrides)
      : generateConceptDesignerPrompt(concept, seed, outputMode)

    logger.info('\u5F00\u59CB\u9636\u6BB51\uFF1A\u751F\u6210\u573A\u666F\u8BBE\u8BA1\u65B9\u6848', {
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
          max_tokens: designerMaxTokens
        },
        { fallbackToNonStream: true, usageLabel: 'scene-design' }
      )
      content = completion.content
      mode = completion.mode
      fallbackResponse = completion.response
    } catch (error) {
      if (referenceImages && referenceImages.length > 0 && shouldRetryWithoutImages(error)) {
        logger.warn('\u6A21\u578B\u4E0D\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u4F7F\u7528\u7EAF\u6587\u672C\u91CD\u8BD5', {
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
            max_tokens: designerMaxTokens
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
      logger.warn('\u8BBE\u8BA1\u8005\u8FD4\u56DE\u7A7A\u5185\u5BB9', {
        concept,
        seed,
        mode,
        model,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        diagnostics: fallbackResponse ? buildCompletionDiagnostics(fallbackResponse) : { mode: 'stream' }
      })
      return ''
    }

    const extractedDesign = extractDesignFromResponse(normalizedContent)
    const cleanedDesign = cleanDesignText(extractedDesign)
    if (cleanedDesign.changes.length > 0) {
      logger.info('\u8BBE\u8BA1\u65B9\u6848\u5DF2\u6E05\u6D17', {
        concept,
        seed,
        mode,
        changes: cleanedDesign.changes,
        originalLength: normalizedContent.length,
        cleanedLength: cleanedDesign.text.length
      })
    }

    if (!cleanedDesign.text) {
      logger.warn('\u8BBE\u8BA1\u8005\u8FD4\u56DE\u7A7A\u65B9\u6848')
      return ''
    }

    logger.info('\u9636\u6BB51\uFF1A\u573A\u666F\u8BBE\u8BA1\u65B9\u6848\u751F\u6210\u6210\u529F', {
      concept,
      seed,
      mode,
      designLength: cleanedDesign.text.length
    })

    return cleanedDesign.text
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error('\u8BBE\u8BA1\u8005 API \u9519\u8BEF', {
        concept,
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message
      })
    } else if (error instanceof Error) {
      logger.error('\u8BBE\u8BA1\u8005\u751F\u6210\u5931\u8D25', {
        concept,
        errorName: error.name,
        errorMessage: error.message
      })
    } else {
      logger.error('\u8BBE\u8BA1\u8005\u751F\u6210\u5931\u8D25\uFF08\u672A\u77E5\u9519\u8BEF\uFF09', { concept, error: String(error) })
    }
    return ''
  }
}
