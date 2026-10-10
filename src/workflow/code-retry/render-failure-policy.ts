export type RenderFailureCategory =
  | 'code'
  | 'resource'
  | 'timeout'
  | 'environment'
  | 'cancelled'

export interface RenderFailureDecision {
  category: RenderFailureCategory
  allowAiRepair: boolean
  reason: string
}

const NON_REPAIRABLE_FAILURES: Array<{
  category: Exclude<RenderFailureCategory, 'code'>
  pattern: RegExp
  reason: string
}> = [
  {
    category: 'cancelled',
    pattern: /(?:job cancelled|operation cancelled|render cancelled)/i,
    reason: 'render was cancelled'
  },
  {
    category: 'resource',
    pattern: /(?:MemoryError|Unable to allocate|out of memory|ENOMEM|paging file is too small)/i,
    reason: 'render exhausted available memory'
  },
  {
    category: 'timeout',
    pattern: /(?:render timeout|timed out|ETIMEDOUT)/i,
    reason: 'render exceeded its execution deadline'
  },
  {
    category: 'environment',
    pattern: /(?:ENOSPC|no space left on device|disk quota exceeded|read-only file system)/i,
    reason: 'render environment cannot write its output'
  },
  {
    category: 'environment',
    pattern: /(?:spawn manim ENOENT|No module named ['"]manim['"]|manim(?:\.exe)?: command not found)/i,
    reason: 'Manim runtime is unavailable'
  },
  {
    category: 'environment',
    pattern: /(?:Fatal Python error|access violation|segmentation fault)/i,
    reason: 'render runtime terminated fatally'
  }
]

export function classifyRenderFailure(stderr: string): RenderFailureDecision {
  for (const failure of NON_REPAIRABLE_FAILURES) {
    if (failure.pattern.test(stderr)) {
      return {
        category: failure.category,
        allowAiRepair: false,
        reason: failure.reason
      }
    }
  }

  return {
    category: 'code',
    allowAiRepair: true,
    reason: 'render failure may be repaired by changing code'
  }
}
