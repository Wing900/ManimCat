const COUNTRY_LOOKUP_TIMEOUT_MS = 1500;

/** Cloudflare answers on the visitor's origin; the raw IP is never stored. */
export async function loadVisitorCountry(signal: AbortSignal): Promise<string | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) return null;
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, COUNTRY_LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch('/cdn-cgi/trace', {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'text/plain' },
    });
    if (!response.ok) return null;
    const trace = await response.text();
    const country = /^loc=([A-Z]{2})\r?$/m.exec(trace)?.[1];
    // XX means unknown. Non-country values such as T1 (Tor) also fall back.
    return country && country !== 'XX' ? country : null;
  } catch {
    // Local development and deployments without Cloudflare use browser language.
    return null;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
