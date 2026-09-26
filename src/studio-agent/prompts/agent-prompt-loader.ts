import fs from 'node:fs'
import path from 'node:path'
import type { StudioAgentType, StudioKind } from '../domain/types'

const TEMPLATE_ROOT = path.join(process.cwd(), 'src', 'studio-agent', 'prompts', 'templates')
const templateCache = new Map<string, string>()

function readTemplate(filePath: string): string {
  const cached = templateCache.get(filePath)
  if (cached) {
    return cached
  }

  const content = fs.readFileSync(filePath, 'utf8')
  templateCache.set(filePath, content)
  return content
}

export function clearStudioAgentPromptCache(): void {
  templateCache.clear()
}

/**
 * Loads the shared builder role template.
 * `studioKind` is kept for call compatibility; scene facts travel as structured
 * `<studio_scene>` context built in orchestration/studio-agent-prompt.ts.
 */
export function getStudioAgentSystemPrompt(
  agentType: StudioAgentType,
  studioKind: StudioKind = 'manim'
): string {
  void studioKind
  return readTemplate(path.join(TEMPLATE_ROOT, 'roles', `${agentType}.system.md`)).trim()
}
