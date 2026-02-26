## 目标

### 修改信息

- **概念**：{{concept}}
- **修改意见**：{{instructions}}

### 输出要求

- **仅输出代码**：禁止解释或 Markdown 包裹
- **画布边界（硬约束）**：x in [-8, 8]，y in [-4.5, 4.5]。修改后任何元素都不得越界。
{{#if isVideo}}
- **锚点协议（视频）**：使用 ### START ### 开始，### END ### 结束，仅输出锚点之间的代码
- **结构规范（视频）**：场景类固定为 `MainScene`，统一使用 `from manim import *`
{{/if}}
{{#if isImage}}
- **锚点协议（图片）**：仅允许输出 YON_IMAGE 锚点块，块外禁止任何字符。
- **格式（图片）**：
  - `### YON_IMAGE_1_START ###`
  - `...python code...`
  - `### YON_IMAGE_1_END ###`
  - `### YON_IMAGE_2_START ###`
  - `...python code...`
  - `### YON_IMAGE_2_END ###`
- **编号规则（图片）**：编号必须从 1 开始连续递增。
- **结构规范（图片）**：每个块都必须包含可渲染 Scene 类，统一使用 `from manim import *`。
{{/if}}

## 原始代码

```python
{{code}}
```

请根据修改意见输出完整的 Manim Python 代码。
