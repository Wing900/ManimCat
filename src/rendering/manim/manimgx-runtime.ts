import fs from 'node:fs'
import path from 'node:path'
import type { NormalizedExecuteOptions } from '../../utils/manim-executor-runtime'

const RESOLUTIONS: Record<string, { width: number; height: number }> = {
  low: { width: 854, height: 480 },
  medium: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 },
}

/** One command and one declared artifact for both video and still renders. */
export function buildManimGxCommand(codeFile: string, options: NormalizedExecuteOptions): {
  command: string
  args: string[]
  outputPath: string
} {
  const resolution = RESOLUTIONS[options.quality] ?? RESOLUTIONS.medium
  const localPython = path.resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  const command = process.env.MANIMGX_PYTHON?.trim() || (fs.existsSync(localPython) ? localPython : 'python')
  const outputPath = path.resolve(options.mediaDir, `output.${options.format}`)

  return {
    command,
    outputPath,
    args: [
      '-u',
      path.resolve('src/rendering/manim/manimgx-runner.py'),
      path.resolve(codeFile),
      ...(options.sceneName ? ['--scene', options.sceneName] : []),
      '--output', outputPath,
      '--format', options.format,
      '--width', String(resolution.width),
      '--height', String(resolution.height),
      '--fps', String(options.frameRate),
    ],
  }
}
