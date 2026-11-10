/**
 * Vendored and extended from manimgx@0.1.1 browser/src/director.ts
 * (GitHub tag v0.1.1, commit 0507708dc5d731478786de2f46ca8a1660d514d6, MIT).
 *
 * Differences from upstream are deliberate and documented in
 * third-party/manimgx/PROVENANCE.txt:
 *  - pinned self-hosted wheels are fetched and SHA-256 verified before install;
 *  - CJK fonts are installed before the first `import manimgx`;
 *  - no runtime PyPI installs for scene imports;
 *  - the native NarrationRuntime is loaded from a build-time copy and attached
 *    with its plays hook and the existing WAV as a Sound at t=0;
 *  - every feed/done/error message carries a page-generated run token that is
 *    never exposed to Python;
 *  - the engine handshake happens once, before any scene source is executed.
 */

import { BrowserRenderError, serializeRenderError } from '../types';
import {
  WORKER_PROTOCOL_VERSION,
  type BootCommand,
  type NarrationRuntimeInput,
  type RunCommand,
  type WorkerCommand,
  type WorkerEngineMessage,
  type WorkerFeedMessage,
  type WorkerMessage,
  type WheelAsset,
} from './worker-protocol';

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

const scope = globalThis as unknown as WorkerScope;
const emit = scope.postMessage.bind(scope);

interface PyProxy {
  toJs(): unknown;
  destroy(): void;
}

interface Micropip {
  install(requirements: string | string[], keepGoing?: boolean, deps?: boolean): Promise<void>;
}

interface PyodideFs {
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
}

interface Pyodide {
  FS: PyodideFs;
  loadPackage(names: string | string[]): Promise<void>;
  pyimport(name: string): unknown;
  runPython(source: string): unknown;
}

interface PyodideModule {
  loadPyodide(options: { indexURL: string }): Promise<Pyodide>;
}

type PythonRunner = (
  film: number,
  source: string,
  name: string | null,
  send: (bytes: Uint8Array) => void,
  optionsJson: string,
) => string;

interface BootState {
  py: Pyodide;
  micropip: Micropip;
  runner: PythonRunner;
  bootId: string;
  sessionId: string;
}

let bootStarted = false;
let bootPromise: Promise<BootState> | null = null;
let bootState: BootState | null = null;
let engineIssued = false;
let runStarted = false;
let imageRuns = false;
let disposed = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isSameOriginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === globalThis.location.origin &&
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function parseCommand(value: unknown): WorkerCommand | null {
  if (!isRecord(value)) return null;
  if (value.v !== WORKER_PROTOCOL_VERSION) return null;
  if (!isId(value.sessionId)) return null;
  if (value.type === 'boot') {
    if (
      !isId(value.bootId) ||
      !isToken(value.bootToken) ||
      typeof value.pyodideUrl !== 'string' ||
      !Array.isArray(value.wheels)
    ) {
      return null;
    }
    const wheels: WheelAsset[] = [];
    for (const raw of value.wheels) {
      if (!isRecord(raw)) return null;
      if (
        typeof raw.name !== 'string' ||
        raw.name.length === 0 ||
        raw.name.length > 80 ||
        typeof raw.version !== 'string' ||
        raw.version.length === 0 ||
        raw.version.length > 40 ||
        typeof raw.url !== 'string' ||
        !isSameOriginUrl(raw.url) ||
        !isSha256(raw.sha256)
      ) {
        return null;
      }
      wheels.push({
        name: raw.name,
        version: raw.version,
        url: raw.url,
        sha256: raw.sha256,
      });
    }
    if (wheels.length === 0 || wheels.length > 16) return null;
    return {
      v: WORKER_PROTOCOL_VERSION,
      type: 'boot',
      bootId: value.bootId,
      sessionId: value.sessionId,
      bootToken: value.bootToken,
      pyodideUrl: value.pyodideUrl,
      wheels,
    };
  }
  if (value.type === 'run') {
    if (
      !isId(value.bootId) ||
      !isId(value.runId) ||
      !isToken(value.runToken) ||
      typeof value.source !== 'string' ||
      value.source.length === 0 ||
      value.source.length > 1024 * 1024 ||
      (value.sceneName !== null &&
        (typeof value.sceneName !== 'string' || value.sceneName.length > 200)) ||
      (value.mode !== undefined && value.mode !== 'video' && value.mode !== 'image') ||
      typeof value.frameRate !== 'number' ||
      !Number.isInteger(value.frameRate) ||
      value.frameRate < 1 ||
      value.frameRate > 120 ||
      !isRecord(value.resolution) ||
      typeof value.resolution.width !== 'number' ||
      !Number.isInteger(value.resolution.width) ||
      value.resolution.width < 1 ||
      value.resolution.width > 4096 ||
      typeof value.resolution.height !== 'number' ||
      !Number.isInteger(value.resolution.height) ||
      value.resolution.height < 1 ||
      value.resolution.height > 4096
    ) {
      return null;
    }
    let narration: NarrationRuntimeInput | null = null;
    if (value.narration !== null) {
      if (!isRecord(value.narration)) return null;
      if (
        typeof value.narration.runtimeSource !== 'string' ||
        value.narration.runtimeSource.length === 0 ||
        value.narration.runtimeSource.length > 512 * 1024 ||
        typeof value.narration.manifestJson !== 'string' ||
        value.narration.manifestJson.length === 0 ||
        value.narration.manifestJson.length > 1024 * 1024 ||
        !(value.narration.audio instanceof ArrayBuffer) ||
        value.narration.audio.byteLength === 0 ||
        value.narration.audio.byteLength > 64 * 1024 * 1024
      ) {
        return null;
      }
      narration = {
        runtimeSource: value.narration.runtimeSource,
        manifestJson: value.narration.manifestJson,
        audio: value.narration.audio,
      };
    }
    return {
      v: WORKER_PROTOCOL_VERSION,
      type: 'run',
      bootId: value.bootId,
      sessionId: value.sessionId,
      runId: value.runId,
      runToken: value.runToken,
      mode: value.mode === 'image' ? 'image' : 'video',
      source: value.source,
      sceneName: value.sceneName as string | null,
      frameRate: value.frameRate,
      resolution: { width: value.resolution.width, height: value.resolution.height },
      narration,
    };
  }
  if (value.type === 'dispose') {
    return {
      v: WORKER_PROTOCOL_VERSION,
      type: 'dispose',
      sessionId: value.sessionId,
    };
  }
  return null;
}

function bootError(bootId: string, bootToken: string, error: BrowserRenderError): void {
  emit({
    v: WORKER_PROTOCOL_VERSION,
    type: 'boot-error',
    bootId,
    bootToken,
    error: serializeRenderError(error),
  } satisfies WorkerMessage);
}

function status(bootId: string, bootToken: string, text: string): void {
  emit({
    v: WORKER_PROTOCOL_VERSION,
    type: 'status',
    bootId,
    bootToken,
    text: text.slice(0, 500),
  } satisfies WorkerMessage);
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

async function sha256(data: ArrayBuffer): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

async function fetchVerifiedWheel(wheel: WheelAsset): Promise<ArrayBuffer> {
  const response = await fetch(wheel.url, {
    credentials: 'omit',
    cache: 'force-cache',
    redirect: 'error',
  });
  if (!response.ok) {
    throw new BrowserRenderError('asset', `Cannot download ${wheel.name}: HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > 128 * 1024 * 1024) {
    throw new BrowserRenderError('asset', `Wheel ${wheel.name} is too large`);
  }
  const data = await response.arrayBuffer();
  if (data.byteLength === 0 || data.byteLength > 128 * 1024 * 1024) {
    throw new BrowserRenderError('asset', `Wheel ${wheel.name} has an invalid size`);
  }
  const digest = await sha256(data);
  if (digest !== wheel.sha256) {
    throw new BrowserRenderError(
      'asset',
      `Wheel ${wheel.name} failed integrity verification`,
      { detail: `expected ${wheel.sha256}, received ${digest}` },
    );
  }
  return data;
}

function wheelFileName(wheel: WheelAsset): string {
  let name: string;
  try {
    name = decodeURIComponent(new URL(wheel.url).pathname.split('/').pop() ?? '');
  } catch {
    name = '';
  }
  if (!/^[A-Za-z0-9_.+-]+\.whl$/.test(name)) {
    throw new BrowserRenderError('asset', `Wheel ${wheel.name} has an invalid filename`);
  }
  return name;
}

async function boot(command: BootCommand): Promise<BootState> {
  bootStarted = true;
  if (!isSameOriginUrl(command.pyodideUrl) || !command.pyodideUrl.endsWith('/')) {
    throw new BrowserRenderError('boot', 'Pyodide URL must be a same-origin directory URL');
  }
  const pyodideModule = (await import(
    /* @vite-ignore */ `${command.pyodideUrl}pyodide.mjs`
  )) as PyodideModule;
  status(command.bootId, command.bootToken, '加载 Python…');
  const py = await pyodideModule.loadPyodide({ indexURL: command.pyodideUrl });
  status(command.bootId, command.bootToken, '加载 Python 包…');
  await py.loadPackage(['micropip', 'numpy', 'pillow', 'typing-extensions']);
  const micropip = py.pyimport('micropip') as Micropip;
  status(command.bootId, command.bootToken, '安装 ManimGX…');
  const wheelDirectory = '/tmp/manimcat-wheels';
  py.FS.mkdirTree(wheelDirectory);
  for (const wheel of command.wheels) {
    const data = await fetchVerifiedWheel(wheel);
    const filename = wheelFileName(wheel);
    const path = `${wheelDirectory}/${filename}`;
    py.FS.writeFile(path, new Uint8Array(data));
    await micropip.install(`emfs:${path}`, false, false);
  }
  status(command.bootId, command.bootToken, '启动 ManimGX 引擎…');
  const runner = py.runPython(RUNNER) as PythonRunner;
  if (typeof runner !== 'function') {
    throw new BrowserRenderError(
      'boot',
      'The embedded Python scene runner was not returned as a callable',
    );
  }
  const built = py.runPython(`
import json
from manimgx import _engine
from manimgx.drawing.typesetting import FONTS
(*_engine.web(), _engine.face_fonts(list(FONTS)), json.dumps({
    "cjk": any("manimgx_fonts_cjk" in path for path in FONTS),
    "fonts": len(FONTS),
}))`) as PyProxy;
  const values = built.toJs() as [
    string,
    Uint8Array<ArrayBuffer>,
    Uint8Array<ArrayBuffer>[],
    string,
  ];
  built.destroy();
  const [js, wasm, fonts, metadata] = values;
  const info = JSON.parse(metadata) as { cjk?: unknown; fonts?: unknown };
  if (info.cjk !== true) {
    throw new BrowserRenderError(
      'engine',
      'The CJK font package is not installed; refusing to render without Chinese glyph support',
    );
  }
  if (!Array.isArray(fonts) || fonts.length === 0) {
    throw new BrowserRenderError('engine', 'ManimGX returned no font faces');
  }
  if (engineIssued) {
    throw new BrowserRenderError('protocol', 'The engine handshake was already issued');
  }
  engineIssued = true;
  emit(
    {
      v: WORKER_PROTOCOL_VERSION,
      type: 'engine',
      bootId: command.bootId,
      bootToken: command.bootToken,
      cjk: true,
      engine: { js, wasm, fonts },
    } satisfies WorkerEngineMessage,
    [wasm.buffer, ...fonts.map((font) => font.buffer)],
  );
  return { py, micropip, runner, bootId: command.bootId, sessionId: command.sessionId };
}

function failureCode(run: RunCommand, message: string, type: string): 'narration' | 'scene' {
  if (run.narration === null) return 'scene';
  return type.startsWith('Narration') || /narration|manifest|audio/i.test(message)
    ? 'narration'
    : 'scene';
}

function emitRunError(command: RunCommand, error: BrowserRenderError): void {
  emit({
    v: WORKER_PROTOCOL_VERSION,
    type: 'error',
    sessionId: command.sessionId,
    runId: command.runId,
    runToken: command.runToken,
    error: serializeRenderError(error),
  } satisfies WorkerMessage);
}

function fsFailure(label: string, error: unknown): BrowserRenderError {
  return new BrowserRenderError(
    'asset',
    `The browser runtime could not prepare ${label}`,
    { detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
  );
}

function runScene(command: RunCommand, state: BootState): void {
  if (command.bootId !== state.bootId || command.sessionId !== state.sessionId) {
    emitRunError(
      command,
      new BrowserRenderError(
        'protocol',
        'The run command is not bound to the boot that created this worker',
      ),
    );
    return;
  }
  runStarted = true;
  const { py, runner } = state;
  const sessionId = command.sessionId;
  const runId = command.runId;
  const runToken = command.runToken;
  const root = `/home/pyodide/manimcat/${sessionId}/${runId}`;
  const encoder = new TextEncoder();
  const send = (bytes: Uint8Array): void => {
    // Copy before transfer: `to_js` bytes may view Pyodide's heap.
    const copy = new Uint8Array(bytes);
    const buffer = copy.buffer;
    emit(
      {
        v: WORKER_PROTOCOL_VERSION,
        type: 'feed',
        sessionId,
        runId,
        runToken,
        bytes: buffer,
      } satisfies WorkerFeedMessage,
      [buffer],
    );
  };
  const write = (path: string, data: Uint8Array, label: string): void => {
    try {
      py.FS.writeFile(path, data);
    } catch (error) {
      throw fsFailure(label, error);
    }
  };
  try {
    try {
      py.FS.mkdirTree(root);
    } catch (error) {
      throw fsFailure('the session workspace', error);
    }
    write(`${root}/scene.py`, encoder.encode(command.source), 'the scene source');
    let optionsJson = JSON.stringify({
      root,
      fps: command.frameRate,
      width: command.resolution.width,
      height: command.resolution.height,
      narration: null,
    });
    if (command.narration) {
      write(
        `${root}/narration_runtime.py`,
        encoder.encode(command.narration.runtimeSource),
        'the narration runtime',
      );
      write(
        `${root}/narration-manifest.json`,
        encoder.encode(command.narration.manifestJson),
        'the narration manifest',
      );
      write(
        `${root}/narration.wav`,
        new Uint8Array(command.narration.audio),
        'the narration WAV',
      );
      optionsJson = JSON.stringify({
        root,
        fps: command.frameRate,
        width: command.resolution.width,
        height: command.resolution.height,
        narration: {
          manifestPath: `${root}/narration-manifest.json`,
          audioPath: `${root}/narration.wav`,
          runtimeDir: root,
        },
      });
    }
    const returned = runner(
      1,
      command.source,
      command.sceneName,
      send,
      optionsJson,
    );
    const result = JSON.parse(returned) as Record<string, unknown>;
    if (typeof result.missing === 'string') {
      const failure = isRecord(result.failure) ? result.failure : {};
      const trace = typeof failure.trace === 'string' ? failure.trace : null;
      const line =
        typeof failure.line === 'number' && Number.isInteger(failure.line) && failure.line > 0
          ? failure.line
          : null;
      emitRunError(
        command,
        new BrowserRenderError(
          result.missing === 'narration_runtime' ? 'narration' : 'scene',
          `Scene imports unavailable module '${result.missing}'. The browser runtime does not install packages at render time.`,
          { detail: trace, line },
        ),
      );
      return;
    }
    if (result.ok !== true) {
      const raw = isRecord(result.error) ? result.error : {};
      const message = typeof raw.message === 'string' ? raw.message : 'Scene failed';
      const type = typeof raw.type === 'string' ? raw.type : 'Error';
      const trace = typeof raw.trace === 'string' ? raw.trace : null;
      const line =
        typeof raw.line === 'number' && Number.isInteger(raw.line) && raw.line > 0
          ? raw.line
          : null;
      emitRunError(
        command,
        new BrowserRenderError(failureCode(command, message, type), message, {
          detail: trace,
          line,
        }),
      );
      return;
    }
    const frameCount =
      typeof result.frameCount === 'number' && Number.isFinite(result.frameCount)
        ? Math.max(0, Math.floor(result.frameCount))
        : 0;
    const sceneDuration =
      typeof result.sceneDuration === 'number' && Number.isFinite(result.sceneDuration)
        ? result.sceneDuration
        : 0;
    const narration = isRecord(result.narration)
      ? {
          status: result.narration.status === 'included' ? ('included' as const) : ('none' as const),
          audioDuration:
            typeof result.narration.audioDuration === 'number'
              ? result.narration.audioDuration
              : null,
          videoDuration:
            typeof result.narration.videoDuration === 'number'
              ? result.narration.videoDuration
              : null,
          warnings: Array.isArray(result.narration.warnings)
            ? result.narration.warnings.filter((item): item is string => typeof item === 'string').slice(0, 20)
            : [],
          errors: Array.isArray(result.narration.errors)
            ? result.narration.errors.filter((item): item is string => typeof item === 'string').slice(0, 20)
            : [],
        }
      : {
          status: 'none' as const,
          audioDuration: null,
          videoDuration: null,
          warnings: [] as string[],
          errors: [] as string[],
        };
    emit({
      v: WORKER_PROTOCOL_VERSION,
      type: 'done',
      sessionId,
      runId,
      runToken,
      frameCount,
      sceneDuration,
      narration,
    } satisfies WorkerMessage);
  } catch (error) {
    emitRunError(
      command,
      error instanceof BrowserRenderError
        ? error
        : new BrowserRenderError('internal', 'The scene runner failed', {
            detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          }),
    );
  }
}

scope.addEventListener('message', (event: MessageEvent<unknown>) => {
  const command = parseCommand(event.data);
  if (!command) return;
  if (command.type === 'dispose') {
    disposed = true;
    emit({
      v: WORKER_PROTOCOL_VERSION,
      type: 'disposed',
      sessionId: command.sessionId,
    } satisfies WorkerMessage);
    return;
  }
  if (disposed) return;
  if (command.type === 'boot') {
    if (bootStarted) return;
    bootStarted = true;
    bootPromise = boot(command)
      .then((state) => {
        bootState = state;
        return state;
      })
      .catch((error: unknown) => {
        bootState = null;
        bootError(
          command.bootId,
          command.bootToken,
          error instanceof BrowserRenderError
            ? error
            : new BrowserRenderError('boot', 'ManimGX could not start', {
                detail: error instanceof Error ? error.message : String(error),
              }),
        );
        throw error;
      });
    // The rejection is reported through boot-error; avoid an unhandled rejection.
    bootPromise.catch(() => undefined);
    return;
  }
  if (command.type === 'run') {
    if (runStarted && !(command.mode === 'image' && imageRuns)) {
      emit({
        v: WORKER_PROTOCOL_VERSION,
        type: 'error',
        sessionId: command.sessionId,
        runId: command.runId,
        runToken: command.runToken,
        error: serializeRenderError(
          new BrowserRenderError('protocol', 'This worker already ran a scene'),
        ),
      } satisfies WorkerMessage);
      return;
    }
    if (command.mode === 'image') imageRuns = true;
    runStarted = true;
    const start = (state: BootState): void => runScene(command, state);
    if (bootState) {
      start(bootState);
    } else if (bootPromise) {
      void bootPromise.then(start).catch(() => {
        emit({
          v: WORKER_PROTOCOL_VERSION,
          type: 'error',
          sessionId: command.sessionId,
          runId: command.runId,
          runToken: command.runToken,
          error: serializeRenderError(
            new BrowserRenderError('boot', 'Run arrived before the engine was ready'),
          ),
        } satisfies WorkerMessage);
      });
    } else {
      emit({
        v: WORKER_PROTOCOL_VERSION,
        type: 'error',
        sessionId: command.sessionId,
        runId: command.runId,
        runToken: command.runToken,
        error: serializeRenderError(
          new BrowserRenderError('boot', 'Run arrived before the engine was ready'),
        ),
      } satisfies WorkerMessage);
    }
  }
});

// ── Python: the scene file, its take, and the native narration timing runtime ──
const RUNNER = String.raw`
import dataclasses, importlib.util, json, linecache, sys, traceback
from pathlib import Path
from pyodide.ffi import to_js
from manimgx import _engine
from manimgx.config import Config, config
from manimgx.scene import Scene



def _failure(out, root, error):
    source = str(root / "scene.py")
    frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename == source]
    trace = "".join(traceback.format_list(frames) + traceback.format_exception_only(error))
    trace = trace.replace(str(root) + "/", "").replace(str(root), "")
    line = frames[-1].lineno if frames else getattr(error, "lineno", None)
    message = str(error).replace(str(root) + "/", "").replace(str(root), "")
    payload = {
        "message": message[:2000],
        "type": type(error).__name__,
        "trace": trace[:20000],
        "line": line,
    }
    try:
        out(_engine.note(json.dumps({"error": payload})))
    except Exception:
        pass
    return payload


def _select(scenes, name):
    names = [scene.__name__ for scene in scenes]
    unique = list(dict.fromkeys(scenes))
    if not unique:
        raise ValueError("the source defines no scene (a subclass of manimgx.Scene)")
    if name is not None:
        if name not in names:
            raise ValueError(
                "the source has no scene " + repr(name) + ". Available scenes: "
                + (", ".join(names) or "none")
            )
        return scenes[names.index(name)]
    if "MainScene" in names:
        return scenes[names.index("MainScene")]
    if len(unique) == 1:
        return unique[0]
    raise ValueError(
        "the source defines multiple scenes; select one with sceneName: " + ", ".join(names)
    )


def run(film, source, name, send, options_json):
    out = lambda data: send(to_js(data))
    options = json.loads(options_json)
    root = Path(options["root"])
    path = root / "scene.py"
    runtime = None
    try:
        root.mkdir(parents=True, exist_ok=True)
        source = source.lstrip("\ufeff")
        path.write_text(source, encoding="utf-8")
        linecache.cache.pop(str(path), None)
        defaults = Config()
        for field in dataclasses.fields(Config):
            setattr(config, field.name, getattr(defaults, field.name))
        spec = importlib.util.spec_from_file_location("scene", path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["scene"] = module
        exec(compile(source, str(path), "exec"), module.__dict__)
        # Match the native runner: request settings override source-level config after
        # the scene module is loaded, before any Scene instance is constructed.
        config.pixel_width = int(options["width"])
        config.pixel_height = int(options["height"])
        config.frame_rate = int(options["fps"])
        effective_fps = int(config.frame_rate)
        if effective_fps != int(options["fps"]):
            raise RuntimeError(
                "effective frame rate " + str(effective_fps)
                + " does not match the requested " + str(int(options["fps"]))
            )
        scenes = [
            value
            for value in vars(module).values()
            if isinstance(value, type)
            and issubclass(value, Scene)
            and value.__module__ == "scene"
        ]
        names = [scene.__name__ for scene in scenes]
        kind = _select(scenes, name)
        out(_engine.note(json.dumps({"scenes": [kind.__name__], "scene": kind.__name__})))
        scene = kind()
        narration = options.get("narration")
        if narration:
            runtime_dir = Path(narration["runtimeDir"])
            sys.path.insert(0, str(runtime_dir))
            from narration_runtime import NarrationRuntime

            runtime = NarrationRuntime(Path(narration["manifestPath"]), effective_fps)
            runtime.attach(scene)
            audio_path = Path(narration["audioPath"])
            original_setup = scene.setup

            def setup():
                # Scene.render creates a fresh Film, then resets the clock and calls
                # setup. Attaching the WAV here puts it on the take's own timeline at
                # t=0 instead of on the throwaway Film made by Scene.__init__.
                try:
                    clip = scene.add_sound(str(audio_path), 0)
                except Exception as exc:
                    raise RuntimeError(f"narration audio could not be attached: {exc}") from exc
                actual = float(clip.sound.duration)
                expected = float(runtime.audio_duration)
                if abs(actual - expected) > 0.25:
                    raise RuntimeError(
                        "narration audio is "
                        + f"{actual:.3f}s but the manifest says {expected:.3f}s"
                    )
                original_setup()

            scene.setup = setup
        film_obj = scene.render(take=out, plays=runtime.on_play if runtime is not None else None)
        frame_count = int(getattr(film_obj, "frame_count", 0))
        if frame_count <= 0:
            raise RuntimeError("ManimGX produced no frames")
        scene_duration = float(scene.clock)
        result = {
            "ok": True,
            "frameCount": frame_count,
            "sceneDuration": scene_duration,
        }
        if runtime is not None:
            runtime.finish(film_obj)
            report = runtime.report()
            video_duration = frame_count / effective_fps
            if video_duration + 1 / effective_fps < float(runtime.audio_duration):
                raise RuntimeError(
                    "narration audio is longer than the rendered film: "
                    + f"{float(runtime.audio_duration):.3f}s > {video_duration:.3f}s"
                )
            result["narration"] = {
                "status": "error" if report["errors"] else "included",
                "audioDuration": report["audioDuration"],
                "videoDuration": report["videoDuration"],
                "warnings": report["warnings"][:20],
                "errors": report["errors"][:20],
            }
            if report["errors"]:
                raise RuntimeError("; ".join(str(item) for item in report["errors"][:5]))
        return json.dumps(result)
    except ModuleNotFoundError as error:
        # Keep the scene source line and traceback for the common unsupported-import
        # failure; the host still refuses to install packages at render time.
        payload = _failure(out, root, error)
        return json.dumps({
            "missing": error.name or type(error).__name__,
            "failure": payload,
        })
    except Exception as error:
        if runtime is not None:
            try:
                runtime.fail(error)
            except Exception:
                pass
        payload = _failure(out, root, error)
        return json.dumps({"ok": False, "error": payload})
run
`;
