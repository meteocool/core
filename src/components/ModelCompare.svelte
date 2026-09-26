<script lang="ts">
  /**
   * Multi-model forecast comparison, in meteocool's own styling.
   *
   * The comparison is meteocompare's (github.com/Flowm/meteocompare): 21 NWP
   * models read straight from open-meteo, combined into one weighted forecast
   * with an agreement signal. meteocompare has no backend, so this reads the
   * same public API rather than a server of ours.
   */
  import { onMount } from "svelte";
  import { fetchForecast, type Forecast } from "../lib/compare/openMeteo";
  import { consensusOf, tierFor, type Consensus } from "../lib/compare/consensus";
  import { modelById } from "../lib/compare/models";
  import { weatherCode } from "../lib/compare/weatherCodes";
  import { reportError } from "../lib/Toast";
  import ModelSpread from "./ModelSpread.svelte";
  import { reverseGeocode } from "../lib/reverseGeocode";
  import { locale } from "svelte-i18n";
  import { get } from "svelte/store";

  /** Where to forecast for: meteocool's map centre when the panel was opened. */
  export let lat: number;
  export let lon: number;
  export let onClose: () => void = () => {};

  /* The report is about a place, so the place is the heading. Coordinates are
     the fallback and the detail line, not the title: nobody recognises their
     own town from six decimals. */
  let placeName: string | null = null;

  let forecast: Forecast | null = null;
  let error: string | null = null;
  let loading = true;
  /** Which day's per-model breakdown is expanded; null for none. */
  let expanded: string | null = null;

  onMount(async () => {
    /* Resolved once: the panel is built with the map centre it was opened on,
       so the point never moves underneath it. Not a reactive statement -- the
       assignment happens in an async callback, which as a `$:` is the shape of
       an infinite loop even when it is not one. */
    reverseGeocode(lat, lon, get(locale) ?? "en", "local", "compare").then((name) => { placeName = name; });
    try {
      forecast = await fetchForecast({ lat, lon, forecastDays: 7 });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      reportError(e);
    } finally {
      loading = false;
    }
  });

  /** Midnight local on the queried day, relative to now, in hours. */
  function leadHours(date: string): number {
    return Math.max(0, (new Date(`${date}T12:00:00`).getTime() - Date.now()) / 3600000);
  }

  function dayName(date: string, index: number): string {
    if (index === 0) return "Today";
    if (index === 1) return "Tomorrow";
    return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
  }

  function round(value: number | null, digits = 0): string {
    if (value === null) return "–";
    return value.toFixed(digits);
  }

  interface DayView {
    date: string;
    name: string;
    lead: number;
    code: Consensus;
    high: Consensus;
    low: Consensus;
    precip: Consensus;
    probability: Consensus;
    wind: Consensus;
  }

  function view(f: Forecast): DayView[] {
    return f.days.map((day, index) => {
      const lead = leadHours(day.date);
      return {
        date: day.date,
        name: dayName(day.date, index),
        lead,
        code: consensusOf(day.values.weather_code, "weather_code", lead),
        high: consensusOf(day.values.temperature_2m_max, "temperature_2m_max", lead),
        low: consensusOf(day.values.temperature_2m_min, "temperature_2m_min", lead),
        precip: consensusOf(day.values.precipitation_sum, "precipitation_sum", lead),
        probability: consensusOf(day.values.precipitation_probability_max, "precipitation_probability_max", lead),
        wind: consensusOf(day.values.wind_speed_10m_max, "wind_speed_10m_max", lead),
      };
    });
  }

  $: days = forecast ? view(forecast) : [];

  function toggle(date: string) {
    expanded = expanded === date ? null : date;
  }

  /** The per-model high/low rows shown when a day is expanded. */
  function breakdown(date: string) {
    const day = forecast?.days.find((d) => d.date === date);
    if (!day) return [];
    const ids = Object.keys(day.values.temperature_2m_max);
    return ids
      .map((id) => ({
        id,
        label: modelById(id)?.label ?? id,
        high: day.values.temperature_2m_max[id],
        low: day.values.temperature_2m_min[id],
        precip: day.values.precipitation_sum[id],
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
</script>

<style>
  /* Solid sheet, no blur: it covers the whole viewport. */
  .panel {
    position: absolute;
    inset: 0;
    z-index: var(--mc-z-sheet-2);
    box-sizing: border-box;
    padding: var(--mc-safe-top) 0 calc(var(--mc-safe-bottom) + 16px);
    background: var(--mc-sheet);
    color: var(--mc-text);
    font-family: var(--mc-font);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* A large title, the way a system app opens a screen: the place is the
     subject, so it is the title, and there is no room above it for a label
     saying what kind of screen this is. The tile that opens this already said
     that, and by the time you are reading a forecast you know. */
  header {
    padding: 10px 56px 14px 16px;
  }

  h1 {
    margin: 0;
    /* Shrinks before it wraps: a long German place name at 34px is wider than
       a phone, and two lines of large title pushes the chart off the screen. */
    font-size: clamp(25px, 7.4vw, 34px);
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.03em;
  }

  /* The subtitle a large title takes: secondary ink, body size, one line. The
     coordinates moved into the panel's own footnote -- six decimals under a
     place name is the kind of detail that reads as clutter until you need it,
     and the diagnostics panel is where the numbers live. */
  .where {
    margin: 3px 0 0;
    font: 400 15px/1.3 var(--mc-font);
    letter-spacing: -0.01em;
    color: var(--mc-text-2);
  }

  .close {
    position: absolute;
    top: calc(var(--mc-safe-top) + 10px);
    right: 12px;
    z-index: 1;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--mc-tint);
    color: var(--mc-text-2);
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast);
  }
  .close:hover {
    background: var(--mc-tint-hover);
    color: var(--mc-text);
  }
  .close:active {
    transform: scale(var(--mc-press));
  }

  /* The seven days as one inset grouped card. */
  .days {
    margin: 0 12px 12px;
    padding: 0;
    background: var(--mc-sheet-card);
    border: 1px solid var(--mc-separator);
    border-radius: var(--mc-radius-card);
    box-shadow: var(--mc-glass-highlight);
    overflow: hidden;
  }

  .day {
    display: grid;
    grid-template-columns: 5.2em 2.2em 1fr 4.6em 4.6em;
    align-items: center;
    gap: 0.5em;
    padding: 10px 12px;
    border-top: 1px solid var(--mc-separator);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--mc-motion-fast);
  }
  .day:first-child {
    border-top: 0;
  }
  .day:hover {
    background-color: var(--mc-tint);
  }
  .day:active {
    background-color: var(--mc-tint-hover);
  }

  .name {
    font-weight: 600;
    font-size: 14px;
  }

  .icon {
    font-size: 20px;
    text-align: center;
  }

  .temps {
    font-variant-numeric: tabular-nums;
    font-size: 15px;
    font-weight: 500;
  }

  /* Scoped to the figures, so it no longer dims the "uncertain" badge too. */
  .temps .low,
  .precip .low {
    color: var(--mc-text-2);
  }

  .spread {
    margin-left: 0.4em;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--mc-text-3);
  }

  .precip {
    font-variant-numeric: tabular-nums;
    font-size: 13px;
    text-align: right;
  }

  /* The agreement signal: tinted capsules with ink text, not saturated fills. */
  .tier {
    display: inline-block;
    padding: 5px 8px;
    border-radius: var(--mc-radius-pill);
    font: 600 11px/1 var(--mc-font);
    letter-spacing: 0.01em;
    text-align: center;
    white-space: nowrap;
  }
  .tier.high { background: var(--mc-green-tint); color: var(--mc-green-ink); }
  .tier.mid { background: var(--mc-orange-tint); color: var(--mc-orange-ink); }
  .tier.low { background: var(--mc-red-tint); color: var(--mc-red-ink); }

  .breakdown {
    margin: 0;
    padding: 6px 12px 10px 12px;
    font-size: 12px;
    background: var(--mc-tint);
    border-top: 1px solid var(--mc-separator);
  }

  .model {
    display: grid;
    grid-template-columns: 1fr 3.4em 3.4em 4em;
    gap: 0.4em;
    padding: 2px 0;
    font-variant-numeric: tabular-nums;
  }

  .model .id {
    color: var(--mc-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .model span:not(.id) {
    text-align: right;
  }

  .status {
    padding: 2em 1em;
    text-align: center;
    font-size: 14px;
    color: var(--mc-text-2);
  }

  footer {
    padding: 0 16px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--mc-text-2);
  }

  footer a {
    color: var(--mc-accent);
  }
</style>

<div class="panel">
  <div class="close" on:click={onClose} title="Close">×</div>

  <header>
    <h1>{placeName ?? `${lat.toFixed(3)}, ${lon.toFixed(3)}`}</h1>
    <p class="where">
      {#if forecast}{forecast.respondingModels.length} of 21 models{:else}Comparing models…{/if}
    </p>
  </header>

  {#if loading}
    <div class="status">Asking 21 weather models…</div>
  {:else if error}
    <div class="status">Could not reach open-meteo.<br />{error}</div>
  {:else}
    <!-- The spread first: the point of comparing models is the disagreement,
         which is a curve over time, not a column of daily numbers. -->
    <ModelSpread {lat} {lon} />

    <div class="days">
      {#each days as day (day.date)}
        <div class="day" on:click={() => toggle(day.date)}>
          <span class="name">{day.name}</span>
          <span class="icon" title={weatherCode(day.code.value).label}>
            {weatherCode(day.code.value).icon}
          </span>
          <span class="temps">
            {round(day.high.value)}°<span class="low"> / {round(day.low.value)}°</span>
            {#if day.high.stdDev >= 0.5}
              <span class="spread">±{round(day.high.stdDev, 1)}</span>
            {/if}
          </span>
          <span class="precip">
            {round(day.precip.value, 1)} mm
            {#if day.probability.value !== null}
              <br /><span class="low">{round(day.probability.value)}%</span>
            {/if}
          </span>
          <span
            class="tier {tierFor(day.high.predictability)}"
            title="Temperature spread ±{round(day.high.stdDev, 1)}° across {day.high.contributors.length} models">
            {tierFor(day.high.predictability) === "high"
              ? "Agreed"
              : tierFor(day.high.predictability) === "mid"
                ? "Mixed"
                : "Uncertain"}
          </span>
        </div>

        {#if expanded === day.date}
          <div class="breakdown">
            {#each breakdown(day.date) as model (model.id)}
              <div class="model">
                <span class="id">{model.label}</span>
                <span>{round(model.high)}°</span>
                <span>{round(model.low)}°</span>
                <span>{round(model.precip, 1)} mm</span>
              </div>
            {/each}
          </div>
        {/if}
      {/each}
    </div>

    <footer>
      Forecast for {lat.toFixed(4)}, {lon.toFixed(4)}.
      Weighted across {forecast?.respondingModels.length} models that cover this point, discounting
      shared lineage so a family of related models does not read as independent
      agreement. The badge scores temperature agreement against the spread
      normal for that lead time. Method and model registry from
      <a href="https://github.com/Flowm/meteocompare" target="_blank" rel="noreferrer">meteocompare</a>;
      data from <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a>
      (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>).
      Tap a day for the per-model figures.
    </footer>
  {/if}
</div>
