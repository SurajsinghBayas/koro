import { isNative } from './native.ts';

/** Open a link in the phone's browser (not inside the app). */
export async function openUrl(url: string) {
  if (isNative) {
    const { openUrl: open } = await import('@tauri-apps/plugin-opener');
    await open(url).catch((e) => console.warn('open failed', e));
  } else window.open(url, '_blank', 'noopener');
}
