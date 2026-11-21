<script lang="ts">
/**
 * meteocool Studio: the 3D map as a place to make pictures of storms.
 *
 * A mode of the 3D map, on a desktop. The map's own chrome for looking
 * (the legend, the peel's tray) steps aside for a tools panel and a
 * timeline: section planes that cut every storm where the reader puts them,
 * the standard views and lenses, the last two hours of scans on a slider,
 * and a scene of keyframes that plays, records to a video and goes into a
 * link. The map underneath is the same map; see lib/studio.
 *
 * Or the reader flies: the panel and the timeline give way to a cockpit's
 * flight deck (flight/FlightDeck.svelte), and the pilot (lib/studio/flight)
 * flies the camera over the same map.
 *
 * A flight asked for from outside (`flightRequest`: "Fly from here" on the
 * map, or a flight's link) takes off without its plan being shown: Studio
 * opens on a note while the radar's storms come in, plans the flight from
 * the start it was given, and is in the air; and when that flight ends, the
 * reader is back where they asked from, not in Studio's tools.
 *
 * Either way a flight takes off with everything it needs loaded
 * (lib/studio/flight/preload.ts): what is not there yet is waited for on a
 * loading screen (flight/FlightLoading.svelte), and the flight starts with
 * all of it at once.
 *
 * And from one of the flight's scenes to the next (its plan, its loading, the
 * flight, and back) the screen goes to black and comes up again, as a
 * simulator's does (lib/curtain.ts).
 */
import { onDestroy } from "svelte";
import { get } from "svelte/store";
import { _ } from "svelte-i18n";
import StudioPanel from "./StudioPanel.svelte";
import StudioTimeline from "./StudioTimeline.svelte";
import FlightDeck from "./flight/FlightDeck.svelte";
import Preflight from "./flight/Preflight.svelte";
import FlightLoading from "./flight/FlightLoading.svelte";
import { Director } from "../../lib/studio/director";
import type { Stage } from "../../lib/studio/director";
import { FLIGHT_STYLE, Pilot } from "../../lib/studio/flight/pilot";
import { planHere, startOf } from "../../lib/studio/flight/plan";
import type { FlightPlan } from "../../lib/studio/flight/plan";
import { distanceM } from "../../lib/studio/flight/geo";
import { stormSystems } from "../../lib/studio/flight/spawn";
import { flightLoad, preloadFlight } from "../../lib/studio/flight/preload";
import type { StormTile } from "../../lib/studio/flight/spawn";
import { flightLinkUrl } from "../../lib/studio/flightLink";
import { cropOf } from "../../lib/studio/record";
import { radarMapHref } from "../../lib/studio/flightPage";
import { closeStudio } from "../../lib/studio/session";
import { STUDIO_SUPPORT } from "../../lib/studio/support";
import {
  flightPlanAsked, flightRequest, studioAspect, studioFlightOnly, studioFlying, studioPlaying, studioRecording,
} from "../../lib/studio/store";
import type { FlightRequest } from "../../lib/studio/store";
import { sendLink } from "../../lib/share";
import { holdSideways } from "../../lib/sideways";
import { curtainDown, lower, throughBlack } from "../../lib/curtain";

/** The 3D map. */
export let stage: Stage;

// What the map calls of Studio's code comes with Studio, not with the map.
stage.setStudioSupport(STUDIO_SUPPORT);
const director = new Director(stage);

/** The flight under way; null when the reader is not flying. */
let pilot: Pilot | null = null;

/**
 * Whether the reader is planning a flight: the page before it
 * (flight/Preflight.svelte). On the flight's own page that is where Studio
 * opens, and what a flight comes back to.
 */
let planning = ($studioFlightOnly && !get(flightRequest)) || get(flightPlanAsked);
/** Studio up for the flight alone: the flight's own page, or the 3D map's Fly (`flightPlanAsked`). */
$: flightAlone = $studioFlightOnly || $flightPlanAsked;

/** The plan the flight under way took off with: what its link gives (`share`). */
let flown: FlightPlan | null = null;
/** Where the reader goes when the flight under way ends, for one asked for with somewhere to go back to. */
let back: (() => void) | null = null;

/** How long the black is held at take-off while the flight's first frames come in, and at other changes of scene, ms. */
const TAKEOFF_HOLD_MS = 450;
const SCENE_HOLD_MS = 200;

/** A change of scene, through black; none while another is under way. */
function cut(change: () => void, hold = SCENE_HOLD_MS): void {
  if (curtainDown()) return;
  void throughBlack(change, hold);
}

/** The plan taken off with while what the flight needs finishes loading; null when none waits. */
let loading: FlightPlan | null = null;

/** To the flight's plan: a scene playing stops first. Not while one records. */
function plan(): void {
  if (pilot || boarding || loading || $studioRecording !== null) return;
  director.pause();
  planning = true;
}

/** Take off, as planned: at once where everything is loaded, else once it is. */
function fly(flightPlan: FlightPlan): void {
  planning = false;
  if (pilot || loading) return;
  if (get(flightLoad).state === "ready") {
    takeOff(flightPlan);
    return;
  }
  loading = flightPlan;
  preloadFlight().then(() => {
    if (loading !== flightPlan) return;
    void throughBlack(() => {
      if (loading !== flightPlan) return;
      loading = null;
      takeOff(flightPlan);
    }, TAKEOFF_HOLD_MS);
  }, () => undefined);
}

/** Loading failed: another try, with the same plan. */
function retry(): void {
  const waiting = loading;
  loading = null;
  if (waiting) fly(waiting);
}

/** Not flown after all: from the loading screen back where the flight was asked from, or to its plan. */
function unload(): void {
  loading = null;
  const going = back;
  back = null;
  if (going) going();
  else planning = true;
}

function takeOff(flightPlan: FlightPlan): void {
  flown = flightPlan;
  pilot = new Pilot(stage, { credits, modelCredit: $_("studio.flight.model_credit"), onLeave: () => cut(land) }, flightPlan);
  pilot.start();
}

/** Put the plan away: back to Studio's tools, or off the flight's own page's map altogether. */
function cancel(): void {
  planning = false;
  if (flightAlone) closeStudio();
}

/** Back to meteocool's map: from the flight's own page, the page the map is on; from the 3D map's Fly, the 3D map. */
function backToMap(): void {
  if ($studioFlightOnly) {
    if (curtainDown()) return;
    void lower().then(() => {
      window.location.href = radarMapHref();
    });
    return;
  }
  cut(cancel);
}

/**
 * Back to Studio, the map and its tools as they were; on the flight's own
 * page, to the plan; from a flight asked for elsewhere, to where it was asked.
 */
function land(): void {
  const flying = pilot;
  pilot = null;
  flown = null;
  flying?.stop();
  const going = back;
  back = null;
  if (flying && going) going();
  else if (flying && flightAlone) planning = true;
}

/* A flight asked for from outside: the radar's storms waited for, then off.
   Their list is each network's and comes in over the 3D map's first seconds
   (as Preflight knows), and a flight planned from the first of it would fly
   at a storm a country away while the one in front of the reader was on its
   way. So it is looked at until it stops changing, with the storms round the
   start in it, or for so long at most. A list that holds still can still be
   only the far networks' (the near one's tiles come with the camera's view,
   a moment later): a tile this near the start is what says the near ones are
   in. Where there is no weather near at all, the flight waits the longest. */
const BOARD_POLL_MS = 750;
/** How many looks in a row the list has to stay the same for. */
const BOARD_SETTLED = 2;
const BOARD_MOST_MS = 10_000;
/** A storm tile this near the start, km, says the storms round it have come in. */
const BOARD_NEAR_KM = 150;

/** The flight asked for, while its storms are waited for; null when there is none. */
let boarding: FlightRequest | null = null;
let boardTimer: ReturnType<typeof setTimeout> | null = null;

const signature = (tiles: readonly StormTile[]) => `${tiles.length}:${tiles.reduce((sum, tile) => sum + (tile.peakDbz ?? 0), 0).toFixed(0)}`;

function board(request: FlightRequest): void {
  boarding = request;
  planning = false;
  director.pause();
  // Loaded while the storms come in.
  preloadFlight().catch(() => undefined);
  const began = performance.now();
  let last = signature(stage.stormTiles());
  let same = 0;
  const look = () => {
    boardTimer = null;
    if (boarding !== request) return;
    const tiles = stage.stormTiles();
    const now = signature(tiles);
    same = now === last ? same + 1 : 0;
    last = now;
    const near = tiles.some((tile) => distanceM(request.start.lon, request.start.lat, tile.lon, tile.lat) <= BOARD_NEAR_KM * 1000);
    if (!(near && same >= BOARD_SETTLED) && performance.now() - began < BOARD_MOST_MS) {
      boardTimer = setTimeout(look, BOARD_POLL_MS);
      return;
    }
    const camera = stage.studioCamera();
    const flightPlan = planHere(
      request.start, stormSystems(tiles), (lon, lat) => stage.groundElevation(lon, lat), camera?.bearing ?? 0, FLIGHT_STYLE,
    );
    boarding = null;
    back = request.back ?? null;
    flightRequest.set(null);
    void throughBlack(() => fly(flightPlan), TAKEOFF_HOLD_MS);
  };
  boardTimer = setTimeout(look, BOARD_POLL_MS);
}

/** Not flown after all: Escape while the storms are waited for, back to where it was asked. */
function unboard(): void {
  const request = boarding;
  boarding = null;
  if (boardTimer !== null) clearTimeout(boardTimer);
  boardTimer = null;
  flightRequest.set(null);
  if (request?.back) request.back();
  else closeStudio();
}

const asked = get(flightRequest);
if (asked) board(asked);

/** Send the start of the flight under way: the plan it took off with, not where it has got to. */
function share(anchor: Element | null): void {
  if (!flown) return;
  const start = startOf(flown, stormSystems(stage.stormTiles()));
  void sendLink({ url: flightLinkUrl(window.location.origin, start), title: $_("studio.flight.share.title") }, anchor, { card: false });
}

// The map can end a flight itself: when the 3D map is put away under it.
$: if (!$studioFlying && pilot) land();
// The page's own chrome goes while flying; see global.css.
$: document.documentElement.classList.toggle("mc-flying", $studioFlying);

/* In the apps, whose web view stays upright, the flight is drawn on its
   side from its plan to its end, and their buttons are put away; see
   lib/sideways.ts. */
let releaseSideways: (() => void) | null = null;
$: aboard = Boolean(boarding || loading || planning || $studioFlying);
$: if (aboard && !releaseSideways) releaseSideways = holdSideways();
$: if (!aboard && releaseSideways) {
  releaseSideways();
  releaseSideways = null;
}
onDestroy(() => releaseSideways?.());

onDestroy(() => {
  if (boardTimer !== null) clearTimeout(boardTimer);
  boarding = null;
  loading = null;
  land();
  document.documentElement.classList.remove("mc-flying");
  director.dispose();
});

/** The credits on the map, for a recording to carry: what its own line of them reads. */
function credits(): string {
  const line = stage.canvas()?.closest(".maplibregl-map")?.querySelector(".maplibregl-ctrl-attrib-inner");
  return (line?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/* What a recording frames, drawn over the map while a shape other than the
   whole window is chosen: the part outside it is dimmed. */
let width = 0;
let height = 0;
$: frame = $studioAspect === "window" ? null : cropOf(width, height, $studioAspect);

function keydown(event: KeyboardEvent) {
  if (boarding && !$studioFlying) {
    if (event.key === "Escape") {
      event.stopPropagation();
      unboard();
    }
    return;
  }
  // The flight has keys of its own (lib/studio/flight/controls.ts), and so have its plan and its loading.
  if ($studioFlying || planning || loading) return;
  const target = event.target as HTMLElement | null;
  // A control with the focus keeps its own keys: Space presses a button.
  if (target?.closest("input, select, textarea, button, [role='radio'], [contenteditable]")) return;
  if (event.key === " ") {
    event.preventDefault();
    if ($studioPlaying) director.pause();
    else void director.play();
  } else if (event.key === "k" || event.key === "K") {
    director.addKeyframe();
  } else if (event.key === "Escape" && ($studioPlaying || $studioRecording !== null)) {
    event.stopPropagation();
    director.pause();
  }
}
</script>

<svelte:window on:keydown={keydown} />

<div class="studio" class:flying={$studioFlying} bind:clientWidth={width} bind:clientHeight={height}>
  {#if $studioFlying && pilot}
    <FlightDeck {pilot} {credits} {share} endsOnMap={back !== null} />
  {:else if loading}
    <FlightLoading onretry={retry} onback={() => cut(unload)} />
  {:else if boarding}
    <!-- A flight asked for from the map or a link, waiting for its storms: a word, and nothing else in the way. -->
    <p class="boarding" role="status">
      <span class="spinner" aria-hidden="true"></span>{$_("studio.flight.boarding")}
    </p>
  {:else if planning}
    <Preflight {stage} ontakeoff={(flightPlan) => cut(() => fly(flightPlan), TAKEOFF_HOLD_MS)} oncancel={() => cut(cancel)}
      onback={flightAlone ? backToMap : null} />
  {:else if !flightAlone}
  {#if frame && width && height}
    <div
      class="frame"
      class:recording={$studioRecording !== null}
      style:left={`${frame.x}px`}
      style:top={`${frame.y}px`}
      style:width={`${frame.width}px`}
      style:height={`${frame.height}px`}
      aria-hidden="true">
      <span>{$studioAspect}</span>
    </div>
  {/if}
  <StudioPanel {director} onclose={closeStudio} onfly={() => cut(plan)} />
  <StudioTimeline {director} {credits} />
  {#if $studioRecording !== null}
    <p class="rec" role="status">{$_("studio.recording_note")}</p>
  {/if}
  {/if}
</div>

<style>
  .studio {
    --studio-accent: var(--mc-orange);
    position: absolute;
    inset: 0;
    z-index: var(--mc-z-chrome);
    pointer-events: none;
    /* What the flight's components size themselves by, upright or on its side (lib/sideways.ts). */
    container: mc-frame / size;
  }
  .studio > :global(*) { pointer-events: auto; }
  /* The flight deck covers the page's own chrome, over which it is drawn. */
  .studio.flying { z-index: var(--mc-z-frame); }
  .studio.flying > :global(*) { pointer-events: none; }

  /* The frame: a hairline with everything outside it dimmed by one large shadow. */
  .studio > .frame {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--studio-accent) 70%, transparent);
    box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.28);
    pointer-events: none;
  }
  .frame.recording { border-color: #ff453a; }
  .frame span {
    position: absolute;
    top: 6px;
    right: 8px;
    color: color-mix(in srgb, var(--studio-accent) 85%, transparent);
    font: 600 11px/1 var(--mc-font);
  }
  .studio > .boarding {
    position: absolute;
    top: calc(var(--mc-top-stack) + var(--mc-control-lg) + var(--mc-gutter));
    left: 50%;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 7px 14px;
    border-radius: var(--mc-radius-pill);
    background: rgba(5, 7, 10, 0.62);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    color: #f2f4f7;
    font: 600 12px/1 var(--mc-font);
    white-space: nowrap;
    transform: translateX(-50%);
    pointer-events: none;
  }
  .boarding .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid rgba(242, 244, 247, 0.3);
    border-top-color: var(--studio-accent);
    border-radius: 50%;
    animation: boarding-turn 0.9s linear infinite;
  }
  @keyframes boarding-turn { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .boarding .spinner { animation: none; border-color: var(--studio-accent); }
  }
  .studio > .rec {
    position: absolute;
    top: calc(var(--mc-top-stack) + var(--mc-control-lg) + var(--mc-gutter));
    left: 50%;
    margin: 0;
    padding: 6px 12px;
    border-radius: var(--mc-radius-pill);
    background: #ff453a;
    color: #fff;
    font: 600 12px/1 var(--mc-font);
    transform: translateX(-50%);
    pointer-events: none;
  }
</style>
