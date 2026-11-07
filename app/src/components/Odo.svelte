<script lang="ts">
  /** Scoreboard-style rolling digits. Only transform animates (compositor-only). */
  let { value }: { value: number | string } = $props();
  const chars = $derived(String(value).split(''));
</script>

<span class="odo" aria-label={String(value)}>
  {#each chars as ch, i (chars.length - i)}
    {#if /\d/.test(ch)}
      <span class="col" style="transform: translateY({-Number(ch) * 10}%)" aria-hidden="true">
        {#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as n}<span>{n}</span>{/each}
      </span>
    {:else}
      <span aria-hidden="true">{ch}</span>
    {/if}
  {/each}
</span>

<style>
  /* align-items:flex-start is essential: with the default `stretch` each digit column is squashed to 1em tall,
     so translateY(-n·10%) moves it only 0.1em per digit. */
  .odo { display: inline-flex; align-items: flex-start; overflow: hidden; height: 1em; line-height: 1; font-variant-numeric: tabular-nums; vertical-align: -0.1em; }
  .col { display: flex; flex-direction: column; transition: transform 650ms var(--ease-spring); }
  .col span { height: 1em; }
</style>
