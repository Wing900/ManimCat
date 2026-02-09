/**
 * Manim Code Generation Prompts
 * 提示词管理 - 与代码逻辑分离，便于维护
 *
 * 结构说明：
 * - system/  : system prompt 模板
 * - user/    : user prompt 模板
 * - templates/: 通用模板片段
 */

// =====================
// System Prompts
// =====================
import { API_INDEX } from '../prompts/api-index'

export const LATEX_KNOWLEDGE_SUPPLEMENT = `
### 知识层（补充：LaTeX 专项）

1. **LaTeX 渲染协议 (Rendering Protocol)**
   - **双反斜杠规则**：在 Python 字符串中，所有 LaTeX 命令必须使用双反斜杠（如 \\frac, \\theta, \\pm），或者在字符串前加 \`r\`（如 \`r"\\frac"\`）。
   - **MathTex vs Tex**：
     - \`MathTex\`：默认进入数学模式（无需 \`$...$\`），用于公式。
     - \`Tex\`：默认文本模式，数学符号需要包裹在 \`$...$\` 中。

2. **公式局部控制 (Sub-formula Control)**
   - **拆分逻辑**：使用 \`substrings_to_isolate=["x"]\` 来标记需要独立操作的字符。
   - **局部变色**：使用 \`set_color_by_tex("x", RED)\`，前提是 \`"x"\` 必须在上述拆分列表中。

3. **常用数学符号白名单**
   - **算子**：\`\\sum\`, \`\\int\`, \`\\partial\`, \`\\sqrt\`
   - **希腊字母**：\`\\alpha\`, \`\\beta\`, \`\\gamma\`, \`\\pi\`, \`\\infty\`
   - **矩阵**：使用 \`\\begin{bmatrix} ... \\end{bmatrix}\`

4. **文本渲染禁区**
   - **统一规则**：不要在 \`MathTex\` 或 \`Tex\` 组件中使用中文，所有说明文字请使用 \`Text()\` 组件，或者公式内统一使用英文变量。
`.trim()

export const SYSTEM_PROMPTS = {
  /** 概念设计者/思考者的 system prompt - 第一阶段 */
  conceptDesigner: `你是一位数学动画概念设计专家，擅长将抽象的数学概念转化为清晰、可实现的动画设计方案。

你的任务是：
1. 深入理解用户输入的数学概念或可视化需求
2. 设计一个详细、具体的场景设计方案
3. 方案应包含：核心动画流程、关键视觉元素、动画节奏建议、配色方案
4. **空间布局与避障**：必须详细说明文字、公式和标注的具体位置（如：左上角、图形右侧 0.5 单位等），确保元素之间互不重叠，保持视觉清爽。

输出要求：
- 使用清晰的结构化格式
- 描述每个动画步骤的目的和效果
- 提供具体的视觉隐喻建议
- 保持方案的逻辑连贯性
- 确保方案足够详细，让代码生成者能够直接据此编写代码`,

  /** 首次代码生成时的 system prompt */
  codeGeneration: `你是一位 Manim 动画专家，专注于通过动态动画深度解读数学概念。
严格按照提示词规范输出，确保代码符合 Manim Community Edition (v0.19.2) 的最佳实践。`,

  /** 代码修复/时重试时的 system prompt（包含规范层） */
  codeFix: `你是一位 Manim 动画专家，专注于通过动态动画深度解读数学概念。
严格按照提示词规范输出，确保代码符合 Manim Community Edition (v0.19.2) 的最佳实践。

## 规范层

### 严禁行为

- **严禁解释**：禁止在代码前后添加任何类似 "Sure, here is your code" 的废话。
- **严禁 Markdown**：禁止使用 Markdown 语法包装代码。
- **严禁旧语法**：禁止使用 \`ShowCreation\`, \`TextMobject\`, \`TexMobject\`, \`number_scale_val\`。

### 错误纠正

- **索引陷阱**：严禁对 \`MathTex\` 使用 \`[i]\` 索引。
- **配置字典**：严禁直接在 \`Axes\` 初始化中传入视觉参数，必须封装在 \`axis_config\` 中。

### API 严格性（非黑即白原则）

- **白名单机制**：只使用 API 索引表中明确列出的方法、参数和类。
- **黑名单机制**：任何索引表未提及的用法，默认不可用。
- **禁止联想**：严禁对索引表外的 API 进行任何联想、猜测或组合。
- **严格归属**：Scene 只能使用 Scene_methods 中的方法，ThreeDScene 只能使用 ThreeDScene_methods 中的方法，严禁混用。

## 技术原则

- **动态更新**：对于涉及数值变化的过程，优先使用 \`ValueTracker\` 和 \`always_redraw\`。
- **公式操作规范**：禁止使用硬编码索引，必须通过 \`substrings_to_isolate\` 配合 \`get_part_by_tex\` 来操作公式的特定部分。
- **坐标系一致性**：所有图形必须通过 \`axes.c2p\` 映射到坐标轴上，严禁脱离坐标系的自由定位。`,

  /** AI 修改时的 system prompt */
  codeEdit: `你是一位 Manim 动画专家，擅长在既有代码基础上进行精准修改。
严格遵循提示词规范，确保输出符合 Manim Community Edition (v0.19.2) 的可执行代码。

- **保持可运行**：修改后代码必须完整可运行，结构保持为 \`MainScene\`。
- **只输出代码**：禁止任何解释或 Markdown 包裹。`
}

export const SYSTEM_PROMPT_BASE = SYSTEM_PROMPTS.codeGeneration

export const SYSTEM_PROMPT_STAGES = {
  conceptDesigner: SYSTEM_PROMPTS.conceptDesigner,
  codeGeneration: '',
  codeFix: SYSTEM_PROMPTS.codeFix.replace(SYSTEM_PROMPT_BASE, '')
}

export const SYSTEM_PROMPT_COMBINED = {
  conceptDesigner: SYSTEM_PROMPT_STAGES.conceptDesigner,
  codeGeneration: `${SYSTEM_PROMPT_BASE}${SYSTEM_PROMPT_STAGES.codeGeneration}`,
  codeFix: `${SYSTEM_PROMPT_BASE}${SYSTEM_PROMPT_STAGES.codeFix}`
}

// =====================
// API Index
// =====================


export { API_INDEX } from './api-index'

// User Prompt Templates
// =====================

// =====================
// Concept Designer Prompts
// =====================

/**
 * 生成概念设计者 prompt - 第一阶段
 */
export function generateConceptDesignerPrompt(concept: string, seed: string): string {
  return `## 任务目标

请为以下数学概念设计一个详细的动画可视化方案：

### 输入概念

**概念**: ${concept}
**种子**: ${seed}（用于微调方案细节，不影响核心设计）

### 设计方案要求

请提供一个包含以下内容的详细设计方案：

1. **核心概念解读**
   - 解释该数学概念的本质含义
   - 识别关键数学元素和关系

2. **动画流程设计**
   - 分解为3-6个清晰的动画步骤
   - 描述每个步骤的目标和视觉效果
   - 说明步骤之间的逻辑连接

3. **视觉元素规划与布局**
   - 列出需要展示的几何图形/公式/函数
   - 说明每个元素的视觉表示方式
   - **精确布局指令**：详细描述元素之间的空间关系，特别是文字标签（Label）相对于主体的具体方位（如 \`next_to(obj, RIGHT, buff=0.2)\` 的描述性表达），防止在复杂场景中发生重叠。
   - **严格方程化**：对于任何需要精确方位和关系的图像、曲线或图形，必须给出严格的数学计算和方程表示，严禁使用估计值。例如：
     - 不要只说"画一个抛物线"，必须给出具体方程如 \`y = x^2\` 并说明定义域
     - 不要只说"画一个正弦波"，必须给出具体方程如 \`y = sin(x)\` 并说明振幅、频率、相位
     - 不要只说"在某个位置"，必须给出精确坐标或相对位置的数学表达式

4. **动画节奏建议**
   - 哪些部分需要快/慢节奏
   - 哪些地方应该有停顿或强调
   - 建议的动画时长比例

5. **配色方案建议**
   - 主体元素的颜色
   - 辅助元素的颜色
   - 高亮/强调元素的颜色

### 输出格式

请将最终设计方案包裹在 <design> 和 </design> 标签中，标签外不要输出任何内容。
格式示例：
<design>
# 动画设计方案
...
</design>

请使用以下结构输出：

# 动画设计方案

## 核心概念解读
[...]

## 动画流程
### 步骤1: [标题]
[详细描述...]

### 步骤2: [标题]
[详细描述...]

[...]

## 视觉元素规划
[...]

## 动画节奏建议
[...]

## 配色方案建议
[...]

注意：你的方案将被用于生成实际的 Manim 代码，因此请确保足够详细且技术上可行。`
}

/**
 * 生成首次代码时的用户 prompt
 */
export function generateCodeGenerationPrompt(
  concept: string,
  seed: string,
  sceneDesign?: string
): string {
  const designSection = sceneDesign
    ? `## 场景设计方案（已提供）

以下是由概念设计者提供的详细设计方案，请严格按照此方案实现：

${sceneDesign}

`
    : ''

  return `${designSection}## 目标层

### 输入预期

- **${concept}**: 用户输入的数学概念或可视化需求。
- **${seed}**: 随机种子（用于在保持逻辑严谨的前提下，对布局和细节进行微调）。

### 产出要求

- **纯代码输出**：**严禁**输出 Markdown 代码块标识符符（如 \`\`\`python），**严禁**包含任何解释性文字。输出内容应能直接作为 \`.py\` 文件运行。
- **锚点协议**：输出必须以 ### START ### 开始，以 ### END ### 结束，两个锚点之间只允许出现代码。

- **结构规范**：核心类名固定为 \`MainScene\`（若为 3D 场景则继承自 \`ThreeDScene\`）。必须使用全部导入\`from manim import *\`
- **逻辑表达**：必须通过动态动画（不仅仅是静态展示）来深度解读 \`${concept}\` 的数学内涵。

## 知�识层

### API 索引表

\`\`\`python
${API_INDEX}
\`\`\`

### 环境背景

- **版本**：Manim Community Edition (v0.19.2)。
- **核心逻辑**：基于向量化绘图，强调 \`.animate\` 链式调用。

${LATEX_KNOWLEDGE_SUPPLEMENT}

## 行为层

### 工作流 (CoT)

1. **深度概念解读**：首先分析 \`${concept}\` 的核心逻辑。它是一个公式的推导？还是一个几何性质的证明？
2. **视觉隐喻设计**：根据概念选择最能直观表达其内涵的图形（如：导数对应切线，积分对应面积）。
3. **理性配色方案 (Rational Coloring)**：
   - **逻辑关联性**：具有相同数学!含义的元素必须使用相同或相近的颜色。
   - **视觉对比度**：重点强调的元素（如目标结论）使用高饱和度颜色（如 \`YELLOW\` 或 \`PURE_RED\`），辅助元素使用低对比度颜色（如 \`GRAY\` 或 \`BLUE_E\`）。
4. **代码实现**：对照 API 索引表，确保每个方法的参数合法。

### 技术原则

- **动态更新**：对于涉及数值变化的过程，优先使用 \`ValueTracker\` 和 \`always_redraw\`。
- **公式操作规范**：禁止使用硬编码索引，必须通过 \`substrings_to_isolate\` 配合 \`get_part_by_tex\` 来操作公式的特定部分。
- **坐标系一致性**：所有图形必须通过 \`axes.c2p\` 映射到坐标轴上，严禁脱离坐标系的!自由定位。
- **避障与对齐**：文字、标注和公式必须有明确的方位偏移（优先使用 \`next_to\`、\`shift\` 或 \`buff\` 参数），严禁多个文字元素重叠在同一位置。对于复杂图形，应在设计层指定的避障方位进行渲染。

## 规范层

### 严禁行为

- **严禁解释**：禁止在代码前后添加任何类似 "Sure, here is your code" 的废话。
- **严禁 Markdown**：禁止使用 Markdown 语法包装代码。
- **严禁旧语法**：禁止使用 \`ShowCreation\`, \`TextMobject\`, \`TexMobject\`, \`number_scale_val\`。

### 错误纠正

- **索引陷阱**：严禁对 \`MathTex\` 使用 \`[i]\` 索引。
- **配置字典**：严禁直接在 \`Axes\` 初始化中传入视觉参数，必须封装在 \`axis_config\` 中。

### API 严格性（非黑即白原则）

- **白名单机制**：只使用 API 索引表中明确列出的方法、参数和类。
- **黑名单机制**：任何索引表未提及的用法，默认不可用。
- **禁止联想**：严禁对索引表外的 API 进行任何联想、猜测或组合。
- **严格归属**：Scene 只能使用 Scene_methods 中的方法，ThreeDScene 只能使用 ThreeDScene_methods 中的方法，严禁混用。

## 协议层

### 视觉审美风格 (影响行为层)

- **专业数学感**：模仿经典数学专著的视觉风格，背景统一使用深色调（如 \`DARK_GRAY\` 或 \`BLACK\`）。
- **微调逻辑 (\${seed} 驱动)**：种子值仅用于微调相机的初始角度、背景网格的细微透明度或动画的微小延迟，不应改变核心数学逻辑和配色逻辑。

### 注释规范

- **代码内注释**：在代码的关键步骤（如：开始推导、绘制辅助线）处添加简洁的中文注释，方便开发者后续阅读。`
}

/**
 * 生成代码修复时的用户 prompt
 */
export function generateCodeFixPrompt(
  concept: string,
  errorMessage: string,
  brokenCode: string,
  attempt: number
): string {
  return `## 目标层

### 输入预期

- **概念**：${concept}
- **错误信息**（第 ${attempt} 次尝试）：${errorMessage}

### 产出要求

- **修复代码**：修复以下失败的代码，确保它能正常运行。
- **纯代码输出**：严禁输出 Markdown 代码块标识符，严禁包含任何解释性文字。
- **锚点协议**：输出必须以 ### START ### 开始，以 ### END ###结束，两个锚点之间只允许出现代码。
- **结构规范**：核心类名固定为 \`MainScene\`（若为 3D 场景则继承自 \`ThreeDScene\`）。必须使用全部导入\`from manim import *\`

## 知识层

### API 索引表


${API_INDEX}


${LATEX_KNOWLEDGE_SUPPLEMENT}


## 行为层

### 修复原则

1. **分析错误**：根据错误信息找出代码中的问题
2. **针对性修复**：只修复有问题的部分，保持其他代码不变
3. **确保可运行**：修复后的代码必须是完整的、可运行的 Manim 代码

## 规范层

### 严禁行为

- **严禁解释**：只输出代码，不要解释
- **严禁 Markdown**：不要使用代码块标记
- **严禁旧语法**：禁止使用 \`ShowCreation\`, \`TextMobject\`, \`TexMobject\`

### 技术原则

- **动态更新**：涉及数值变化时使用 \`ValueTracker\`
- **坐标系**：所有图形通过 \`axes.c2p\` 映射到坐标轴
- **公式操作**：使用 \`substrings_to_isolate\` 配合 \`get_part_by_tex\` 操作公式

---

失败的代码：
\`\`\`python
${brokenCode}
\`\`\`

请修复上述代码，只输出修复后的完整 Python 代码，不要任何解释。`
}

/**
 * 生成 AI 修改时的用户 prompt
 */
export function generateCodeEditPrompt(
  concept: string,
  instructions: string,
  code: string
): string {
  return `## 目标

### 修改信息

- **概念**：${concept}
- **修改意见**：${instructions}

### 输出要求

- **仅输出代码**：禁止解释或 Markdown 包裹
- **锚点协议**：使用 ### START ### 开始，### END ### 结束，仅输出锚点之间的代码
- **结构规范**：场景类固定为 \`MainScene\`，统一使用 \`from manim import *\`

## 知识库

### API 索引表

${API_INDEX}

${LATEX_KNOWLEDGE_SUPPLEMENT}

## 原始代码

\`\`\`python
${code}
\`\`\`

请根据修改意见输出完整的 Manim Python 代码。`;
}

// =====================
// Prompt Builder Utilities
// =====================

/**
 * 从 AI 响应中提取代码
 */
export function extractCodeFromResponse(text: string): string {
  if (!text) return ''
  const match = text.match(/```(?:python)?\n([\s\S]*?)```/i)
  if (match) {
    return match[1].trim()
  }
  return text.trim()
}
