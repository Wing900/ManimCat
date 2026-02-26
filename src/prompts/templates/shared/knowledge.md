## 知识层

### API 索引表

```python
{{apiIndex}}
```

### Soul 补充索引表

```python
{{soulIndex}}
```

### 环境背景

- **版本**：Manim Community Edition (v0.19.2)
- **核心逻辑**：基于向量化绘图，强调 `.animate` 链式调用

### LaTeX 专项知识

1. **LaTeX 渲染协议 (Rendering Protocol)**
   - **双反斜杠规则**：在 Python 字符串中，所有 LaTeX 命令必须使用双反斜杠（如 `\\frac`, `\\theta`, `\\pm`），或者在字符串前加 `r`（如 `r"\\frac"`）
   - **MathTex vs Tex**：
     - `MathTex`：默认进入数学模式（无需 `$...$`），用于公式
     - `Tex`：默认文本模式，数学符号需要包裹在 `$...$` 中

