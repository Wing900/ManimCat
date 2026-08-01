export function buildStudioPreToolCommentary(input: {
  toolName: string
  toolInput: Record<string, unknown>
}): string {
  const path = readPathLabel(input.toolInput)

  switch (input.toolName) {
    case 'ls':
      return path ? `我先看一下 ${path} 的目录结构。` : '我先看一下当前目录结构。'
    case 'read':
      return path ? `我先读取 ${path} 看看当前内容。` : '我先读取相关文件看看当前内容。'
    case 'glob':
      return '我先按模式查找相关文件。'
    case 'grep':
      return '我先搜索相关代码和上下文。'
    case 'write':
      return path ? `我准备写入 ${path}。` : '我准备写入目标文件。'
    case 'edit':
    case 'apply_patch':
      return path ? `我先修改 ${path}。` : '我先修改相关文件。'
    case 'static-check':
      return '我先做一次静态检查确认当前状态。'
    case 'task':
      return '我准备启动一个子任务处理这部分工作。'
    case 'render':
      return '我准备提交渲染任务。'
    default:
      return `我先执行 ${input.toolName}。`
  }
}

function readPathLabel(input: Record<string, unknown>): string | null {
  const candidates = [input.path, input.file, input.directory]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}
