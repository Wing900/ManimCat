/**
 * Manim API 索引表 - 共享常量
 * AI 生成代码时使用的 API 参考
 */

export const API_INDEX = `# Manim API 索引表（AI 专用）。注意：所有 Mobjects 都接受 'global_vmobject_params'。每个类只列出独特参数。

# --- 全局与场景 ---
globalization_params = ["background_image", "background_stroke_color", "background_stroke_opacity", "background_stroke_width", "cap_style", "close_new_points", "color", "dim", "fill_color", "fill_opacity", "joint_type", "make_smooth_after_applyingariang_functions", "n_points_per_cubic_curve", "name", "pre_function_handle_to_anchor_scale_factor", "shade_in_3d", "sheen_direction", "sheen_factor", "stroke_color", "stroke_opacity", "stroke_width", "target", "tolerance_for_point_equality", "z_index"]
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
