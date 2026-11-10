import {
  BrowserRenderError,
  MAX_IMAGE_BLOCKS,
  type ImageRenderProgress,
  type RenderedImageBlock,
  type RenderResolution,
} from '../types';
import { detectBrowserRenderSupport } from '../capabilities';
import { normalizeImageSessionInput } from '../validation';
import { DirectorClient, type DirectorDone } from '../engine/director-client';
import { PreviewPlayer } from '../engine/preview-player';
import { loadAssetBundle, loadWebEngine } from './assets';

export interface ImageFrameCallbacks {
  onProgress(progress: ImageRenderProgress): void;
  onBlock(block: RenderedImageBlock): void;
  onComplete(count: number): void;
  onError(error: BrowserRenderError): void;
}

export interface ImageFrameInput {
  sessionId: string;
  blocks: Array<{ index: number; source: string }>;
  frameRate: number;
  resolution: RenderResolution;
}

/** Encode exact RGBA rows as a lossless PNG. No CSS or preview surface participates. */
async function encodePng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<ArrayBuffer> {
  const expected = width * height * 4;
  if (pixels.byteLength !== expected) {
    throw new BrowserRenderError(
      'engine',
      'The engine returned an image with an unexpected byte length',
      { detail: `expected ${expected}, received ${pixels.byteLength}` },
    );
  }
  const owned = new Uint8ClampedArray(pixels.byteLength);
  owned.set(pixels);
  const image = new ImageData(owned, width, height);
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new BrowserRenderError('internal', 'A 2D canvas could not be created for PNG output');
    }
    context.putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return blob.arrayBuffer();
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new BrowserRenderError('internal', 'A 2D canvas could not be created for PNG output');
  }
  context.putImageData(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => {
        if (value) resolve(value);
        else reject(new BrowserRenderError('internal', 'The PNG encoder returned no image'));
      },
      'image/png',
    );
  });
  return blob.arrayBuffer();
}

function validDone(done: DirectorDone): boolean {
  return (
    Number.isInteger(done.frameCount) &&
    done.frameCount > 0 &&
    Number.isFinite(done.sceneDuration) &&
    done.sceneDuration >= 0
  );
}

/**
 * Sequential browser image renderer for the isolated frame.
 *
 * One booted Pyodide worker and one WebGPU player serve every block. Each block runs
 * its own scene take to completion; the patched engine then reads the final film
 * texture (after tear_down) into RGBA bytes, which this controller encodes as PNG.
 * A failed block rejects the batch instead of reporting a partial success as complete.
 */
export class ImageFrameController {
  #canvas: HTMLCanvasElement;
  #callbacks: ImageFrameCallbacks;
  #input: ReturnType<typeof normalizeImageSessionInput>;
  #director: DirectorClient | null = null;
  #player: PreviewPlayer | null = null;
  #disposed = false;
  #failed = false;

  constructor(canvas: HTMLCanvasElement, input: ImageFrameInput, callbacks: ImageFrameCallbacks) {
    if (input.blocks.length > MAX_IMAGE_BLOCKS) {
      throw new BrowserRenderError('invalid-input', 'Too many image blocks');
    }
    this.#canvas = canvas;
    this.#callbacks = callbacks;
    this.#input = normalizeImageSessionInput(input, MAX_IMAGE_BLOCKS);
  }

  async start(): Promise<void> {
    if (this.#disposed) return;
    this.#callbacks.onProgress({
      completed: 0,
      total: this.#input.blocks.length,
      index: this.#input.blocks[0]?.index ?? 0,
      statusText: '正在检查 WebGPU…',
    });
    const capability = await detectBrowserRenderSupport();
    if (this.#disposed) return;
    if (!capability.supported) {
      this.#fail(
        new BrowserRenderError('unsupported', capability.detail, {
          detail: capability.missingFeatures?.join(', ') ?? capability.reason,
        }),
      );
      return;
    }

    this.#callbacks.onProgress({
      completed: 0,
      total: this.#input.blocks.length,
      index: this.#input.blocks[0]?.index ?? 0,
      statusText: '正在加载图片渲染资源…',
    });
    let bundle;
    let engineAssets;
    try {
      bundle = await loadAssetBundle();
      engineAssets = await loadWebEngine(bundle);
    } catch (error) {
      this.#fail(
        error instanceof BrowserRenderError
          ? error
          : new BrowserRenderError('asset', 'The image renderer assets are unavailable', {
              detail: error instanceof Error ? error.message : String(error),
            }),
      );
      return;
    }
    if (this.#disposed) return;

    const director = new DirectorClient(
      this.#input.sessionId,
      {
        onStatus: (text) => this.#status(text),
        onEngine: (engine, cjk) => {
          if (this.#disposed || this.#failed) return;
          if (!cjk) {
            this.#fail(
              new BrowserRenderError(
                'engine',
                'The engine started without CJK fonts; refusing to render Chinese content',
              ),
            );
            return;
          }
          try {
            this.#player = new PreviewPlayer(this.#canvas, engine, {
              resolution: this.#input.resolution,
              renderOnly: true,
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
          void this.#runBlocks();
        },
        onFeed: (bytes) => {
          if (this.#disposed || this.#failed) return;
          this.#player?.feed(bytes);
        },
        // Image runs resolve through runImageBlock; this global callback is unused.
        onDone: () => undefined,
        onError: (error) => this.#fail(error),
      },
      { engineAssets },
    );
    this.#director = director;
    try {
      director.boot(bundle.pyodideUrl, bundle.wheels);
    } catch (error) {
      this.#fail(
        error instanceof BrowserRenderError
          ? error
          : new BrowserRenderError('boot', 'The image renderer could not start', {
              detail: error instanceof Error ? error.message : String(error),
            }),
      );
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#director?.dispose();
    this.#director = null;
    this.#player?.dispose();
    this.#player = null;
  }

  #status(text: string): void {
    if (this.#disposed || this.#failed) return;
    this.#callbacks.onProgress({
      completed: 0,
      total: this.#input.blocks.length,
      index: this.#input.blocks[0]?.index ?? 0,
      statusText: text,
    });
  }

  async #runBlocks(): Promise<void> {
    const director = this.#director;
    const player = this.#player;
    if (!director || !player || this.#disposed || this.#failed) return;
    const total = this.#input.blocks.length;
    try {
      for (const [position, block] of this.#input.blocks.entries()) {
        if (this.#disposed || this.#failed) return;
        this.#callbacks.onProgress({
          completed: position,
          total,
          index: block.index,
          statusText: `正在渲染图片 ${position + 1}/${total}…`,
        });
        const done = await director.runImageBlock({
          source: block.source,
          sceneName: null,
          frameRate: this.#input.frameRate,
          resolution: this.#input.resolution,
        });
        if (this.#disposed || this.#failed) return;
        if (!validDone(done)) {
          throw new BrowserRenderError('scene', 'The image block produced no frames');
        }
        const pixels = await player.renderImage(
          this.#input.resolution.width,
          this.#input.resolution.height,
        );
        if (this.#disposed || this.#failed) return;
        const png = await encodePng(
          pixels,
          this.#input.resolution.width,
          this.#input.resolution.height,
        );
        if (this.#disposed || this.#failed) return;
        this.#callbacks.onBlock({
          index: block.index,
          width: this.#input.resolution.width,
          height: this.#input.resolution.height,
          bytes: png,
        });
        this.#callbacks.onProgress({
          completed: position + 1,
          total,
          index: block.index,
          statusText:
            position + 1 === total
              ? '图片已完成'
              : `正在渲染图片 ${position + 2}/${total}…`,
        });
      }
      if (this.#disposed || this.#failed) return;
      this.#callbacks.onComplete(total);
    } catch (error) {
      if (this.#disposed || this.#failed) return;
      this.#fail(
        error instanceof BrowserRenderError
          ? error
          : new BrowserRenderError('internal', 'The image batch failed', {
              detail: error instanceof Error ? error.message : String(error),
            }),
      );
    }
  }

  #fail(error: BrowserRenderError): void {
    if (this.#disposed || this.#failed) return;
    this.#failed = true;
    this.#callbacks.onError(error);
  }
}
