/**
 * Adapted from manimgx@0.1.1 browser/src/player.ts (MIT, tag v0.1.1,
 * commit 0507708dc5d731478786de2f46ca8a1660d514d6).
 *
 * This is the page-side native WebGPU player without the custom element or the
 * worker/source ownership. The public RenderSession owns lifecycle, readiness
 * and error reporting instead of reading shadow-DOM status text.
 */

import { BrowserRenderError, type VisualCheck } from '../types';
import type { ManimgxEngine, ManimgxNativePlayer } from './engine-types';
import { TakeInspector } from './take-inspector';

interface Options {
  resolution: { width: number; height: number };
  onFatal(error: BrowserRenderError): void;
  /** Image capture reads the film texture directly; do not schedule player draws. */
  renderOnly?: boolean;
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const MAX_BACKLOG_BYTES = 64 * 1024 * 1024;

function frameError(error: unknown, message: string): BrowserRenderError {
  return new BrowserRenderError('engine', message, {
    detail: error instanceof Error ? error.message : String(error),
  });
}

export class PreviewPlayer {
  #canvas: HTMLCanvasElement;
  #player: ManimgxNativePlayer | null = null;
  #connection = new AbortController();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #frame = 0;
  #backlog: ArrayBuffer[] = [];
  #backlogBytes = 0;
  #hidden = false;
  #inspector = new TakeInspector();
  #disposed = false;
  #onFatal: (error: BrowserRenderError) => void;
  #renderOnly: boolean;

  constructor(canvas: HTMLCanvasElement, engine: ManimgxEngine, options: Options) {
    this.#canvas = canvas;
    this.#onFatal = options.onFatal;
    this.#renderOnly = options.renderOnly === true;
    const box = canvas.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) {
      throw new BrowserRenderError(
        'invalid-input',
        'The renderer container has no visible size',
      );
    }
    canvas.width = options.resolution.width;
    canvas.height = options.resolution.height;
    canvas.style.aspectRatio = `${options.resolution.width} / ${options.resolution.height}`;
    canvas.tabIndex = 0;
    this.#player = new engine.Player(canvas, 0, false, MAC);
    this.#player.resize(
      options.resolution.width,
      options.resolution.height,
      1,
    );
    // Image mode reads the film texture directly. Keeping DOM observers and input
    // handlers active here can call resize()/hide() while async render_image(&mut self)
    // owns the wasm Player, which wasm-bindgen rejects as a recursive mutable borrow.
    if (!this.#renderOnly) this.#wire(this.#connection.signal);
    for (const bytes of this.#backlog.splice(0)) this.feed(bytes);
    this.#backlogBytes = 0;
  }

  get ready(): boolean {
    return this.#player !== null && this.#player.film !== undefined;
  }

  get currentTime(): number {
    return this.#player?.time ?? 0;
  }

  get duration(): number | null {
    if (!this.#player?.film) return null;
    const duration = this.#player.duration;
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  get playing(): boolean {
    return this.#player?.playing ?? false;
  }

  /** The actual SOUND payload observed in the take stream, if any. */
  get takeSound(): Uint8Array | null {
    return this.#inspector.sound;
  }

  /**
   * Read the finished take's clean final frame from the patched browser engine.
   * This never reads the canvas or the player face.
   */
  async renderImage(width: number, height: number): Promise<Uint8Array> {
    const player = this.#player;
    if (!player || this.#disposed) {
      throw new BrowserRenderError('disposed', 'The player is not available for image capture');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new BrowserRenderError('invalid-input', 'Image capture dimensions are invalid');
    }
    let pixels: Uint8Array;
    try {
      pixels = await player.render_image(width, height);
    } catch (error) {
      throw frameError(error, 'The engine could not read a clean image frame');
    }
    if (this.#disposed || this.#player !== player) {
      throw new BrowserRenderError('disposed', 'The player was disposed during image capture');
    }
    return pixels;
  }

  get takeSoundCount(): number {
    return this.#inspector.soundCount;
  }

  /** Why SOUND inspection stopped, if the take stream was malformed or oversized. */
  get takeSoundDisabledReason(): string | null {
    return this.#inspector.disabledReason;
  }

  feed(bytes: ArrayBuffer): boolean {
    if (this.#disposed) return false;
    this.#inspector.push(new Uint8Array(bytes));
    if (!this.#player) {
      this.#backlogBytes += bytes.byteLength;
      if (this.#backlogBytes > MAX_BACKLOG_BYTES) {
        this.#onFatal(
          new BrowserRenderError('engine', 'The player take backlog exceeded its memory budget'),
        );
        return false;
      }
      this.#backlog.push(bytes);
      return true;
    }
    try {
      this.#player.feed(new Uint8Array(bytes));
    } catch (error) {
      this.#onFatal(frameError(error, 'The player could not read a take message'));
      return false;
    }
    return this.#after();
  }

  play(): boolean {
    return this.#act('The player could not start', () => this.#player?.play());
  }

  pause(): boolean {
    return this.#act('The player could not pause', () => this.#player?.pause());
  }

  seek(seconds: number): boolean {
    const player = this.#player;
    if (!player) return false;
    const duration = this.duration;
    const target = Math.max(0, duration === null ? seconds : Math.min(seconds, duration));
    return this.#act('The player could not seek', () => {
      player.time = target;
    });
  }

  /**
   * Resume the native Speaker's shared AudioContext through its inert-key path.
   * Call synchronously from a trusted in-frame gesture. Player.play() alone does
   * not resume the context (upstream player.rs: key/press/release do).
   */
  unlockAudio(): boolean {
    return this.#act('The player could not unlock narration audio', () => {
      this.#player?.key('Unidentified', false, false, false);
    });
  }

  /**
   * Classify the canvas that is currently displayed. Diagnostic only: this never
   * seeks, draws or otherwise changes the native film clock, so it cannot move
   * playback away from the user's time. Black/unreadable is reported honestly and
   * never decides readiness.
   */
  async probe(): Promise<VisualCheck> {
    const player = this.#player;
    if (
      !player ||
      this.duration === null ||
      this.#hidden ||
      this.#disposed ||
      this.#connection.signal.aborted ||
      player.playing
    ) {
      return 'unavailable';
    }
    const result = await sampleCanvas(this.#canvas);
    if (this.#disposed || this.#connection.signal.aborted || this.#player !== player) {
      return 'unavailable';
    }
    return result === null ? 'unavailable' : result ? 'nonblack' : 'black';
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#connection.abort();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#backlog = [];
    this.#backlogBytes = 0;
    const player = this.#player;
    this.#player = null;
    if (player) {
      try {
        player.pause();
      } catch {
        // Already gone.
      }
      try {
        player.free();
      } catch {
        // Already gone.
      }
    }
  }

  #act(message: string, action: () => unknown): boolean {
    if (this.#disposed || !this.#player) return false;
    try {
      action();
    } catch (error) {
      this.#onFatal(frameError(error, message));
      return false;
    }
    return this.#after();
  }

  #after(): boolean {
    const player = this.#player;
    if (!player || this.#disposed) return false;
    if (this.#renderOnly) return true;
    try {
      for (const [ask, value] of player.asks()) {
        if (ask === 'fullscreen') {
          if (value) {
            this.#canvas.requestFullscreen?.().catch(() => undefined);
          } else if (document.fullscreenElement === this.#canvas) {
            void document.exitFullscreen().catch(() => undefined);
          }
        }
        // A scene change would require a second Python run; this runtime owns one
        // scene per isolated frame. The engine's face only asks when a file has
        // several scenes, which the host contract does not expose.
      }
      this.#canvas.style.cursor = player.cursor;
      if (this.#timer !== undefined) clearTimeout(this.#timer);
      this.#timer = undefined;
      const wake = player.wake();
      if (wake === 0) {
        if (!this.#frame) {
          this.#frame = requestAnimationFrame(() => this.#draw());
        }
      } else if (wake > 0) {
        this.#timer = setTimeout(() => this.#after(), wake);
      }
      return true;
    } catch (error) {
      this.#onFatal(frameError(error, 'The player could not update its frame'));
      return false;
    }
  }

  #draw(): void {
    this.#frame = 0;
    if (this.#disposed) return;
    try {
      this.#player?.draw();
    } catch (error) {
      this.#onFatal(frameError(error, 'The player could not draw'));
      return;
    }
    this.#after();
  }

  #wire(signal: AbortSignal): void {
    const player = this.#player;
    const canvas = this.#canvas;
    if (!player) return;
    const at = (event: PointerEvent): [number, number] => {
      const box = canvas.getBoundingClientRect();
      return [
        (event.clientX - box.left) * (canvas.width / box.width),
        (event.clientY - box.top) * (canvas.height / box.height),
      ];
    };
    const on = <K extends keyof HTMLElementEventMap>(
      target: Pick<HTMLElement, 'addEventListener'>,
      type: K,
      hand: (event: HTMLElementEventMap[K]) => boolean | void,
      options?: AddEventListenerOptions,
    ): void =>
      target.addEventListener(
        type,
        (event) => {
          if (this.#player !== player) return;
          try {
            if (hand(event)) event.preventDefault();
            this.#after();
          } catch (error) {
            this.#onFatal(frameError(error, 'The player could not handle input'));
          }
        },
        { ...options, signal },
      );
    let pressed: number | null = null;
    on(this.#canvas, 'keydown', (event) =>
      player.key(event.key, event.ctrlKey, event.altKey, event.metaKey),
    );
    on(canvas, 'pointermove', (event) => player.pointer(...at(event)));
    on(canvas, 'pointerdown', (event) => {
      if (pressed !== null || event.button !== 0 || !event.isPrimary) return false;
      pressed = event.pointerId;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      return player.press(...at(event), event.pointerType === 'touch');
    });
    const end = (event: PointerEvent, ended: () => boolean | void): boolean | void => {
      if (event.pointerId !== pressed) return false;
      pressed = null;
      return ended();
    };
    on(canvas, 'pointerup', (event) => end(event, () => player.release()));
    on(canvas, 'pointercancel', (event) => end(event, () => player.cancel()));
    on(canvas, 'pointerleave', () => player.leave());
    on(
      canvas,
      'wheel',
      (event) => {
        const unit = [1, 20, canvas.clientHeight][event.deltaMode] ?? 1;
        return player.wheel(event.deltaX * unit, event.deltaY * unit);
      },
      { passive: false },
    );
    on(document, 'fullscreenchange', () => player.fullscreen(document.fullscreenElement === canvas));
    const resize = new ResizeObserver(([entry]) => {
      if (!entry || this.#player !== player) return;
      try {
        const box = entry.devicePixelContentBoxSize?.[0];
        const css = entry.contentBoxSize[0];
        if (!css) return;
        const width = box ? box.inlineSize : Math.round(css.inlineSize * devicePixelRatio);
        const height = box ? box.blockSize : Math.round(css.blockSize * devicePixelRatio);
        player.resize(width, height, width / css.inlineSize);
        this.#after();
      } catch (error) {
        this.#onFatal(frameError(error, 'The player could not resize'));
      }
    });
    resize.observe(canvas);
    const visibility = new IntersectionObserver(([entry]) => {
      if (!entry || this.#player !== player) return;
      try {
        this.#hidden = !entry.isIntersecting;
        player.hide(this.#hidden);
        this.#after();
      } catch (error) {
        this.#onFatal(frameError(error, 'The player could not change visibility'));
      }
    });
    visibility.observe(canvas);
    signal.addEventListener(
      'abort',
      () => {
        resize.disconnect();
        visibility.disconnect();
      },
      { once: true },
    );
  }
}

/** True for a non-black frame, false for black, null when the canvas cannot be read. */
async function sampleCanvas(canvas: HTMLCanvasElement): Promise<boolean | null> {
  try {
    const bitmap = await createImageBitmap(canvas);
    try {
      const width = 64;
      const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
      const scratch = document.createElement('canvas');
      scratch.width = width;
      scratch.height = height;
      const context = scratch.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] > 6 || data[index + 1] > 6 || data[index + 2] > 6) return true;
      }
      return false;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
