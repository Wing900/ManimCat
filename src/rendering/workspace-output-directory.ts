import path from 'node:path'

/** Version paths are allocated internally, never accepted as arbitrary filesystem locations. */
export function workspaceRenderOutputDirectory(workspace: string, legacyId: string, versionDirectory?: string): string {
  if (versionDirectory) {
    if (!/^renders\/(?:scene_[1-9]\d*\/)?v[1-9]\d*$/.test(versionDirectory)) throw new Error('Invalid render output directory')
    return path.join(workspace, versionDirectory)
  }
  return path.join(workspace, 'renders', legacyId)
}
