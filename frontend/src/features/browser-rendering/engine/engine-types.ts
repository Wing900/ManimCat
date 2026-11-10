/** The wasm-bindgen interface exported by ManimGX's rust/engine/src/web.rs. */
export interface ManimgxEngine {
  default(options: { module_or_path: Uint8Array<ArrayBuffer> }): Promise<unknown>;
  init(fonts: Uint8Array<ArrayBuffer>[]): Promise<void>;
  Player: new (
    canvas: HTMLCanvasElement,
    time: number,
    playing: boolean,
    mac: boolean,
  ) => ManimgxNativePlayer;
}

export interface ManimgxNativePlayer {
  free(): void;
  feed(bytes: Uint8Array): void;
  key(key: string, ctrl: boolean, alt: boolean, meta: boolean): boolean;
  pointer(x: number, y: number): void;
  press(x: number, y: number, touch: boolean): boolean;
  release(): boolean;
  leave(): void;
  cancel(): void;
  wheel(dx: number, dy: number): boolean;
  resize(width: number, height: number, scale: number): void;
  hide(hidden: boolean): void;
  fullscreen(on: boolean): void;
  wake(): number;
  draw(): void;
  asks(): (['scene', string] | ['fullscreen', boolean])[];
  readonly cursor: string;
  time: number;
  readonly duration: number;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  /** The patched browser engine's clean film-frame readback: RGBA bytes, no player face. */
  render_image(width: number, height: number): Promise<Uint8Array>;
  readonly scene: string | undefined;
  readonly film: Uint32Array | undefined;
}
