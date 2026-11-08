<script lang="ts">
  import { app, canPull, runPull } from '../lib/store.svelte.ts';
  import Icon from './Icon.svelte';

  /** Pull down at the top of a screen to refresh it (the screen decides what that fetches, see onPull). */
  const TRIGGER = 72, MAX = 120;
  let dy = $state(0);
  let busy = $state(false);
  let startY = -1, startX = 0;
  let active = $state(false);

  function start(e: TouchEvent) {
    if (busy || app.desk || window.scrollY > 0 || !canPull(app.tab)) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('[role="dialog"], input, textarea, [data-nopull]')) return;
    startY = e.touches[0]!.clientY; startX = e.touches[0]!.clientX; active = false;
  }
  function move(e: TouchEvent) {
    if (startY < 0) return;
    const y = e.touches[0]!.clientY - startY, x = Math.abs(e.touches[0]!.clientX - startX);
    if (!active) {
      if (y > 10 && y > x * 1.5 && window.scrollY <= 0) active = true;
      else if (y < 0 || x > 14) { startY = -1; return; }
      else return;
    }
    e.preventDefault(); // we own this gesture now (no native overscroll / page drag)
    dy = Math.min(MAX, y * 0.5); // rubber band
  }
  async function end() {
    if (startY < 0) return;
    startY = -1;
    if (!active) return;
    active = false;
    if (dy >= TRIGGER * 0.75) {
      busy = true; dy = 56;
      const t0 = Date.now();
      await runPull(app.tab);
      await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - t0)))); // let the spin read as "done"
      busy = false;
    }
    dy = 0;
  }
  $effect(() => {
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  });
  const ready = $derived(dy >= TRIGGER * 0.75);
</script>

{#if dy > 0 || busy}
  <div class="ptr" class:anim={!active || busy} style:transform="translate(-50%, {dy - 48}px)" aria-live="polite">
    <div class="ring" class:spin={busy} class:ready style:--p={Math.min(1, dy / (TRIGGER * 0.75))} style:rotate="{busy ? 0 : dy * 3}deg">
      <Icon name="refresh" size={18} />
    </div>
    {#if busy}<span class="sr">Refreshing</span>{/if}
  </div>
{/if}

<style>
  .ptr { position: fixed; top: calc(var(--safe-top) + 6px); left: 50%; z-index: 70; pointer-events: none; }
  .ptr.anim { transition: transform .25s var(--ease-out); }
  .ring { width: 40px; height: 40px; border-radius: 999px; display: grid; place-items: center; color: var(--text);
          background: var(--surface); box-shadow: 0 6px 20px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.08); position: relative;
          opacity: calc(.35 + var(--p, 1) * .65); }
  .ring::before { content: ""; position: absolute; inset: -2px; border-radius: inherit; padding: 2px; pointer-events: none;
                  background: conic-gradient(#F2C14E, #5EC8FF, #C38BFF, #F2C14E calc(var(--p, 1) * 100%), transparent 0);
                  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); }
  .ring.ready { color: #F2C14E; }
  .ring.spin { animation: spin .8s linear infinite; }
  .ring.spin::before { background: conic-gradient(#F2C14E, #5EC8FF, #C38BFF, transparent 75%); }
  @keyframes spin { to { transform: rotate(360deg); } }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
