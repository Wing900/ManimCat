## 规范层

### 严禁行为

- **严禁解释**：禁止在代码前后添加任何类似 "Sure, here is your code" 的废话
- **严禁 Markdown**：禁止使用 Markdown 语法包装代码
- **中文渲染禁区**：任何中文说明必须只使用 `Text()` 或 `MarkupText()`，严禁在 `MathTex`/`Tex` 中写中文；公式和中文禁止混用
- **严禁旧语法**：禁止使用 `ShowCreation`, `TextMobject`, `TexMobject`, `number_scale_val`

### 错误纠正

- **索引陷阱**：严禁对 `MathTex` 使用 `[i]` 索引
- **配置字典**：严禁直接在 `Axes` 初始化中传入视觉参数，必须封装在 `axis_config` 中
- **虚线陷阱**：严禁在 `plot()`, `Line()`, `Circle()` 等普通绘图函数中直接使用 `dash_length` 或 `dashed_ratio`

### API 严格性（非黑即白原则）

- **白名单机制**：只使用 API 索引表中明确列出的方法、参数和类
- **黑名单机制**：任何索引表未提及的用法，默认不可用
- **禁止联想**：严禁对索引表外的 API 进行任何联想、猜测或组合
- **严格归属**：Scene 只能使用 Scene_methods 中的方法，ThreeDScene 只能使用 ThreeDScene_methods 中的方法，严禁混用

### 技术原则

- **动态更新**：对于涉及数值变化的过程，优先使用 `ValueTracker` 和 `always_redraw`
- **公式操作规范**：禁止使用硬编码索引，必须通过 `substrings_to_isolate` 配合 `get_part_by_tex` 来操作公式的特定部分
- **坐标系一致性**：所有图形必须通过 `axes.c2p` 映射到坐标轴上，严禁脱离坐标系的自由定位
- **避障与对齐**：文字、标注和公式必须有明确的方位偏移（优先使用 `next_to`、`shift` 或 `buff` 参数），严禁多个文字元素重叠在同一位置
