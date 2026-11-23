<script lang="ts">
/**
 * Before a flight: its plan, on one page, for the reader to change and then
 * take off from.
 *
 * A chart with the start and the way to the storm drawn on it, which a click
 * moves, and the heavy cells and the lightning of the last minutes marked on
 * it, which is what the storms on offer are ranked by; the aircraft, turning; where and how the flight begins; and a
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
 * the sound. What the flight needs (lib/studio/flight/preload.ts) is not
 * loaded meanwhile: it is large, and comes once the reader takes off, with
 * how far along it is (FlightLoading.svelte).
 */
import logo from "../../../assets/logo.svg";
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
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from "ol/style";
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
  showcasePlan, STRIKE_WINDOW_MIN,
} from "../../../lib/studio/flight/plan";
import type { FlightPlan } from "../../../lib/studio/flight/plan";
import {
  approachTo, clearSkyStart, HEAVY_DBZ, isHeavy, rankSystems, stormSystems, withStrikes,
} from "../../../lib/studio/flight/spawn";
import type { StormSystem } from "../../../lib/studio/flight/spawn";
import { FLIGHT_BASEMAP } from "../../../lib/studio/store";
import { flightLinkOrigin, flightLinkUrl } from "../../../lib/studio/flightLink";
import { startOf } from "../../../lib/studio/flight/plan";
import { sendLink } from "../../../lib/share";
import { flightLoad, shareOf } from "../../../lib/studio/flight/preload";
import { claimMenuMusic } from "../../../lib/studio/flight/soundtrack";
import { shareAvailable, shareIcon } from "../../../lib/shareSupport";
import { followSideways } from "../../../lib/sideways";
import { lift } from "../../../lib/curtain";
import { archiveStep, cloudsTime, shareDialog } from "../../../stores";
import { demoBackend } from "../../../weatherSource";

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

/** The lightning the storms are ranked by: every strike the map holds from the last minutes. */
const recentStrikes = () => stage.strikesSince(Date.now() - STRIKE_WINDOW_MIN * 60_000);
/** The storms on the radar, each with its lightning, the best to fly at first (spawn.ts, `rankSystems`). */
const ranked = (list: typeof tiles, struck: typeof strikes) => rankSystems(withStrikes(stormSystems(list), struck), look.lon, look.lat);

let tiles = stage.stormTiles();
let strikes = recentStrikes();
let systems = ranked(tiles, strikes);

/** The plan the flight would fly unasked, from the storms listed now: over the demo's storm, the start chosen for it by hand. */
const proposed = (): FlightPlan => (demoBackend && systems.length ? showcasePlan(systems[0], FLIGHT_STYLE) : null) ?? planFrom(
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
/* The lightning counts by its order of magnitude, in halves: a storm whose
   count creeps up strike by strike does not remake the plan every look. */
const signature = (list: typeof tiles, struck: typeof strikes) => (
  `${list.length}:${list.reduce((sum, tile) => sum + (tile.peakDbz ?? 0), 0).toFixed(0)}:${Math.round(2 * Math.log2(1 + struck.length))}`
);
let listed = signature(tiles, strikes);
const listTimer = setInterval(() => {
  const next = stage.stormTiles();
  const struck = recentStrikes();
  if (signature(next, struck) === listed) return;
  listed = signature(next, struck);
  tiles = next;
  strikes = struck;
  systems = ranked(tiles, strikes);
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

/** A storm system as the list names it: how strong, how far and which way from where the reader looked; and its lightning, as a bolt and a count. */
function named(system: StormSystem): string {
  const nm = Math.round(distanceM(look.lon, look.lat, system.lon, system.lat) / NM);
  const name = $_("studio.flight.plan.system", { values: { dbz: Math.round(system.peakDbz), nm, across: Math.round((system.radiusKm * 2000) / NM) } });
  return system.strikes ? `${name} · ⚡ ${system.strikes}` : name;
}

function setTarget(event: Event): void {
  const system = systems[Number((event.currentTarget as HTMLSelectElement).value)];
  if (!system) return;
  // The demo's storm from where it was chosen by hand to be flown at, however it was picked.
  change((demoBackend ? showcasePlan(system, plan.style) : null) ?? retargeted(plan, system, tiles));
  frame();
}


/* The chart. */
let chartElement: HTMLDivElement | null = null;
/** Whether the reader has moved or zoomed the chart: the plan's own framing leaves it where they put it from then on. */
let viewed = false;
let chart: OlMap | null = null;
const stormSource = new VectorSource();
/** The heavy tiles (`HEAVY_DBZ` and over), drawn solid over the rest, edged. */
const heavySource = new VectorSource();
/** The lightning of the last minutes, a spark each; and the heavy systems on offer, ringed and labelled. */
const strikeSource = new VectorSource();
const heavyMarks = new VectorSource();
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

const HEAVY_EDGE = new Stroke({ color: "rgba(255, 255, 255, 0.9)", width: 1.25 });
const SPARK = new Style({
  image: new CircleStyle({ radius: 2.6, fill: new Fill({ color: YELLOW }), stroke: new Stroke({ color: "rgba(20, 20, 20, 0.85)", width: 1 }) }),
});

/** A heavy system's mark: a ring round its towers, with its strongest echo and its strikes beside it. */
const heavyMark = (system: StormSystem) => new Style({
  image: new CircleStyle({ radius: 14, stroke: new Stroke({ color: "#ffffff", width: 2 }), fill: new Fill({ color: "rgba(255, 69, 58, 0.18)" }) }),
  text: new Text({
    text: `${Math.round(system.peakDbz)} dBZ${system.strikes ? `  ⚡ ${system.strikes}` : ""}`,
    font: "600 12px system-ui, sans-serif", offsetY: -24,
    fill: new Fill({ color: "#ffffff" }), stroke: new Stroke({ color: "rgba(0, 0, 0, 0.8)", width: 3 }),
  }),
});

/**
 * The storms on the chart: the finer tiles where the list has them, as the
 * weather radar in the cockpit paints them, the heavy ones solid and edged
 * over the rest; the lightning of the last minutes over them; and each heavy
 * system of those on offer ringed, with what makes it heavy written by it.
 */
function drawStorms(): void {
  const fine = tiles.filter((tile) => !tile.coarse && tile.tile);
  stormSource.clear();
  heavySource.clear();
  for (const tile of fine.length ? fine : tiles.filter((each) => each.tile)) {
    const colour = radarColour(tile.peakDbz ?? 0);
    if (!colour || !tile.tile) continue;
    const [west, south, east, north] = tileBounds(tile.tile[0], tile.tile[1], tile.tile[2]);
    const feature = new Feature(new Polygon([[[west, south], [east, south], [east, north], [west, north], [west, south]].map((at) => fromLonLat(at))]));
    const heavy = (tile.peakDbz ?? 0) >= HEAVY_DBZ;
    feature.setStyle(new Style({ fill: new Fill({ color: colour }), stroke: heavy ? HEAVY_EDGE : undefined }));
    (heavy ? heavySource : stormSource).addFeature(feature);
  }
  strikeSource.clear();
  strikeSource.addFeatures(strikes.map((strike) => {
    const feature = new Feature(new Point(fromLonLat([strike.lon, strike.lat])));
    feature.setStyle(SPARK);
    return feature;
  }));
  heavyMarks.clear();
  heavyMarks.addFeatures(systems.slice(0, OFFERED).filter(isHeavy).map((system) => {
    const feature = new Feature(new Point(fromLonLat([system.lon, system.lat])));
    feature.setStyle(heavyMark(system));
    return feature;
  }));
}

onDestroy(claimMenuMusic());

onMount(() => {
  drawStorms();
  chart = new OlMap({
    target: chartElement ?? undefined,
    layers: [
      window.lm.baseLayerFactory(FLIGHT_BASEMAP),
      // Over the basemap, whose imagery is raised over a plain one's ground; the storms under the place names, the plan over them.
      new VectorLayer({ source: stormSource, opacity: 0.45, zIndex: 90 }),
      new VectorLayer({ source: heavySource, opacity: 0.9, zIndex: 91 }),
      labelsOnly(),
      new VectorLayer({ source: strikeSource, zIndex: 110 }),
      new VectorLayer({ source: heavyMarks, zIndex: 115, declutter: true }),
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
    <p class="brand"><img src={logo} alt="" /><span><b>meteoair</b> <small>by meteocool.com</small></span></p>
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
          <div>
            <dt>{$_(`studio.flight.plan.brief.${line.item}`)}</dt>
            <dd class:caution={line.caution}>{line.text}</dd>
          </div>
        {/each}
      </dl>
      <p class="credit">{$_("studio.flight.model_credit")}</p>
    </div>
  </div>

  <footer>
    {#if $shareAvailable}
      <!-- A link that takes off from this plan, over the weather of whenever it is opened; in a past window, over that window's step. -->
      <button type="button" class="chip glass glass-pill"
        title={$_($archiveStep === null ? "studio.flight.share.plan_title" : "studio.flight.share.plan_title_past")}
        on:click={(event) => sendLink(
          {
            url: flightLinkUrl(flightLinkOrigin(window.location.origin), {
              ...startOf(plan, systems), ...($archiveStep === null ? {} : { at: $archiveStep }),
            }),
            title: $_("studio.flight.share.title"),
          },
          event.currentTarget, { card: false, note: $_($archiveStep === null ? "studio.flight.share.note" : "studio.flight.share.note_past") },
        )}>
        <Icon icon={shareIcon()} /> {$_("studio.flight.share.plan")}
      </button>
    {/if}
    {#if onback}
      <button type="button" class="chip glass glass-pill" on:click={onback}>{$_("studio.flight.plan.back")}</button>
    {:else}
      <button type="button" class="chip glass glass-pill" on:click={oncancel}>{$_("studio.flight.plan.cancel")}</button>
    {/if}
    <!-- What the flight needs, where it is loading already (a flight asked for again): along the button's foot until it is in. -->
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
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
  }
  header .title { justify-self: start; }
  header .head-tools { justify-self: end; }
  /* meteocool's, in the middle of the plan's head: the raindrop and the name. */
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    color: #fff;
    font: 600 14px/1 var(--mc-font);
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.45);
  }
  .brand span { display: flex; align-items: baseline; gap: 8px; white-space: nowrap; }
  .brand b { font: 700 23px/1 var(--mc-font); letter-spacing: -0.02em; }
  .brand small { font-size: 14px; color: rgba(235, 235, 245, 0.78); }
  .brand img { width: 38px; height: 38px; filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.45)); }
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
    /* The chart's column, its storm under it, beside the aircraft and the
       fields and as tall as what is left of the screen; the briefing the
       whole width under them, or, where it would not fit, not at all: the
       plan is not scrolled on a desktop. */
    grid-template-rows: auto minmax(auto, 1fr) auto;
    grid-template-areas:
      "chart aircraft"
      "chart fields"
      "brief brief";
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
    min-height: 200px;
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
    align-self: start;
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
    margin: 0;
    column-gap: 40px;
    font: 12px/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  .briefing dl > div {
    display: grid;
    grid-template-columns: 9ch minmax(0, 1fr);
    gap: 14px;
    padding: 1.5px 0;
    break-inside: avoid;
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

  /* Wide: the briefing in two columns, in half the height. */
  @container mc-frame (min-width: 1200px) {
    .briefing dl { columns: 2; }
  }
  /* Too short for the briefing under the rest without scrolling: none. */
  @container mc-frame (min-width: 901px) and (max-width: 1199px) and (max-height: 790px) {
    .briefing { display: none; }
  }
  @container mc-frame (min-width: 1200px) and (max-height: 690px) {
    .briefing { display: none; }
  }
  /* Narrower: one column, scrolled, the way off always at its foot. */
  @container mc-frame (max-width: 900px) {
    .panes {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto;
      grid-template-areas: "chart" "aircraft" "fields" "brief";
    }
    .chart { min-height: 260px; }
  }
  @container mc-frame (max-width: 760px) {
    .brand small { display: none; }
  }
  @container mc-frame (max-width: 560px) {
    .brand span { display: none; }
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
