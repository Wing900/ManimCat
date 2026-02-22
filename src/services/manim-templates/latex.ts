// 用于检测的 LaTeX 命令模式
const LATEX_COMMAND_HINTS = [
  '\\frac', '\\sum', '\\int', '\\sqrt', '\\alpha', '\\beta',
  '\\pi', '\\sin', '\\cos', '\\tan', '\\left', '\\right'
]

const FALLBACK_MATH_EXPRESSION = 'x^2 + y^2 = 1'

function extractDelimitedLatex(text: string): string | null {
  const candidates: string[] = []

  for (const match of text.matchAll(/\$\$([\s\S]*?)\$\$/g)) {
    candidates.push(match[1])
  }
  for (const match of text.matchAll(/\$([\s\S]*?)\$/g)) {
    candidates.push(match[1])
  }
  for (const match of text.matchAll(/\\\(([\s\S]*?)\\\)/g)) {
    candidates.push(match[1])
  }
  for (const match of text.matchAll(/\\\[([\s\S]*?)\\\]/g)) {
    candidates.push(match[1])
  }

  if (!candidates.length) {
    return null
  }

  return candidates
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] ?? null
}

function sanitizeMathExpression(text: string): string {
  let t = text.trim()

  // 常见中文标点归一化
  t = t
    .replace(/[：]/g, ':')
    .replace(/[，]/g, ',')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[【]/g, '[')
    .replace(/[】]/g, ']')

  // 去除题号（例如：11.、11)、11、）
  t = t.replace(/^\s*\d+\s*[\.\)\]、．]\s*/, '')

  // 去除 CJK 文本，避免 MathTex 在 pdflatex 下因中文失败
  t = t.replace(/[\u3400-\u9FFF\uF900-\uFAFF]+/g, ' ')

  // MathTex 不应包含 $ 分隔符
  t = t.replace(/\$/g, '')

  // 空白归一化
  t = t.replace(/\s+/g, ' ').trim()

  return t
}

/**
 * 检查文本是否可能是 LaTeX 表达式
 */
export function isLikelyLatex(text: string): boolean {
  const t = text.trim()
  if (!t) return false

  // 检查常见的 LaTeX 分隔符
  if (['$$', '$', '\\(', '\\)', '\\[', '\\]'].some((d) => t.includes(d))) {
    return true
  }

  // 检查 LaTeX 命令
  if (LATEX_COMMAND_HINTS.some((cmd) => t.includes(cmd))) {
    return true
  }

  // 检查上标/下标模式
  if ((t.includes('^') || t.includes('_')) && !t.slice(0, 3).trim().includes(' ')) {
    return true
  }

  return false
}

/**
 * 清理 LaTeX 表达式，移除分隔符
 */
export function cleanLatex(text: string): string {
  let t = text.trim()

  const extracted = extractDelimitedLatex(t)
  if (extracted) {
    t = extracted
  }

  // 移除常见的分隔符
  t = t.replace(/^\$+|\$+$/g, '')
  t = t.replace(/^\\\(|\\\)$/g, '')
  t = t.replace(/^\\\[|\\\]$/g, '')

  t = sanitizeMathExpression(t)

  if (!t) {
    return FALLBACK_MATH_EXPRESSION
  }

  return t
}

/**
 * 为 LaTeX 表达式生成 Manim 代码
 */
export function generateLatexSceneCode(expr: string): string {
  const cleanedExpr = cleanLatex(expr)
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        title = Title('LaTeX')
        eq = MathTex(${JSON.stringify(cleanedExpr)}).scale(1.2)
        self.play(Write(title))
        self.play(Write(eq))
        self.wait()
`
}
