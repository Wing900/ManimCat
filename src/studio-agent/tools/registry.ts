import type { StudioAgentType, StudioKind, StudioToolDefinition } from '../domain/types'

export class StudioToolRegistry {
  private readonly tools = new Map<string, StudioToolDefinition<any>[]>()

  register(tool: StudioToolDefinition<any>): void {
    const existing = this.tools.get(tool.name) ?? []
    if (existing.some((candidate) => haveOverlappingStudioKinds(candidate.allowedStudioKinds, tool.allowedStudioKinds))) {
      throw new Error(`Duplicate Studio tool registration: ${tool.name}`)
    }
    this.tools.set(tool.name, [...existing, tool])
  }

  get(toolName: string, studioKind?: StudioKind): StudioToolDefinition<any> | null {
    const candidates = this.tools.get(toolName) ?? []
    if (!candidates.length) {
      return null
    }

    if (!studioKind) {
      return candidates[0] ?? null
    }

    return candidates.find((tool) => this.matchesStudioKind(tool, studioKind)) ?? null
  }

  require(toolName: string, studioKind: StudioKind): StudioToolDefinition<any> {
    const tool = this.get(toolName, studioKind)
    if (!tool) {
      throw new Error(`Unsupported Studio tool: ${toolName}`)
    }
    return tool
  }

  list(): StudioToolDefinition<any>[] {
    return [...this.tools.values()].flat()
  }

  listForAgent(agentType: StudioAgentType, studioKind?: StudioKind): StudioToolDefinition<any>[] {
    return this.list().filter((tool) => (
      tool.allowedAgents.includes(agentType)
      && this.matchesStudioKind(tool, studioKind)
    ))
  }

  private matchesStudioKind(tool: StudioToolDefinition<any>, studioKind?: StudioKind): boolean {
    if (!studioKind || !tool.allowedStudioKinds?.length) {
      return true
    }

    return tool.allowedStudioKinds.includes(studioKind)
  }
}

function haveOverlappingStudioKinds(left?: StudioKind[], right?: StudioKind[]): boolean {
  if (!left?.length || !right?.length) {
    return true
  }
  return left.some((kind) => right.includes(kind))
}
