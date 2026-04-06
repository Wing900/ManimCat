import type { StudioSession } from '../domain/types'
import type { StudioResolvedSkill } from '../runtime/tool-runtime-context'
import { createStudioSkillRuntime } from './runtime/skill-runtime'

export function createLocalStudioSkillResolver(options?: { maxFiles?: number }) {
  const runtime = createStudioSkillRuntime({ maxFiles: options?.maxFiles })

  return async function resolveSkill(name: string, session: StudioSession): Promise<StudioResolvedSkill> {
    return runtime.resolve(name, session)
  }
}
