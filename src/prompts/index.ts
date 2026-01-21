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

export const SYSTEM_PROMPTS = {
  /** 首次代码生成时的 system prompt */
  codeGeneration: `你是一位 Manim 动画专家，专注于通过动态动画深度解读数学概念。
严格按照提示词规范输出，确保代码符合 Manim Community Edition (v0.19.2) 的最佳实践。`,

  /** 代码修复/重试时的 system prompt（包含规范层） */
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

## 技术原则

- **动态更新**：对于涉及数值变化的过程，优先使用 \`ValueTracker\` 和 \`always_redraw\`。
- **公式操作规范**：禁止使用硬编码索引，必须通过 \`substrings_to_isolate\` 配合 \`get_part_by_tex\` 来操作公式的特定部分。
- **坐标系一致性**：所有图形必须通过 \`axes.c2p\` 映射到坐标轴上，严禁脱离坐标系的自由定位。`
}

// =====================
// API Index
// =====================

export const API_INDEX = `# Manim API Index for AI. NOTE: All Mobjects accept 'global_vmobject_params'. Only unique args are listed per class.

# --- Global & Scene ---
global_vmobject_params = ["background_image", "background_stroke_color", "background_stroke_opacity", "background_stroke_width", "cap_style", "close_new_points", "color", "dim", "fill_color", "fill_opacity", "joint_type", "make_smooth_after_applying_functions", "n_points_per_cubic_curve", "name", "pre_function_handle_to_anchor_scale_factor", "shade_in_3d", "sheen_direction", "sheen_factor", "stroke_color", "stroke_opacity", "stroke_width", "target", "tolerance_for_point_equality", "z_index"]
scene_classes = ["Scene", "ThreeDScene"]
Scene_args = ["always_update_mobjects", "camera_class", "random_seed", "renderer", "skip_animations"]
Scene_methods = ["add", "add_foreground_mobject", "add_foreground_mobjects", "add_mobjects_from_animations", "add_sound", "add_subcaption", "add_updater", "begin_animations"]
ThreeDScene_args = ["always_update_mobjects", "ambient_camera_rotation", "camera_class", "default_angled_camera_orientation_kwargs", "random_seed", "renderer", "skip_animations"]
ThreeDScene_methods = ["add", "add_fixed_in_frame_mobjects", "add_fixed_orientation_mobjects", "add_foreground_mobject", "add_foreground_mobjects", "add_sound", "add_subcaption"]

# --- Mobjects: Coordinate Systems ---
coord_classes = ["Axes", "NumberLine", "NumberPlane"]
Axes_unique_args = ["axis", "axis_config", "dimension", "tips", "vmobjects", "x_axis_config", "x_length", "x_range", "y_axis_config", "y_length", "y_range"]
Axes_methods = ["add", "add_background_rectangle", "add_coordinates", "add_cubic_bezier_curve", "add_cubic_bezier_curve_to", "add_cubic_bezier_curves"]
NumberLine_unique_args = ["buff", "decimal_number_config", "end", "exclude_origin_tick", "font_size", "include_numbers", "include_ticks", "include_tip", "label_constructor", "label_direction", "length", "line_to_number_buff", "longer_tick_multiple", "normal_vector", "numbers_to_exclude", "numbers_to_include", "numbers_with_elongated_ticks", "path_arc", "rotation", "scaling", "start", "tick_size", "tip_height", "tip_length", "tip_style", "tip_width", "unit_size", "x_range"]
NumberLine_methods = ["add", "add_background_rectangle", "add_cubic_bezier_curve", "add_cubic_bezier_curve_to", "add_cubic_bezier_curves", "add_labels"]
NumberPlane_unique_args = ["axis_config", "background_line_style", "dimension", "faded_line_ratio", "faded_line_style", "tips", "vmobjects", "x_axis_config", "x_length", "x_range", "y_axis_config", "y_length", "y_range"]
NumberPlane_methods = ["add", "add_background_rectangle", "add_coordinates", "add_cubic_bezier_curve", "add_cubic_bezier_curve_to", "add_cubic_bezier_curves"]

# --- Mobjects: Geometry (Shapes) ---
shape_classes = ["Circle", "Square", "Rectangle", "Line", "Arrow", "Dot", "Brace"]
Circle_unique_args = ["angle", "arc_center", "normal_vector", "num_components", "radius", "start_angle", "tip_length", "tip_style"]
Square_unique_args = ["grid_xstep", "grid_ystep", "height", "mark_paths_closed", "side_length", "vertex_groups", "vertices", "width"]
Rectangle_unique_args = ["grid_xstep", "grid_ystep", "height", "mark_paths_closed", "vertex_groups", "vertices", "width"]
Line_unique_args = ["buff", "end", "normal_vector", "path_arc", "start", "tip_length", "tip_style"]
Arrow_unique_args = ["buff", "end", "max_stroke_width_to_length_ratio", "max_tip_length_to_length_ratio", "normal_vector", "path_arc", "start", "tip_length", "tip_style"]
Dot_unique_args = ["angle", "arc_center", "normal_vector", "num_components", "point", "radius", "start_angle", "tip_length", "tip_style"]
Brace_unique_args = ["buff", "direction", "long_lines", "mobject", "path_obj", "sharpness", "should_remove_null_curves", "should_subdivide_sharp_curves"]
shape_common_methods = ["add", "add_background_rectangle", "add_cubic_bezier_curve", "add_cubic_bezier_curve_to", "add_cubic_bezier_curves", "add_line_to"]

# --- Mobjects: Math & Text ---
math_text_classes = ["Tex", "MathTex", "Text", "DecimalNumber"]
Tex_unique_args = ["arg_separator", "file_name", "font_size", "height", "opacity", "organize_left_to_right", "path_string_config", "should_center", "substrings_to_isolate", "svg_default", "tex_environment", "tex_string", "tex_strings", "tex_template", "tex_to_color_map", "use_svg_cache", "width"]
MathTex_unique_args = ["arg_separator", "file_name", "font_size", "height", "opacity", "organize_left_to_right", "path_string_config", "should_center", "substrings_to_isolate", "svg_default", "tex_environment", "tex_string", "tex_strings", "tex_template", "tex_to_color_map", "use_svg_cache", "width"]
Text_unique_args = ["disable_ligatures", "file_name", "font", "font_size", "gradient", "height", "line_spacing", "opacity", "path_string_config", "should_center", "slant", "svg_default", "t2c", "t2f", "t2g", "t2s", "t2w", "tab_width", "text", "use_svg_cache", "warn_missing_font", "weight", "width"]
DecimalNumber_unique_args = ["digit_buff_per_font_unit", "edge_to_fix", "font_size", "group_with_commas", "include_background_rectangle", "include_sign", "mob_class", "num_decimal_places", "number", "show_ellipsis", "unit", "unit_buff_per_font_unit"]
math_text_common_methods = ["add", "add_background_rectangle", "add_cubic_bezier_curve", "add_cubic_bezier_curve_to", "add_cubic_bezier_curves", "add_line_to"]

# --- Animations ---
anim_classes = ["Create", "Write", "FadeIn", "FadeOut", "Transform", "ReplacementTransform"]
common_anim_args = ["_on_finish", "introducer", "lag_ratio", "mobject", "name", "rate_func", "remover", "reverse_rate_function", "run_time", "suspend_mobject_updating", "use_override"]
Write_unique_args = ["reverse", "stroke_color", "stroke_width", "vmobject"]
FadeIn_unique_args = ["mobjects", "path_arc", "path_arc_axis", "path_arc_centers", "path_func", "replace_mobject_with_target_in_scene", "scale", "shift", "target_mobject", "target_position"]
FadeOut_unique_args = ["mobjects", "path_arc", "path_arc_axis", "path_arc_centers", "path_func", "replace_mobject_with_target_in_scene", "scale", "shift", "target_mobject", "target_position"]
Transform_unique_args = ["path_arc", "path_arc_axis", "path_arc_centers", "path_func", "replace_mobject_with_target_in_scene", "target_mobject"]
ReplacementTransform_unique_args = ["path_arc", "path_arc_axis", "path_arc_centers", "path_func", "replace_mobject_with_target_in_scene", "target_mobject"]
common_anim_methods = ["begin", "clean_up_from_scene", "copy", "create_starting_mobject", "finish", "get_all_families_zipped", "get_all_mobjects"]

# --- Logic & Updaters ---
logic_classes_and_functions = ["ValueTracker", "always_redraw"]
ValueTracker_args = ["color", "dim", "name", "target", "value", "z_index"]
ValueTracker_methods = ["add", "add_updater", "align_data"]
always_redraw_args = ["func"]`

// =====================
// User Prompt Templates
// =====================

/**
 * 生成首次代码时的用户 prompt
 */
export function generateCodeGenerationPrompt(concept: string, seed: string): string {
  return `## 目标层

### 输入预期

- **${concept}**: 用户输入的数学概念或可视化需求。
- **${seed}**: 随机种子（用于在保持逻辑严谨的前提下，对布局和细节进行微调）。

### 产出要求

- **纯代码输出**：**严禁**输出 Markdown 代码块标识符符（如 \`\`\`python），**严禁**包含任何解释性文字。输出内容应能直接作为 \`.py\` 文件运行。
- **结构规范**：核心类名固定为 \`MainScene\`（若为 3D 场景则继承自 \`ThreeDScene\`）。
- **逻辑表达**：必须通过动态动画（不仅仅是静态展示）来深度解读 \`${concept}\` 的数学内涵。

## 知�识层

### API 索引表

\`\`\`python
${API_INDEX}
\`\`\`

### 环境背景

- **版本**：Manim Community Edition (v0.19.2)。
- **核心逻辑**：基于向量化绘图，强调 \`.animate\` 链式调用。

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

## 规范层

### 严禁行为

- **严禁解释**：禁止在代码前后添加任何类似 "Sure, here is your code" 的废话。
- **严禁 Markdown**：禁止使用 Markdown 语法包装代码。
- **严禁旧语法**：禁止使用 \`ShowCreation\`, \`TextMobject\`, \`TexMobject\`, \`number_scale_val\`。

### 错误纠正

- **索引陷阱**：严禁对 \`MathTex\` 使用 \`[i]\` 索引。
- **配置字典**：严禁直接在 \`Axes\` 初始化中传入视觉参数，必须封装在 \`axis_config\` 中。

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
