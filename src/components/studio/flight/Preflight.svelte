<script lang="ts">
/**
 * Before a flight: its plan, on one page, for the reader to change and then
 * take off from.
 *
 * A chart with the start and the way to the storm drawn on it, which a click
 * moves; the aircraft, turning; where and how the flight begins; and a
 * briefing that reads all of it back as a crew would be handed it.
 *
 * The whole screen, as a simulator's menu is: a storm turning slowly behind
 * it, lightning in its anvil (a loop the flight's own sky was recorded in,
 * public/video), and each part of the plan a pane of dark glass over it,
 * dark whatever the theme, as the sky behind it is. What the
 * flight draws is not asked: the imagery under it, its storms in the sky's
 * own style, the radar off the ground and the storms ahead marked (the
 * flight's own keys still change the last two). The plan and the briefing are lib/studio/flight/plan.ts;
 * the flight that takes it is lib/studio/flight/pilot.ts.
 *
 * A menu: the menus' music plays while it is up, with a switch for all of
 * the sound, and what the flight needs is loaded meanwhile
 * (lib/studio/flight/preload.ts), so that taking off seldom waits.
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
import AircraftPreview from "./AircraftPreview.svelte";
import SoundSwitch from "./SoundSwitch.svelte";
import { radarColour } from "./instruments";
import { labelsOnly } from "../../../layers/vector";
import { tileBounds } from "../../../lib/volumeBox";
import type { Stage } from "../../../lib/studio/director";
import { indicatedFromTrue, machOf } from "../../../lib/studio/flight/atmosphere";
import { cloudBaseAt } from "../../../lib/studio/flight/stationAir";
import { destination, distanceM } from "../../../lib/studio/flight/geo";
import { FLIGHT_STYLE } from "../../../lib/studio/flight/pilot";
import {
  AIRCRAFT, ALTITUDE_RANGE, atMach, briefing, flightLevel, headed, levelled, machRange, movedTo, planFrom, retargeted,
} from "../../../lib/studio/flight/plan";
import type { FlightPlan } from "../../../lib/studio/flight/plan";
import { approachTo, clearSkyStart, rankSystems, stormSystems } from "../../../lib/studio/flight/spawn";
import type { StormSystem } from "../../../lib/studio/flight/spawn";
import { FLIGHT_BASEMAP } from "../../../lib/studio/store";
import { flightLinkUrl } from "../../../lib/studio/flightLink";
import { startOf } from "../../../lib/studio/flight/plan";
import { sendLink } from "../../../lib/share";
import { flightLoad, loadMenuMusic, preloadFlight, shareOf } from "../../../lib/studio/flight/preload";
import { claimMenuMusic } from "../../../lib/studio/flight/soundtrack";
import { shareAvailable, shareIcon } from "../../../lib/shareSupport";
import { followSideways } from "../../../lib/sideways";
import { lift } from "../../../lib/curtain";
import { cloudsTime, shareDialog } from "../../../stores";

/** The 3D map: where the reader was looking, and the storms on the radar. */
export let stage: Stage;
export let ontakeoff: (plan: FlightPlan) => void;
export let oncancel: () => void;
/** Off the flight's plan altogether, back to meteocool's map; where given, in place of the plan's Cancel. */
export let onback: (() => void) | null = null;

const FEET = 3.28084;
const KNOTS = 1.943844;
const KMH = 3.6;
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

/**
 * The storm behind the plan, and its first frame for until it plays; or
 * instead, for a reader who asks for less motion, and in an iOS app whose
 * web view would play it full screen, over the plan, rather than in place.
 */
const SKY = `${import.meta.env?.BASE_URL ?? "/"}video/storm-loop`;
const fullScreenOnly = typeof window !== "undefined" && Boolean(window.webkit?.messageHandlers?.scriptHandler)
  && !window.nativeCapabilities?.inlineVideo;
const still = fullScreenOnly || (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);

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
    // Not from under a reader who is looking round the chart: it would jump back to the plan as they moved it.
    if (!viewed) frame();
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
$: speeds = machRange(plan.altitude);
$: level = Math.round((plan.altitude * FEET) / 1000) * 10;
$: target = plan.target ? systems.indexOf(plan.target) : -1;
$: feet = Math.round((plan.altitude * FEET) / 100) * 100;
$: knots = Math.round(indicatedFromTrue(plan.tas, plan.altitude) * KNOTS);
$: loadPercent = Math.floor(shareOf($flightLoad) * 100);

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


/* The chart. */
let chartElement: HTMLDivElement | null = null;
/** Whether the reader has moved or zoomed the chart: the plan's own framing leaves it where they put it from then on. */
let viewed = false;
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

onDestroy(claimMenuMusic());

onMount(() => {
  void loadMenuMusic();
  preloadFlight().catch(() => undefined);
  drawStorms();
  chart = new OlMap({
    target: chartElement ?? undefined,
    layers: [
      window.lm.baseLayerFactory(FLIGHT_BASEMAP),
      // Over the basemap, whose imagery is raised over a plain one's ground; the storms under the place names, the plan over them.
      new VectorLayer({ source: stormSource, opacity: 0.5, zIndex: 90 }),
      labelsOnly(),
      new VectorLayer({ source: new VectorSource({ features: [route, nose, goal, start] }), zIndex: 120 }),
    ],
    controls: [],
    view: new View({ center: fromLonLat([plan.lon, plan.lat]), zoom: 7, enableRotation: false }),
  });
  // Read in the picture as drawn, on its side in the apps (lib/sideways.ts).
  followSideways(chart);
  // A click is where the flight starts.
  chart.on("singleclick", (event) => {
    const [lon, lat] = toLonLat(event.coordinate);
    change(movedTo(plan, lon, lat));
  });
  frame();
  // Up from the black it was come to through (lib/curtain.ts).
  lift();
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

<section class="preflight" aria-label={$_("studio.flight.plan.title")}>
  <video class="sky" src={still ? undefined : `${SKY}.mp4`} poster={`${SKY}.jpg`} autoplay muted loop playsinline
    disablepictureinpicture aria-hidden="true" tabindex="-1"></video>
  <header>
    <h2 class="title glass glass-pill"><Icon icon={faPlaneDeparture} /> {$_("studio.flight.plan.title")}</h2>
    <div class="head-tools">
      <SoundSwitch look="chip" />
      <CloseDisc on:click={oncancel} />
    </div>
  </header>

  <div class="panes">
    <!-- The chart, and under it which storm it is drawn for. -->
    <div class="chart-col">
      <div class="pane chart glass glass-tray">
        <div class="map" bind:this={chartElement} aria-label={$_("studio.flight.plan.chart")} role="application"
          on:pointerdown={() => { viewed = true; }} on:wheel={() => { viewed = true; }}></div>
        <p class="hint">{$_("studio.flight.plan.chart_hint")}</p>
      </div>
      <div class="field storm glass glass-tray">
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
      </div>
    </div>

    <div class="pane aircraft glass glass-tray">
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

    <!-- The flight, a pane of glass for each of what it asks. -->
    <div class="fields" role="group" aria-label={$_("studio.flight.plan.flight")}>
      <div class="field glass glass-tray">
        <label for="preflight-level">{$_("studio.flight.plan.level")}</label>
        <div class="slider">
          <input id="preflight-level" type="range" min={Math.round((ALTITUDE_RANGE[0] * FEET) / 100)}
            max={Math.round((ALTITUDE_RANGE[1] * FEET) / 100)} step="10" value={level}
            on:input={(event) => change(levelled(plan, (Number(event.currentTarget.value) * 100) / FEET))} />
          <output for="preflight-level">
            <b>{flightLevel(plan.altitude)}</b>
            <small>{feet.toLocaleString("en")} ft · {(plan.altitude / 1000).toFixed(1)} km</small>
          </output>
        </div>
      </div>

      <div class="field glass glass-tray">
        <label for="preflight-speed">{$_("studio.flight.plan.speed")}</label>
        <div class="slider">
          <!-- Only the speeds the level allows: never one that stalls the wing or tears the surfaces off it. -->
          <input id="preflight-speed" type="range" min={speeds[0].toFixed(3)} max={speeds[1].toFixed(3)} step="0.005" value={mach.toFixed(3)}
            on:input={(event) => change(atMach(plan, Number(event.currentTarget.value)))} />
          <output for="preflight-speed">
            <b>M{mach.toFixed(2).slice(1)}</b>
            <small>{knots} kt · {Math.round((knots / KNOTS) * KMH)} km/h</small>
          </output>
        </div>
      </div>

      <div class="field glass glass-tray">
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
      </div>
    </div>

    <div class="pane briefing glass glass-tray">
      <h3>{$_("studio.flight.plan.briefing")}</h3>
      <dl>
        {#each lines as line (line.item)}
          <dt>{$_(`studio.flight.plan.brief.${line.item}`)}</dt>
          <dd class:caution={line.caution}>{line.text}</dd>
        {/each}
      </dl>
      <p class="credit">{$_("studio.flight.model_credit")}</p>
    </div>
  </div>

  <footer>
    {#if $shareAvailable}
      <!-- A link that takes off from this plan, over the weather of whenever it is opened. -->
      <button type="button" class="chip glass glass-pill" title={$_("studio.flight.share.plan_title")}
        on:click={(event) => sendLink(
          { url: flightLinkUrl(window.location.origin, startOf(plan, systems)), title: $_("studio.flight.share.title") },
          event.currentTarget, { card: false, note: $_("studio.flight.share.note") },
        )}>
        <Icon icon={shareIcon()} /> {$_("studio.flight.share.plan")}
      </button>
    {/if}
    {#if onback}
      <button type="button" class="chip glass glass-pill" on:click={onback}>{$_("studio.flight.plan.back")}</button>
    {:else}
      <button type="button" class="chip glass glass-pill" on:click={oncancel}>{$_("studio.flight.plan.cancel")}</button>
    {/if}
    <!-- What the flight needs, loading since the plan came up: along the button's foot until it is in. -->
    <button type="button" class="chip go" on:click={() => ontakeoff(plan)}
      title={$flightLoad.state === "loading" ? $_("studio.flight.page.loading_title", { values: { percent: loadPercent } }) : undefined}>
      <Icon icon={faPlaneDeparture} /> {$_("studio.flight.plan.takeoff")}
      {#if $flightLoad.state === "loading"}
        <span class="load" style:width={`${loadPercent}%`} aria-hidden="true"></span>
      {/if}
    </button>
  </footer>
</section>

<style>
  /* The whole screen: the map behind blurred out of reading, the plan in panes over it. */
  .preflight {
    --gap: clamp(8px, 1.4cqw, 14px);
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: var(--gap);
    box-sizing: border-box;
    padding: clamp(10px, 2.4cqh, 28px) clamp(10px, 2.4cqw, 32px);
    padding-left: max(clamp(10px, 2.4cqw, 32px), calc(var(--mc-safe-left, 0px) + 8px));
    padding-right: max(clamp(10px, 2.4cqw, 32px), calc(var(--mc-safe-right, 0px) + 8px));
    padding-top: max(clamp(10px, 2.4cqh, 28px), calc(var(--mc-safe-top, 0px) + 6px));
    padding-bottom: max(clamp(10px, 2.4cqh, 28px), calc(var(--mc-safe-bottom, 0px) + 8px));
    overflow: hidden;
    background: #0b1018;
    color: var(--mc-text);
    font: 13px/1.35 var(--mc-font);
    pointer-events: auto;
    /* Dark glass whatever the theme: the storm behind it is a dark sky, and a
       light theme's ink and controls on dark panes read as neither. */
    color-scheme: dark;
    --mc-text: #f2f2f7;
    --mc-text-2: rgba(235, 235, 245, 0.72);
    --mc-chrome-text: #ffffff;
    --mc-chrome-text-2: rgba(235, 235, 245, 0.8);
    --mc-chrome-text-3: rgba(235, 235, 245, 0.6);
    --mc-chrome-tint: rgba(255, 255, 255, 0.13);
    --mc-chrome-tint-hover: rgba(255, 255, 255, 0.2);
    --mc-chrome-tint-active: rgba(255, 255, 255, 0.28);
    --mc-chrome-separator: rgba(255, 255, 255, 0.16);
    --mc-chrome-hairline: rgba(255, 255, 255, 0.26);
    --mc-chrome-accent: #0a84ff;
    --mc-chrome-accent-strong: #409cff;
    --mc-sheet-card: #3a3f47;
    --mc-glass-fill: rgba(18, 22, 30, 0.56);
    --mc-glass-fill-strong: rgba(18, 22, 30, 0.72);
    --mc-glass-edge: rgba(255, 255, 255, 0.16);
    --mc-glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 0 0 0.5px rgba(255, 255, 255, 0.1);
    --mc-glass-ring: var(--mc-glass-highlight), 0 2px 10px rgba(0, 0, 0, 0.35);
    --mc-glass-ring-lg: var(--mc-glass-highlight), 0 10px 30px rgba(0, 0, 0, 0.4);
    --mc-glass-backdrop: blur(14px) saturate(1.2);
  }
  /* The storm: under everything, darkened a little and only just softened, so it is seen but not read. */
  .sky {
    position: absolute;
    inset: 0;
    z-index: -1;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(3px) brightness(0.62) saturate(0.9);
    transform: scale(1.03);
    pointer-events: none;
  }
  .preflight { isolation: isolate; }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 9px 16px;
    font: 700 16px/1.2 var(--mc-font);
  }
  .title :global(svg) { width: 15px; height: 15px; color: var(--mc-orange); }
  .head-tools { display: flex; align-items: center; gap: 10px; }

  .panes {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(330px, 1fr);
    /* Never shorter than what is in them: the chart's column, its storm under it, spans the first two. */
    grid-template-rows: auto auto 1fr;
    grid-template-areas:
      "chart aircraft"
      "chart fields"
      "brief fields";
    gap: var(--gap);
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    /* Room for the panes' shadows, inside what scrolls. */
    margin: -6px;
    padding: 6px;
  }
  .pane { box-sizing: border-box; min-width: 0; }
  h3 {
    margin: 0 0 6px;
    color: var(--mc-text-2, inherit);
    font: 700 11px/1.2 var(--mc-font);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .chart-col {
    grid-area: chart;
    display: flex;
    flex-direction: column;
    gap: calc(var(--gap) * 0.75);
    min-width: 0;
  }
  .chart {
    flex: 1 1 auto;
    position: relative;
    min-height: 300px;
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

  .aircraft {
    grid-area: aircraft;
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 10px;
  }
  .preview {
    height: 132px;
    border-radius: calc(var(--mc-radius-tray) - 6px);
    overflow: hidden;
    background: linear-gradient(#2c66b8, #9fc4e8 78%, #d7e6f4);
  }
  .name { margin: 0; font: 700 15px/1.25 var(--mc-font); }
  .name span { display: block; font-weight: 600; color: var(--mc-text-2, inherit); }
  .specs { margin: 6px 0 0; font-size: 12px; color: var(--mc-text-2, inherit); }

  .fields {
    grid-area: fields;
    display: flex;
    flex-direction: column;
    gap: calc(var(--gap) * 0.75);
    min-width: 0;
  }
  .field {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    min-height: 50px;
    box-sizing: border-box;
    padding: 8px 12px 8px 16px;
  }
  .field > label { font-weight: 700; }
  .field .value { color: var(--mc-text-2, inherit); }
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
    display: grid;
    justify-items: end;
    gap: 3px;
    min-width: 96px;
    font: 600 12px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }
  .slider output b { font-weight: 700; font-size: 13px; }
  .slider output small { color: var(--mc-text-2); font-size: 11px; font-weight: 600; }
  /* The way back onto the storm: never squeezed below its words. */
  .slider .chip { flex: none; }

  /* The briefing: the crew's printout, dark glass whatever the theme. */
  .briefing {
    grid-area: brief;
    padding: 12px 16px;
    background: rgba(5, 7, 10, 0.7);
    color: #dfe5ec;
  }
  .briefing h3 { color: #9aa3ad; }
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
  .credit { margin: 10px 0 0; font-size: 11px; color: #8a939d; }

  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
  }
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
  .chip.glass { background: var(--mc-glass-fill); border: 1px solid var(--mc-glass-edge); }
  .chip:hover { background: var(--mc-tint-hover); }
  .chip.glass:hover { background: color-mix(in srgb, var(--mc-glass-fill) 80%, var(--mc-text) 8%); }
  .chip:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .chip:disabled { cursor: default; opacity: 0.45; }
  .chip :global(svg) { width: 12px; height: 12px; }
  footer .chip { height: 40px; padding: 0 18px; font-size: 13px; }
  .chip.go { position: relative; overflow: hidden; padding: 0 24px; background: var(--mc-orange); color: #1a1205; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3); }
  .chip.go .load {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    background: rgba(26, 18, 5, 0.55);
    transition: width 0.2s ease;
  }
  .chip.go:hover { background: color-mix(in srgb, var(--mc-orange) 88%, #fff); }

  /* Narrower: one column, scrolled, the way off always at its foot. */
  @container mc-frame (max-width: 900px) {
    .panes {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto;
      grid-template-areas: "chart" "aircraft" "fields" "brief";
    }
    .chart { min-height: 260px; }
  }
  /* A phone on its side is wide enough for the chart beside the rest again,
     which leaves a thumb somewhere to scroll the plan by that is not the chart.
     The chart keeps to the screen's height, its storm under it in sight. */
  @container mc-frame (min-width: 560px) and (max-height: 560px) {
    .panes {
      /* Measured, for the chart to be as tall as what is seen of it. */
      container: plan-panes / size;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
      grid-template-rows: auto auto;
      grid-template-areas: "chart aircraft" "chart fields";
    }
    .chart-col { position: sticky; top: 0; align-self: start; height: calc(100cqh - 12px); }
    .chart { min-height: 120px; }
    .aircraft { padding: 8px; gap: 10px; }
    .preview { height: 72px; }
    .field { grid-template-columns: 64px minmax(0, 1fr); gap: 8px; min-height: 44px; padding: 6px 10px 6px 12px; }
    .slider { gap: 8px; }
    .slider input { min-width: 40px; }
    .slider output { min-width: 0; }
  }
  @container mc-frame (max-height: 560px) {
    .preview { height: 96px; }
    .title { padding: 7px 14px; font-size: 14px; }
  }
  /* A phone, either way up: no room to read a briefing in, and the plan says it all already. */
  @container mc-frame (max-width: 480px) or (max-height: 560px) {
    .briefing { display: none; }
  }
  /* Under a finger, what is pressed is a finger's size. */
  @media (pointer: coarse) {
    .chip, select { height: 40px; }
    .chip { padding: 0 16px; font-size: 13px; }
    .chip.go { padding: 0 22px; }
    .slider input { height: 32px; }
  }
  /* A phone held upright: a field's name over its control, and the numbers beside a slider take less of its row. */
  @container mc-frame (max-width: 480px) {
    .field { grid-template-columns: minmax(0, 1fr); gap: 4px; padding: 10px 14px; }
    .slider output { min-width: 0; }
    .slider { flex-wrap: wrap; row-gap: 2px; }
    .aircraft { grid-template-columns: minmax(0, 1fr); }
    footer { flex-wrap: wrap; }
    footer .chip { flex: 1 1 auto; }
  }
</style>
