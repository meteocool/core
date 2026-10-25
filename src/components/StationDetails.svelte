<script lang="ts">
/**
 * A weather station tapped on the stations' map: its name, its height, and
 * every value the newest answer has for it, with when it was measured.
 *
 * The answer holds only what the map asked for (lib/stations.ts
 * `parametersFor`), so this is the parameter on show, the wind's direction
 * with its speed. In the storms' frame (StormPanel), as a sheet on a phone
 * and the corner drawer on a desktop.
 */
import { _ } from "svelte-i18n";
import { format } from "date-fns";
import StormPanel from "./StormPanel.svelte";
import { formatValue } from "../lib/stations";
import type { ObservedProperties, StationChoice } from "../lib/stations";
import { toKnots } from "../lib/windBarb";

export let station: ObservedProperties;
export let onClose: () => void = () => {};

/** The rows the sheet can show, in the control's order; each only when the station has it. */
const ROWS: { key: keyof ObservedProperties; label: string; read: (value: number) => string }[] = [
  { key: "wind_speed_m_s", label: "stations.parameter.wind", read: (value) => speed(value) },
  { key: "wind_direction_deg", label: "stations.parameter.wind_direction", read: (value) => `${Math.round(value)}°` },
  { key: "gust_m_s", label: "stations.parameter.gusts", read: (value) => speed(value) },
  { key: "gust_direction_deg", label: "stations.parameter.gust_direction", read: (value) => `${Math.round(value)}°` },
  { key: "temperature_c", label: "stations.parameter.temperature", read: (value) => `${as("temperature", value)} °C` },
  { key: "precipitation_mm", label: "stations.parameter.precipitation", read: (value) => `${as("precipitation", value)} mm` },
  { key: "humidity_pct", label: "stations.parameter.humidity", read: (value) => `${as("humidity", value)} %` },
  { key: "pressure_msl_hpa", label: "stations.parameter.pressure", read: (value) => `${as("pressure", value)} hPa` },
];

const as = (choice: StationChoice, value: number) => formatValue(choice, value);
/** m/s as measured, and the knots a barb is drawn in. */
const speed = (value: number) => `${as("wind", value)} m/s · ${Math.round(toKnots(value))} kt`;

$: rows = ROWS.filter(({ key }) => typeof station[key] === "number")
  .map(({ key, label, read }) => ({ label, value: read(station[key] as number) }));
$: observed = format(new Date(station.observed_at), "HH:mm");
</script>

<StormPanel label={station.name} place={station.state} {onClose}>
  <span slot="header" class="headline">{station.name}</span>
  <dl class="stats">
    <div>
      <dt>{$_("stations.sheet.height")}</dt>
      <dd>{Math.round(station.elevation_m)} m</dd>
    </div>
    <div>
      <dt>{$_("stations.sheet.observed")}</dt>
      <dd>{observed}</dd>
    </div>
  </dl>
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
