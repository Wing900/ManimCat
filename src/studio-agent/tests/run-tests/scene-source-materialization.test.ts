import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  MAX_STUDIO_SCENE_SOURCES,
  MAX_STUDIO_SCENE_SOURCE_LENGTH,
  materializeStudioSceneSources,
  StudioSceneSourceRejectedError,
} from '../../scenes/materialize-studio-scene-sources'
import { run } from './factories'

async function createRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'studio-scene-sources-'))
}

export async function runSceneSourceMaterializationTests(): Promise<void> {
  await run('Scene sources land as scenes/<id>.py under the Session directory', async () => {
    const root = await createRoot()
    const result = await materializeStudioSceneSources({
      rootDirectory: root,
      sceneSources: { scene_1: 'FIRST = 1\n', scene_2: 'SECOND = 2\n' }
    })

    assert.deepEqual(result.sceneIds.sort(), ['scene_1', 'scene_2'])
    assert.equal(await fs.readFile(path.join(root, 'scenes', 'scene_1.py'), 'utf8'), 'FIRST = 1\n')
    assert.equal(await fs.readFile(path.join(root, 'scenes', 'scene_2.py'), 'utf8'), 'SECOND = 2\n')
  })

  await run('an existing Scene file is replaced by what the browser sent', async () => {
    const root = await createRoot()
    await fs.mkdir(path.join(root, 'scenes'), { recursive: true })
    await fs.writeFile(path.join(root, 'scenes', 'scene_1.py'), 'STALE = 0\n', 'utf8')

    await materializeStudioSceneSources({ rootDirectory: root, sceneSources: { scene_1: 'FRESH = 1\n' } })

    assert.equal(await fs.readFile(path.join(root, 'scenes', 'scene_1.py'), 'utf8'), 'FRESH = 1\n')
  })

  await run('a Scene id that is not a Python module stem is refused', async () => {
    const root = await createRoot()
    for (const sceneId of ['../evil', 'scene-1', 'scene_1/../../evil', '', 'scenes/scene_1']) {
      await assert.rejects(
        () => materializeStudioSceneSources({ rootDirectory: root, sceneSources: { [sceneId]: 'X = 1\n' } }),
        (error: unknown) =>
          error instanceof StudioSceneSourceRejectedError && error.reason === 'invalid_scene_id'
      )
    }

    // Nothing escaped: the only possible location is scenes/, and it stays empty.
    const entries = await fs.readdir(path.join(root, 'scenes')).catch(() => [])
    assert.deepEqual(entries, [])
  })

  await run('too many Scene sources are refused before anything is written', async () => {
    const root = await createRoot()
    const sceneSources: Record<string, string> = {}
    for (let index = 0; index <= MAX_STUDIO_SCENE_SOURCES; index++) {
      sceneSources[`scene_${index + 1}`] = `X = ${index}\n`
    }

    await assert.rejects(
      () => materializeStudioSceneSources({ rootDirectory: root, sceneSources }),
      (error: unknown) => error instanceof StudioSceneSourceRejectedError && error.reason === 'too_many_sources'
    )

    const entries = await fs.readdir(path.join(root, 'scenes')).catch(() => [])
    assert.deepEqual(entries, [])
  })

  await run('an oversized Scene source is refused', async () => {
    const root = await createRoot()
    await assert.rejects(
      () =>
        materializeStudioSceneSources({
          rootDirectory: root,
          sceneSources: { scene_1: 'x'.repeat(MAX_STUDIO_SCENE_SOURCE_LENGTH + 1) }
        }),
      (error: unknown) => error instanceof StudioSceneSourceRejectedError && error.reason === 'source_too_large'
    )
  })

  await run('a scenes path that is not a real directory is refused', async () => {
    const root = await createRoot()
    await fs.writeFile(path.join(root, 'scenes'), 'not a directory\n', 'utf8')

    await assert.rejects(
      () => materializeStudioSceneSources({ rootDirectory: root, sceneSources: { scene_1: 'X = 1\n' } }),
      (error: unknown) =>
        error instanceof StudioSceneSourceRejectedError && error.reason === 'unsafe_scene_directory'
    )
  })
}
