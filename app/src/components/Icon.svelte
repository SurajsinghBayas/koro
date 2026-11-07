<script lang="ts">
  /** Pixel icons on a 24px grid (crisp edges). */
  const P: Record<string, string> = {
    home: 'M4 10h2V8h2V6h2V4h4v2h2v2h2v2h2v10h-6v-6h-4v6H4z',
    ball: 'M9 3h6v2h2v2h2v10h-2v2h-2v2H9v-2H7v-2H5V7h2V5h2zm0 4v2H7v6h2v2h6v-2h2V9h-2V7zm2 2h2v6h-2z',
    news: 'M4 4h16v16H4zm2 2v4h12V6zm0 6v2h12v-2zm0 4v2h8v-2z',
    list: 'M4 4h2v2H4zm4 0h12v2H8zm-4 6h2v2H4zm4 0h12v2H8zm-4 6h2v2H4zm4 0h12v2H8z',
    gear: 'M10 2h4v3h2v1h1V5h2v2h-1v1h1v2h3v4h-3v2h-1v1h1v2h-2v-1h-1v1h-2v3h-4v-3H8v-1H7v1H5v-2h1v-1H5v-2H2v-4h3V8h1V7H5V5h2v1h1V5h2zm0 7v6h4V9z',
    desk: 'M3 5h18v11H3zm2 2v7h14V7zm4 11h6v2H9z',
    plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
    x: 'M5 5h2v2h2v2h2v2h2V9h2V7h2V5h2v2h-2v2h-2v2h-2v2h2v2h2v2h2v2h-2v-2h-2v-2h-2v-2h-2v2H9v2H7v2H5v-2h2v-2h2v-2h2v-2H9V9H7V7H5z',
    moon: 'M10 3h4v2h-2v2h-2v6h2v2h2v2h4v-2h2v2h-2v2h-2v2h-6v-2H8v-2H6v-2H4V9h2V7h2V5h2z',
    focus: 'M10 2h4v2h2v2h2v2h2v8h-2v2h-2v2h-2v2h-4v-2H8v-2H6v-2H4V8h2V6h2V4h2zm1 4v7h5v-2h-3V6z',
    bolt: 'M13 2h2v6h5v2h-2v2h-2v2h-2v2h-2v2h-2v4H8v-6H3v-2h2v-2h2V8h2V6h2V4h2z',
    sun: 'M11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM8 6h8v2h2v8h-2v2H8v-2H6V8h2z',
    refresh: 'M6 4h10v2h2v2h2v4h-2v-2h-2V8h-2V6H8v2H6v8h2v2h6v-2h2v4H6v-2H4V6h2z',
    trash: 'M9 2h6v2h5v2H4V4h5zM6 8h12v12h-2v2H8v-2H6zm4 2v8h1v-8zm3 0v8h1v-8z',
    back: 'M10 5h2v2h-2v2H8v2h12v2H8v2h2v2h2v2h-2v-2H8v-2H6v-2H4v-2h2V9h2V7h2z',
  };
  let { name, size = 20 }: { name: keyof typeof P | string; size?: number } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} class="icon" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d={P[name] ?? P.list} /></svg>
