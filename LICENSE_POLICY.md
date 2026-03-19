# LICENSE POLICY

本文件为 ManimCat 仓库的授权范围说明文件（binding scope）。

## 1) 适用优先级

1. `LICENSE_POLICY.md`（本文件）定义文件/路径级授权边界。
2. `LICENSES/MIT.txt` 与 `LICENSES/ManimCat-NC.txt` 提供完整协议文本。
3. 未在本文件中列入 MIT 清单的文件，默认适用 `ManimCat-NC`（非商业）协议。

## 2) MIT 清单（可商用）

以下文件/路径适用 MIT（括号说明：因为包含原作者项目相关部分或高度相似衍生链路）：

- `src/services/manim-templates.ts`（因包含原作者相关模板与匹配链路）
- `src/services/manim-templates/**`（因包含原作者相关模板与匹配链路）
- `src/services/openai-client.ts`（因包含原作者相关调用链路）
- `src/services/job-store.ts`（因包含原作者相关接口链路）
- `src/utils/logger.ts`（因包含原作者相关日志结构）
- `src/middlewares/error-handler.ts`（因包含原作者相关错误处理链路）

第三方来源说明见：
- `THIRD_PARTY_NOTICES.md`
- `THIRD_PARTY_NOTICES.zh-CN.md`

## 3) 非商业清单（默认）

除“MIT 清单”外，本仓库其余文件默认适用 `LICENSES/ManimCat-NC.txt`。

## 4) 另行商业授权

若需将非商业范围内文件用于商业用途，需与作者签署书面商业授权。

## 5) 历史版本说明

本政策用于定义本仓库当前与后续版本的授权边界；历史版本若已在其他条款下发布，请以对应版本中的授权声明为准。
