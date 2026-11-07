/** fetch with timeout + conditional GET (ETag / Last-Modified) memory, so unchanged feeds cost a 304. */
const validators = new Map<string, { etag?: string; lastModified?: string; body: string }>();

export async function fetchText(url: string, opts: { timeoutMs?: number; conditional?: boolean; headers?: Record<string, string> } = {}) {
  const { timeoutMs = 12_000, conditional = true } = opts;
  const prev = conditional ? validators.get(url) : undefined;
  const headers: Record<string, string> = {
    'user-agent': 'Mozilla/5.0 (Koro personal dashboard; +https://github.com/)',
    accept: '*/*',
    ...opts.headers,
  };
  if (prev?.etag) headers['if-none-match'] = prev.etag;
  if (prev?.lastModified) headers['if-modified-since'] = prev.lastModified;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (res.status === 304 && prev) return { text: prev.body, changed: false };
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const text = await res.text();
  if (conditional) {
    validators.set(url, {
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined,
      body: text,
    });
  }
  return { text, changed: true };
}

export async function fetchJson<T>(url: string, timeoutMs = 12_000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.replace(/(apikey|api_token)=[^&]+/g, '$1=***')}`);
  return (await res.json()) as T;
}
