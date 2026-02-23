/**
 * Code Retry Service - 工具函数
 */

/**
 * 从 AI 响应中提取代码
 */
export function extractCodeFromResponse(text: string, outputMode: 'video' | 'image' = 'video'): string {
  if (!text) return ''

  // 移除 think 标签
  const sanitized = text.replace(/<think>[\s\S]*?<\/think>/gi, '')

  if (outputMode === 'image') {
    const codeMatch = sanitized.match(/```(?:python)?([\s\S]*?)```/i)
    if (codeMatch) {
      return codeMatch[1].trim()
    }
    return sanitized.trim()
  }

  // 优先匹配锚点协议
  const anchorMatch = sanitized.match(/### START ###([\s\S]*?)### END ###/)
  if (anchorMatch) {
    return anchorMatch[1].trim()
  }

  // 匹配 Markdown 代码块
  const codeMatch = sanitized.match(/```(?:python)?([\s\S]*?)```/i)
  if (codeMatch) {
    return codeMatch[1].trim()
  }

  // 返回原始文本（去除首尾空白）
  return sanitized.trim()
}

/**
 * 从错误信息中提取错误类型
 */
export function getErrorType(stderr: string): string {
  if (!stderr) return 'Unknown'

  const errorPatterns = [
    { name: 'NameError', pattern: /NameError/i },
    { name: 'SyntaxError', pattern: /SyntaxError/i },
    { name: 'AttributeError', pattern: /AttributeError/i },
    { name: 'ImportError', pattern: /ImportError/i },
    { name: 'TypeError', pattern: /TypeError/i },
    { name: 'ValueError', pattern: /ValueError/i },
    { name: 'RuntimeError', pattern: /RuntimeError/i },
    { name: 'IndentationError', pattern: /IndentationError/i },
  ]

  for (const { name, pattern } of errorPatterns) {
    if (pattern.test(stderr)) {
      return name
    }
  }

  return 'Unknown'
}

/**
 * 从错误信息中提取完整错误描述（包含类型）
 */
export function extractErrorMessage(stderr: string): string {
  if (!stderr) return 'Unknown error'

  // 提取最后一行错误信息
  const lines = stderr.trim().split('\n')
  const lastLine = lines[lines.length - 1]?.trim()

  return lastLine || stderr.slice(0, 500)
}
