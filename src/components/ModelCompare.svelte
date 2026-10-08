<script lang="ts">
  /**
   * Multi-model forecast comparison, in meteocool's own styling.
   *
   * The comparison is meteocompare's (github.com/Flowm/meteocompare): 21 NWP
   * models read straight from open-meteo, combined into one weighted forecast
   * with an agreement signal. meteocompare has no backend, so this reads the
   * same public API rather than a server of ours.
   *
   * Drawn in the drawers' frame (StormPanel): the phone's sheet and the
   * desktop's corner panel, as a storm's details are (App.svelte picks the
   * surface), so it does not read as a different app.
   */
  import { onDestroy, onMount } from "svelte";
  import { fetchForecast, type Forecast } from "../lib/compare/openMeteo";
  import { isAbort } from "../lib/timedFetch";
  import { onWake } from "../lib/wakeup";
  import { consensusOf, tierFor, type Consensus } from "../lib/compare/consensus";
  import { modelById } from "../lib/compare/models";
  import { weatherCode } from "../lib/compare/weatherCodes";
  import { reportShown } from "../lib/sentry";
  import ModelSpread from "./ModelSpread.svelte";
  import { reverseGeocode } from "../lib/reverseGeocode";
  import { _, locale } from "svelte-i18n";
  import { get } from "svelte/store";
  import { currentLocale, type Translate } from "../locale/t";
  import StormPanel from "./StormPanel.svelte";

  /** Where to forecast for: meteocool's map centre when the panel was opened. */
  export let lat: number;
  export let lon: number;
  export let onClose: () => void = () => {};
  /** The spread's range to open on, in hours; see ModelSpread. */
  export let initialHours = 24;

  /* The report is about a place, so the place is the heading. Coordinates are
     the fallback and the detail line, not the title: nobody recognises their
     own town from six decimals. */
  let placeName: string | null = null;

  let forecast: Forecast | null = null;
  let error: string | null = null;
  let loading = true;
  /** Which day's per-model breakdown is expanded; null for none. */
  let expanded: string | null = null;

  /**
   * Called off when the panel closes, so twenty-one models' worth of forecast
   * does not go on downloading for a panel nobody has open any more, holding
   * the loading bar up until it is done (on a slow link, a long time).
   */
  const controller = new AbortController();

  /**
   * Ask, and again on a retry or a wake, so an error does not stay up until
   * the panel is closed, however long ago the network came back.
   */
  async function load() {
    loading = true;
    error = null;
    try {
      forecast = await fetchForecast({ lat, lon, forecastDays: 7, signal: controller.signal });
    } catch (e) {
      // Our own abort is the panel closing, not open-meteo failing.
      if (isAbort(e)) return;
      error = e instanceof Error ? e.message : String(e);
      reportShown("compare", e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    /* Resolved once: the panel is built with the map centre it was opened on,
       so the point never moves underneath it. Not a reactive statement: the
       assignment happens in an async callback, which as a `$:` is the shape of
       an infinite loop even when it is not one. */
    reverseGeocode(lat, lon, get(locale) ?? "en", "local", "compare").then((name) => { placeName = name; });
    load();
  });

  const unsubscribeWake = onWake(() => { if (error && !loading) load(); });
  onDestroy(() => {
    unsubscribeWake();
    controller.abort();
  });

  /** Midnight local on the queried day, relative to now, in hours. */
  function leadHours(date: string): number {
    return Math.max(0, (new Date(`${date}T12:00:00`).getTime() - Date.now()) / 3600000);
  }

  function dayName(date: string, index: number, t: Translate): string {
    if (index === 0) return t("compare.today");
    if (index === 1) return t("compare.tomorrow");
    return new Date(`${date}T12:00:00`).toLocaleDateString(currentLocale(), { weekday: "short" });
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

  function view(f: Forecast, t: Translate): DayView[] {
    return f.days.map((day, index) => {
      const lead = leadHours(day.date);
      return {
        date: day.date,
        name: dayName(day.date, index, t),
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

  // `$_` as an argument, so the day names follow a language change.
  $: days = forecast ? view(forecast, $_) : [];

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
  /* The seven days as rows, as the drawers set label-and-value rows: a
     hairline between them and no card around them; the drawer is the card. */
  .days {
    margin: 0;
    padding: 0;
  }

  .day {
    display: grid;
    /* The name takes what is left; everything else is as wide as it needs.
       Two lines per row (high and low over their spread, the amount over
       its chance), so no figure has to wrap on a phone. */
    grid-template-columns: minmax(4.4em, 1fr) 1.6em auto 4.4em auto;
    align-items: center;
    gap: 0.5em;
    margin: 0 -8px;
    padding: 10px 8px;
    border-radius: 10px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--mc-motion-fast);
  }
  .day + .day {
    border-top: 0.5px solid var(--mc-separator);
  }
  .day:hover {
    background-color: var(--mc-tint);
  }
  .day:active {
    background-color: var(--mc-tint-hover);
  }

  .name {
    font-weight: 600;
  }

  .icon {
    font-size: 19px;
    text-align: center;
  }

  .temps {
    font: 600 15px/1.25 var(--mc-font);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* Scoped to the figures, so it does not dim the "uncertain" badge too. */
  .temps .low,
  .precip .low {
    color: var(--mc-text-2);
    font-weight: 400;
  }

  .spread {
    display: block;
    font: 400 11px/1.3 var(--mc-font);
    font-variant-numeric: tabular-nums;
    color: var(--mc-text-3);
  }

  .precip {
    font-variant-numeric: tabular-nums;
    font-size: 13px;
    line-height: 1.3;
    text-align: right;
    white-space: nowrap;
  }

  /* The agreement signal: tinted capsules with ink text, not saturated fills. */
  .tier {
    justify-self: end;
    padding: 5px 9px;
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
    margin: 0 0 6px;
    padding: 8px 12px;
    border-radius: 12px;
    background: var(--mc-tint);
    font-size: 12px;
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
    color: var(--mc-text-2);
  }

  /* Under the error it retries. */
  .mc-retry {
    margin-top: 12px;
  }

  footer a {
    color: var(--mc-accent);
  }
</style>

<StormPanel
  label={placeName ? $_("compare.title_place", { values: { place: placeName } }) : $_("compare.title")}
  place={forecast
    ? $_("compare.responding", { values: { count: forecast.respondingModels.length } })
    : $_("compare.comparing")}
  {onClose}>
  <span slot="header" class="headline">{placeName ?? `${lat.toFixed(3)}, ${lon.toFixed(3)}`}</span>

  {#if loading}
    <div class="status">{$_("compare.loading")}</div>
  {:else if error}
    <div class="status">
      {$_("compare.error")}<br />{error}
      <br /><button type="button" class="mc-retry" on:click={() => load()}>{$_("retry")}</button>
    </div>
  {:else}
    <!-- The spread first: the point of comparing models is the disagreement,
         which is a curve over time, not a column of daily numbers. -->
    <ModelSpread {lat} {lon} {initialHours} />

    <h3 class="section">{$_("compare.days_heading")}<span class="aside">{$_("compare.days_aside")}</span></h3>
    <div class="days">
      {#each days as day (day.date)}
        <div class="day" role="button" tabindex="0" aria-expanded={expanded === day.date}
             on:click={() => toggle(day.date)}
             on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(day.date); } }}>
          <span class="name">{day.name}</span>
          <span class="icon" title={weatherCode(day.code.value, $_).label}>
            {weatherCode(day.code.value, $_).icon}
          </span>
          <span class="temps">
            {round(day.high.value)}° <span class="low">/ {round(day.low.value)}°</span>
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
            title={$_("compare.tier_title", {
              values: { spread: round(day.high.stdDev, 1), count: day.high.contributors.length },
            })}>
            {$_(`compare.tier.${tierFor(day.high.predictability)}`)}
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

    <!-- The sentence is split around the links rather than carrying markup
         through the translation. -->
    <footer>
      {$_("compare.footer.method", {
        values: { lat: lat.toFixed(4), lon: lon.toFixed(4), count: forecast?.respondingModels.length ?? 0 },
      })}
      {$_("compare.footer.registry")}
      <a href="https://github.com/Flowm/meteocompare" target="_blank" rel="noreferrer">meteocompare</a>;
      {$_("compare.footer.data")} <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a>
      (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>).
    </footer>
  {/if}
</StormPanel>
