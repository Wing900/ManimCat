/**
 * OpenAI Client Service
 * Handles AI-powered Manim code generation
 * Using GPT-4.1 nano - OpenAI's fastest model (95.9 tokens/sec, <5s to first token)
 * Supports custom API endpoints via CUSTOM_API_URL and CUSTOM_API_KEY env variables
 */

import OpenAI from 'openai'
import crypto from 'crypto'
import { createLogger } from '../utils/logger'

const logger = createLogger('OpenAIClient')

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'glm-4-flash'
const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '1200', 10)

const CUSTOM_API_URL = process.env.CUSTOM_API_URL?.trim()

let openaiClient: OpenAI | null = null

try {
  if (CUSTOM_API_URL) {
    openaiClient = new OpenAI({
      baseURL: CUSTOM_API_URL,
      apiKey: process.env.OPENAI_API_KEY
    })
  } else {
    openaiClient = new OpenAI()
  }
} catch (error) {
  logger.warn('OpenAI client initialization failed', { error })
}

/**
 * Generate a unique seed based on concept and timestamp
 * This helps ensure different outputs for similar concepts
 */
function generateUniqueSeed(concept: string): string {
  const timestamp = Date.now()
  const randomPart = crypto.randomBytes(4).toString('hex')
  return crypto.createHash('md5').update(`${concept}-${timestamp}-${randomPart}`).digest('hex').slice(0, 8)
}

/**
 * Generate an optimized prompt for unique Manim code generation
 * Includes variation instructions to avoid repetitive outputs
 */
function generateManimPrompt(concept: string, seed: string): string {
  return `为以下概念创建一个独特的 Manim 动画：${concept}

生成种子：${seed}（使用此种子激发创意变化）

要求：
- 使用 MainScene 类（3D 概念使用 ThreeDScene）
- 使用 MathTex 显示 LaTeX 公式
- 清晰的分步可视化过程
- 用不同颜色标记元素，每次选择不同的配色方案
- 使用 self.wait() 创建流畅的动画节奏
- 创意性的位置布局和动画时序
- 添加增强理解的独特视觉元素

重要：生成全新的、独特的动画。请变化：
- 动画时序和播放顺序
- 配色方案（每次选择不同的颜色）
- 对象的位置和排列方式
- 文本标签和说明文字
- 视觉效果和过渡动画

只输出有效的 Python 代码，不要包含 markdown 格式。`
}

/**
 * Extract code from AI response (handles markdown code blocks)
 */
function extractCodeFromResponse(text: string): string {
  if (!text) return ''

  // Try fenced code blocks with language
  const match = text.match(/```(?:python)?\n([\s\S]*?)```/i)
  if (match) {
    return match[1].trim()
  }

  return text.trim()
}

/**
 * Generate Manim code using OpenAI
 * Uses higher temperature for varied outputs and unique seed for each request
 */
export async function generateAIManimCode(concept: string): Promise<string> {
  if (!openaiClient) {
    logger.warn('OpenAI client not available')
    return ''
  }

  try {
    const seed = generateUniqueSeed(concept)

    const systemPrompt = `你是一位 Manim 动画专家，专门创作独特的数学动画。
每个动画都应该在视觉上与众不同，使用创意性的配色、布局和时序。
只输出有效的 Python 代码，不要包含 markdown 或解释说明。
始终使用 MainScene 作为类名。`

    const userPrompt = generateManimPrompt(concept, seed)

    const response = await openaiClient.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: AI_TEMPERATURE,
      max_tokens: MAX_TOKENS
    })

    const content = response.choices[0]?.message?.content || ''
    if (!content) {
      logger.warn('AI returned empty content')
      return ''
    }

    return extractCodeFromResponse(content)
  } catch (error) {
    logger.error('AI generation failed', { error })
    if (error instanceof Error) {
      logger.error('Error details', { name: error.name, message: error.message })
    }
    return ''
  }
}

/**
 * Check if OpenAI client is available
 */
export function isOpenAIAvailable(): boolean {
  return openaiClient !== null
}
