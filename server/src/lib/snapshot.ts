import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../env.ts';

/** Feed caches (news, matches) live in memory; a JSON snapshot on disk survives restarts. Not in Neon on purpose. */
export function loadSnapshot<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(env.DATA_DIR, `${name}.json`), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function saveSnapshot(name: string, value: unknown) {
  try {
    mkdirSync(env.DATA_DIR, { recursive: true });
    const file = join(env.DATA_DIR, `${name}.json`);
    writeFileSync(file + '.tmp', JSON.stringify(value));
    renameSync(file + '.tmp', file);
  } catch (e) {
    console.warn(`[snapshot] could not save ${name}:`, (e as Error).message);
  }
}
