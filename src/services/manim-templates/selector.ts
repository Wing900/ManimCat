import { createLogger } from '../../utils/logger'
import { templateMappings } from './mappings'

const logger = createLogger('ManimTemplates')

/**
 * 模板匹配阈值 - 设置得很高以优先考虑 AI 生成（获得独特的输出）
 * 0.75 要求非常强的关键词匹配才能使用模板
 */
export const TEMPLATE_MATCH_THRESHOLD = 0.75

/**
 * 计算模板的匹配分数
 * 返回 0 到 1 之间的分数，越高越好
 */
export function calculateMatchScore(concept: string, keywords: string[]): number {
  const lowerConcept = concept.toLowerCase().trim()
  const words = lowerConcept.split(/\s+/)

  let matchedKeywords = 0
  let totalKeywordWords = 0

  for (const keyword of keywords) {
    const keywordWords = keyword.toLowerCase().split(/\s+/)
    totalKeywordWords += keywordWords.length

    const allWordsMatch = keywordWords.every((kw) =>
      words.some((w) => w.includes(kw) || kw.includes(w))
    )

    if (allWordsMatch) {
      matchedKeywords += keywordWords.length
    }
  }

  const keywordScore = totalKeywordWords > 0 ? matchedKeywords / totalKeywordWords : 0

  const conceptComplexity = words.length
  let complexityPenalty = 1.0

  if (conceptComplexity > 8) {
    complexityPenalty = 0.4
  } else if (conceptComplexity > 5) {
    complexityPenalty = 0.6
  }

  const allKeywordWords = keywords.flatMap((k) => k.toLowerCase().split(/\s+/))
  const unmatchedWords = words.filter(
    (w) => !allKeywordWords.some((kw) => w.includes(kw) || kw.includes(w))
  )
  const specificityPenalty = unmatchedWords.length > 3 ? 0.8 : 1.0

  return keywordScore * complexityPenalty * specificityPenalty
}

/**
 * 根据概念关键词选择合适的模板
 * 只有在置信度非常高（>0.75）时才返回模板
 * 这确保大多数查询会交给 AI 以获得独特的动画
 */
export function selectTemplate(concept: string): { code: string; templateName: string } | null {
  const lowerConcept = concept.toLowerCase().trim()

  let bestMatch: (() => string) | null = null
  let bestTemplateName = ''
  let bestScore = 0

  for (const [templateName, templateInfo] of Object.entries(templateMappings)) {
    const score = calculateMatchScore(lowerConcept, templateInfo.keywords)
    if (score > bestScore) {
      bestScore = score
      bestMatch = templateInfo.generator
      bestTemplateName = templateName
    }
  }

  if (bestMatch && bestScore > TEMPLATE_MATCH_THRESHOLD) {
    try {
      return { code: bestMatch(), templateName: bestTemplateName }
    } catch (error) {
      logger.error('生成模板时出错', { error })
      return null
    }
  }

  return null
}

/**
 * 获取模板匹配信息而不生成代码（用于日志/调试）
 */
export function getTemplateMatchInfo(
  concept: string
): { bestTemplate: string; bestScore: number; threshold: number } {
  const lowerConcept = concept.toLowerCase().trim()
  let bestTemplate = ''
  let bestScore = 0

  for (const [templateName, templateInfo] of Object.entries(templateMappings)) {
    const score = calculateMatchScore(lowerConcept, templateInfo.keywords)
    if (score > bestScore) {
      bestScore = score
      bestTemplate = templateName
    }
  }

  return { bestTemplate, bestScore, threshold: TEMPLATE_MATCH_THRESHOLD }
}
