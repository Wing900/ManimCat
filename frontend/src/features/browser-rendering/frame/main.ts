import {
  BROWSER_RENDER_PROTOCOL_VERSION,
  BrowserRenderError,
  initialRenderState,
  serializeRenderError,
  type RenderSessionState,
} from '../types';
import {
  parseParentMessage,
  toWireState,
  type FrameToParent,
} from '../protocol';
import { normalizeSessionInput } from '../validation';
import { FrameController } from './controller';
import { ImageFrameController } from './image-controller';

const stageElement = document.querySelector<HTMLDivElement>('#stage')!;
const shieldElement = document.querySelector<HTMLDivElement>('#shield')!;
const overlayElement = document.querySelector<HTMLDivElement>('#overlay')!;
const badgeElement = document.querySelector<HTMLDivElement>('#badge')!;
const audioButton = document.querySelector<HTMLButtonElement>('#audio')!;

if (!stageElement || !shieldElement || !overlayElement || !badgeElement || !audioButton) {
  throw new Error('The browser renderer frame is missing its DOM');
}

const canvas = document.createElement('canvas');
canvas.className = 'film';
canvas.setAttribute('aria-label', 'ManimGX 动画播放器');
stageElement.append(canvas);

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function resolveParentOrigin(): string | null {
  const params = new URLSearchParams(location.search);
  const declared = originOf(params.get('parent'));
  const referrer = originOf(document.referrer || null);
  const ancestors = (
    location as Location & { ancestorOrigins?: DOMStringList }
  ).ancestorOrigins;
  const ancestor = ancestors && ancestors.length > 0 ? originOf(ancestors[0] ?? null) : null;
  // CR18 is deliberately not accepted: ancestorOrigins[0] is the nearest ancestor's
  // origin in the browsers this runtime targets, so an arbitrary contains() check
  // would weaken the immediate-parent binding. Reject a same-origin parent inside the
  // frame as well as on the host side.
  if (declared) {
    if (declared === location.origin) return null;
    if (referrer && referrer !== declared) return null;
    if (ancestor && ancestor !== declared) return null;
    return declared;
  }
  const fallback = referrer ?? ancestor;
  if (!fallback || fallback === location.origin) return null;
  return fallback;
}

const parentOrigin = resolveParentOrigin();
let activeSessionId: string | null = null;
let controller: FrameController | null = null;
let imageController: ImageFrameController | null = null;

function post(message: FrameToParent, transfer: Transferable[] = []): void {
  if (!parentOrigin) return;
  window.parent.postMessage(message, parentOrigin, transfer);
}

function showStatus(text: string): void {
  shieldElement.hidden = false;
  overlayElement.replaceChildren();
  overlayElement.hidden = false;
  overlayElement.classList.remove('error');
  const line = document.createElement('div');
  line.textContent = text;
  overlayElement.append(line);
}

function showError(error: BrowserRenderError): void {
  shieldElement.hidden = false;
  overlayElement.replaceChildren();
  overlayElement.hidden = false;
  overlayElement.classList.add('error');
  const title = document.createElement('strong');
  title.textContent = error.message;
  const code = document.createElement('div');
  code.className = 'code';
  code.textContent =
    error.line === null ? error.code : `${error.code} · line ${error.line}`;
  overlayElement.append(title, code);
  if (error.detail) {
    const detail = document.createElement('pre');
    detail.textContent =
      error.detail.length > 4000 ? `${error.detail.slice(0, 4000)}…` : error.detail;
    overlayElement.append(detail);
  }
}

function updateAudioControl(state: RenderSessionState): void {
  const show =
    state.audio === 'locked' &&
    state.ready &&
    state.phase !== 'error' &&
    state.phase !== 'disposed';
  audioButton.hidden = !show;
  audioButton.textContent = '启用旁白';
}

function updateBadge(state: RenderSessionState): void {
  const parts: string[] = [];
  if (state.audio === 'locked' && state.ready) parts.push('旁白待启用');
  else if (state.narration === 'included') parts.push('旁白音轨');
  else if (state.narration === 'pending') parts.push('旁白准备中');
  else if (state.narration === 'error') parts.push('旁白错误');
  else parts.push('无旁白');
  if (state.cjk === 'loaded') parts.push('中文字体');
  if (state.visualCheck === 'unavailable') parts.push('画面未取样');
  badgeElement.textContent = parts.join(' · ');
}

function postState(state: RenderSessionState): void {
  if (!activeSessionId) return;
  updateBadge(state);
  updateAudioControl(state);
  if (state.error) showError(state.error);
  else if (state.statusText) showStatus(state.statusText);
  else {
    shieldElement.hidden = true;
    overlayElement.hidden = true;
    overlayElement.replaceChildren();
  }
  post({
    v: BROWSER_RENDER_PROTOCOL_VERSION,
    type: 'session:state',
    sessionId: activeSessionId,
    state: toWireState(state),
  });
}

function postSessionError(sessionId: string, error: BrowserRenderError): void {
  post({
    v: BROWSER_RENDER_PROTOCOL_VERSION,
    type: 'session:error',
    sessionId,
    error: serializeRenderError(error),
  });
}

audioButton.addEventListener('click', (event) => {
  // This handler runs inside the renderer frame, so the click is a trusted user
  // gesture here. The host's postMessage play cannot grant that activation.
  event.preventDefault();
  controller?.unlockAudio();
});

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!parentOrigin) return;
  if (event.source !== window.parent || event.origin !== parentOrigin) return;
  const parsed = parseParentMessage(event.data);
  if (!parsed.ok) return;
  const message = parsed.value;
  if (message.type === 'image:start') {
    if (activeSessionId !== null || controller !== null || imageController !== null) {
      postSessionError(
        message.sessionId,
        new BrowserRenderError('protocol', 'This frame already owns a render session'),
      );
      return;
    }
    activeSessionId = message.sessionId;
    shieldElement.hidden = true;
    overlayElement.hidden = true;
    overlayElement.replaceChildren();
    badgeElement.textContent = '';
    audioButton.hidden = true;
    let created: ImageFrameController;
    try {
      created = new ImageFrameController(canvas, message.input, {
      onProgress: (progress) => {
        if (!activeSessionId) return;
        if (progress.statusText) showStatus(progress.statusText);
        post({
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'image:progress',
          sessionId: activeSessionId,
          completed: progress.completed,
          total: progress.total,
          index: progress.index,
          statusText: progress.statusText,
        });
      },
      onBlock: (block) => {
        if (!activeSessionId) return;
        post(
          {
            v: BROWSER_RENDER_PROTOCOL_VERSION,
            type: 'image:block',
            sessionId: activeSessionId,
            index: block.index,
            width: block.width,
            height: block.height,
            bytes: block.bytes,
          },
          [block.bytes],
        );
      },
      onComplete: (count) => {
        if (!activeSessionId) return;
        showStatus('图片已完成');
        post({
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'image:complete',
          sessionId: activeSessionId,
          count,
        });
      },
      onError: (error) => {
        if (!activeSessionId) return;
        showError(error);
        postSessionError(activeSessionId, error);
      },
      });
    } catch (error) {
      const failure =
        error instanceof BrowserRenderError
          ? error
          : new BrowserRenderError('invalid-input', 'The image session input is invalid', {
              detail: error instanceof Error ? error.message : String(error),
            });
      activeSessionId = null;
      showError(failure);
      postSessionError(message.sessionId, failure);
      return;
    }
    imageController = created;
    void created.start().catch((error: unknown) => {
      const failure =
        error instanceof BrowserRenderError
          ? error
          : new BrowserRenderError('internal', 'The image renderer failed to start', {
              detail: error instanceof Error ? error.message : String(error),
            });
      postSessionError(message.sessionId, failure);
    });
    return;
  }
  if (message.type === 'session:start') {
    if (activeSessionId !== null || controller !== null || imageController !== null) {
      postSessionError(
        message.sessionId,
        new BrowserRenderError('protocol', 'This frame already owns a render session'),
      );
      return;
    }
    activeSessionId = message.sessionId;
    let normalized;
    try {
      normalized = normalizeSessionInput(
        {
          sessionId: message.input.sessionId,
          source: message.input.source,
          sceneName: message.input.sceneName ?? undefined,
          frameRate: message.input.frameRate,
          resolution: message.input.resolution,
          narration: message.input.narration
            ? {
                manifest: message.input.narration.manifest,
                audio: message.input.narration.audio,
                format: 'wav',
              }
            : undefined,
        },
        message.input.narration?.audio ?? null,
      );
    } catch (error) {
      const failure =
        error instanceof BrowserRenderError
          ? error
          : new BrowserRenderError('invalid-input', 'The session input is invalid', {
              detail: error instanceof Error ? error.message : String(error),
            });
      const state: RenderSessionState = {
        ...initialRenderState(),
        sessionId: message.sessionId,
        phase: 'error',
        narration: message.input.narration ? 'error' : 'none',
        error: failure,
      };
      postState(state);
      postSessionError(message.sessionId, failure);
      return;
    }
    const created = new FrameController(canvas, normalized, {
      onState: postState,
      onProgress: (currentTime, duration) => {
        if (!activeSessionId) return;
        post({
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'session:progress',
          sessionId: activeSessionId,
          currentTime,
          duration,
        });
      },
      onComplete: (duration, narration, visualCheck, cjk) => {
        if (!activeSessionId) return;
        post({
          v: BROWSER_RENDER_PROTOCOL_VERSION,
          type: 'session:complete',
          sessionId: activeSessionId,
          duration,
          narration,
          visualCheck,
          cjk,
        });
      },
      onError: (error) => {
        if (!activeSessionId) return;
        postSessionError(activeSessionId, error);
      },
    });
    controller = created;
    void created.start().catch((error: unknown) => {
      const failure =
        error instanceof BrowserRenderError
          ? error
          : new BrowserRenderError('internal', 'The renderer failed to start', {
              detail: error instanceof Error ? error.message : String(error),
            });
      postSessionError(message.sessionId, failure);
    });
    return;
  }
  if (!activeSessionId || message.sessionId !== activeSessionId) return;
  if (message.type === 'session:dispose') {
    const sessionId = activeSessionId;
    controller?.dispose();
    controller = null;
    imageController?.dispose();
    imageController = null;
    activeSessionId = null;
    post({
      v: BROWSER_RENDER_PROTOCOL_VERSION,
      type: 'session:disposed',
      sessionId,
    });
    shieldElement.hidden = true;
    overlayElement.hidden = true;
    overlayElement.replaceChildren();
    badgeElement.textContent = '';
    audioButton.hidden = true;
    return;
  }
  if (!controller) return;
  if (message.type === 'playback:play') controller.play();
  else if (message.type === 'playback:pause') controller.pause();
  else if (message.type === 'playback:seek') controller.seek(message.seconds);
});

if (!parentOrigin) {
  showError(
    new BrowserRenderError(
      'renderer-origin',
      'The renderer frame has no validated parent origin',
      { detail: 'The host must open this frame with ?parent=<origin>.' },
    ),
  );
} else {
  showStatus('渲染器已就绪');
  post({ v: BROWSER_RENDER_PROTOCOL_VERSION, type: 'frame:ready' });
}
