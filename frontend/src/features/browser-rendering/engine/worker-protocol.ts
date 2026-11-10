/**
 * Internal protocol between the isolated frame page and its Pyodide worker.
 *
 * Every outbound message (except the one-time engine handshake) carries a
 * page-generated run token. The token is never passed into Python, so executed
 * scene code cannot forge feed/done/error messages even though it can reach the
 * worker's global postMessage. The engine handshake uses a separate boot token
 * and is accepted only before the first run is dispatched.
 */

import type { SerializedBrowserRenderError } from '../types';

export const WORKER_PROTOCOL_VERSION = 1 as const;

export interface WheelAsset {
  name: string;
  version: string;
  url: string;
  sha256: string;
}

export interface BootCommand {
  v: typeof WORKER_PROTOCOL_VERSION;
  type: 'boot';
  bootId: string;
  sessionId: string;
  bootToken: string;
  pyodideUrl: string;
  wheels: WheelAsset[];
}

export interface NarrationRuntimeInput {
  runtimeSource: string;
  manifestJson: string;
  audio: ArrayBuffer;
}

export interface RunCommand {
  v: typeof WORKER_PROTOCOL_VERSION;
  type: 'run';
  bootId: string;
  sessionId: string;
  runId: string;
  runToken: string;
  /** Video runs once per worker; image mode may run sequential independent blocks. */
  mode: 'video' | 'image';
  source: string;
  sceneName: string | null;
  frameRate: number;
  resolution: { width: number; height: number };
  narration: NarrationRuntimeInput | null;
}

export interface DisposeCommand {
  v: typeof WORKER_PROTOCOL_VERSION;
  type: 'dispose';
  sessionId: string;
}

export type WorkerCommand = BootCommand | RunCommand | DisposeCommand;

export interface WorkerStatusMessage {
  v: typeof WORKER_PROTOCOL_VERSION;
  type: 'status';
  bootId: string;
  bootToken: string;
  text: string;
}

export interface WorkerEngineMessage {
  v: typeof WORKER_PROTOCOL_VERSION;
  type: 'engine';
  bootId: string;
  bootToken: string;
  cjk: boolean;
  engine: {
    js: string;
    wasm: Uint8Array<ArrayBuffer>;
    fonts: Uint8Array<ArrayBuffer>[];
  };
}

export interface WorkerFeedMessage {
  v: typeof WORKER_PROTOCOL_VERSION;
  type: 'feed';
  sessionId: string;
  runId: string;
  runToken: string;
  bytes: ArrayBuffer;
}

export interface WorkerDoneMessage {
  v: typeof WORKER_PROTOCOL_VERSION;
  type: 'done';
  sessionId: string;
  runId: string;
  runToken: string;
  frameCount: number;
  sceneDuration: number;
  narration: {
    status: 'none' | 'included';
    audioDuration: number | null;
    videoDuration: number | null;
    warnings: string[];
    errors: string[];
  };
}

export interface WorkerErrorMessage {
  v: typeof WORKER_PROTOCOL_VERSION;
  type: 'error';
  sessionId: string;
  runId: string;
  runToken: string;
  error: SerializedBrowserRenderError;
}

export interface WorkerBootErrorMessage {
  v: typeof WORKER_PROTOCOL_VERSION;
  type: 'boot-error';
  bootId: string;
  bootToken: string;
  error: SerializedBrowserRenderError;
}

export interface WorkerDisposedMessage {
  v: typeof WORKER_PROTOCOL_VERSION;
  type: 'disposed';
  sessionId: string;
}

export type WorkerMessage =
  | WorkerStatusMessage
  | WorkerEngineMessage
  | WorkerFeedMessage
  | WorkerDoneMessage
  | WorkerErrorMessage
  | WorkerBootErrorMessage
  | WorkerDisposedMessage;
