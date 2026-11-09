import { mkdir, readFile, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import { join } from 'node:path'
import { workspaceRenderOutputDirectory } from '../workspace-output-directory'
import {
  StudioRunCancelledError,
  readAbortReason,
  throwIfStudioRunCancelled
} from '../../studio-agent/runtime/execution/run-cancellation'
import {
  assertSandboxAvailable,
  copyVerifiedRegularFile,
  listPngArtifacts,
  publishPngArtifacts,
  resolvePythonRuntime,
  spawnSandboxedProcess,
  terminateSandboxProcess,
  type SandboxInvocationInput,
} from '../sandbox'

export interface MatplotlibExecutionResult {
  outputDir: string
  scriptPath: string
  imageDataUris: string[]
  imagePaths: string[]
  stdout: string
  stderr: string
}

interface PrivateSandbox {
  rootDirectory: string
  inputDirectory: string
  workDirectory: string
  outputDirectory: string
}

function createPrivateSandbox(rootDirectory: string): PrivateSandbox {
  fs.rmSync(rootDirectory, { recursive: true, force: true })
  const sandbox: PrivateSandbox = {
    rootDirectory,
    inputDirectory: join(rootDirectory, 'input'),
    workDirectory: join(rootDirectory, 'work'),
    outputDirectory: join(rootDirectory, 'output'),
  }
  for (const directory of [
    sandbox.inputDirectory,
    sandbox.workDirectory,
    sandbox.outputDirectory,
    join(sandbox.workDirectory, 'home'),
    join(sandbox.workDirectory, '.cache'),
    join(sandbox.workDirectory, '.config'),
    join(sandbox.workDirectory, '.local', 'share'),
    join(sandbox.workDirectory, 'mplconfig'),
  ]) {
    fs.mkdirSync(directory, { recursive: true })
  }
  return sandbox
}

export async function executeMatplotlibRender(input: {
  workspaceDirectory: string
  workspaceOutputDirectory?: string
  renderId: string
  code: string
  signal?: AbortSignal
}): Promise<MatplotlibExecutionResult> {
  throwIfStudioRunCancelled(input.signal)
  // Fail before writing or executing any submitted source.
  assertSandboxAvailable()

  const outputDir = workspaceRenderOutputDirectory(input.workspaceDirectory, input.renderId, input.workspaceOutputDirectory)
  await mkdir(outputDir, { recursive: true })

  const sourcePath = join(outputDir, 'plot_script.py')
  const wrapperPath = join(outputDir, 'plot_executor.py')
  await writeFile(sourcePath, input.code, 'utf8')
  await writeFile(wrapperPath, buildExecutorScript(), 'utf8')

  const sandbox = createPrivateSandbox(join(outputDir, '.sandbox'))
  try {
    copyVerifiedRegularFile(sourcePath, join(sandbox.inputDirectory, 'plot_script.py'))
    copyVerifiedRegularFile(wrapperPath, join(sandbox.inputDirectory, 'plot_executor.py'))

    // MATPLOTLIB_PYTHON is an optional override; otherwise share the configured
    // ManimGX render runtime, then the normal .venv/PATH discovery.
    const matplotlibPython = process.env.MATPLOTLIB_PYTHON?.trim()
    const runtime = resolvePythonRuntime(
      matplotlibPython ? { explicit: matplotlibPython } : { envName: 'MANIMGX_PYTHON' }
    )
    const invocation: SandboxInvocationInput = {
      label: `matplotlib-${input.renderId}`,
      executable: runtime.executable,
      args: [
        '-u',
        '/input/plot_executor.py',
        '/input/plot_script.py',
        '/output',
        '/work/mplconfig',
      ],
      cwd: '/work',
      inputDirectory: sandbox.inputDirectory,
      workDirectory: sandbox.workDirectory,
      outputDirectory: sandbox.outputDirectory,
      runtimeDirectories: runtime.mountDirectories,
      pathEntries: runtime.pathEntries,
      env: {
        MPLCONFIGDIR: '/work/mplconfig',
      },
    }

    const { stdout, stderr } = await runSandboxedPython(invocation, input.signal)
    const sandboxImages = listPngArtifacts(sandbox.outputDirectory)
    if (sandboxImages.length === 0) {
      throw new Error(stderr.trim() || 'Matplotlib execution finished without producing any image output')
    }

    // Only verified bytes from the private output are published. stdout is never
    // parsed for paths, so a malicious script cannot select a host file to read.
    const imagePaths = publishPngArtifacts(sandboxImages, outputDir)
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
  } finally {
    fs.rmSync(sandbox.rootDirectory, { recursive: true, force: true })
  }
}

function runSandboxedPython(
  invocation: SandboxInvocationInput,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new StudioRunCancelledError(readAbortReason(signal)))
      return
    }

    let child: ReturnType<typeof spawnSandboxedProcess>
    try {
      child = spawnSandboxedProcess(invocation)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    let stdout = ''
    let stderr = ''
    let finished = false
    let aborted = false
    let killTimer: NodeJS.Timeout | undefined

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort)
      if (killTimer) {
        clearTimeout(killTimer)
        killTimer = undefined
      }
    }

    const settleReject = (error: Error) => {
      if (finished) return
      finished = true
      cleanup()
      reject(error)
    }

    const settleResolve = (value: { stdout: string; stderr: string }) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(value)
    }

    const handleAbort = () => {
      aborted = true
      terminateSandboxProcess(child, 'SIGTERM')
      killTimer = setTimeout(() => {
        if (!finished) terminateSandboxProcess(child, 'SIGKILL')
      }, 2000)
      killTimer.unref?.()
    }

    signal?.addEventListener('abort', handleAbort, { once: true })

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      settleReject(error instanceof Error ? error : new Error(String(error)))
    })
    child.on('close', (code) => {
      if (finished) return
      // The sandbox owns a PID namespace; kill any lingering group member before
      // the caller scans or publishes the private output directory.
      terminateSandboxProcess(child)
      if (aborted) {
        settleReject(new StudioRunCancelledError(readAbortReason(signal)))
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

function buildExecutorScript(): string {
  return [
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
  ].join('\n')
}
