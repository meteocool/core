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

  /** Where to forecast for: meteocool's map centre when the panel was opened. */
  export let lat: number;
  export let lon: number;
  export let onClose: () => void = () => {};

  let forecast: Forecast | null = null;
  let error: string | null = null;
  let loading = true;
  /** Which day's per-model breakdown is expanded; null for none. */
  let expanded: string | null = null;

  onMount(async () => {
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
  .panel {
    position: absolute;
    inset: 0;
    background-color: var(--sl-color-white);
    color: var(--sl-color-gray-700);
    z-index: 10000001;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 0.6em;
    padding: 0.8em 1em 0.4em;
  }

  h1 {
    font-size: 1.1em;
    margin: 0;
    font-weight: 600;
  }

  .where {
    font-size: 0.8em;
    opacity: 0.65;
    margin-left: auto;
    text-align: right;
  }

  .days {
    padding: 0 0.6em 1em;
  }

  .day {
    display: grid;
    grid-template-columns: 3.4em 2.2em 1fr 4.6em 4.2em;
    align-items: center;
    gap: 0.5em;
    padding: 0.55em 0.4em;
    border-top: 1px solid var(--sl-color-gray-200);
    cursor: pointer;
  }

  .day:hover {
    background-color: var(--sl-color-gray-50);
  }

  .name {
    font-weight: 600;
    font-size: 0.9em;
  }

  .icon {
    font-size: 1.3em;
    text-align: center;
  }

  .temps {
    font-variant-numeric: tabular-nums;
    font-size: 0.95em;
  }

  .low {
    opacity: 0.55;
  }

  .spread {
    font-size: 0.75em;
    opacity: 0.5;
    margin-left: 0.4em;
  }

  .precip {
    font-variant-numeric: tabular-nums;
    font-size: 0.85em;
    text-align: right;
  }

  /* The agreement signal: how much the models back this forecast. */
  .tier {
    font-size: 0.7em;
    text-align: center;
    border-radius: 10px;
    padding: 2px 6px;
    white-space: nowrap;
  }
  .tier.high { background: #1a7f37; color: #fff; }
  .tier.mid { background: #b7791f; color: #fff; }
  .tier.low { background: #a62b2b; color: #fff; }

  .breakdown {
    padding: 0.3em 0.4em 0.7em 3.9em;
    font-size: 0.78em;
  }

  .model {
    display: grid;
    grid-template-columns: 1fr 3.4em 3.4em 4em;
    gap: 0.4em;
    padding: 1px 0;
    font-variant-numeric: tabular-nums;
  }

  .model .id {
    opacity: 0.7;
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
    opacity: 0.7;
    font-size: 0.9em;
  }

  footer {
    padding: 0 1em 1.4em;
    font-size: 0.7em;
    opacity: 0.6;
    line-height: 1.5;
  }

  footer a {
    color: inherit;
  }

  .close {
    position: absolute;
    top: 0.6em;
    right: 0.8em;
    font-size: 1.6em;
    line-height: 1;
    cursor: pointer;
    opacity: 0.6;
    z-index: 1;
  }
  .close:hover { opacity: 1; }
</style>

<div class="panel">
  <div class="close" on:click={onClose} title="Close">×</div>

  <header>
    <h1>🌡 Model Comparison</h1>
    <div class="where">
      {lat.toFixed(3)}, {lon.toFixed(3)}
      {#if forecast}<br />{forecast.respondingModels.length} of 21 models{/if}
    </div>
  </header>

  {#if loading}
    <div class="status">Asking 21 weather models…</div>
  {:else if error}
    <div class="status">Could not reach open-meteo.<br />{error}</div>
  {:else}
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
              ? "agreed"
              : tierFor(day.high.predictability) === "mid"
                ? "mixed"
                : "uncertain"}
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
      Weighted across {forecast?.respondingModels.length} models that cover this point, discounting
      shared lineage so a family of related models does not read as independent
      agreement. The badge scores temperature agreement against the spread
      normal for that lead time. Method and model registry from
      <a href="https://github.com/Flowm/meteocompare" target="_blank" rel="noreferrer">meteocompare</a>;
      data from <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">open-meteo</a>.
      Tap a day for the per-model figures.
    </footer>
  {/if}
</div>
