/**
 * OpenAI 客户端服务
 * 处理基于 AI 的 Manim 代码生成
 * 使用 GPT-4.1 nano - OpenAI 最快的模型（95.9 tokens/sec，首 token <5s）
 * 支持通过 CUSTOM_API_URL 和 CUSTOM_API_KEY 环境变量使用自定义 API 端点
 */

import OpenAI from 'openai'
import crypto from 'crypto'
import { createLogger } from '../utils/logger'
import type { CustomApiConfig } from '../types'

const logger = createLogger('OpenAIClient')

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'glm-4-flash'
const AI_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.7')
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '1200', 10)
const OPENAI_TIMEOUT = parseInt(process.env.OPENAI_TIMEOUT || '60000', 10) // 60 秒

const CUSTOM_API_URL = process.env.CUSTOM_API_URL?.trim()

let openaiClient: OpenAI | null = null

try {
  const baseConfig = {
    timeout: OPENAI_TIMEOUT,
    defaultHeaders: {
      'User-Agent': 'ManimCat/1.0'
    }
  }

  if (CUSTOM_API_URL) {
    openaiClient = new OpenAI({
      ...baseConfig,
      baseURL: CUSTOM_API_URL,
      apiKey: process.env.OPENAI_API_KEY
    })
  } else {
    openaiClient = new OpenAI(baseConfig)
  }
} catch (error) {
  logger.warn('OpenAI 客户端初始化失败', { error })
}

/**
 * 创建自定义 OpenAI 客户端
 */
function createCustomClient(config: CustomApiConfig): OpenAI {
  return new OpenAI({
    baseURL: config.apiUrl.trim().replace(/\/+$/, ''),
    apiKey: config.apiKey,
    timeout: OPENAI_TIMEOUT,
    defaultHeaders: {
      'User-Agent': 'ManimCat/1.0'
    }
  })
}

/**
 * 基于概念和时间戳生成唯一种子
 * 这有助于确保相似概念产生不同的输出
 */
function generateUniqueSeed(concept: string): string {
  const timestamp = Date.now()
  const randomPart = crypto.randomBytes(4).toString('hex')
  return crypto.createHash('md5').update(`${concept}-${timestamp}-${randomPart}`).digest('hex').slice(0, 8)
}

/**
 * 生成用于生成唯一 Manim 代码的优化 prompt
 * 包含变化指令以避免重复输出
 */
function generateManimPrompt(concept: string, seed: string): string {
  // API 索引表
  const apiIndex = `# Manim API Index for AI. NOTE: Most visual mobjects inherit args from Mobject and VMobject. Only unique args are listed per class.

# --- Colors & Constants ---
colors_and_constants = ["BOLD", "BOOK", "HEAVY", "ITALIC", "LIGHT", "MEDIUM", "NORMAL", "OBLIQUE", "SEMIBOLD", "SEMILIGHT", "THIN", "ULTRABOLD", "ULTRAHEAVY", "ULTRALIGHT", "BLUE", "GREEN", "RED", "YELLOW", "WHITE", "BLACK", "GREY", "PURPLE", "ORANGE", "PINK", "TEAL", "GOLD"]

# --- Core Mobject Classes & Global Params ---
Mobject_args = ["color", "name", "dim", "target", "z_index"]
VMobject_args = ["fill_color", "fill_opacity", "stroke_color", "stroke_opacity", "stroke_width", "background_stroke_color", "background_stroke_opacity", "background_stroke_width", "sheen_factor", "joint_type", "sheen_direction", "close_new_points", "pre_function_handle_to_anchor_scale_factor", "make_smooth_after_applying_functions", "background_image", "shade_in_3d", "tolerance_for_point_equality", "n_points_per_cubic_curve", "cap_style"]
common_mobject_methods = ["add", "add_background_rectangle", "add_cubic_bezier_curve", "add_line_to", "add_updater", "align_to", "animate", "apply_function", "become", "center", "copy", "fade", "get_center", "move_to", "next_to", "remove", "rotate", "scale", "set_color", "shift", "surround"]

# --- Mobject Categories & Classes ---
# Mobjects: 2D Shapes
shape_2d_classes = ["Angle", "AnnularSector", "Annulus", "Arc", "ArcBetweenPoints", "ArcPolygon", "Circle", "Cross", "CubicBezier", "Cutout", "Difference", "Dot", "Elbow", "Ellipse", "Exclusion", "FullScreenRectangle", "Intersection", "Polygon", "Polygram", "Rectangle", "RegularPolygon", "RegularPolygram", "RightAngle", "RoundedRectangle", "ScreenRectangle", "Sector", "Square", "Star", "Triangle", "Union"]
Angle_args = ["line1", "line2", "radius", "quadrant", "other_angle", "dot", "dot_radius", "dot_distance", "dot_color", "elbow"]
AnnularSector_args = ["inner_radius", "outer_radius", "angle", "start_angle", "fill_opacity", "stroke_width", "color"]
Annulus_args = ["inner_radius", "outer_radius", "fill_opacity", "stroke_width", "color", "mark_paths_closed"]
Arc_args = ["radius", "start_angle", "angle", "num_components", "arc_center"]
ArcBetweenPoints_args = ["start", "end", "angle", "radius"]
ArcPolygon_args = ["vertices", "angle", "radius", "arc_config"]
Circle_args = ["radius", "color"]
Cross_args = ["mobject", "stroke_color", "stroke_width", "scale_factor"]
CubicBezier_args = ["start_anchor", "start_handle", "end_handle", "end_anchor"]
Cutout_args = ["main_shape", "mobjects"]
Difference_args = ["subject", "clip"]
Dot_args = ["point", "radius", "stroke_width", "fill_opacity", "color"]
Elbow_args = ["width", "angle"]
Ellipse_args = ["width", "height"]
Exclusion_args = ["subject", "clip"]
Polygon_args = ["vertices"]
Polygram_args = ["vertex_groups", "color"]
Rectangle_args = ["color", "height", "width", "grid_xstep", "grid_ystep", "mark_paths_closed", "close_new_points"]
RegularPolygon_args = ["n"]
RegularPolygram_args = ["num_vertices", "density", "radius", "start_angle"]
RightAngle_args = ["line1", "line2", "length"]
RoundedRectangle_args = ["corner_radius"]
ScreenRectangle_args = ["aspect_ratio", "height"]
Sector_args = ["radius"]
Square_args = ["side_length"]
Star_args = ["n", "outer_radius", "inner_radius", "density", "start_angle"]
Intersection_args = ["vmobjects"]
Union_args = ["vmobjects"]

# Mobjects: 3D Shapes
shape_3d_classes = ["Arrow3D", "Cone", "Cube", "Cylinder", "Dodecahedron", "Dot3D", "Icosahedron", "Line3D", "Octahedron", "Prism", "Polyhedron", "Sphere", "Tetrahedron", "Torus", "ThreeDVMobject"]
Arrow3D_args = ["start", "end", "thickness", "height", "base_radius", "color", "resolution"]
Cone_args = ["base_radius", "height", "direction", "show_base", "v_range", "u_min", "checkerboard_colors"]
Cube_args = ["side_length", "fill_opacity", "fill_color", "stroke_width"]
Cylinder_args = ["radius", "height", "direction", "v_range", "show_ends", "resolution"]
Dodecahedron_args = ["edge_length"]
Dot3D_args = ["point", "radius", "color", "resolution"]
Icosahedron_args = ["edge_length"]
Line3D_args = ["start", "end", "thickness", "color", "resolution"]
Octahedron_args = ["edge_length"]
Prism_args = ["dimensions"]
Polyhedron_args = ["vertex_coords", "faces_list", "faces_config", "graph_config"]
Sphere_args = ["center", "radius", "resolution", "u_range", "v_range"]
Tetrahedron_args = ["edge_length"]
Torus_args = ["major_radius", "minor_radius", "u_range", "v_range", "resolution"]
ThreeDVMobject_args = ["shade_in_3d"]

# Mobjects: Text, Code & Markup
text_classes = ["BulletedList", "Code", "MarkupText", "MathTex", "Paragraph", "SingleStringMathTex", "Tex", "Text", "Title"]
BulletedList_args = ["items", "buff", "dot_scale_factor", "tex_environment"]
Code_args = ["code_file", "code_string", "language", "formatter_style", "tab_width", "add_line_numbers", "line_numbers_from", "background", "background_config", "paragraph_config"]
MarkupText_args = ["text", "fill_opacity", "stroke_width", "color", "font_size", "line_spacing", "font", "slant", "weight", "justify", "gradient", "tab_width", "height", "width", "should_center", "disable_ligatures", "warn_missing_font"]
MathTex_args = ["tex_strings", "arg_separator", "substrings_to_isolate", "tex_to_color_map", "tex_environment"]
Paragraph_args = ["text", "line_spacing", "alignment"]
SingleStringMathTex_args = ["tex_string", "stroke_width", "should_center", "height", "organize_left_to_right", "tex_environment", "tex_template", "font_size", "color"]
Tex_args = ["tex_strings", "arg_separator", "tex_environment"]
Text_args = ["text", "fill_opacity", "stroke_width", "color", "font_size", "line_spacing", "font", "slant", "weight", "t2c", "t2f", "t2g", "t2s", "t2w", "gradient", "tab_width", "warn_missing_font", "height", "width", "should_center", "disable_ligatures", "use_svg_cache"]
Title_args = ["text_parts", "include_underline", "match_underline_width_to_text", "underline_buff"]

# Mobjects: Coordinate Systems & Graphs
coord_classes = ["Axes", "BarChart", "ComplexPlane", "DiGraph", "Graph", "NumberLine", "NumberPlane", "PolarPlane", "ThreeDAxes"]
Axes_args = ["x_range", "y_range", "x_length", "y_length", "axis_config", "x_axis_config", "y_axis_config", "tips"]
BarChart_args = ["values", "bar_names", "y_range", "x_length", "y_length", "bar_colors", "bar_width", "bar_fill_opacity", "bar_stroke_width"]
DiGraph_args = ["vertices", "edges", "labels", "label_fill_color", "layout", "layout_scale", "layout_config", "vertex_type", "vertex_config", "vertex_mobjects", "edge_type", "partitions", "root_vertex", "edge_config"]
Graph_args = ["vertices", "edges", "labels", "label_fill_color", "layout", "layout_scale", "layout_config", "vertex_type", "vertex_config", "vertex_mobjects", "edge_type", "partitions", "root_vertex", "edge_config"]
NumberLine_args = ["x_range", "length", "unit_size", "include_ticks", "tick_size", "numbers_with_elongated_ticks", "longer_tick_multiple", "exclude_origin_tick", "rotation", "stroke_width", "include_tip", "tip_width", "tip_height", "tip_shape", "include_numbers", "font_size", "label_direction", "label_constructor", "scaling", "line_to_number_buff", "decimal_number_config", "numbers_to_exclude", "numbers_to_include"]
NumberPlane_args = ["x_range", "y_range", "x_length", "y_length", "background_line_style", "faded_line_style", "faded_line_ratio", "make_smooth_after_applying_functions"]
PolarPlane_args = ["radius_max", "size", "radius_step", "azimuth_step", "azimuth_units", "azimuth_compact_fraction", "azimuth_offset", "azimuth_direction", "azimuth_label_buff", "azimuth_label_font_size", "radius_config", "background_line_style", "faded_line_style", "faded_line_ratio", "make_smooth_after_applying_functions"]
ThreeDAxes_args = ["x_range", "y_range", "z_range", "x_length", "y_length", "z_length", "z_axis_config", "z_normal", "num_axis_pieces", "light_source", "depth", "gloss"]

# Mobjects: Tables & Matrices
table_classes = ["DecimalMatrix", "DecimalTable", "IntegerMatrix", "IntegerTable", "MathTable", "Matrix", "MobjectMatrix", "MobjectTable", "Table"]
DecimalMatrix_args = ["matrix", "element_to_mobject", "element_to_mobject_config"]
DecimalTable_args = ["table", "element_to_mobject", "element_to_mobject_config"]
IntegerMatrix_args = ["matrix", "element_to_mobject"]
IntegerTable_args = ["table", "element_to_mobject"]
MathTable_args = ["table", "element_to_mobject"]
Matrix_args = ["matrix", "v_buff", "h_buff", "bracket_h_buff", "bracket_v_buff", "add_background_rectangles_to_entries", "include_background_rectangle", "element_to_mobject", "element_to_mobject_config", "element_alignment_corner", "left_bracket", "right_bracket", "stretch_brackets", "bracket_config"]
Table_args = ["table", "row_labels", "col_labels", "top_left_entry", "v_buff", "h_buff", "include_outer_lines", "add_background_rectangles_to_entries", "entries_background_color", "include_background_rectangle", "background_rectangle_color", "element_to_mobject", "element_to_mobject_config", "arrange_in_grid_config", "line_config"]

# Mobjects: Arrows, Braces, Lines & Vectors
line_classes = ["ArcBrace", "Arrow", "ArrowCircleFilledTip", "ArrowCircleTip", "ArrowSquareFilledTip", "ArrowSquareTip", "ArrowTip", "ArrowTriangleFilledTip", "ArrowTriangleTip", "Brace", "BraceBetweenPoints", "CurvedArrow", "CurvedDoubleArrow", "DashedLine", "DoubleArrow", "LabeledArrow", "LabeledLine", "Line", "StealthTip", "TangentLine", "TipableVMobject", "Underline", "Vector"]
ArcBrace_args = ["arc", "direction"]
Arrow_args = ["stroke_width", "buff", "max_tip_length_to_length_ratio", "max_stroke_width_to_length_ratio"]
ArrowCircleFilledTip_args = ["fill_opacity", "stroke_width"]
ArrowCircleTip_args = ["fill_opacity", "stroke_width", "length", "start_angle"]
Brace_args = ["mobject", "direction", "buff", "sharpness", "stroke_width", "fill_opacity", "background_stroke_width", "background_stroke_color"]
BraceBetweenPoints_args = ["point_1", "point_2", "direction"]
CurvedArrow_args = ["start_point", "end_point"]
DashedLine_args = ["dash_length", "dashed_ratio"]
Line_args = ["start", "end", "buff", "path_arc"]
TangentLine_args = ["vmob", "alpha", "length", "d_alpha"]
TipableVMobject_args = ["tip_length", "normal_vector", "tip_style"]
Underline_args = ["mobject", "buff"]
Vector_args = ["direction", "buff"]

# Mobjects: Fields, Functions & Updaters
function_classes = ["AnimatedBoundary", "ArrowVectorField", "ComplexValueTracker", "DashedVMobject", "FunctionGraph", "ImplicitFunction", "ParametricFunction", "StreamLines", "Surface", "TracedPath", "ValueTracker", "VectorField"]
AnimatedBoundary_args = ["vmobject", "colors", "max_stroke_width", "cycle_rate", "back_and_forth", "draw_rate_func", "fade_rate_func"]
ArrowVectorField_args = ["func", "color", "color_scheme", "min_color_scheme_value", "max_color_scheme_value", "colors", "x_range", "y_range", "z_range", "three_dimensions", "length_func", "opacity", "vector_config"]
ComplexValueTracker_args = ["value"]
DashedVMobject_args = ["vmobject", "num_dashes", "dashed_ratio", "dash_offset", "color", "equal_lengths"]
FunctionGraph_args = ["function", "x_range", "color"]
ImplicitFunction_args = ["func", "x_range", "y_range", "min_depth", "max_quads", "use_smoothing"]
ParametricFunction_args = ["function", "t_range", "scaling", "dt", "discontinuities", "use_smoothing", "use_vectorized"]
StreamLines_args = ["func", "color", "color_scheme", "min_color_scheme_value", "max_color_scheme_value", "colors", "x_range", "y_range", "z_range", "three_dimensions", "noise_factor", "n_repeats", "dt", "virtual_time", "max_anchors_per_line", "padding", "stroke_width", "opacity"]
Surface_args = ["func", "u_range", "v_range", "resolution", "surface_piece_config", "fill_color", "fill_opacity", "checkerboard_colors", "stroke_color", "stroke_width", "should_make_jagged", "pre_function_handle_to_anchor_scale_factor"]
TracedPath_args = ["traced_point_func", "stroke_width", "stroke_color", "dissipating_time"]
ValueTracker_args = ["value"]
VectorField_args = ["func", "color", "color_scheme", "min_color_scheme_value", "max_color_scheme_value", "colors"]

# Mobjects: Utility, Wrappers & Misc
util_classes = ["AnnotationDot", "BackgroundRectangle", "BraceLabel", "BraceText", "ConvexHull", "DecimalNumber", "Group", "ImageMobject", "Integer", "LabeledDot", "ManimBanner", "PGroup", "Point", "SampleSpace", "SVGMobject", "SurroundingRectangle", "VDict", "VGroup", "Variable", "VectorizedPoint"]
AnnotationDot_args = ["radius", "stroke_width", "stroke_color", "fill_color"]
BackgroundRectangle_args = ["mobjects", "color", "stroke_width", "stroke_opacity", "fill_opacity", "buff"]
BraceLabel_args = ["obj", "text", "brace_direction", "label_constructor", "font_size", "buff", "brace_config"]
DecimalNumber_args = ["number", "num_decimal_places", "mob_class", "include_sign", "group_with_commas", "digit_buff_per_font_unit", "show_ellipsis", "unit", "unit_buff_per_font_unit", "include_background_rectangle", "edge_to_fix", "font_size", "stroke_width", "fill_opacity"]
Group_args = ["mobjects"]
ImageMobject_args = ["filename_or_array", "scale_to_resolution", "invert", "image_mode"]
Integer_args = ["number", "num_decimal_places"]
LabeledDot_args = ["label", "radius", "buff"]
ManimBanner_args = ["dark_theme"]
Point_args = ["location", "color"]
SampleSpace_args = ["height", "width", "fill_color", "fill_opacity", "stroke_width", "stroke_color", "default_label_scale_val"]
SVGMobject_args = ["file_name", "should_center", "height", "width", "color", "opacity", "fill_color", "fill_opacity", "stroke_color", "stroke_opacity", "stroke_width", "svg_default", "path_string_config", "use_svg_cache"]
SurroundingRectangle_args = ["mobjects", "color", "buff", "corner_radius"]
VDict_args = ["mapping_or_iterable", "show_keys"]
VGroup_args = ["vmobjects"]
Variable_args = ["var", "label", "var_type", "num_decimal_places"]
VectorizedPoint_args = ["location", "color", "fill_opacity", "stroke_width", "artificial_width", "artificial_height"]

# --- Animation Classes & Params ---
common_animation_args = ["mobject", "lag_ratio", "run_time", "rate_func", "reverse_rate_function", "name", "remover", "suspend_mobject_updating", "introducer", "_on_finish", "use_override"]
common_animation_methods = ["begin", "clean_up_from_scene", "copy", "create_starting_mobject", "finish", "get_all_families_zipped", "get_all_mobjects", "get_all_mobjects_to_update", "get_rate_func", "get_run_time"]
animation_classes = ["AddTextLetterByLetter", "AnimationGroup", "ApplyComplexFunction", "ApplyFunction", "ApplyMatrix", "ApplyMethod", "ApplyWave", "Broadcast", "Circumscribe", "Create", "DrawBorderThenFill", "FadeIn", "FadeOut", "FadeToColor", "FadeTransform", "Flash", "FocusOn", "GrowArrow", "GrowFromCenter", "Homotopy", "Indicate", "LaggedStart", "MoveAlongPath", "MoveToTarget", "ReplacementTransform", "Restore", "Rotate", "Rotating", "ScaleInPlace", "ShowIncreasingSubsets", "Succession", "Transform", "Uncreate", "Wait", "Wiggle", "Write", "Unwrite"]
AddTextLetterByLetter_args = ["text", "suspend_mobject_updating", "int_func", "rate_func", "time_per_char", "run_time", "reverse_rate_function", "introducer"]
AnimationGroup_args = ["animations", "group", "run_time", "rate_func", "lag_ratio"]
ApplyComplexFunction_args = ["function", "mobject"]
ApplyFunction_args = ["function", "mobject"]
ApplyMatrix_args = ["matrix", "mobject", "about_point"]
ApplyMethod_args = ["method"]
ApplyWave_args = ["mobject", "direction", "amplitude", "wave_func", "time_width", "ripples", "run_time"]
Broadcast_args = ["mobject", "focal_point", "n_mobs", "initial_opacity", "final_opacity", "initial_width", "remover", "lag_ratio", "run_time"]
Circumscribe_args = ["mobject", "shape", "fade_in", "fade_out", "time_width", "buff", "color", "run_time", "stroke_width"]
Create_args = ["mobject", "lag_ratio", "introducer"]
DrawBorderThenFill_args = ["vmobject", "run_time", "rate_func", "stroke_width", "stroke_color", "introducer"]
FadeIn_args = ["mobjects"]
FadeOut_args = ["mobjects"]
FadeToColor_args = ["mobject", "color"]
FadeTransform_args = ["mobject", "target_mobject", "stretch", "dim_to_match"]
Flash_args = ["point", "line_length", "num_lines", "flash_radius", "line_stroke_width", "color", "time_width", "run_time"]
FocusOn_args = ["focus_point", "opacity", "color", "run_time"]
GrowArrow_args = ["arrow", "point_color"]
GrowFromCenter_args = ["mobject", "point_color"]
Homotopy_args = ["homotopy", "mobject", "run_time", "apply_function_kwargs"]
Indicate_args = ["mobject", "scale_factor", "color", "rate_func"]
LaggedStart_args = ["animations", "lag_ratio"]
MoveAlongPath_args = ["mobject", "path", "suspend_mobject_updating"]
MoveToTarget_args = ["mobject"]
ReplacementTransform_args = ["mobject", "target_mobject"]
Restore_args = ["mobject"]
Rotate_args = ["mobject", "angle", "axis", "about_point", "about_edge"]
Rotating_args = ["mobject", "angle", "axis", "about_point", "about_edge", "run_time", "rate_func"]
ScaleInPlace_args = ["mobject", "scale_factor"]
ShowIncreasingSubsets_args = ["group", "suspend_mobject_updating", "int_func", "reverse_rate_function"]
Succession_args = ["animations", "lag_ratio"]
Transform_args = ["mobject", "target_mobject", "path_func", "path_arc", "path_arc_axis", "path_arc_centers", "replace_mobject_with_target_in_scene"]
Uncreate_args = ["mobject", "reverse_rate_function", "remover"]
Wait_args = ["run_time", "stop_condition", "frozen_frame", "rate_func"]
Wiggle_args = ["mobject", "scale_value", "rotation_angle", "n_wiggles", "scale_about_point", "rotate_about_point", "run_time"]
Write_args = ["vmobject", "rate_func", "reverse"]
Unwrite_args = ["vmobject", "rate_func", "reverse"]`

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

### API 索引表

\`\`\`python
${apiIndex}
\`\`\`

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
- **坐标系一致性**：所有图形必须通过 \`axes.c2p\` 映射到坐标轴上，严禁脱离坐标系的自由定位。

## 规范层

### 严禁行为

- **严禁解释**：禁止在代码前后添加任何类似 "Sure, here is your code" 的废话。
- **严禁 Markdown**：禁止使用 Markdown 语法包装代码。
- **严禁旧语法**：禁止使用 \`ShowCreation\`, \`TextMobject\`, \`TexMobject\`, \`number_scale_val\`。
- **严禁缩进污染**：所有代码行必须按照标准的 Python 缩进规则生成，第一行代码（import行）必须从第 0 列开始，禁止任何前缀空格。你的输出必须直接以 \`from manim import *\` 开头，严禁任何前导字符、空格或换行。

### 错误纠正

- **索引陷阱**：严禁对 \`MathTex\` 使用 \`[i]\` 索引。
- **配置字典**：严禁直接在 \`Axes\` 初始化中传入视觉参数，必须封装在 \`axis_config\` 中。

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
function extractCodeFromResponse(text: string): string {
  if (!text) return ''

  // 移除 <think> 标签及其中的内容
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '')

  // 优先匹配锚点之间的内容
  const anchorMatch = text.match(/### START ###\n([\s\S]*?)\n### END ###/)
  if (anchorMatch) {
    return anchorMatch[1].trim()
  }

  // 尝试匹配带语言标识的代码块
  const match = text.match(/```(?:python)?\n([\s\S]*?)```/i)
  if (match) {
    return match[1].trim()
  }

  return text.trim()
}

/**
 * 使用 OpenAI 生成 Manim 代码
 * 使用较高的温度以获得多样化的输出，并为每次请求使用唯一种子
 */
export async function generateAIManimCode(concept: string, customApiConfig?: CustomApiConfig): Promise<string> {
  // 使用自定义 API 或默认客户端
  const client = customApiConfig ? createCustomClient(customApiConfig) : openaiClient

  if (!client) {
    logger.warn('OpenAI 客户端不可用')
    return ''
  }

  try {
    const seed = generateUniqueSeed(concept)

    const systemPrompt = `你是一位 Manim 动画专家，专注于通过动态动画深度解读数学概念。
严格按照提示词规范输出，确保代码符合 Manim Community Edition (v0.19.2) 的最佳实践。`

    const userPrompt = generateManimPrompt(concept, seed)

    const response = await client.chat.completions.create({
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
      logger.warn('AI 返回空内容')
      return ''
    }

    // 记录完整的 AI 响应
    logger.info('AI 代码生成成功', {
      concept,
      seed,
      responseLength: content.length,
      response: content
    })

    const extractedCode = extractCodeFromResponse(content)
    logger.info('代码提取完成', {
      extractedLength: extractedCode.length,
      code: extractedCode
    })

    return extractedCode
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error('OpenAI API 错误', {
        concept,
        status: error.status,
        code: error.code,
        type: error.type,
        message: error.message,
        headers: JSON.stringify(error.headers),
        cause: error.cause
      })
    } else if (error instanceof Error) {
      logger.error('AI 生成失败', {
        concept,
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack
      })
    } else {
      logger.error('AI 生成失败（未知错误）', { concept, error: String(error) })
    }
    return ''
  }
}

/**
 * 检查 OpenAI 客户端是否可用
 */
export function isOpenAIAvailable(): boolean {
  return openaiClient !== null
}
