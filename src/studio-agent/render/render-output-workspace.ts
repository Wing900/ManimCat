import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** mkdir is an exclusive reservation, including across workers sharing the workspace. */
function reserveNumberedDirectory(parent: string, prefix: string): { directory: string; number: number } {
  fs.mkdirSync(parent, { recursive: true })
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  let number = fs.readdirSync(parent).reduce((max, name) => Math.max(max, Number(pattern.exec(name)?.[1] ?? 0)), 0) + 1
  for (;;) {
    const directory = path.join(parent, `${prefix}${number}`)
    try { fs.mkdirSync(directory); return { directory, number } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; number += 1 }
  }
}

/** Stable scene aliases survive reordering. Index publication uses an exclusive hard link:
 * readers never see a partially written alias; concurrent creators converge on one winner.
 */
function sceneDirectory(root: string, sceneId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sceneId)) throw new Error('Invalid render scene scope')
  const index = path.join(root, '.scopes')
  fs.mkdirSync(index, { recursive: true })
  const binding = path.join(index, sceneId)
  function read(): string {
    const name = fs.readFileSync(binding, 'utf8')
    if (!/^scene_[1-9]\d*$/.test(name)) throw new Error('Invalid render scene binding')
    return path.join(root, name)
  }
  if (fs.existsSync(binding)) return read()
  const reserved = reserveNumberedDirectory(root, 'scene_')
  const temporary = path.join(index, `${sceneId}.${randomUUID()}.tmp`)
  fs.writeFileSync(temporary, path.basename(reserved.directory), { flag: 'wx' })
  try {
    try { fs.linkSync(temporary, binding) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  } finally { fs.unlinkSync(temporary) }
  return read()
}

/** Public workspace paths are readable; queue/database identities remain independent. */
export function reserveRenderOutputWorkspace(workspace: string, sceneId?: string) {
  const root = path.join(workspace, 'renders')
  const scope = sceneId ? sceneDirectory(root, sceneId) : root
  const reserved = reserveNumberedDirectory(scope, 'v')
  return {
    workspaceOutputDirectory: path.relative(workspace, reserved.directory).replace(/\\/g, '/'),
    version: reserved.number,
    label: `V${reserved.number}`,
  }
}
