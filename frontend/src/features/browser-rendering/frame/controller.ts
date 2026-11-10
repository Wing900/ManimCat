import { BrowserRenderError, initialRenderState, type RenderSessionState } from '../types';
import { detectBrowserRenderSupport } from '../capabilities';
import {
  inspectWav,
  verifyNarrationDecodes,
  type NormalizedSessionInput,
  type WavInfo,
} from '../validation';
import { DirectorClient, type DirectorDone } from '../engine/director-client';
import { PreviewPlayer } from '../engine/preview-player';
import { loadAssetBundle, loadNarrationRuntime } from './assets';

// Frame-side backstops; the host's configurable timers are authoritative.
const BOOT_TIMEOUT_MS = 5 * 60_000;
const RENDER_TIMEOUT_MS = 60 * 60_000;
const PROGRESS_INTERVAL_MS = 250;
const AUDIO_PROMPT = '旁白需要一次点击才能播放';

export interface FrameControllerCallbacks {
  onState(state: RenderSessionState): void;
  onProgress(currentTime: number, duration: number | null): void;
  onComplete(
    duration: number,
    narration: 'none' | 'included',
    visualCheck: RenderSessionState['visualCheck'],
    cjk: RenderSessionState['cjk'],
  ): void;
  onError(error: BrowserRenderError): void;
}

export class FrameController {
  #canvas: HTMLCanvasElement;
  #callbacks: FrameControllerCallbacks;
  #input: NormalizedSessionInput;
  #state: RenderSessionState;
  #runtimeSource: string | null = null;
  #director: DirectorClient | null = null;
  #player: PreviewPlayer | null = null;
  #audioUnlocked = false;
  #wantsPlay = false;
  #pendingSeek: number | null = null;
  #disposed = false;
  #failed = false;
  #finishing = false;
  #takeComplete = false;
  #bootTimer: ReturnType<typeof setTimeout> | undefined;
  #renderTimer: ReturnType<typeof setTimeout> | undefined;
  #progressTimer: ReturnType<typeof setInterval> | undefined;
  #lastProgress = -1;

  constructor(
    canvas: HTMLCanvasElement,
    input: NormalizedSessionInput,
    callbacks: FrameControllerCallbacks,
  ) {
    this.#canvas = canvas;
    this.#callbacks = callbacks;
    this.#input = input;
    this.#state = {
      ...initialRenderState(),
      sessionId: input.sessionId,
      narration: input.narration ? 'pending' : 'none',
      audio: input.narration ? 'locked' : 'none',
    };
  }

  get state(): RenderSessionState {
    return this.#state;
  }

  async start(): Promise<void> {
    if (this.#disposed || this.#failed) return;
    this.#set({ phase: 'checking', statusText: '正在检查 WebGPU…' });
    const capability = await detectBrowserRenderSupport();
    if (this.#disposed || this.#failed) return;
    if (!capability.supported) {
      this.#fail(
        new BrowserRenderError('unsupported', capability.detail, {
          detail: capability.missingFeatures?.join(', ') ?? capability.reason,
        }),
      );
      return;
    }
    if (this.#input.narration) {
      this.#set({ phase: 'loading', statusText: '正在验证旁白音轨…' });
      try {
        await verifyNarrationDecodes(
          this.#input.narration.audio,
          this.#input.narration.manifest.duration,
        );
      } catch (error) {
        if (this.#disposed) return;
        this.#fail(
          error instanceof BrowserRenderError
            ? error
            : new BrowserRenderError('narration', 'Narration audio could not be verified', {
                detail: error instanceof Error ? error.message : String(error),
              }),
        );
        return;
      }
      if (this.#disposed || this.#failed) return;
    }
    this.#set({ phase: 'loading', statusText: '正在加载渲染资源…' });
    try {
      const bundle = await loadAssetBundle();
      if (this.#disposed || this.#failed) return;
      if (this.#input.narration) {
        this.#runtimeSource = await loadNarrationRuntime(bundle);
      }
      if (this.#disposed || this.#failed) return;
      this.#bootTimer = setTimeout(() => {
        this.#fail(
          new BrowserRenderError('timeout', 'The browser renderer did not become ready in time'),
        );
      }, BOOT_TIMEOUT_MS);
      const director = new DirectorClient(this.#input.sessionId, {
        onStatus: (text) => {
          if (this.#disposed || this.#failed) return;
          this.#set({ phase: 'loading', statusText: text });
        },
        onEngine: (engine, cjk) => {
          if (this.#disposed || this.#failed) return;
          if (this.#bootTimer !== undefined) clearTimeout(this.#bootTimer);
          this.#bootTimer = undefined;
          if (!cjk) {
            this.#fail(
              new BrowserRenderError(
                'engine',
                'The engine started without CJK fonts; refusing to render Chinese content',
              ),
            );
            return;
          }
          let player: PreviewPlayer;
          try {
            player = new PreviewPlayer(this.#canvas, engine, {
              resolution: this.#input.resolution,
              onFatal: (error) => this.#fail(error),
            });
          } catch (error) {
            this.#fail(
              new BrowserRenderError('engine', 'The WebGPU player could not start', {
                detail: error instanceof Error ? error.message : String(error),
              }),
            );
            return;
          }
          this.#player = player;
          this.#set({
            phase: 'rendering',
            cjk: 'loaded',
            statusText: '正在渲染场景…',
          });
          this.#renderTimer = setTimeout(() => {
            this.#fail(
              new BrowserRenderError('timeout', 'The scene render exceeded its time budget'),
            );
          }, RENDER_TIMEOUT_MS);
          try {
            director.run({
              source: this.#input.source,
              sceneName: this.#input.sceneName,
              frameRate: this.#input.frameRate,
              resolution: this.#input.resolution,
              narration:
                this.#input.narration && this.#runtimeSource
                  ? {
                      runtimeSource: this.#runtimeSource,
                      manifestJson: JSON.stringify({
                        ...this.#input.narration.manifest,
                        audioPath: 'narration.wav',
                      }),
                      audio: this.#input.narration.audio,
                    }
                  : null,
            });
          } catch (error) {
            this.#fail(
              error instanceof BrowserRenderError
                ? error
                : new BrowserRenderError('scene', 'The scene could not be started', {
                    detail: error instanceof Error ? error.message : String(error),
                  }),
            );
          }
        },
        onFeed: (bytes) => {
          if (this.#disposed || this.#failed || this.#finishing || this.#takeComplete) return;
          this.#player?.feed(bytes);
        },
        onDone: (done) => {
          if (this.#disposed || this.#failed || this.#takeComplete) return;
          try {
            this.#finish(done);
          } catch (error) {
            this.#fail(
              new BrowserRenderError('internal', 'The finishing take check failed', {
                detail: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        },
        onError: (error) => this.#fail(error),
      });
      this.#director = director;
      director.boot(bundle.pyodideUrl, bundle.wheels);
    } catch (error) {
      if (this.#disposed) return;
      this.#fail(
        error instanceof BrowserRenderError
          ? error
          : new BrowserRenderError('internal', 'The renderer could not start', {
              detail: error instanceof Error ? error.message : String(error),
            }),
      );
    }
  }

  play(): void {
    if (this.#disposed || this.#failed) return;
    this.#wantsPlay = true;
    if (!this.#player || !this.#state.ready) return;
    this.#startPlayback();
  }

  pause(): void {
    if (this.#disposed || this.#failed) return;
    this.#wantsPlay = false;
    const player = this.#player;
    if (!player || !this.#state.ready) return;
    if (!player.pause()) return;
    if (this.#disposed || this.#failed || this.#player !== player) return;
    this.#set({ phase: 'paused', playing: false, statusText: null });
  }

  seek(seconds: number): void {
    if (this.#disposed || this.#failed) return;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      this.#fail(new BrowserRenderError('invalid-input', 'seek() needs a finite, non-negative time'));
      return;
    }
    this.#pendingSeek = seconds;
    if (!this.#player || !this.#state.ready) return;
    this.#applyPendingSeek();
  }

  /**
   * Called synchronously from a trusted in-frame click. The host's postMessage play
   * cannot carry user activation across origins, so this is the only unlock path.
   */
  unlockAudio(): boolean {
    if (this.#disposed || this.#failed) return false;
    if (!this.#input.narration) {
      this.#audioUnlocked = true;
      return true;
    }
    const player = this.#player;
    if (!player) return false;
    if (!this.#audioUnlocked) {
      if (!player.unlockAudio()) return false;
      if (this.#disposed || this.#failed || this.#player !== player) return false;
      this.#audioUnlocked = true;
    }
    if (this.#state.ready) {
      this.#set({ audio: 'ready', statusText: null });
      if (this.#wantsPlay) return this.#startPlayback();
    }
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearTimers();
    this.#director?.dispose();
    this.#director = null;
    this.#player?.dispose();
    this.#player = null;
    this.#state = {
      ...this.#state,
      phase: 'disposed',
      ready: false,
      playing: false,
      statusText: null,
    };
    this.#callbacks.onState(this.#state);
  }

  #startPlayback(): boolean {
    const player = this.#player;
    if (!player || !this.#state.ready || this.#disposed || this.#failed) return false;
    if (this.#input.narration && !this.#audioUnlocked) {
      this.#set({
        phase: this.#state.playing ? 'playing' : 'ready',
        playing: false,
        audio: 'locked',
        statusText: AUDIO_PROMPT,
      });
      return false;
    }
    if (!player.play()) return false;
    if (this.#disposed || this.#failed || this.#player !== player) return false;
    this.#set({
      phase: 'playing',
      playing: true,
      audio: this.#input.narration ? 'ready' : 'none',
      statusText: null,
    });
    return true;
  }

  #finish(done: DirectorDone): void {
    if (this.#disposed || this.#failed || this.#takeComplete) return;
    this.#finishing = true;
    try {
      if (this.#renderTimer !== undefined) clearTimeout(this.#renderTimer);
      this.#renderTimer = undefined;
      const player = this.#player;
      if (!player) {
        this.#fail(new BrowserRenderError('engine', 'The player disappeared before completion'));
        return;
      }
      const duration = player.duration;
      if (duration === null) {
        this.#fail(
          new BrowserRenderError('engine', 'The finished film has no finite duration (NaN)'),
        );
        return;
      }

      const fps = this.#input.frameRate;
      // The take's own duration and videoDuration are frameCount / fps. A quarter
      // frame catches a truncated take or a mismatched frame rate without failing on
      // float noise. scene.clock may lead the frame grid by less than two frames
      // (Scene.render emits a closing frame when the clock falls between frames), so
      // its comparison uses a two-frame window.
      const frameTolerance = Math.max(1e-6, 0.25 / fps);
      const sceneTolerance = 2 / fps + 1e-6;
      if (!Number.isInteger(done.frameCount) || done.frameCount <= 0) {
        this.#fail(
          new BrowserRenderError('engine', 'The finished take reported no frames', {
            detail: `frameCount=${String(done.frameCount)}`,
          }),
        );
        return;
      }
      const expectedVideo = done.frameCount / fps;
      if (Math.abs(duration - expectedVideo) > frameTolerance) {
        this.#fail(
          new BrowserRenderError('engine', 'The player duration does not match the finished take', {
            detail: `player ${duration.toFixed(6)}s, take ${expectedVideo.toFixed(6)}s, tolerance ${frameTolerance.toFixed(6)}s`,
          }),
        );
        return;
      }
      if (
        !Number.isFinite(done.sceneDuration) ||
        done.sceneDuration < 0 ||
        Math.abs(done.sceneDuration - duration) > sceneTolerance
      ) {
        this.#fail(
          new BrowserRenderError('engine', 'The scene clock does not match the player duration', {
            detail: `scene ${String(done.sceneDuration)}s, player ${duration.toFixed(6)}s, tolerance ${sceneTolerance.toFixed(6)}s`,
          }),
        );
        return;
      }
      if (
        done.narration.videoDuration !== null &&
        (!Number.isFinite(done.narration.videoDuration) ||
          Math.abs(done.narration.videoDuration - expectedVideo) > frameTolerance)
      ) {
        this.#fail(
          new BrowserRenderError('narration', 'The narration video duration does not match the take', {
            detail: `reported ${String(done.narration.videoDuration)}s, expected ${expectedVideo.toFixed(6)}s`,
          }),
        );
        return;
      }

      if (this.#input.narration) {
        if (done.narration.status !== 'included' || done.narration.errors.length > 0) {
          this.#fail(
            new BrowserRenderError('narration', 'Narration was requested but did not complete', {
              detail: done.narration.errors.join('\n') || null,
            }),
          );
          return;
        }
        const audioDuration = done.narration.audioDuration;
        if (audioDuration === null || !Number.isFinite(audioDuration)) {
          this.#fail(
            new BrowserRenderError(
              'narration',
              'Narration completed without a measurable audio duration',
            ),
          );
          return;
        }
        if (
          Math.abs(audioDuration - this.#input.narration.manifest.duration) > 0.25
        ) {
          this.#fail(
            new BrowserRenderError('narration', 'The narration report disagrees with the manifest', {
              detail: `report ${audioDuration.toFixed(3)}s, manifest ${this.#input.narration.manifest.duration.toFixed(3)}s`,
            }),
          );
          return;
        }
        if (duration + 1 / fps < audioDuration - 0.05) {
          this.#fail(
            new BrowserRenderError(
              'narration',
              'The film ended before the narration track (truncated audio)',
              {
                detail: `film ${duration.toFixed(3)}s, narration ${audioDuration.toFixed(3)}s`,
              },
            ),
          );
          return;
        }
        const sound = player.takeSound;
        if (!sound) {
          const inspectionFailure = player.takeSoundDisabledReason;
          this.#fail(
            new BrowserRenderError(
              'narration',
              inspectionFailure === null
                ? 'The finished take contains no SOUND track for the requested narration'
                : 'The take stream could not be inspected for its SOUND track',
              inspectionFailure === null ? undefined : { detail: inspectionFailure },
            ),
          );
          return;
        }
        let soundWav: WavInfo;
        try {
          soundWav = inspectWav(new Uint8Array(sound).buffer);
        } catch (error) {
          this.#fail(
            new BrowserRenderError('narration', 'The take SOUND track is not a readable WAV', {
              detail: error instanceof Error ? error.message : String(error),
            }),
          );
          return;
        }
        // The pinned Film._end writes a 48 kHz, 16-bit PCM WAV (manimgx/rendering/film.py).
        if (
          soundWav.audioFormat !== 1 ||
          soundWav.bitsPerSample !== 16 ||
          soundWav.sampleRate !== 48_000
        ) {
          this.#fail(
            new BrowserRenderError('narration', 'The take SOUND track has an unexpected format', {
              detail: `format=${soundWav.audioFormat}, ${soundWav.bitsPerSample}-bit, ${soundWav.sampleRate} Hz`,
            }),
          );
          return;
        }
        if (Math.abs(soundWav.duration - duration) > Math.max(0.01, frameTolerance)) {
          this.#fail(
            new BrowserRenderError('narration', 'The take SOUND duration does not match the film', {
              detail: `sound ${soundWav.duration.toFixed(3)}s, player ${duration.toFixed(3)}s`,
            }),
          );
          return;
        }
        if (soundWav.duration + 0.25 < audioDuration) {
          this.#fail(
            new BrowserRenderError('narration', 'The take SOUND is shorter than the narration', {
              detail: `sound ${soundWav.duration.toFixed(3)}s, narration ${audioDuration.toFixed(3)}s`,
            }),
          );
          return;
        }
      } else if (done.narration.status !== 'none') {
        this.#fail(
          new BrowserRenderError(
            'narration',
            'The renderer attached narration although the session requested none',
          ),
        );
        return;
      }

      // A pending seek must land before ready/complete is announced, and a failed
      // native seek must take the common terminal path, not a null dereference.
      if (!this.#applyPendingSeek()) return;
      if (this.#disposed || this.#failed) return;

      const narration = this.#input.narration ? 'included' : 'none';
      const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
      this.#takeComplete = true;
      this.#set({
        phase: 'ready',
        ready: true,
        sceneComplete: true,
        playing: false,
        duration,
        currentTime,
        narration,
        audio: this.#input.narration
          ? this.#audioUnlocked
            ? 'ready'
            : 'locked'
          : 'none',
        visualCheck: 'unverified',
        statusText: null,
      });
      if (this.#wantsPlay) this.#startPlayback();
      if (this.#disposed || this.#failed) return;
      this.#callbacks.onComplete(duration, narration, this.#state.visualCheck, this.#state.cjk);
      this.#startProgress();
      this.#probeVisuals(player);
    } finally {
      this.#finishing = false;
    }
  }

  #probeVisuals(player: PreviewPlayer): void {
    // Diagnostics must never fight a requested playback or delay readiness.
    try {
      if (this.#wantsPlay || player.playing) return;
    } catch {
      return;
    }
    void player
      .probe()
      .then((visualCheck) => {
        if (this.#disposed || this.#failed || this.#player !== player) return;
        this.#set({ visualCheck });
      })
      .catch(() => {
        if (this.#disposed || this.#failed || this.#player !== player) return;
        this.#set({ visualCheck: 'unavailable' });
      });
  }

  #applyPendingSeek(): boolean {
    if (this.#pendingSeek === null) return true;
    const player = this.#player;
    if (!player) return false;
    const target = this.#pendingSeek;
    this.#pendingSeek = null;
    if (!player.seek(target)) return false;
    if (this.#disposed || this.#failed || this.#player !== player) return false;
    let currentTime: number;
    try {
      currentTime = player.currentTime;
    } catch (error) {
      this.#fail(
        new BrowserRenderError('engine', 'The player time could not be read after seeking', {
          detail: error instanceof Error ? error.message : String(error),
        }),
      );
      return false;
    }
    if (!Number.isFinite(currentTime)) {
      this.#fail(new BrowserRenderError('engine', 'The player returned an invalid seek time'));
      return false;
    }
    this.#set({ currentTime: Math.max(0, currentTime) });
    return true;
  }

  #startProgress(): void {
    if (this.#progressTimer !== undefined) clearInterval(this.#progressTimer);
    this.#progressTimer = setInterval(() => {
      if (this.#disposed || this.#failed) return;
      const player = this.#player;
      if (!player) return;
      try {
        const currentTime = Number.isFinite(player.currentTime) ? player.currentTime : 0;
        const duration = player.duration;
        this.#state.currentTime = currentTime;
        this.#state.duration = duration;
        if (this.#state.ready && player.playing !== this.#state.playing) {
          const playing = player.playing;
          this.#set({ playing, phase: playing ? 'playing' : 'paused' });
        }
        if (Math.abs(currentTime - this.#lastProgress) >= 0.05) {
          this.#lastProgress = currentTime;
          this.#callbacks.onProgress(currentTime, duration);
        }
      } catch (error) {
        this.#fail(
          new BrowserRenderError('engine', 'The player progress could not be read', {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }, PROGRESS_INTERVAL_MS);
  }

  #set(partial: Partial<RenderSessionState>): void {
    if (this.#disposed || this.#failed) return;
    this.#state = { ...this.#state, ...partial };
    this.#callbacks.onState(this.#state);
  }

  #fail(error: BrowserRenderError): void {
    if (this.#disposed || this.#failed) return;
    this.#failed = true;
    this.#wantsPlay = false;
    this.#pendingSeek = null;
    this.#clearTimers();
    this.#director?.dispose();
    this.#director = null;
    this.#player?.dispose();
    this.#player = null;
    this.#state = {
      ...this.#state,
      phase: 'error',
      ready: false,
      playing: false,
      statusText: null,
      error,
      narration:
        error.code === 'narration'
          ? 'error'
          : this.#input.narration
            ? 'error'
            : 'none',
    };
    this.#callbacks.onState(this.#state);
    this.#callbacks.onError(error);
  }

  #clearTimers(): void {
    if (this.#bootTimer !== undefined) clearTimeout(this.#bootTimer);
    if (this.#renderTimer !== undefined) clearTimeout(this.#renderTimer);
    if (this.#progressTimer !== undefined) clearInterval(this.#progressTimer);
    this.#bootTimer = undefined;
    this.#renderTimer = undefined;
    this.#progressTimer = undefined;
  }
}
