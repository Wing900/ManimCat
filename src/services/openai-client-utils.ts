import crypto from 'crypto'
import { API_INDEX, SOUL_INDEX } from '../prompts/api-index'

export const OPENAI_MANIM_SYSTEM_PROMPT = `你是一位 Manim 动画专家，专注于通过动态动画深度解读数学概念。
严格按照提示词规范输出，确保代码符合 Manim Community Edition (v0.19.2) 的最佳实践。

## System Knowledge (Auto-Injected)

\`\`\`python
${API_INDEX}

# Supplemental
${SOUL_INDEX}
\`\`\`
`

/**
 * 基于概念和时间戳生成唯一种子
 * 这有助于确保相似概念产生不同的输出
 */
export function generateUniqueSeed(concept: string): string {
  const timestamp = Date.now()
  const randomPart = crypto.randomBytes(4).toString('hex')
  return crypto.createHash('md5').update(`${concept}-${timestamp}-${randomPart}`).digest('hex').slice(0, 8)
}

/**
 * 生成用于生成唯一 Manim 代码的优化 prompt
 * 包含变化指令以避免重复输出
 */
export function generateManimPrompt(concept: string, seed: string): string {
  return `## 目标层

### 输入预期

- **${concept}**: 用户输入的数学概念或可视化需求。
- **${seed}**: 随机种子（用于在保持逻辑严谨的前提下，对布局和细节进行微调）。

### 产出要求

- **纯代码输出**：**严禁**输出 Markdown 代码块标识符（如 \`\`\`python），**严禁**包含任何解释性文字。输出内容应能直接作为 \`.py\` 文件运行。
- **结构规范**：核心类名固定为 \`MainScene\`（若为 3D 场景则继承自 \`ThreeDScene\`）。
- **逻辑表达**：必须通过动态动画（不仅仅是静态展示）来深度解读 \`${concept}\` 的数学内涵。
- **锚点协议**：输出必须以 \`### START ###\` 开始，以 \`### END ###\` 结束。这两个锚点之间**只允许出现代码**。

## 知识层

### 环境背景

- **版本**：Manim Community Edition (v0.19.2)。
- **核心逻辑**：基于向量化绘图，强调 \`.animate\` 链式调用。

## 行为层

### 工作流 (CoT)

1. **深度概念解读**：首先分析 \`${concept}\` 的核心逻辑。它是一个公式的推导？还是一个几何性质的证明？
2. **视觉隐喻设计**：根据概念选择最能直观表达其内涵的图形（如：导数对应切线，积分对应面积）。
3. **理性配色方案 (Rational Coloring)**：
   - **逻辑关联性**：具有相同数学含义的元素必须使用相同或相近的颜色。
   - **视觉对比度**：重点强调的元素（如目标结论）使用高饱和度颜色（如 \`YELLOW\` 或 \`PURE_RED\`），辅助元素使用低对比度颜色（如 \`GRAY\` 或 \`BLUE_E\`）。
4. **代码实现**：对照 API 索引表，确保每个方法的参数合法。

### 技术原则

- **动态更新**：对于涉及数值变化的过程，优先使用 \`ValueTracker\` 和 \`always_redraw\`。
- **公式操作规范**：禁止使用硬编码索引，必须通过 \`substrings_to_isolate\` 配合 \`get_part_by_tex\` 来操作公式的特定部分。
- **坐标系一致性**：所有图形必须通过 \`axes.c2p\` 映射到坐标轴上，严禁脱离坐标系的!自由定位。
- **避障布局**：必须明确文字、标签、公式相对于主体的空间位置（优先使用 \`next_to(obj, direction, buff=...) \` 或 \`shift\`），严禁多个文字元素在视觉上重叠。对于复杂场景，应预先计算好每个标注的方位。

## 规范层

### 严禁行为

- **严禁解释**：禁止在代码前后添加任何类似 "Sure, here is your code" 的废话。
- **严禁 Markdown**：禁止使用 Markdown 语法包装代码。
- **严禁旧语法**：禁止使用 \`ShowCreation\`, \`TextMobject\`, \`TexMobject\`, \`number_scale_val\`。
- **严禁缩进污染**：所有代码行必须按照标准的 Python 缩进规则生成，第一行代码（import行）必须从第 0 列开始，禁止任何前缀空格。你的输出必须直接以 \`from manim import *\` 开头，严禁任何前导字符、空格或换行。

### 错误纠正

- **索引陷阱**：严禁对 \`MathTex\` 使用 \`[i]\` 索引。
- **配置字典**：严禁直接在 \`Axes\` 初始化中传入视觉参数，必须封装在 \`axis_config\` 中。
- **虚线陷阱**：严禁在 \`plot()\`, \`Line()\`, \`Circle()\` 等普通绘图函数中直接使用 \`dash_length\` 或 \`dashed_ratio\` 参数。若需虚线，必须使用 \`DashedLine\` 类或 \`DashedVMobject\` 包装。

## 协议层

### 视觉审美风格 (影响行为层)

- **专业数学感**：模仿经典数学专著的视觉风格，背景统一使用深色调（如 \`DARK_GRAY\` 或 \`BLACK\`）。
- **微调逻辑 (\${seed} 驱动)**：种子值仅用于微调相机的初始角度、背景网格的细微透明度或动画的微小延迟，不应改变核心数学逻辑和配色逻辑。

### 注释规范

- **严禁注释说明**：禁止在代码中使用 # 编写任何注释，禁止使用 """ 编写文档字符串。`
}

/**
 * 从 AI 响应中提取代码（处理 markdown 代码块）
 */
export function extractCodeFromResponse(text: string): string {
  if (!text) return ''

  const withoutThink = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const anchorMatch = withoutThink.match(/### START ###\n([\s\S]*?)\n### END ###/)
  if (anchorMatch) {
    return anchorMatch[1].trim()
  }

  const match = withoutThink.match(/```(?:python)?\n([\s\S]*?)```/i)
  if (match) {
    return match[1].trim()
  }

  return withoutThink.trim()
}
