import type {
  StudioPermissionDecision,
  StudioPermissionLevel,
  StudioPermissionRequest,
  StudioPermissionRule
} from '../domain/types'

function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === '*') {
    return true
  }

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(value)
}

export function evaluatePermission(
  rules: StudioPermissionRule[],
  permission: string,
  pattern: string
): 'allow' | 'ask' | 'deny' {
  const match = rules.find(
    (rule) => (rule.permission === permission || rule.permission === '*') && matchesPattern(rule.pattern, pattern)
  )
  return match?.action ?? 'ask'
}

export function defaultRulesForLevel(level: StudioPermissionLevel): StudioPermissionRule[] {
  switch (level) {
    case 'L0':
    case 'L1':
      return []
    case 'L2':
      return [
        { permission: 'read', pattern: '*', action: 'allow' },
        { permission: 'glob', pattern: '*', action: 'allow' },
        { permission: 'grep', pattern: '*', action: 'allow' },
        { permission: 'ls', pattern: '*', action: 'allow' },
        { permission: 'skill', pattern: '*', action: 'allow' }
      ]
    case 'L3':
      return [
        ...defaultRulesForLevel('L2'),
        { permission: 'bash', pattern: '*', action: 'allow' }
      ]
    case 'L4':
      return [{ permission: '*', pattern: '*', action: 'allow' }]
  }
}

export function mergePermissionRules(
  baseRules: StudioPermissionRule[],
  overrides: StudioPermissionRule[]
): StudioPermissionRule[] {
  return [...overrides, ...baseRules]
}

export function buildChildSessionRules(input: {
  parentRules: StudioPermissionRule[]
  denyTask?: boolean
  extraRules?: StudioPermissionRule[]
}): StudioPermissionRule[] {
  const rules: StudioPermissionRule[] = []

  if (input.denyTask ?? true) {
    rules.push({ permission: 'task', pattern: '*', action: 'deny' })
  }

  if (input.extraRules?.length) {
    rules.push(...input.extraRules)
  }

  rules.push(...input.parentRules)
  return rules
}

export type StudioPermissionResolver = (
  request: StudioPermissionRequest
) => Promise<StudioPermissionDecision>
