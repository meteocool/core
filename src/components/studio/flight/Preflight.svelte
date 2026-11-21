<script lang="ts">
/**
 * Before a flight: its plan, on one page, for the reader to change and then
 * take off from.
 *
 * A chart with the start and the way to the storm drawn on it, which a click
 * moves; the aircraft, turning; where and how the flight begins; what the
 * map is drawn with; and a briefing that reads all of it back as a crew
 * would be handed it. The plan and the briefing are lib/studio/flight/plan.ts;
 * the flight that takes it is lib/studio/flight/pilot.ts.
 */
import { onDestroy, onMount } from "svelte";
import { _ } from "svelte-i18n";
import { get } from "svelte/store";
import OlMap from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import { LineString, Point, Polygon } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { boundingExtent } from "ol/extent";
import { fromLonLat, toLonLat } from "ol/proj";
import { Fill, RegularShape, Stroke, Style } from "ol/style";
import { faPlaneDeparture } from "@fortawesome/free-solid-svg-icons/faPlaneDeparture";
import CloseDisc from "../../CloseDisc.svelte";
import Icon from "../../Icon.svelte";
import Segmented from "../../Segmented.svelte";
import AircraftPreview from "./AircraftPreview.svelte";
import { radarColour } from "./instruments";
import { labelsOnly } from "../../../layers/vector";
import { BASE_LAYERS } from "../../../lib/baseLayers";
import { MAP_STYLES } from "../../../lib/cloudStyle";
import type { CloudStyle } from "../../../lib/cloudStyle";
import { tileBounds } from "../../../lib/volumeBox";
import type { Stage } from "../../../lib/studio/director";
import { indicatedFromTrue, machOf } from "../../../lib/studio/flight/atmosphere";
import { cloudBaseAt } from "../../../lib/studio/flight/stationAir";
import { destination, distanceM } from "../../../lib/studio/flight/geo";
import { FLIGHT_STYLE } from "../../../lib/studio/flight/pilot";
import {
  AIRCRAFT, ALTITUDE_RANGE, atMach, briefing, flightLevel, headed, levelled, MACH_RANGE, movedTo, planFrom, retargeted,
} from "../../../lib/studio/flight/plan";
import type { FlightPlan } from "../../../lib/studio/flight/plan";
import { approachTo, clearSkyStart, rankSystems, stormSystems } from "../../../lib/studio/flight/spawn";
import type { StormSystem } from "../../../lib/studio/flight/spawn";
import { STUDIO_BASEMAP } from "../../../lib/studio/store";
import { flightLinkUrl } from "../../../lib/studio/flightLink";
import { startOf } from "../../../lib/studio/flight/plan";
import { sendLink } from "../../../lib/share";
import { shareAvailable, shareIcon } from "../../../lib/shareSupport";
import { cloudsTime, mapBaseLayer, shareDialog } from "../../../stores";

/** The 3D map: where the reader was looking, and the storms on the radar. */
export let stage: Stage;
export let ontakeoff: (plan: FlightPlan) => void;
export let oncancel: () => void;

const FEET = 3.28084;
const KNOTS = 1.943844;
const NM = 1852;
/** How many storm systems the page offers to fly at. */
const OFFERED = 6;
/** How long the nose is drawn on the chart, km. */
const NOSE_KM = 28;

/** How often the radar's list of storms is looked at again while the page is up, ms. */
const LIST_MS = 1500;
/** A storm system this near where the chosen one stood is the chosen one, in a newer list, km. */
const SAME_SYSTEM_KM = 120;

const camera = stage.studioCamera();
const look = { lon: camera?.lon ?? 10, lat: camera?.lat ?? 50, bearing: camera?.bearing ?? 0 };
const ground = (lon: number, lat: number) => stage.groundElevation(lon, lat);
const aircraft = AIRCRAFT[0];

let tiles = stage.stormTiles();
let systems = rankSystems(stormSystems(tiles), look.lon, look.lat);

/** The plan the flight would fly unasked, from the storms listed now. */
const proposed = (): FlightPlan => planFrom(
  systems.length ? approachTo(systems[0], tiles, ground) : clearSkyStart(look.lon, look.lat, look.bearing, ground),
  FLIGHT_STYLE,
);
let plan: FlightPlan = proposed();
/** Whether the reader has changed the plan: from then on it is theirs, whatever the radar lists next. */
let touched = false;
function change(next: FlightPlan): void {
  touched = true;
  plan = next;
}

/* The list of storms is each network's, and they do not all arrive at once:
   a page opened in the map's first seconds planned for a storm a country
   away while the one in front of the reader was still on its way. So the
   list is looked at again while the page is up. A plan the reader has not
   touched is made again from it; one they have keeps everything but its
   storm, which is found again in the new list where it still stands. */
const signature = (list: typeof tiles) => `${list.length}:${list.reduce((sum, tile) => sum + (tile.peakDbz ?? 0), 0).toFixed(0)}`;
let listed = signature(tiles);
const listTimer = setInterval(() => {
  const next = stage.stormTiles();
  if (signature(next) === listed) return;
  listed = signature(next);
  tiles = next;
  systems = rankSystems(stormSystems(tiles), look.lon, look.lat);
  drawStorms();
  if (!touched) {
    plan = proposed();
    frame();
    return;
  }
  const was = plan.target;
  if (!was) return;
  const again = systems
    .map((system) => ({ system, km: distanceM(was.lon, was.lat, system.lon, system.lat) / 1000 }))
    .filter(({ km }) => km <= SAME_SYSTEM_KM)
    .sort((a, b) => a.km - b.km)[0];
  if (again) plan = { ...plan, target: again.system };
}, LIST_MS);

/* Where the clouds begin over the start, as the stations there have it; asked again once the start has moved. */
let base: { km: number; stations: number; warmer: number } | undefined;
let baseFor = "";
function askBase(lon: number, lat: number): void {
  const where = `${lon.toFixed(1)},${lat.toFixed(1)}`;
  if (where === baseFor) return;
  baseFor = where;
  void cloudBaseAt(lon, lat).then((found) => {
    if (baseFor === where) base = found ?? undefined;
  });
}
$: askBase(plan.lon, plan.lat);
$: lines = briefing(plan, systems, $cloudsTime.newest, base);
$: mach = machOf(plan.tas, plan.altitude);
$: level = Math.round((plan.altitude * FEET) / 1000) * 10;
$: target = plan.target ? systems.indexOf(plan.target) : -1;

/** A storm system as the list names it: how strong, how far and which way from where the reader looked. */
function named(system: StormSystem): string {
  const nm = Math.round(distanceM(look.lon, look.lat, system.lon, system.lat) / NM);
  return $_("studio.flight.plan.system", { values: { dbz: Math.round(system.peakDbz), nm, across: Math.round((system.radiusKm * 2000) / NM) } });
}

function setTarget(event: Event): void {
  const system = systems[Number((event.currentTarget as HTMLSelectElement).value)];
  if (!system) return;
  change(retargeted(plan, system, tiles));
  frame();
}

/* The map's layers, as the flight will draw them. The basemap is Studio's
   own setting, kept as the reader leaves it here; the storms' style is the
   flight's alone. The ground's relief is always under a flight, and rough
   air always in its storms. */
const BASEMAPS = ["system", ...BASE_LAYERS.filter((name) => name !== "topographic")];
const chosenBasemap = (_resolved?: string) => window.settings.getString<string>("studioBaseLayer", STUDIO_BASEMAP);
let basemap = chosenBasemap();
$: basemap = chosenBasemap($mapBaseLayer);
function setBasemap(event: Event): void {
  basemap = (event.currentTarget as HTMLSelectElement).value;
  window.settings.set("studioBaseLayer", basemap);
}
const STYLES: CloudStyle[] = [...MAP_STYLES];
const VIEWS: Array<FlightPlan["view"]> = ["cockpit", "outside"];

/* The chart. */
let chartElement: HTMLDivElement | null = null;
let chart: OlMap | null = null;
const stormSource = new VectorSource();
const route = new Feature<LineString>();
const nose = new Feature<LineString>();
const start = new Feature<Point>();
const goal = new Feature<Point>();
const MAGENTA = "#ff4fd8";
const YELLOW = "#ffd60a";

route.setStyle(new Style({ stroke: new Stroke({ color: MAGENTA, width: 2, lineDash: [8, 6] }) }));
nose.setStyle(new Style({ stroke: new Stroke({ color: YELLOW, width: 2.5 }) }));
goal.setStyle(new Style({
  image: new RegularShape({ points: 4, radius: 9, stroke: new Stroke({ color: MAGENTA, width: 2.5 }) }),
}));

/** The aircraft on the chart: a dart, its point the way it flies. */
const dart = (heading: number) => new Style({
  image: new RegularShape({
    points: 3, radius: 11, scale: [0.72, 1.25], rotation: (heading * Math.PI) / 180, rotateWithView: true,
    fill: new Fill({ color: YELLOW }), stroke: new Stroke({ color: "#1a1a1a", width: 1.5 }),
  }),
});

function drawPlan(drawn: FlightPlan): void {
  const from = fromLonLat([drawn.lon, drawn.lat]);
  start.setGeometry(new Point(from));
  start.setStyle(dart(drawn.heading));
  nose.setGeometry(new LineString([from, fromLonLat(destination(drawn.lon, drawn.lat, drawn.heading, NOSE_KM * 1000))]));
  if (drawn.target) {
    const to = fromLonLat([drawn.target.lon, drawn.target.lat]);
    goal.setGeometry(new Point(to));
    route.setGeometry(new LineString([from, to]));
  } else {
    goal.setGeometry(undefined);
    route.setGeometry(undefined);
  }
}
$: drawPlan(plan);

/** The chart on the start and the storm, with room round both. */
function frame(): void {
  const view = chart?.getView();
  if (!view) return;
  const points = [fromLonLat([plan.lon, plan.lat])];
  if (plan.target) points.push(fromLonLat([plan.target.lon, plan.target.lat]));
  else points.push(fromLonLat(destination(plan.lon, plan.lat, plan.heading, 120_000)));
  view.fit(boundingExtent(points), { padding: [70, 70, 70, 70], maxZoom: 9 });
}

/** The storms on the chart: the finer tiles where the list has them, as the weather radar in the cockpit paints them. */
function drawStorms(): void {
  const fine = tiles.filter((tile) => !tile.coarse && tile.tile);
  stormSource.clear();
  stormSource.addFeatures((fine.length ? fine : tiles.filter((tile) => tile.tile)).flatMap((tile) => {
    const colour = radarColour(tile.peakDbz ?? 0);
    if (!colour || !tile.tile) return [];
    const [west, south, east, north] = tileBounds(tile.tile[0], tile.tile[1], tile.tile[2]);
    const feature = new Feature(new Polygon([[[west, south], [east, south], [east, north], [west, north], [west, south]].map((at) => fromLonLat(at))]));
    feature.setStyle(new Style({ fill: new Fill({ color: colour }) }));
    return [feature];
  }));
}

onMount(() => {
  drawStorms();
  chart = new OlMap({
    target: chartElement ?? undefined,
    layers: [
      window.lm.baseLayerFactory(get(mapBaseLayer)),
      // Over the basemap, whose imagery is raised over a plain one's ground; the storms under the place names, the plan over them.
      new VectorLayer({ source: stormSource, opacity: 0.5, zIndex: 90 }),
      labelsOnly(),
      new VectorLayer({ source: new VectorSource({ features: [route, nose, goal, start] }), zIndex: 120 }),
    ],
    controls: [],
    view: new View({ center: fromLonLat([plan.lon, plan.lat]), zoom: 7, enableRotation: false }),
  });
  // A click is where the flight starts.
  chart.on("singleclick", (event) => {
    const [lon, lat] = toLonLat(event.coordinate);
    change(movedTo(plan, lon, lat));
  });
  frame();
});

onDestroy(() => {
  clearInterval(listTimer);
  chart?.setTarget(undefined);
  chart = null;
});

function keydown(event: KeyboardEvent): void {
  // The plan's link being shared: the keys are that dialog's.
  if (get(shareDialog)) return;
  if (event.key === "Escape") {
    event.stopPropagation();
    oncancel();
  } else if (event.key === "Enter" && !(event.target as HTMLElement | null)?.closest("select, button, a")) {
    event.preventDefault();
    ontakeoff(plan);
  }
}
</script>

<svelte:window on:keydown|capture={keydown} />

<div class="preflight">
  <section class="sheet glass glass-tray glass-reading" aria-label={$_("studio.flight.plan.title")}>
    <header>
      <h2><Icon icon={faPlaneDeparture} /> {$_("studio.flight.plan.title")}</h2>
      <CloseDisc on:click={oncancel} />
    </header>

    <div class="chart">
      <div class="map" bind:this={chartElement} aria-label={$_("studio.flight.plan.chart")} role="application"></div>
      <p class="hint">{$_("studio.flight.plan.chart_hint")}</p>
    </div>

    <div class="side">
      <div class="aircraft">
        <div class="preview">
          <AircraftPreview label={$_("studio.flight.plan.preview", { values: { name: aircraft.name } })} />
        </div>
        <div class="about">
          <h3>{$_("studio.flight.plan.aircraft")}</h3>
          <!-- One to choose from so far, shown as the one chosen. -->
          <p class="name">{aircraft.name} <span>meteowings</span></p>
          <p class="specs">
            {$_("studio.flight.plan.specs", { values: {
              length: aircraft.length.toFixed(1), span: aircraft.span.toFixed(1), mach: aircraft.cruise.toFixed(2).slice(1),
              ceiling: Math.round(aircraft.ceiling / 100),
            } })}
          </p>
        </div>
      </div>

      <h3>{$_("studio.flight.plan.flight")}</h3>
      <div class="fields">
        <label for="preflight-target">{$_("studio.flight.plan.target")}</label>
        {#if systems.length}
          <select id="preflight-target" value={String(target)} on:change={setTarget}>
            {#each systems.slice(0, OFFERED) as system, i (i)}
              <option value={String(i)}>{named(system)}</option>
            {/each}
          </select>
        {:else}
          <span class="value">{$_("studio.flight.clear_sky")}</span>
        {/if}

        <label for="preflight-level">{$_("studio.flight.plan.level")}</label>
        <div class="slider">
          <input id="preflight-level" type="range" min={Math.round((ALTITUDE_RANGE[0] * FEET) / 100)}
            max={Math.round((ALTITUDE_RANGE[1] * FEET) / 100)} step="10" value={level}
            on:input={(event) => change(levelled(plan, (Number(event.currentTarget.value) * 100) / FEET))} />
          <output for="preflight-level">{flightLevel(plan.altitude)} · {Math.round((plan.altitude * FEET) / 100) * 100} ft</output>
        </div>

        <label for="preflight-speed">{$_("studio.flight.plan.speed")}</label>
        <div class="slider">
          <input id="preflight-speed" type="range" min={MACH_RANGE[0]} max={MACH_RANGE[1]} step="0.01" value={mach.toFixed(2)}
            on:input={(event) => change(atMach(plan, Number(event.currentTarget.value)))} />
          <output for="preflight-speed">M{mach.toFixed(2).slice(1)} · {Math.round(indicatedFromTrue(plan.tas, plan.altitude) * KNOTS)} kt</output>
        </div>

        <label for="preflight-heading">{$_("studio.flight.plan.heading")}</label>
        <div class="slider">
          <input id="preflight-heading" type="range" min="0" max="359" step="1" value={Math.round(plan.heading) % 360}
            on:input={(event) => change(headed(plan, Number(event.currentTarget.value)))} />
          <output for="preflight-heading">{String(Math.round(plan.heading) % 360).padStart(3, "0")}°</output>
          {#if plan.target}
            <button type="button" class="chip" disabled={plan.aimed} on:click={() => change(headed(plan, null))}>
              {$_("studio.flight.plan.aim")}
            </button>
          {/if}
        </div>

        <span class="label" id="preflight-view">{$_("studio.flight.plan.view")}</span>
        <Segmented compact stretch label={$_("studio.flight.plan.view")}
          options={VIEWS.map((view) => ({ value: view, label: $_(`studio.flight.plan.${view}`) }))}
          value={plan.view} on:change={(event) => change({ ...plan, view: event.detail })} />
      </div>

      <h3>{$_("studio.flight.plan.layers")}</h3>
      <div class="fields">
        <label for="preflight-basemap">{$_("studio.basemap")}</label>
        <select id="preflight-basemap" value={basemap} on:change={setBasemap}>
          {#each BASEMAPS as name (name)}
            <option value={name}>
              {$_(`settings.base_layers.${name}`)}{name === "system" ? ` · ${$_(`settings.base_layers.${$mapBaseLayer}`)}` : ""}
            </option>
          {/each}
        </select>

        <span class="label">{$_("style_3d.title")}</span>
        <Segmented compact stretch label={$_("style_3d.title")}
          options={STYLES.map((style) => ({ value: style, label: $_(`style_3d.${style}`) }))}
          value={plan.style} on:change={(event) => change({ ...plan, style: event.detail })} />

        <span class="label">{$_("studio.flight.plan.radar")}</span>
        <label class="check">
          <input type="checkbox" checked={plan.radarOnGround} on:change={(event) => change({ ...plan, radarOnGround: event.currentTarget.checked })} />
          {$_("studio.flight.plan.radar_on_ground")}
        </label>

        <span class="label">{$_("studio.flight.plan.marks")}</span>
        <label class="check">
          <input type="checkbox" checked={plan.marks} on:change={(event) => change({ ...plan, marks: event.currentTarget.checked })} />
          {$_("studio.flight.plan.marks_on")}
        </label>
      </div>
    </div>

    <div class="briefing">
      <h3>{$_("studio.flight.plan.briefing")}</h3>
      <dl>
        {#each lines as line (line.item)}
          <dt>{$_(`studio.flight.plan.brief.${line.item}`)}</dt>
          <dd class:caution={line.caution}>{line.text}</dd>
        {/each}
      </dl>
    </div>

    <footer>
      <p class="credit">{$_("studio.flight.model_credit")}</p>
      {#if $shareAvailable}
        <!-- A link that takes off from this plan, over the weather of whenever it is opened. -->
        <button type="button" class="chip" title={$_("studio.flight.share.plan_title")}
          on:click={(event) => sendLink(
            { url: flightLinkUrl(window.location.origin, startOf(plan, systems)), title: $_("studio.flight.share.title") },
            event.currentTarget, { card: false },
          )}>
          <Icon icon={shareIcon()} /> {$_("studio.flight.share.plan")}
        </button>
      {/if}
      <button type="button" class="chip" on:click={oncancel}>{$_("studio.flight.plan.cancel")}</button>
      <button type="button" class="chip go" on:click={() => ontakeoff(plan)}>
        <Icon icon={faPlaneDeparture} /> {$_("studio.flight.plan.takeoff")}
      </button>
    </footer>
  </section>
</div>

<style>
  .preflight {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: clamp(8px, 2.5vh, 28px) clamp(8px, 2.5vw, 28px);
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.35);
    pointer-events: auto;
  }
  .sheet {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(320px, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto auto;
    grid-template-areas:
      "head head"
      "chart side"
      "brief side"
      "foot foot";
    gap: 12px 18px;
    width: min(1180px, 100%);
    max-height: 100%;
    box-sizing: border-box;
    padding: 16px 18px 14px;
    overflow: auto;
    color: var(--mc-text);
    font: 13px/1.35 var(--mc-font);
  }
  header {
    grid-area: head;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font: 700 17px/1.2 var(--mc-font);
  }
  h2 :global(svg) { width: 16px; height: 16px; }
  h3 {
    margin: 12px 0 6px;
    color: var(--mc-text-muted, inherit);
    font: 700 11px/1.2 var(--mc-font);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0.75;
  }

  .chart {
    grid-area: chart;
    position: relative;
    min-height: 300px;
    border-radius: 12px;
    overflow: hidden;
    background: #10151b;
  }
  .map { position: absolute; inset: 0; cursor: crosshair; }
  .hint {
    position: absolute;
    left: 10px;
    bottom: 8px;
    margin: 0;
    padding: 4px 9px;
    border-radius: var(--mc-radius-pill);
    background: rgba(5, 7, 10, 0.62);
    color: #f2f4f7;
    font: 600 11px/1.2 var(--mc-font);
    pointer-events: none;
  }

  .side { grid-area: side; min-width: 0; }
  .aircraft {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    align-items: center;
    gap: 10px;
  }
  .preview {
    height: 132px;
    border-radius: 12px;
    background: linear-gradient(#2c66b8, #9fc4e8 78%, #d7e6f4);
  }
  .about h3 { margin-top: 0; }
  .name { margin: 0; font: 700 15px/1.25 var(--mc-font); }
  .name span { display: block; font-weight: 600; opacity: 0.7; }
  .specs { margin: 6px 0 0; font-size: 12px; opacity: 0.8; }

  .fields {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: center;
    gap: 8px 12px;
  }
  .fields > label, .fields > .label { font-weight: 600; opacity: 0.85; }
  .fields .value { opacity: 0.8; }
  select {
    min-width: 0;
    height: var(--mc-pill-h);
    padding: 0 8px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
  }
  .slider {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .slider input { flex: 1; min-width: 60px; accent-color: var(--mc-orange); }
  .slider output {
    min-width: 108px;
    font: 600 12px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }
  .check { display: flex; align-items: center; gap: 8px; font-weight: 400 !important; }
  .check input { accent-color: var(--mc-orange); }

  .briefing {
    grid-area: brief;
    padding: 10px 14px 12px;
    border-radius: 12px;
    background: rgba(5, 7, 10, 0.78);
    color: #dfe5ec;
  }
  .briefing h3 { margin-top: 0; color: #9aa3ad; opacity: 1; }
  .briefing dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 3px 14px;
    margin: 0;
    font: 12px/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  .briefing dt { color: #7fd4e4; }
  .briefing dd { margin: 0; }
  .briefing dd.caution { color: #ffb340; }

  footer {
    grid-area: foot;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .credit { flex: 1; margin: 0; font-size: 11px; opacity: 0.6; }
  .chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--mc-pill-h);
    box-sizing: border-box;
    padding: 0 12px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 12px/1 var(--mc-font);
    white-space: nowrap;
    cursor: pointer;
  }
  .chip:hover { background: var(--mc-tint-hover); }
  .chip:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .chip:disabled { cursor: default; opacity: 0.45; }
  .chip :global(svg) { width: 12px; height: 12px; }
  .chip.go { padding: 0 18px; background: var(--mc-orange); color: #1a1205; }
  .chip.go:hover { background: color-mix(in srgb, var(--mc-orange) 88%, #fff); }

  @media (max-width: 900px) {
    .sheet {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto;
      grid-template-areas: "head" "chart" "side" "brief" "foot";
    }
    .chart { min-height: 260px; }
  }
  /* A screen the plan has to be scrolled on: the way off stays at its foot, whatever is scrolled. */
  @media (max-width: 900px), (max-height: 560px) {
    footer {
      position: sticky;
      bottom: -14px;
      z-index: 1;
      margin: 0 -18px -14px;
      padding: 10px 18px 14px;
      background: var(--mc-glass-fill-solid);
      -webkit-backdrop-filter: blur(16px);
      backdrop-filter: blur(16px);
    }
  }
  /* A phone on its side is wide enough for the chart beside the rest again,
     which leaves a thumb somewhere to scroll the plan by that is not the chart. */
  @media (min-width: 640px) and (max-width: 900px) and (max-height: 560px) {
    .sheet {
      grid-template-columns: minmax(0, 1fr) minmax(300px, 1.1fr);
      grid-template-areas: "head head" "chart side" "brief side" "foot foot";
    }
    .chart { min-height: 200px; }
  }
  /* Under a finger, what is pressed is a finger's size. */
  @media (pointer: coarse) {
    .chip, select { height: 40px; }
    .chip { padding: 0 16px; font-size: 13px; }
    .chip.go { padding: 0 22px; }
    .slider input { height: 32px; }
    .check { min-height: 32px; }
    footer .credit { font-size: 10px; }
  }
  /* A phone held upright: the numbers beside a slider take less of its row. */
  @media (max-width: 480px) {
    .sheet { padding: 14px 14px 12px; }
    footer { margin: 0 -14px -12px; padding: 10px 14px 12px; bottom: -12px; }
    .slider output { min-width: 0; }
    .slider { flex-wrap: wrap; row-gap: 2px; }
    footer .credit { display: none; }
  }
</style>
