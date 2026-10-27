import fs from 'node:fs'
import path from 'node:path'
import { clearTemplateCache, getVisualStylePrompt } from '../../prompts/loader'
import type { StudioAgentType } from '../domain/types'

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
  clearTemplateCache()
}

/**
 * Loads the shared builder role template. Studio differences never travel through this loader:
 * scene facts arrive as structured `<studio_scene>` context built in
 * orchestration/studio-agent-prompt.ts.
 */
export function getStudioAgentSystemPrompt(agentType: StudioAgentType): string {
  const template = readTemplate(path.join(TEMPLATE_ROOT, 'roles', `${agentType}.system.md`)).trim()
  if (agentType !== 'builder' || !template.includes('{{visualStyle}}')) {
    return template
  }
  return template.split('{{visualStyle}}').join(getVisualStylePrompt('en-US'))
}
