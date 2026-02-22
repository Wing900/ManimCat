import type { PromptOverrides } from '../types'

export function hasPromptOverrides(promptOverrides?: PromptOverrides): boolean {
  if (!promptOverrides) return false

  const roles = promptOverrides.roles || {}
  const shared = promptOverrides.shared || {}

  const hasRoleOverride = Object.values(roles).some((roleValue) => {
    if (!roleValue || typeof roleValue !== 'object') return false
    return ['system', 'user'].some((field) => {
      const content = roleValue[field as 'system' | 'user']
      return typeof content === 'string' && content.trim().length > 0
    })
  })

  const hasSharedOverride = Object.values(shared).some(
    (value) => typeof value === 'string' && value.trim().length > 0
  )

  return hasRoleOverride || hasSharedOverride
}
