/**
 * Mandatory Linux rendering sandbox.
 *
 * Untrusted ManimGX/Matplotlib source is only ever executed through bubblewrap.
 * There is intentionally no "no sandbox" switch: a missing bwrap binary, a denied
 * user namespace, or a probe failure aborts before submitted code is started.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const SANDBOX_MARKER_ENV = 'MANIMCAT_RENDER_SANDBOX'

const MAX_PROBE_STDERR = 4_000

/** Read-only runtime trees. Each is explicit; the host root is never mounted. */
const SYSTEM_READONLY_PATHS = [
  '/usr',
  '/usr/local',
  '/lib',
  '/lib64',
  '/bin',
  '/sbin',
  '/etc/ld.so.cache',
  '/etc/fonts',
  '/etc/localtime',
] as const

/** Non-secret runtime hints that may safely cross into the renderer. */
const HOST_ENV_ALLOWLIST = [
  'VK_ICD_FILENAMES',
  'VK_DRIVER_FILES',
  'VK_LOADER_DRIVERS_SELECT',
  'LIBGL_ALWAYS_SOFTWARE',
  'MESA_LOADER_DRIVER_OVERRIDE',
  'MESA_VK_DEVICE_SELECT',
  'GALLIUM_DRIVER',
] as const

const FORBIDDEN_RUNTIME_DIRECTORIES = ['/app', '/data', '/home', '/root', '/tmp']
/** Never accept a runtime mount rooted at kernel/configuration trees. */
const SENSITIVE_RUNTIME_ROOTS = ['/etc', '/proc', '/sys', '/dev', '/run', '/boot']

export interface SandboxReadOnlyFile {
  source: string
  destination: string
}

export interface SandboxInvocationInput {
  label: string
  /** Executable path as seen inside the sandbox. */
  executable: string
  args?: readonly string[]
  /** Working directory as seen inside the sandbox. */
  cwd: string
  inputDirectory?: string
  workDirectory?: string
  outputDirectory?: string
  /** Exact read-only runtime roots, e.g. the render venv (not its parent). */
  runtimeDirectories?: readonly string[]
  /** Exact server-owned runner files mounted read-only. */
  readOnlyFiles?: readonly SandboxReadOnlyFile[]
  /** PATH entries available inside the sandbox. */
  pathEntries?: readonly string[]
  /** Explicitly safe child environment values. Host secrets are never copied. */
  env?: Record<string, string | undefined>
}

export interface SandboxInvocation {
  command: string
  args: string[]
  /** Complete child environment (already applied with --clearenv/--setenv). */
  env: NodeJS.ProcessEnv
  /** Minimal environment for the bwrap launcher process itself. */
  spawnEnv: NodeJS.ProcessEnv
  cwd: string
}

export interface SandboxProbeResult {
  available: boolean
  bwrapPath?: string
  reason?: string
}

let cachedProbe: SandboxProbeResult | undefined
const bwrapFlagSupport = new Map<string, boolean>()

export class SandboxUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxUnavailableError'
  }
}

function isExecutableFile(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate)
    if (!stat.isFile()) return false
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveFromPath(command: string): string | undefined {
  const entries = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const entry of entries) {
    const candidate = path.join(entry, command)
    if (isExecutableFile(candidate)) return candidate
  }
  return undefined
}

/** bwrap path override is only a path; it never disables the sandbox. */
export function resolveSandboxBwrapPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.MANIMCAT_BWRAP_PATH?.trim()
  if (configured) {
    const resolved = path.resolve(configured)
    return isExecutableFile(resolved) ? resolved : undefined
  }
  for (const candidate of ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap']) {
    if (isExecutableFile(candidate)) return candidate
  }
  const fromPath = resolveFromPath('bwrap')
  return fromPath ? path.resolve(fromPath) : undefined
}

function isForbiddenRuntimeDirectory(directory: string): boolean {
  const resolved = path.resolve(directory)
  const projectRoot = path.resolve(process.cwd())
  if (resolved === path.parse(resolved).root) return true
  if (resolved === projectRoot || projectRoot.startsWith(`${resolved}${path.sep}`)) return true

  for (const forbidden of FORBIDDEN_RUNTIME_DIRECTORIES) {
    if (resolved === forbidden) return true
  }
  for (const sensitiveRoot of SENSITIVE_RUNTIME_ROOTS) {
    if (resolved === sensitiveRoot || resolved.startsWith(`${sensitiveRoot}${path.sep}`)) return true
  }
  // A bare home directory would expose far more than the requested runtime.
  // Exact subdirectories such as /app/.venv remain valid: the parent is never mounted.
  for (const forbiddenRoot of ['/home', '/root']) {
    if (resolved.startsWith(`${forbiddenRoot}${path.sep}`)) {
      const relative = path.relative(forbiddenRoot, resolved)
      if (relative.split(path.sep).length < 2) return true
    }
  }
  return false
}

function validateRuntimeDirectory(directory: string): { source: string; destination: string } {
  const destination = path.resolve(directory)
  let source: string
  try {
    // Validate the real target, not just the lexical path. A symlink must not be
    // able to turn an apparently safe venv path into a mount of /app or a home.
    source = fs.realpathSync(destination)
  } catch {
    throw new SandboxUnavailableError(`Runtime mount does not exist: ${destination}`)
  }
  if (isForbiddenRuntimeDirectory(source)) {
    throw new SandboxUnavailableError(`Refusing unsafe runtime mount: ${destination} -> ${source}`)
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(source)
  } catch {
    throw new SandboxUnavailableError(`Runtime mount does not exist: ${source}`)
  }
  if (!stat.isDirectory()) {
    throw new SandboxUnavailableError(`Runtime mount is not a directory: ${source}`)
  }
  // Keep the caller's path visible inside the sandbox (a venv may be reached
  // through a symlink) while mounting the validated real directory.
  return { source, destination }
}

/**
 * Optional bwrap flags are only used when the installed binary advertises them.
 * The mandatory user-namespace flags are never conditional.
 */
function supportsBwrapFlag(bwrapPath: string, flag: string): boolean {
  const cacheKey = `${bwrapPath}\0${flag}`
  const cached = bwrapFlagSupport.get(cacheKey)
  if (cached !== undefined) return cached

  let supported = false
  try {
    const result = spawnSync(bwrapPath, ['--help'], {
      encoding: 'utf8',
      timeout: 3_000,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    supported = `${result.stdout || ''}\n${result.stderr || ''}`.includes(flag)
  } catch {
    supported = false
  }
  bwrapFlagSupport.set(cacheKey, supported)
  return supported
}

function validatePrivateDirectory(directory: string, label: string): string {
  const resolved = path.resolve(directory)
  if (resolved === path.parse(resolved).root) {
    throw new SandboxUnavailableError(`Refusing to mount the host root as ${label}`)
  }
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(resolved)
  } catch {
    throw new SandboxUnavailableError(`${label} does not exist: ${resolved}`)
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SandboxUnavailableError(`${label} must be a real directory: ${resolved}`)
  }
  return resolved
}

function appendReadOnlyMount(args: string[], source: string, destination: string, optional: boolean): void {
  args.push(optional ? '--ro-bind-try' : '--ro-bind', source, destination)
}

function hostRuntimeEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of HOST_ENV_ALLOWLIST) {
    const value = process.env[key]?.trim()
    if (value) env[key] = value
  }
  return env
}

function buildChildEnvironment(input: SandboxInvocationInput): NodeJS.ProcessEnv {
  const pathEntries = Array.from(new Set([
    ...(input.pathEntries ?? []),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ])).filter((entry) => entry && entry.startsWith('/'))

  const env: NodeJS.ProcessEnv = {
    PATH: pathEntries.join(path.delimiter),
    HOME: '/work/home',
    USER: 'render',
    LOGNAME: 'render',
    TMPDIR: '/tmp',
    XDG_CACHE_HOME: '/work/.cache',
    XDG_CONFIG_HOME: '/work/.config',
    XDG_DATA_HOME: '/work/.local/share',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONUNBUFFERED: '1',
    [SANDBOX_MARKER_ENV]: '1',
  }

  Object.assign(env, hostRuntimeEnvironment())
  for (const [key, value] of Object.entries(input.env ?? {})) {
    if (typeof value === 'string' && value.length > 0) {
      env[key] = value
    }
  }
  return env
}

/**
 * Build the complete bwrap invocation. Exported for unit tests so the isolation
 * flags and mount set can be asserted without requiring a working user namespace.
 */
export function buildSandboxInvocation(
  input: SandboxInvocationInput,
  bwrapPath = resolveSandboxBwrapPath()
): SandboxInvocation {
  if (!bwrapPath) {
    throw new SandboxUnavailableError(
      'bubblewrap (bwrap) is not installed. Rendering is disabled until the sandbox is available.'
    )
  }
  if (!path.isAbsolute(input.executable)) {
    throw new SandboxUnavailableError(`Sandbox executable must be absolute: ${input.executable}`)
  }
  if (!input.cwd.startsWith('/')) {
    throw new SandboxUnavailableError(`Sandbox working directory must be absolute: ${input.cwd}`)
  }

  // Submitted code must not be able to create a new (nested) user namespace.
  // --assert-userns-disabled is an extra kernel-level check on newer bwrap.
  const userNamespaceFlags = ['--disable-userns']
  if (supportsBwrapFlag(bwrapPath, '--assert-userns-disabled')) {
    userNamespaceFlags.push('--assert-userns-disabled')
  }

  const args: string[] = [
    '--die-with-parent',
    '--new-session',
    '--unshare-user',
    '--unshare-pid',
    '--unshare-net',
    '--unshare-ipc',
    '--unshare-uts',
    '--unshare-cgroup-try',
    ...userNamespaceFlags,
    '--cap-drop', 'ALL',
    '--hostname', 'manimcat-render',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--tmpfs', '/run',
    '--tmpfs', '/var/tmp',
  ]

  for (const runtimePath of SYSTEM_READONLY_PATHS) {
    appendReadOnlyMount(args, runtimePath, runtimePath, true)
  }
  for (const runtimeDirectory of input.runtimeDirectories ?? []) {
    const resolved = validateRuntimeDirectory(runtimeDirectory)
    appendReadOnlyMount(args, resolved.source, resolved.destination, false)
  }

  if (input.inputDirectory) {
    const inputDir = validatePrivateDirectory(input.inputDirectory, 'sandbox input directory')
    appendReadOnlyMount(args, inputDir, '/input', false)
  }
  if (input.workDirectory) {
    const workDir = validatePrivateDirectory(input.workDirectory, 'sandbox work directory')
    args.push('--bind', workDir, '/work')
  }
  if (input.outputDirectory) {
    const outputDir = validatePrivateDirectory(input.outputDirectory, 'sandbox output directory')
    args.push('--bind', outputDir, '/output')
  }

  for (const file of input.readOnlyFiles ?? []) {
    const source = path.resolve(file.source)
    const destination = path.posix.normalize(file.destination)
    // Runner files are only allowed in their dedicated read-only directory. This
    // prevents a caller mistake from shadowing /etc, /usr or another trusted tree.
    if (
      destination !== file.destination ||
      !destination.startsWith('/runner/') ||
      destination.includes('/../')
    ) {
      throw new SandboxUnavailableError(`Unsafe sandbox runner file destination: ${file.destination}`)
    }
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(source)
    } catch {
      throw new SandboxUnavailableError(`Sandbox runner file is missing: ${source}`)
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new SandboxUnavailableError(`Sandbox runner file must be a regular file: ${source}`)
    }
    const realSource = fs.realpathSync(source)
    appendReadOnlyMount(args, realSource, destination, false)
  }

  const env = buildChildEnvironment(input)
  args.push('--clearenv')
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      args.push('--setenv', key, value)
    }
  }
  args.push('--chdir', input.cwd, '--', input.executable, ...(input.args ?? []))

  return {
    command: bwrapPath,
    args,
    env,
    // bwrap itself gets no application environment, only a PATH to find nothing by accident.
    spawnEnv: { PATH: '/usr/local/bin:/usr/bin:/bin' },
    cwd: input.workDirectory ? path.resolve(input.workDirectory) : process.cwd(),
  }
}

function probeCommandPath(): string {
  for (const candidate of ['/usr/bin/true', '/bin/true']) {
    if (isExecutableFile(candidate)) return candidate
  }
  throw new SandboxUnavailableError('Cannot find a trusted probe executable (/usr/bin/true)')
}

/** Probe the kernel/container capability once. The probe never runs submitted code. */
export function probeSandboxSupport(force = false): SandboxProbeResult {
  if (cachedProbe && !force) return cachedProbe

  if (process.platform !== 'linux') {
    cachedProbe = {
      available: false,
      reason: `bubblewrap isolation requires Linux, got ${process.platform}`,
    }
    return cachedProbe
  }

  const bwrapPath = resolveSandboxBwrapPath()
  if (!bwrapPath) {
    cachedProbe = {
      available: false,
      reason: 'bubblewrap (bwrap) is not installed or MANIMCAT_BWRAP_PATH is invalid',
    }
    return cachedProbe
  }

  let invocation: SandboxInvocation
  try {
    invocation = buildSandboxInvocation(
      {
        label: 'sandbox-probe',
        executable: probeCommandPath(),
        cwd: '/',
        env: {},
      },
      bwrapPath
    )
  } catch (error) {
    cachedProbe = {
      available: false,
      bwrapPath,
      reason: error instanceof Error ? error.message : String(error),
    }
    return cachedProbe
  }

  const result = spawnSync(invocation.command, invocation.args, {
    env: invocation.spawnEnv,
    cwd: invocation.cwd,
    encoding: 'utf8',
    timeout: 5_000,
  })

  if (result.error) {
    cachedProbe = {
      available: false,
      bwrapPath,
      reason: `bubblewrap probe failed to start: ${result.error.message}`,
    }
    return cachedProbe
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim().slice(-MAX_PROBE_STDERR)
    cachedProbe = {
      available: false,
      bwrapPath,
      reason: `bubblewrap cannot create the required namespaces${
        stderr ? `: ${stderr.split(/\r?\n/).slice(-3).join(' | ')}` : ''
      }`,
    }
    return cachedProbe
  }

  cachedProbe = { available: true, bwrapPath }
  return cachedProbe
}

export function resetSandboxProbeForTests(): void {
  cachedProbe = undefined
  bwrapFlagSupport.clear()
}

/**
 * Explicit browser-only deployment mode. The container entrypoint skips the outer
 * user namespace; server-side render paths still fail closed because they require
 * bubblewrap. This is never inferred from a failed sandbox probe.
 */
export function isBrowserOnlyDeployment(): boolean {
  return process.env.MANIMCAT_CONTAINER_SANDBOX?.trim() === 'disabled'
}

export function assertSandboxAvailable(): string {
  const probe = probeSandboxSupport()
  if (!probe.available || !probe.bwrapPath) {
    throw new SandboxUnavailableError(
      `Rendering sandbox is unavailable and submitted code will not run. ${probe.reason ?? 'unknown reason'}`
    )
  }
  return probe.bwrapPath
}

/** Spawn bwrap as its own process group so cancellation can kill the whole namespace. */
export function spawnSandboxedProcess(input: SandboxInvocationInput): ChildProcess {
  const invocation = buildSandboxInvocation(input, assertSandboxAvailable())
  const child = spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.spawnEnv,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return child
}

/** Best-effort process-group termination shared by timeout and cancellation paths. */
export function terminateSandboxProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') {
      child.kill(signal)
    } else {
      process.kill(-child.pid, signal)
    }
  } catch {
    try {
      child.kill(signal)
    } catch {
      // Already gone.
    }
  }
}
