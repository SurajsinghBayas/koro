import { isNative } from './native.ts';

/**
 * HTTP client. On the phone requests go through tauri-plugin-http (Rust, rustls): no CORS, and plain
 * http:// works for testing against your Mac on Wi-Fi. In the browser it's normal fetch.
 */
let httpFetch: typeof fetch | null = null;
async function getFetch(): Promise<typeof fetch> {
  if (httpFetch) return httpFetch;
  httpFetch = isNative ? ((await import('@tauri-apps/plugin-http')).fetch as typeof fetch) : fetch.bind(window);
  return httpFetch;
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
    throw new ApiError(0, (e as Error)?.name === 'AbortError' ? 'Server not reachable (timeout)' : `Server not reachable: ${(e as Error)?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
}
