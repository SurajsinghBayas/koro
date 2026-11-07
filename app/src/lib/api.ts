/**
 * HTTP client: the WebView's own fetch on the phone and in the browser. The server sends CORS headers,
 * and the Android build allows cleartext so http:// works for Wi-Fi / USB testing against the Mac.
 * (tauri-plugin-http hung on Android until our timeout aborted it, so it is no longer used.)
 */
async function getFetch(): Promise<typeof fetch> {
  return fetch.bind(window);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function request<T>(server: string, path: string, opts: { method?: string; token?: string; body?: unknown; etag?: string; timeoutMs?: number } = {}) {
  const f = await getFetch();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.etag) headers['if-none-match'] = opts.etag;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await f(`${server.replace(/\/+$/, '')}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    if (res.status === 304) return { data: null as T | null, etag: opts.etag, notModified: true };
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, data?.error ?? `HTTP ${res.status}`);
    return { data: data as T, etag: res.headers.get('etag') ?? undefined, notModified: false };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const err = e as Error;
    throw new ApiError(0, err?.name === 'AbortError' ? 'Server not reachable (timed out after 15 s)' : `Server not reachable: ${err?.name ?? ''} ${err?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
}
