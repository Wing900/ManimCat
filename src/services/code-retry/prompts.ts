/**
 * Code Retry Service - Prompts
 */

import { API_INDEX } from '../../prompts/api-index'

// System prompt - 与代码生成者一致
export const CODE_RETRY_SYSTEM_PROMPT = `你是一位 Manim 动画专家，专注于通过动态动画深度解读数学概念。
严格按照提示词词规范输出，确保代码符合 Manim Community Edition (v0.19.2) 的最佳实践。`

/**
 * 构建首次代码生成的用户提示词
 */
export function buildInitialCodePrompt(
  concept: string,
  seed: string,
  sceneDesign: string
): string {
  return `## 目标层

### 输入预期

- **${concept}**: 用户输入的数学概念或可视化需求。
- **${seed}**: 随机种子。
- **sceneDesign**: 概念设计者提供的场景设计方案。

### 产出要求

- **纯代码输出**：严禁输出 Markdown 代码块标识符，严禁包含任何解释性文字。
- **结构规范**：核心类名固定为 \`MainScene\`（若为 3D 场景则继承自 \`ThreeDScene\`）。
- **导入规范**：必须使用全部导入 \`from manim import *\`

## 知识层

### API 索引表

\`\`\`python
${API_INDEX}
\`\`\`

### 环境背景

- **版本**：Manim Community Edition (v0.19.2)。
- **核心逻辑**：基于向量化绘图，强调 \`.animate\` 链式调用。

## 行为层

### 工作流

1. **深度概念解读**：分析 \`${concept}\` 的核心逻辑。
2. **视觉隐喻设计**：选择最能直观表达其内涵的图形。
3. **理性配色方案**：
   - 逻辑关联性：相同数学含义的元素使用相同或相近颜色。
   - 视觉对比度：重点元素用高饱和度颜色，辅助元素用低对比度颜色。
4. **代码实现**：对照 API 索引表，确保每个方法参数合法。

### 技术原则

- **动态更新**：涉及数值变化时使用 \`ValueTracker\` 和 \`always_redraw\`。
- **公式操作规范**：使用 \`substrings_to_isolate\` 配合 \`get_part_by_tex\` 操作公式。
- **坐标系一致性**：所有图形通过 \`axes.c2p\` 映射到坐标轴。

## 规范层

### 严禁行为

- **严禁解释**：禁止在代码前后添加任何类似 "Sure, here is your code" 的废话。
- **严禁 Markdown**：禁止使用 Markdown 语法包装代码。
- **严禁旧语法**：禁止使用 \`ShowCreation\`, \`TextMobject\`, \`TexMobject\`。

### 错误纠正

- **索引陷阱**：严禁对 \`MathTex\` 使用 \`[i]\` 索引。
- **配置字典**：严禁直接在 \`Axes\` 初始化中传入视觉参数，必须封装在 \`axis_config\` 中。
- **虚线陷阱**：严禁在 \`plot()\`, \`Line()\`, \`Circle()\` 等普通绘图函数中直接使用 \`dash_length\` 或 \`dashed_ratio\` 参数。若需虚线，必须使用 \`DashedLine\` 类或 \`DashedVMobject\` 包装。

## 协议层

### 视觉审美风格

- **背景**：使用深色调（如 \`DARK_GRAY\` 或 \`BLACK\`）。

---

## 场景设计方案

\`\`\`
${sceneDesign}
\`\`\`

请根据上述设计方案生成 Manim 代码。`}
