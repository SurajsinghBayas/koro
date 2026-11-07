<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, loadWeather } from '../lib/store.svelte.ts';
  import { ago, fmtTime } from '../lib/util.ts';
  import { aqiLabel, wx } from '../lib/weather.ts';

  /** Current-location weather. `compact` = one block for desk mode. */
  let { compact = false }: { compact?: boolean } = $props();
  const w = $derived(app.weather);
  const cur = $derived(w ? wx(w.now.code, w.now.isDay) : null);
  const aq = $derived(w ? aqiLabel(w.aqi) : null);
  const hr = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', hour12: true }).replace(' ', '').toLowerCase();
</script>

{#if !w}
  {#if !compact}
    <button class="card ask" onclick={() => loadWeather(true)}>
      <Icon name="sun" />
      <span><b>Weather for where you are</b><span class="muted">Tap to allow location (approximate is enough).</span></span>
    </button>
  {/if}
{:else if compact}
  <div class="wc">
    <Icon name={cur!.icon} size={28} />
    <div><b class="num">{Math.round(w.now.temp)}°</b> <span>{cur!.label}</span>
      <div class="sub">{w.place ?? ''} · H {Math.round(w.today.max)}° L {Math.round(w.today.min)}°{w.rainSoon ? ` · ${w.rainSoon}` : ''}</div></div>
  </div>
{:else}
  <section class="card wx">
    <div class="card__title"><h3>{w.place ?? 'Weather'}</h3><button class="label linkish" onclick={() => loadWeather(true)}>{ago(w.at)} ↻</button></div>
    <div class="now">
      <span class="big num">{Math.round(w.now.temp)}°</span>
      <div class="desc">
        <span class="cond"><Icon name={cur!.icon} size={18} /> {cur!.label}</span>
        <span class="muted">Feels {Math.round(w.now.feels)}° · H {Math.round(w.today.max)}° L {Math.round(w.today.min)}°</span>
      </div>
    </div>
    {#if w.rainSoon}<div class="rain"><Icon name="drop" size={14} /> {w.rainSoon}</div>{/if}
    <div class="hours">
      {#each w.hours.slice(0, 8) as h (h.at)}
        <div class="h"><span class="t">{hr(h.at)}</span><Icon name={wx(h.code).icon} size={16} /><b class="num">{Math.round(h.temp)}°</b>{#if h.rain >= 30}<span class="p">{h.rain}%</span>{/if}</div>
      {/each}
    </div>
    <div class="facts">
      <span>Rain {w.today.rainChance}%</span><span>Humidity {w.now.humidity}%</span><span>UV {Math.round(w.today.uv)}</span>
      {#if aq}<span class="aq aq--{aq.tone}">AQI {w.aqi} · {aq.label}</span>{/if}
      <span>Sunset {fmtTime(w.today.sunset)}</span>
    </div>
  </section>
{/if}

<style>
  .ask { display: flex; gap: var(--s3); align-items: center; text-align: left; }
  .ask > span { display: flex; flex-direction: column; gap: 2px; }
  .linkish { background: none; color: var(--accent-text); }
  .now { display: flex; align-items: center; gap: var(--s4); }
  .big { font-size: 3rem; font-weight: 700; line-height: 1; }
  .desc { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-sm); }
  .cond { display: inline-flex; gap: 6px; align-items: center; font-weight: 650; color: var(--gold-text); }
  .rain { margin-top: var(--s3); display: inline-flex; gap: 6px; align-items: center; font-size: var(--fs-sm); font-weight: 600; color: var(--accent-text); }
  .hours { display: flex; gap: 4px; overflow-x: auto; margin: var(--s3) calc(-1 * var(--s2)) 0; padding: 0 var(--s2) 4px; scrollbar-width: none; }
  .h { flex: 0 0 auto; min-width: 44px; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: var(--fs-xs); color: var(--text-2); }
  .h .t { color: var(--text-3); }
  .h .p { color: var(--accent-text); font-weight: 600; }
  .facts { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: var(--s3); font-size: var(--fs-xs); color: var(--text-3); }
  .aq { font-weight: 650; }
  .aq--good { color: var(--success, #3c9d5d); } .aq--ok { color: var(--gold-text); } .aq--warn, .aq--bad { color: var(--danger); }
  .wc { display: flex; gap: var(--s3); align-items: center; color: var(--text); }
  .wc b { font-size: 1.5rem; }
  .wc .sub { font-size: var(--fs-xs); color: var(--text-3); }
</style>
