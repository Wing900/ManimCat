import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { workspaceRenderOutputDirectory } from '../workspace-output-directory'
import { StudioRunCancelledError, isStudioRunCancelledError, readAbortReason, throwIfStudioRunCancelled } from '../../studio-agent/runtime/execution/run-cancellation'

export interface MatplotlibExecutionResult {
  outputDir: string
  scriptPath: string
  imageDataUris: string[]
  imagePaths: string[]
  stdout: string
  stderr: string
}

export async function executeMatplotlibRender(input: {
  workspaceDirectory: string
  workspaceOutputDirectory?: string
  renderId: string
  code: string
  signal?: AbortSignal
}): Promise<MatplotlibExecutionResult> {
  throwIfStudioRunCancelled(input.signal)
  const outputDir = workspaceRenderOutputDirectory(input.workspaceDirectory, input.renderId, input.workspaceOutputDirectory)
  const matplotlibConfigDir = join(input.workspaceDirectory, '.cache', 'matplotlib')
  await mkdir(outputDir, { recursive: true })
  await mkdir(matplotlibConfigDir, { recursive: true })

  const sourcePath = join(outputDir, 'plot_script.py')
  const wrapperPath = join(outputDir, 'plot_executor.py')
  await writeFile(sourcePath, input.code, 'utf8')
  await writeFile(wrapperPath, buildExecutorScript(), 'utf8')

  const { stdout, stderr } = await runPython(wrapperPath, [sourcePath, outputDir, matplotlibConfigDir], input.signal)
  const parsedImagePaths = parseJsonLine(stdout, 'PLOT_OUTPUTS_JSON=') as string[] | undefined
  const imagePaths = Array.isArray(parsedImagePaths) && parsedImagePaths.length > 0
    ? parsedImagePaths
    : await findPngOutputs(outputDir)

  if (imagePaths.length === 0) {
    throw new Error(stderr.trim() || 'Matplotlib execution finished without producing any image output')
  }

  const imageDataUris = await Promise.all(imagePaths.map(async (imagePath) => {
    const bytes = await readFile(imagePath)
    return `data:image/png;base64,${bytes.toString('base64')}`
  }))

  return {
    outputDir,
    scriptPath: sourcePath,
    imageDataUris,
    imagePaths,
    stdout,
    stderr,
  }
}

async function findPngOutputs(outputDir: string): Promise<string[]> {
  const entries = await readdir(outputDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
    .map((entry) => join(outputDir, entry.name))
    .sort((a, b) => a.localeCompare(b))
}

async function runPython(scriptPath: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  const candidates = [
    { command: 'python', args: [scriptPath, ...args], matplotlibConfigDirIndex: 2 },
    { command: 'py', args: ['-3', scriptPath, ...args], matplotlibConfigDirIndex: 4 },
  ]

  const failures: string[] = []
  for (const candidate of candidates) {
    try {
      return await spawnProcess(candidate.command, candidate.args, candidate.matplotlibConfigDirIndex, signal)
    } catch (error) {
      if (isStudioRunCancelledError(error)) throw error
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${candidate.command} failed: ${message}`)
    }
  }

  throw new Error(`Unable to execute Python for matplotlib render. ${failures.join(' | ')}`)
}

function spawnProcess(
  command: string,
  args: string[],
  matplotlibConfigDirIndex: number,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new StudioRunCancelledError(readAbortReason(signal)))
      return
    }

    const matplotlibConfigDir = args[matplotlibConfigDirIndex]
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MPLCONFIGDIR: matplotlibConfigDir ?? process.env.MPLCONFIGDIR,
      },
    })
    let stdout = ''
    let stderr = ''
    let finished = false

    const cleanupAbort = () => {
      signal?.removeEventListener('abort', handleAbort)
    }

    const settleReject = (error: Error) => {
      if (finished) {
        return
      }
      finished = true
      cleanupAbort()
      reject(error)
    }

    const settleResolve = (value: { stdout: string; stderr: string }) => {
      if (finished) {
        return
      }
      finished = true
      cleanupAbort()
      resolve(value)
    }

    const handleAbort = () => {
      child.kill('SIGTERM')
      settleReject(new StudioRunCancelledError(readAbortReason(signal)))
    }

    signal?.addEventListener('abort', handleAbort, { once: true })

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      settleReject(error instanceof Error ? error : new Error(String(error)))
    })
    child.on('close', (code) => {
      if (finished) {
        return
      }
      if (code === 0) {
        settleResolve({ stdout, stderr })
        return
      }

      settleReject(new Error(stderr.trim() || `Python process exited with code ${code}`))
    })
  })
}

function parseJsonLine(stdout: string, prefix: string): unknown {
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(prefix))
  if (!line) {
    return undefined
  }

  return JSON.parse(line.slice(prefix.length))
}

function buildExecutorScript(): string {
  return [
    'import json',
    'import os',
    'import sys',
    'import matplotlib',
    "matplotlib.use('Agg')",
    'import matplotlib.pyplot as plt',
    '',
    'source_path = sys.argv[1]',
    'output_dir = sys.argv[2]',
    'mpl_config_dir = sys.argv[3] if len(sys.argv) > 3 else None',
    'if mpl_config_dir:',
    '    os.makedirs(mpl_config_dir, exist_ok=True)',
    '    os.environ["MPLCONFIGDIR"] = mpl_config_dir',
    'os.makedirs(output_dir, exist_ok=True)',
    'os.chdir(output_dir)',
    "namespace = {'plt': plt, '__name__': '__main__', '__file__': source_path}",
    '',
    'with open(source_path, "r", encoding="utf-8") as f:',
    '    source = f.read()',
    '',
    'exec(compile(source, source_path, "exec"), namespace)',
    '',
    'figure_numbers = plt.get_fignums()',
    'outputs = []',
    'for index, figure_number in enumerate(figure_numbers, start=1):',
    '    figure = plt.figure(figure_number)',
    '    output_path = os.path.join(output_dir, f"plot_{index}.png")',
    '    figure.savefig(output_path, dpi=160, bbox_inches="tight")',
    '    outputs.append(output_path)',
    '',
    'if not outputs:',
    '    outputs = [',
    '        os.path.join(output_dir, name)',
    '        for name in sorted(os.listdir(output_dir))',
    '        if name.lower().endswith(".png")',
    '    ]',
    '',
    'if not outputs:',
    '    raise RuntimeError("No matplotlib figures or PNG outputs were produced by the script")',
    '',
    'print("PLOT_OUTPUTS_JSON=" + json.dumps(outputs, ensure_ascii=False))',
  ].join('\n')
}
