<script lang="ts">
/**
 * A weather station tapped on the stations' map: its name, its height, and
 * every value the newest answer has for it, with when it was measured.
 *
 * The answer holds only what the map asked for (lib/stations.ts
 * `parametersFor`), so this is the parameter on show, the wind's direction
 * with its speed. Above them, what the station measured over the last days
 * (StationHistory), which is what the sheet is opened for; its height and
 * when it measured are small, beside its state. In the storms' frame
 * (StormPanel), as a sheet on a phone and the corner drawer on a desktop.
 */
import { _, locale } from "svelte-i18n";
import { format } from "date-fns";
import StormPanel from "./StormPanel.svelte";
import StationHistory from "./StationHistory.svelte";
import { formatValue } from "../lib/stations";
import type { ObservedProperties, StationChoice } from "../lib/stations";
import { toKnots } from "../lib/windBarb";
import { currentLocale } from "../locale/t";

export let station: ObservedProperties;
export let onClose: () => void = () => {};

/** The rows the sheet can show, in the control's order; each only when the station has it. */
const ROWS: { key: keyof ObservedProperties; label: string; read: (value: number, lang: string) => string }[] = [
  { key: "wind_speed_m_s", label: "stations.parameter.wind", read: (value, lang) => speed(value, lang) },
  { key: "wind_direction_deg", label: "stations.parameter.wind_direction", read: (value) => `${Math.round(value)}°` },
  { key: "gust_m_s", label: "stations.parameter.gusts", read: (value, lang) => speed(value, lang) },
  { key: "gust_direction_deg", label: "stations.parameter.gust_direction", read: (value) => `${Math.round(value)}°` },
  { key: "temperature_c", label: "stations.parameter.temperature", read: (value, lang) => `${as("temperature", value, lang)} °C` },
  { key: "precipitation_mm", label: "stations.parameter.precipitation", read: (value, lang) => `${as("precipitation", value, lang)} mm` },
  { key: "humidity_pct", label: "stations.parameter.humidity", read: (value, lang) => `${as("humidity", value, lang)} %` },
  { key: "pressure_msl_hpa", label: "stations.parameter.pressure", read: (value, lang) => `${as("pressure", value, lang)} hPa` },
];

const as = (choice: StationChoice, value: number, lang: string) => formatValue(choice, value, lang);
/** m/s as measured, and the knots a barb is drawn in. */
const speed = (value: number, lang: string) => `${as("wind", value, lang)} m/s · ${Math.round(toKnots(value))} kt`;

/* Named so the rows are written again when the language changes. */
$: lang = $locale ?? currentLocale();

$: rows = ROWS.filter(({ key }) => typeof station[key] === "number")
  .map(({ key, label, read }) => ({ label, value: read(station[key] as number, lang) }));
$: observed = format(new Date(station.observed_at), "HH:mm");
/* Its state, then its height and when it measured: small, as the place line is. */
$: place = $_("stations.sheet.place", {
  values: { state: station.state, height: Math.round(station.elevation_m), time: observed },
});
</script>

<StormPanel label={station.name} {place} {onClose}>
  <span slot="header" class="headline">{station.name}</span>
  {#key station.station}
    <StationHistory station={station.station} />
  {/key}
  <h3 class="section">{$_("stations.sheet.latest")}</h3>
  {#if rows.length}
    <dl class="facts">
      {#each rows as row (row.label)}
        <div>
          <dt>{$_(row.label)}</dt>
          <dd>{row.value}</dd>
        </div>
      {/each}
    </dl>
  {:else}
    <p class="none">{$_("stations.sheet.none")}</p>
  {/if}
  <footer>{$_("stations.sheet.source")}</footer>
</StormPanel>

<style>
  .none {
    margin: 0;
    color: var(--mc-text-2);
  }
</style>
