/**
 * AI 代码修复服务
 * 处理渲染失败时的 Manim 代码重试和修复
 *
 * 架构设计：
 * - 单一职责：修复损坏的 Manim 代码
 * - 清晰的重试尝试日志记录
 * - 可配置的最大重试次数
 */

import { generateAIManimCode, isOpenAIAvailable } from './openai-client'
import OpenAI from 'openai'
import { createLogger } from '../utils/logger'

const logger = createLogger('AICodeFix')

// 配置
const MAX_RETRIES = parseInt(process.env.AI_CODE_FIX_MAX_RETRIES || '3', 10)
const ENABLE_CODE_FIX = process.env.ENABLE_AI_CODE_FIX !== 'false'

// OpenAI 配置（从环境变量读取，与 openai-client.ts 一致）
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'glm-4-flash'
const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '1200', 10)

const CUSTOM_API_URL = process.env.CUSTOM_API_URL?.trim()

// 初始化 OpenAI 客户端
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
  logger.warn('OpenAI 客户端初始化失败', { error })
}

// API 索引表（用于重试时的完整 prompt）
const API_INDEX = `# Manim API 索引表（AI 专用）。注意：所有 Mobjects 都接受 'global_vmobject_params'。每个类只列出独特参数。

# --- 全局与场景 ---
global_vmobject_params = ["background_image", "background_stroke_color", "background_stroke_opacity", "background_stroke_width", "cap_style", "close_new_points", "color", "dim", "fill_color", "fill_opacity", "joint_type", "make_smooth_after_applying_functions", "n_points_per_cubic_curve", "name", "pre_function_handle_to_anchor_scale_factor", "shade_in_3d", "sheen_direction", "sheen_factor", "stroke_color", "stroke_opacity", "stroke_width", "target", "tolerance_for_point_equality", "z_index"]
scene_classes = ["Scene", "ThreeDScene"]
Scene_args = ["always_update_mobjects", "camera_class", "random_seed", "renderer", "skip_animations"]
Scene_methods = ["add", "add_foreground_mobject", "add_foreground_mobjects", "add_mobjects_from_animations", "add_sound", "add_subcaption", "add_updater", "begin_animations"]
ThreeDScene_args = ["always_update_mobjects", "ambient_camera_rotation", "camera_class", "default_angled_camera_orientation_kwargs", "random_seed", "renderer", "skip_animations"]
ThreeDScene_methods = ["add", "add_fixed_in_frame_mobjects", "add_fixed_orientation_mobjects", "add_foreground_mobject", "add_foreground_mobjects", "add_sound", "add_subcaption"]

# --- Mobjects: 坐标系 ---
coord_classes = ["Axes", "NumberLine", "NumberPlane"]
Axes_unique_args = ["axis", "axis_config", "dimension", "tips", "vmobjects", "x_axis_config", "x_length", "x_range", "y_axis_config", "y_length", "y_range"]
Axes_methods = ["add", "add_background_rectangle", "add_coordinates", "add_cubic_bezier_curve", "add_cubic_bezier_curve_to", "add_cubic_bezier_curves"]
NumberLine_unique_args = ["buff", "decimal_number_config", "end", "exclude_origin_tick", "font_size", "include_numbers", "include_ticks", "include_tip", "label_constructor", "label_direction", "length", "line_to_number_buff", "longer_tick_multiple", "normal_vector", "numbers_to_exclude", "numbers_to_include", "numbers_with_elongated_ticks", "path_arc", "rotation", "scaling", "start", "tick_size", "tip_height", "tip_length", "tip_shape", "tip_style", "tip_width", "unit_size", "x_range"]
NumberLine_methods = ["add", "add_background_rectangle", "add_cubic_bezier_curve", "add_cubic_bezier_curve_to", "add_cubic_bezier_curves", "add_labels"]
NumberPlane_unique_args = ["axis_config", "background_line_style", "dimension", "faded_line_ratio", "faded_line_style", "tips", "vmobjects", "x_axis_config", "x_length", "x_range", "y_axis_config", "y_length", "y_range"]
NumberPlane_methods = ["add", "add_background_rectangle", "add_coordinates", "add_cubic_bezier_curve", "add_cubic_bezier_curve_to", "add_cubic_bezier_curves"]

# --- Mobjects: 几何图形 ---
shape_classes = ["Circle", "Square", "Rectangle", "Line", "Arrow", "Dot", "Brace"]
Circle_unique_args = ["angle", "arc_center", "normal_vector", "num_components", "radius", "start_angle", "tip_length", "tip_style"]
Square_unique_args = ["grid_xstep", "grid_ystep", "height", "mark_paths_closed", "side_length", "vertex_groups", "vertices", "width"]
Rectangle_unique_args = ["grid_xstep", "grid_ystep", "height", "mark_paths_closed", "vertex_groups", "vertices", "width"]
Line_unique_args = ["buff", "end", "normal_vector", "path_arc", "start", "tip_length", "tip_style"]
Arrow_unique_args = ["buff", "end", "max_stroke_width_to_length_ratio", "max_tip_length_to_length_ratio", "normal_vector", "path_arc", "start", "tip_length", "tip_style"]
Dot_unique_args = ["angle", "arc_center", "normal_vector", "num_components", "point", "radius", "start_angle", "tip_length", "tip_style"]
Brace_unique_args = ["buff", "direction", "long_lines", "mobject", "path_obj", "sharpness", "should_remove_null_curves", "should_subdivide_sharp_curves"]
shape_common_methods = ["add", "add_background_rectangle", "add_cubic_bezier_curve", "add_cubic_bezier_curve_to", "add_cubic_bezier_curves", "add_line_to"]

# --- Mobjects: 数学与文本 ---
math_text_classes = ["Tex", "MathTex", "Text", "DecimalNumber"]
Tex_unique_args = ["arg_separator", "file_name", "font_size", "height", "opacity", "organize_left_to_right", "path_string_config", "should_center", "substrings_to_isolate", "svg_default", "tex_environment", "tex_string", "tex_strings", "tex_template", "tex_to_color_map", "use_svg_cache", "width"]
MathTex_unique_args = ["arg_separator", "file_name", "font_size", "height", "opacity", "organize_left_to_right", "path_string_config", "should_center", "substrings_to_isolate", "svg_default", "tex_environment", "tex_string", "tex_strings", "tex_template", "tex_to_color_map", "use_svg_cache", "width"]
Text_unique_args = ["disable_ligatures", "file_name", "font", "font_size", "gradient", "height", "line_spacing", "opacity", "path_string_config", "should_center", "slant", "svg_default", "t2c", "t2f", "t2g", "t2s", "t2w", "tab_width", "text", "use_svg_cache", "warn_missing_font", "weight", "width"]
DecimalNumber_unique_args = ["digit_buff_per_font_unit", "edge_to_fix", "font_size", "group_with_commas", "include_background_rectangle", "include_sign", "mob_class", "num_decimal_places", "number", "show_ellipsis", "unit", "unit_buff_per_font_unit"]
math_text_common_methods = ["add", "add_background_rectangle", "add_cubic_bezier_curve", "add_cubic_bezier_curve_to", "add_cubic_bezier_curves", "add_line_to"]

# --- 动画 ---
anim_classes = ["Create", "Write", "FadeIn", "FadeOut", "Transform", "ReplacementTransform"]
common_anim_args = ["_on_finish", "introducer", "lag_ratio", "mobject", "name", "rate_func", "remover", "reverse_rate_function", "run_time", "suspend_mobject_updating", "use_override"]
Write_unique_args = ["reverse", "stroke_color", "stroke_width", "vmobject"]
FadeIn_unique_args = ["mobjects", "path_arc", "path_arc_axis", "path_arc_centers", "path_func", "replace_mobject_with_target_in_scene", "scale", "shift", "target_mobject", "target_position"]
FadeOut_unique_args = ["mobjects", "path_arc", "path_arc_axis", "path_arc_centers", "path_func", "replace_mobject_with_target_in_scene", "scale", "shift", "target_mobject", "target_position"]
Transform_unique_args = ["path_arc", "path_arc_axis", "path_arc_centers", "path_func", "replace_mobject_with_target_in_scene", "target_mobject"]
ReplacementTransform_unique_args = ["path_arc", "path_arc_axis", "path_arc_centers", "path_func", "replace_mobject_with_target_in_scene", "target_mobject"]
common_anim_methods = ["begin", "clean_up_from_scene", "copy", "create_starting_mobject", "finish", "get_all_families_zipped", "get_all_mobjects"]

# --- 逻辑与更新器 ---
logic_classes_and_functions = ["ValueTracker", "always_redraw"]
ValueTracker_args = ["color", "dim", "name", "target", "value", "z_index"]
ValueTracker_methods = ["add", "add_updater", "align_data"]
always_redraw_args = ["func"]`

// 重试时的 system prompt（与首次生成一致）
const RETRY_SYSTEM_PROMPT = `你是一位 Manim 动画专家，专注于通过动态动画深度解读数学概念。
严格按照提示词规范输出，确保代码符合 Manim Community Edition (v0.19.2) 的最佳实践。

## 规范层

### 严禁行为

- **严禁解释**：禁止在代码前后添加任何类似 "Sure, here is your code" 的废话。
- **严禁 Markdown**：禁止使用 Markdown 语法包装代码。
- **严禁旧语法**：禁止使用 \`ShowCreation\`, \`TextMobject\`, \`TexMobject\`, \`number_scale_val\`。

### 错误纠正

- **索引陷阱**：严禁对 \`MathTex\` 使用 \`[i]\` 索引。
- **配置字典**：严禁直接在 \`Axes\` 初始化中传入视觉参数，必须封装在 \`axis_config\` 中。

## 技术原则

- **动态更新**：对于涉及数值变化的过程，优先使用 \`ValueTracker\` 和 \`always_redraw\`。
- **公式操作规范**：禁止使用硬编码索引，必须通过 \`substrings_to_isolate\` 配合 \`get_part_by_tex\` 来操作公式的特定部分。
- **坐标系一致性**：所有图形必须通过 \`axes.c2p\` 映射到坐标轴上，严禁脱离坐标系的自由定位。`

export interface FixCodeOptions {
  concept: string
  brokenCode: string
  errorMessage: string
  attempt: number
}

export interface FixCodeResult {
  success: boolean
  code: string
  attempt: number
  reason?: string
}

/**
 * 从 stderr 中提取实际的错误消息
 */
function extractErrorMessage(stderr: string): string {
  if (!stderr) return '未知错误'

  // 尝试提取 Python 语法错误
  const syntaxMatch = stderr.match(/SyntaxError:.+/)
  if (syntaxMatch) return syntaxMatch[0].trim()

  // 尝试提取 Python 跟踪信息
  const tracebackMatch = stderr.match(/File ".+?\.py".+?\n.+?\n.+/s)
  if (tracebackMatch) return tracebackMatch[0].trim()

  // 返回最后一行非空内容
  const lines = stderr.split('\n').filter(l => l.trim())
  return lines[lines.length - 1] || stderr.trim()
}

/**
 * 检查错误是否可重试
 * 某些错误（如缺少依赖）AI 无法修复
 */
function isRetryableError(errorMessage: string): boolean {
  const unretryablePatterns = [
    /ModuleNotFoundError/i,
    /ImportError/i,
    /No module named/i
  ]

  return !unretryablePatterns.some(pattern => pattern.test(errorMessage))
}

/**
 * 从 AI 响应中提取代码（处理 markdown 代码块）
 */
function extractCodeFromResponse(text: string): string {
  if (!text) return ''
  const match = text.match(/```(?:python)?\n([\s\S]*?)```/i)
  if (match) {
    return match[1].trim()
  }
  return text.trim()
}

/**
 * 使用 AI 修复损坏的 Manim 代码 - 现在使用完整的 system prompt
 */
export async function fixCode(options: FixCodeOptions): Promise<FixCodeResult> {
  const { attempt, concept, brokenCode, errorMessage } = options

  logger.info('尝试修复代码', {
    attempt,
    maxRetries: MAX_RETRIES,
    error: errorMessage
  })

  if (!openaiClient) {
    logger.warn('OpenAI 客户端不可用')
    return {
      success: false,
      code: brokenCode,
      attempt,
      reason: 'OpenAI 客户端不可用'
    }
  }

  try {
    // 构建完整的用户 prompt，包含 API 索引表
    const userPrompt = `## 目标层

### 输入预期

- **概念**：${concept}
- **错误信息**（第 ${attempt} 次尝试）：${errorMessage}

### 产出要求

- **修复代码**：修复以下失败的代码，确保它能正常运行。
- **纯代码输出**：严禁输出 Markdown 代码块标识符，严禁包含任何解释性文字。
- **结构规范**：核心类名固定为 \`MainScene\`（若为 3D 场景则继承自 \`ThreeDScene\`）。

## 知识层

### API 索引表

\`\`\`python
${API_INDEX}
\`\`\`

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

    const response = await openaiClient.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: RETRY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: AI_TEMPERATURE,
      max_tokens: MAX_TOKENS
    })

    const content = response.choices[0]?.message?.content || ''
    
    if (!content || content.length < 50) {
      logger.warn('AI 返回空内容或代码过短', { attempt })
      return {
        success: false,
        code: brokenCode,
        attempt,
        reason: 'AI 返回无效代码'
      }
    }

    const fixedCode = extractCodeFromResponse(content)

    logger.info('代码修复尝试完成', {
      attempt,
      codeLength: fixedCode.length
    })

    return {
      success: true,
      code: fixedCode,
      attempt
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error('代码修复尝试失败', { attempt, error: errMsg })
    if (error instanceof OpenAI.APIError) {
      logger.error('OpenAI API 错误详情', {
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message,
        headers: error.headers
      })
    }
    return {
      success: false,
      code: brokenCode,
      attempt,
      reason: errMsg
    }
  }
}

/**
 * 执行代码渲染的重试逻辑
 * 返回最终使用的代码（修复后的或原始的）
 */
export async function executeRetryLogic(
  initialCode: string,
  concept: string,
  renderer: (code: string) => Promise<{ success: boolean; stderr: string; stdout: string }>,
  onRetryStart?: () => Promise<void>
): Promise<{ code: string; success: boolean; attempts: number; lastError?: string }> {
  if (!ENABLE_CODE_FIX) {
    logger.info('AI 代码修复已禁用，使用原始代码')
    const result = await renderer(initialCode)
    return { code: initialCode, success: result.success, attempts: 1, lastError: result.success ? undefined : result.stderr }
  }

  let currentCode = initialCode
  let lastResult = await renderer(initialCode)

  logger.info('初始渲染结果', {
    success: lastResult.success,
    stderr: lastResult.stderr
  })

  // 如果首次尝试成功，提前返回
  if (lastResult.success) {
    return { code: currentCode, success: true, attempts: 1 }
  }

  const errorMessage = extractErrorMessage(lastResult.stderr)

  // 检查错误是否可重试
  if (!isRetryableError(errorMessage)) {
    logger.warn('错误不可重试，跳过 AI 修复', { error: errorMessage })
    return { code: currentCode, success: false, attempts: 1, lastError: errorMessage }
  }

  // 通知开始重试（更新 stage 为 refining）
  if (onRetryStart) {
    try {
      await onRetryStart()
    } catch (error) {
      logger.warn('执行 onRetryStart 回调失败', { error })
    }
  }

  // 使用 AI 修复进行重试
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.info(`开始第 ${attempt} 次重试`, {
      maxRetries: MAX_RETRIES,
      error: errorMessage
    })

    const fixResult = await fixCode({
      concept,
      brokenCode: currentCode,
      errorMessage,
      attempt
    })

    if (!fixResult.success) {
      logger.warn('修复尝试失败，将重试', { attempt })
      continue
    }

    // 使用修复后的代码尝试渲染
    currentCode = fixResult.code
    lastResult = await renderer(currentCode)

    if (lastResult.success) {
      logger.info('代码修复成功', {
        attempt,
        totalAttempts: attempt + 1
      })
      return { code: currentCode, success: true, attempts: attempt + 1 }
    }

    // 更新错误消息用于下一次迭代
    const newErrorMessage = extractErrorMessage(lastResult.stderr)
    logger.warn('修复后的代码仍然失败', {
      attempt,
      error: newErrorMessage
    })
  }

  // 所有重试用尽
  logger.error('所有重试尝试已用尽', {
    totalAttempts: MAX_RETRIES + 1,
    finalError: extractErrorMessage(lastResult.stderr)
  })

  return { code: currentCode, success: false, attempts: MAX_RETRIES + 1, lastError: extractErrorMessage(lastResult.stderr) }
}

/**
 * 检查代码修复是否启用
 */
export function isCodeFixEnabled(): boolean {
  return ENABLE_CODE_FIX
}

/**
 * 获取最大重试次数配置
 */
export function getMaxRetries(): number {
  return MAX_RETRIES
}