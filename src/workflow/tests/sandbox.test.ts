import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertRegularNonSymlinkFile,
  buildSandboxInvocation,
  copyVerifiedRegularFile,
  listPngArtifacts,
  probeSandboxSupport,
  resolvePythonRuntime,
  stageNarrationForSandbox,
} from '../../rendering/sandbox'
import { executeMatplotlibRender } from '../../rendering/matplotlib/matplotlib-executor'
import { executeManimCommand } from '../../utils/manim-executor'

const probe = probeSandboxSupport()
const sandboxSkip = probe.available ? false : `sandbox unavailable: ${probe.reason ?? 'unknown reason'}`
const requireIntegration = process.env.MANIMCAT_REQUIRE_SANDBOX_TESTS === '1'

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents)
}

function makeSandboxDirectories(root: string): {
  inputDirectory: string
  workDirectory: string
  outputDirectory: string
} {
  const inputDirectory = path.join(root, 'input')
  const workDirectory = path.join(root, 'work')
  const outputDirectory = path.join(root, 'output')
  for (const directory of [inputDirectory, workDirectory, outputDirectory]) {
    fs.mkdirSync(directory, { recursive: true })
  }
  return { inputDirectory, workDirectory, outputDirectory }
}

function mountPair(args: readonly string[], kind: string, source: string, destination: string): number {
  return args.findIndex(
    (value, index) => value === kind && args[index + 1] === source && args[index + 2] === destination
  )
}

test('sandbox invocation has mandatory namespaces, no host root, and an explicit environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-invocation-'))
  try {
    const directories = makeSandboxDirectories(root)
    const runner = path.join(root, 'runner.py')
    writeFile(runner, 'print("runner")\n')
    const previousSecret = process.env.MANIMCAT_SANDBOX_TEST_SECRET
    process.env.MANIMCAT_SANDBOX_TEST_SECRET = 'must-not-leak'
    try {
      const invocation = buildSandboxInvocation(
        {
          label: 'test',
          executable: '/usr/bin/python3',
          args: ['-c', 'print(1)'],
          cwd: '/work',
          ...directories,
          pathEntries: ['/usr/bin'],
          readOnlyFiles: [{ source: runner, destination: '/runner/runner.py' }],
          env: { SAFE_RENDER_FLAG: '1' },
        },
        '/usr/bin/bwrap'
      )

      for (const flag of [
        '--die-with-parent',
        '--new-session',
        '--unshare-user',
        '--unshare-pid',
        '--unshare-net',
        '--unshare-ipc',
        '--unshare-uts',
        '--clearenv',
      ]) {
        assert.ok(invocation.args.includes(flag), `missing ${flag}`)
      }
      // Nested user namespaces must stay disabled inside the render sandbox.
      assert.ok(invocation.args.includes('--disable-userns'))
      assert.equal(invocation.args.includes('/sys'), false)
      assert.ok(mountPair(invocation.args, '--ro-bind', directories.inputDirectory, '/input') >= 0)
      assert.ok(mountPair(invocation.args, '--bind', directories.workDirectory, '/work') >= 0)
      assert.ok(mountPair(invocation.args, '--bind', directories.outputDirectory, '/output') >= 0)
      assert.ok(mountPair(invocation.args, '--ro-bind', runner, '/runner/runner.py') >= 0)
      assert.ok(invocation.args.includes('ALL'))
      assert.ok(!invocation.args.includes('--share-net'))

      // The host root and application/data trees are never bind-mounted.
      assert.equal(invocation.args.some((value, index) =>
        (value === '--bind' || value === '--ro-bind' || value === '--bind-try' || value === '--ro-bind-try') &&
        invocation.args[index + 1] === '/'
      ), false)
      assert.equal(invocation.args.includes('/etc'), false)
      assert.equal(invocation.args.includes('/etc/passwd'), false)

      const clearEnvIndex = invocation.args.indexOf('--clearenv')
      const firstSetEnvIndex = invocation.args.indexOf('--setenv')
      assert.ok(clearEnvIndex >= 0 && firstSetEnvIndex > clearEnvIndex)
      assert.equal(invocation.env.MANIMCAT_SANDBOX_TEST_SECRET, undefined)
      assert.equal(invocation.env.SAFE_RENDER_FLAG, '1')
      assert.equal(invocation.env.HOME, '/work/home')
      assert.ok(!invocation.args.some((value) => value.includes('must-not-leak')))
      assert.equal(invocation.spawnEnv.MANIMCAT_SANDBOX_TEST_SECRET, undefined)
    } finally {
      if (previousSecret === undefined) {
        delete process.env.MANIMCAT_SANDBOX_TEST_SECRET
      } else {
        process.env.MANIMCAT_SANDBOX_TEST_SECRET = previousSecret
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('newer bubblewrap user-namespace assertions are used when advertised', {
  skip: process.platform === 'win32',
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-bwrap-flags-'))
  try {
    const fakeBwrap = path.join(root, 'bwrap')
    writeFile(fakeBwrap, [
      '#!/bin/sh',
      'if [ "$1" = "--help" ]; then',
      '  echo "  --disable-userns"',
      '  echo "  --assert-userns-disabled"',
      '  exit 0',
      'fi',
      'exit 1',
    ].join('\n'))
    fs.chmodSync(fakeBwrap, 0o755)

    const invocation = buildSandboxInvocation({
      label: 'flags-test',
      executable: '/usr/bin/python3',
      cwd: '/',
    }, fakeBwrap)

    assert.ok(invocation.args.includes('--disable-userns'))
    assert.ok(invocation.args.includes('--assert-userns-disabled'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('runtime mounts validate symlink targets and still support venv executable links', {
  skip: process.platform === 'win32',
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-runtime-links-'))
  try {
    const unsafeLink = path.join(root, 'project-link')
    fs.symlinkSync(process.cwd(), unsafeLink, 'dir')
    assert.throws(
      () => buildSandboxInvocation({
        label: 'unsafe-runtime',
        executable: '/usr/bin/python3',
        cwd: '/',
        runtimeDirectories: [unsafeLink],
      }, '/usr/bin/bwrap'),
      /unsafe runtime mount/i
    )

    const venv = path.join(root, 'venv')
    const venvBin = path.join(venv, 'bin')
    fs.mkdirSync(venvBin, { recursive: true })
    writeFile(path.join(venv, 'pyvenv.cfg'), 'home = /usr/bin\n')
    const venvPython = path.join(venvBin, 'python')
    fs.symlinkSync('/usr/bin/python3', venvPython)

    const runtime = resolvePythonRuntime({ explicit: venvPython })
    assert.equal(runtime.executable, venvPython)
    assert.deepEqual(runtime.mountDirectories, [venv])
    assert.ok(runtime.pathEntries.includes(venvBin))

    const invocation = buildSandboxInvocation({
      label: 'safe-runtime',
      executable: runtime.executable,
      cwd: '/',
      runtimeDirectories: runtime.mountDirectories,
      pathEntries: runtime.pathEntries,
    }, '/usr/bin/bwrap')
    assert.ok(mountPair(invocation.args, '--ro-bind', fs.realpathSync(venv), venv) >= 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('artifact publication accepts only regular non-symlink files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-artifacts-'))
  try {
    const output = path.join(root, 'output')
    fs.mkdirSync(output)
    const regularPng = path.join(output, 'plot_1.png')
    writeFile(regularPng, 'png-bytes')
    assert.deepEqual(listPngArtifacts(output), [regularPng])

    const linkedPng = path.join(output, 'plot_2.png')
    fs.symlinkSync('/etc/passwd', linkedPng)
    assert.throws(() => listPngArtifacts(output), /symlink/i)

    const linkedVideo = path.join(root, 'output.mp4')
    fs.symlinkSync('/usr/bin/true', linkedVideo)
    assert.throws(() => assertRegularNonSymlinkFile(linkedVideo, 'Manim output'), /symlink/i)
    assert.throws(
      () => copyVerifiedRegularFile(linkedVideo, path.join(root, 'published.mp4')),
      /symlink/i
    )

    // Even if a symlink is swapped in after the first check, O_NOFOLLOW refuses it.
    fs.rmSync(linkedPng)
    const safeTarget = path.join(root, 'published.png')
    copyVerifiedRegularFile(regularPng, safeTarget)
    assert.equal(fs.readFileSync(safeTarget, 'utf8'), 'png-bytes')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('narration staging rewrites parent paths and rejects symlinked audio', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-narration-'))
  try {
    const narrationDirectory = path.join(root, 'workspace', 'narration')
    const audioPath = path.join(narrationDirectory, 'narration.wav')
    const segmentPath = path.join(narrationDirectory, 'segments', '001-line.wav')
    writeFile(audioPath, 'audio')
    writeFile(segmentPath, 'segment')
    const manifestPath = path.join(narrationDirectory, 'narration-manifest.json')
    writeFile(manifestPath, JSON.stringify({
      version: 1,
      audioPath,
      duration: 1,
      segments: [{ id: 's1', start: 0, duration: 1, audioPath: segmentPath, cues: {} }],
      cues: {},
    }))

    const inputDirectory = path.join(root, 'input')
    fs.mkdirSync(inputDirectory)
    const staged = stageNarrationForSandbox({
      inputDirectory,
      manifestPath,
      syncReportPath: path.join(root, 'sync-report.json'),
    })
    assert.equal(staged.manifestPath, '/input/narration/manifest.json')
    assert.equal(staged.syncReportPath, '/output/sync-report.json')

    const stagedText = fs.readFileSync(path.join(inputDirectory, 'narration', 'manifest.json'), 'utf8')
    assert.equal(stagedText.includes(root), false)
    const document = JSON.parse(stagedText) as {
      audioPath: string
      segments: Array<{ audioPath: string }>
    }
    assert.ok(document.audioPath.startsWith('/input/narration/'))
    assert.ok(document.segments[0].audioPath.startsWith('/input/narration/'))

    const linkedAudio = path.join(narrationDirectory, 'linked.wav')
    fs.symlinkSync('/etc/passwd', linkedAudio)
    writeFile(manifestPath, JSON.stringify({
      version: 1,
      audioPath: linkedAudio,
      duration: 1,
      segments: [{ id: 's1', start: 0, duration: 1, audioPath: linkedAudio, cues: {} }],
      cues: {},
    }))
    assert.throws(
      () => stageNarrationForSandbox({ inputDirectory, manifestPath }),
      /symlink/i
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('sandbox blocks host files, secrets, host processes, network and other tasks', {
  skip: requireIntegration ? false : sandboxSkip,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-isolation-'))
  try {
    const directories = makeSandboxDirectories(root)
    const outside = path.join(root, 'outside')
    fs.mkdirSync(outside)
    const hostSecret = path.join(outside, 'host-secret.txt')
    const otherTask = path.join(outside, 'other-task.txt')
    writeFile(hostSecret, 'host-only-secret')
    writeFile(otherTask, 'other-task')
    writeFile(path.join(directories.inputDirectory, 'allowed.txt'), 'allowed')

    const hiddenPaths = [
      '/etc/passwd',
      '/app',
      '/data',
      process.cwd(),
      hostSecret,
      otherTask,
      `/proc/${process.pid}`,
    ]
    const script = [
      'import os',
      'import socket',
      '',
      'secret = os.environ.get("MANIMCAT_SANDBOX_TEST_SECRET")',
      'assert not secret, "host secret leaked into sandbox"',
      `hidden = ${JSON.stringify(hiddenPaths)}`,
      'for entry in hidden:',
      '    assert not os.path.exists(entry), f"host path visible: {entry}"',
      '',
      'with open("/input/allowed.txt", encoding="utf-8") as handle:',
      '    assert handle.read() == "allowed"',
      '',
      'with open("/proc/net/dev", encoding="utf-8") as handle:',
      '    rows = handle.read().splitlines()[2:]',
      'interfaces = [row.split(":", 1)[0].strip() for row in rows if row.split(":", 1)[0].strip() != "lo"]',
      'assert not interfaces, f"unexpected network interfaces: {interfaces}"',
      'with open("/proc/net/route", encoding="utf-8") as handle:',
      '    assert len(handle.read().splitlines()) <= 1',
      '',
      '# Real connection attempts: the sandbox has no usable network namespace.',
      'for address in ("192.0.2.1", "198.51.100.1"):',
      '    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)',
      '    probe.settimeout(2)',
      '    try:',
      '        probe.connect((address, 9))',
      '    except OSError:',
      '        pass',
      '    else:',
      '        raise AssertionError(f"sandbox unexpectedly connected to {address}")',
      '    finally:',
      '        probe.close()',
      '',
      '# /input is mounted read-only; the attempt must fail and leave no file.',
      'try:',
      '    with open("/input/blocked.txt", "w", encoding="utf-8") as handle:',
      '        handle.write("blocked")',
      'except OSError:',
      '    pass',
      'else:',
      '    raise AssertionError("/input was writable")',
      'assert not os.path.exists("/input/blocked.txt")',
      '',
      'with open("/output/result.txt", "w", encoding="utf-8") as handle:',
      '    handle.write("ok\\n")',
    ].join('\n')

    const runtime = resolvePythonRuntime({ envName: 'MANIMGX_PYTHON' })
    const previousSecret = process.env.MANIMCAT_SANDBOX_TEST_SECRET
    process.env.MANIMCAT_SANDBOX_TEST_SECRET = 'host-only-secret'
    let invocation
    try {
      invocation = buildSandboxInvocation({
        label: 'isolation-test',
        executable: runtime.executable,
        args: ['-c', script],
        cwd: '/work',
        inputDirectory: directories.inputDirectory,
        workDirectory: directories.workDirectory,
        outputDirectory: directories.outputDirectory,
        runtimeDirectories: runtime.mountDirectories,
        pathEntries: runtime.pathEntries,
      })
    } finally {
      if (previousSecret === undefined) {
        delete process.env.MANIMCAT_SANDBOX_TEST_SECRET
      } else {
        process.env.MANIMCAT_SANDBOX_TEST_SECRET = previousSecret
      }
    }
    const result = spawnSync(invocation.command, invocation.args, {
      env: invocation.spawnEnv,
      cwd: invocation.cwd,
      encoding: 'utf8',
      timeout: 20_000,
    })
    assert.equal(result.status, 0, `sandbox command failed:\n${result.stderr}${result.stdout}`)
    assert.equal(fs.readFileSync(path.join(directories.outputDirectory, 'result.txt'), 'utf8'), 'ok\n')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

let matplotlibSkip: boolean | string = sandboxSkip
if (!matplotlibSkip) {
  try {
    const runtime = resolvePythonRuntime({
      envName: process.env.MATPLOTLIB_PYTHON?.trim() ? 'MATPLOTLIB_PYTHON' : 'MANIMGX_PYTHON',
    })
    const ready = spawnSync(runtime.executable, ['-c', 'import matplotlib'], {
      encoding: 'utf8',
      timeout: 20_000,
    })
    if (ready.status !== 0) {
      matplotlibSkip = `matplotlib not installed in ${runtime.executable}: ${(ready.stderr || '').trim()}`
    }
  } catch (error) {
    matplotlibSkip = error instanceof Error ? error.message : String(error)
  }
}

test('matplotlib renders in the sandbox and publishes only verified PNG artifacts', {
  skip: requireIntegration ? false : matplotlibSkip,
}, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-matplotlib-'))
  try {
    const result = await executeMatplotlibRender({
      workspaceDirectory: workspace,
      renderId: 'render-1',
      code: [
        'import matplotlib.pyplot as plt',
        'plt.figure()',
        'plt.plot([0, 1], [0, 1])',
      ].join('\n'),
    })

    assert.ok(result.imagePaths.length > 0)
    for (const imagePath of result.imagePaths) {
      const stat = fs.lstatSync(imagePath)
      assert.equal(stat.isSymbolicLink(), false)
      assert.equal(stat.isFile(), true)
      assert.deepEqual([...fs.readFileSync(imagePath).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    }
    assert.equal(result.imageDataUris.length, result.imagePaths.length)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})

if (!probe.available) {
  test('sandbox absence fails closed before submitted Python executes', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-fail-closed-'))
    const marker = path.join(workspace, 'executed.txt')
    try {
      await assert.rejects(
        () => executeMatplotlibRender({
          workspaceDirectory: workspace,
          renderId: 'render-1',
          code: `open(${JSON.stringify(marker)}, 'w').write('executed')`,
        }),
        /sandbox is unavailable|bubblewrap/i
      )
      assert.equal(fs.existsSync(marker), false)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('Manim render also fails closed when the sandbox is unavailable', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-manim-fail-closed-'))
    try {
      const codeFile = path.join(workspace, 'scene.py')
      writeFile(codeFile, 'raise RuntimeError("must not execute")\n')
      const result = await executeManimCommand(codeFile, {
        jobId: 'sandbox-test',
        quality: 'low',
        tempDir: workspace,
        mediaDir: path.join(workspace, 'media'),
      })
      assert.equal(result.success, false)
      assert.match(result.stderr, /sandbox|bubblewrap/i)
      assert.equal(fs.existsSync(path.join(workspace, 'media', 'output.mp4')), false)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
}
