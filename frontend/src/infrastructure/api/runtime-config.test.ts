import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isStudioClientDataMode,
  loadStudioDataMode,
  peekStudioDataMode,
  resetStudioDataMode
} from './runtime-config';

/**
 * 形态探测的三条约定：服务端说什么就是什么、**任何失败都是 server**、
 * 一个进程只问一次（形态不会在部署中途改变）。
 */
describe('studio data mode', () => {
  beforeEach(() => {
    resetStudioDataMode();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetStudioDataMode();
  });

  it('reports the shape the server names', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ studioDataMode: 'client' }))));

    expect(peekStudioDataMode()).toBeNull();
    await expect(loadStudioDataMode()).resolves.toBe('client');
    expect(peekStudioDataMode()).toBe('client');
    expect(isStudioClientDataMode()).toBe(true);
  });

  it('answers server for anything it does not recognise', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ studioDataMode: 'whatever' }))));

    await expect(loadStudioDataMode()).resolves.toBe('server');
    expect(isStudioClientDataMode()).toBe(false);
  });

  it('answers server when the probe fails, so a user data never moves silently', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    await expect(loadStudioDataMode()).resolves.toBe('server');
  });

  it('answers server when the endpoint is not there', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));

    await expect(loadStudioDataMode()).resolves.toBe('server');
  });

  it('asks the server once, however many callers ask', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ studioDataMode: 'client' })));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([loadStudioDataMode(), loadStudioDataMode(), loadStudioDataMode()]);
    await loadStudioDataMode();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
