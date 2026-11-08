import { DEMO } from './demo.ts';

/** Tiny IndexedDB key-value store (works in the Android WebView and in a desktop browser). */
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('koro', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve((r.result as T) ?? fallback);
      r.onerror = () => resolve(fallback);
    });
  } catch {
    return fallback;
  }
}

export async function kvSet(key: string, value: unknown) {
  if (DEMO) return; // demo mode never saves
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put($stateSnapshot(value), key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('kvSet failed', key, e);
  }
}

/** Svelte $state proxies can't be structured-cloned; plain JSON copy is enough for our data. */
function $stateSnapshot(v: unknown) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export async function kvClear() {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').clear();
      tx.oncomplete = () => resolve();
    });
  } catch { /* ignore */ }
}
