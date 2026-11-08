<script lang="ts">
  /** Clean line icons on a 24px grid (2px rounded strokes). Transport glyphs (FILL) are solid. */
  const P: Record<string, string> = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    ball: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M8 4.6c2 2 3 4.5 3 7.4s-1 5.4-3 7.4 M16 4.6c-2 2-3 4.5-3 7.4s1 5.4 3 7.4',
    news: 'M4 5h13v14H6a2 2 0 0 1-2-2z M17 9h3v8a2 2 0 0 1-2 2 M8 9h5 M8 12.5h5 M8 16h3',
    list: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
    gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
    desk: 'M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8 20h8 M12 16v4',
    plus: 'M12 5v14 M5 12h14',
    x: 'M6 6l12 12 M18 6 6 18',
    moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    focus: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 12h.01',
    bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
    sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
    refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.6 4.5L20 16 M20 20v-4h-4',
    trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12 M9 7V4h6v3',
    back: 'M15 18l-6-6 6-6',
    music: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0z M20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0z',
    play: 'M7 4.6v14.8a1 1 0 0 0 1.5.86l12-7.4a1 1 0 0 0 0-1.72l-12-7.4A1 1 0 0 0 7 4.6z',
    pause: 'M7 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M15 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    prev: 'M19 5.6v12.8a1 1 0 0 1-1.6.8L9.2 13a1.2 1.2 0 0 1 0-2l8.2-6.2a1 1 0 0 1 1.6.8z M5 5a1 1 0 0 1 2 0v14a1 1 0 0 1-2 0z',
    next: 'M5 5.6v12.8a1 1 0 0 0 1.6.8l8.2-6.2a1.2 1.2 0 0 0 0-2L6.6 4.8A1 1 0 0 0 5 5.6z M17 5a1 1 0 0 1 2 0v14a1 1 0 0 1-2 0z',
    clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 7v5l3 2',
    cal: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M4 10h16 M8 3v4 M16 3v4',
    drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
    lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z M8 11V7a4 4 0 0 1 8 0v4',
    vol: 'M4 9h3l5-4v14l-5-4H4z M16 9a4 4 0 0 1 0 6 M19 6a8 8 0 0 1 0 12',
    mute: 'M4 9h3l5-4v14l-5-4H4z M16 9l5 6 M21 9l-5 6',
    laptop: 'M5 5h14a1 1 0 0 1 1 1v10H4V6a1 1 0 0 1 1-1z M2 19h20',
    bookmark: 'M6 3h12v18l-6-4-6 4z',
    cloud: 'M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.6 1.5A4 4 0 0 1 17.5 18z',
    minus: 'M5 12h14',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
    heart: 'M12 20s-7-4.4-9-9a5 5 0 0 1 9-4 5 5 0 0 1 9 4c-2 4.6-9 9-9 9z',
    yt: 'M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z M10 9v6l5-3z',
    mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
    queue: 'M4 6h12 M4 11h12 M4 16h7 M16 14v6l5-3z',
    lyrics: 'M4 5h16v11H9l-5 4z M8 9h8 M8 12h5',
    search: 'M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M20 20l-4-4',
    shuffle: 'M3 7h3c5 0 7 10 12 10h3 M18 14l3 3-3 3 M3 17h3c1.6 0 2.8-1 3.8-2.5 M14.2 9.5C15.2 8 16.4 7 18 7h3 M18 4l3 3-3 3',
    repeat: 'M4 11V9a3 3 0 0 1 3-3h13 M17 3l3 3-3 3 M20 13v2a3 3 0 0 1-3 3H4 M7 21l-3-3 3-3',
    thumbdown: 'M7 14h4l-1 5a2 2 0 0 0 3.6 1.3L18 14V4H8.6a2 2 0 0 0-2 1.6L5.1 12A2 2 0 0 0 7 14z M18 4h2v10h-2',
    chevdown: 'M6 9l6 6 6-6',
    sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  };
  const FILL = new Set(['play', 'pause', 'prev', 'next']);
  let { name, size = 20 }: { name: keyof typeof P | string; size?: number } = $props();
  const key = $derived(P[name] ? name : 'list');
</script>

<svg viewBox="0 0 24 24" width={size} height={size} class="icon" aria-hidden="true">
  {#if FILL.has(key)}<path fill="currentColor" d={P[key]} />
  {:else}<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={P[key]} />{/if}
</svg>
