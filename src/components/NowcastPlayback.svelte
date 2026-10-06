<script lang="ts">
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
  import { toolbarTransitionEnd, toolbarTransitionStart } from "../lib/toolbarTransition";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faAngleDoubleDown } from "@fortawesome/free-solid-svg-icons/faAngleDoubleDown";
import { faAngleDoubleUp } from "@fortawesome/free-solid-svg-icons/faAngleDoubleUp";
import { faHistory } from "@fortawesome/free-solid-svg-icons/faHistory";
import { faRetweet } from "@fortawesome/free-solid-svg-icons/faRetweet";
import { faLocationCrosshairs } from "@fortawesome/free-solid-svg-icons/faLocationCrosshairs";
import Icon from "./Icon.svelte";
import StateMachine from "javascript-state-machine";
import { fly } from "svelte/transition";
import { onDestroy, onMount } from "svelte";
import {
  lastFocus, sharedActiveCap,
  latLon,
  bottomToolbarMode, precacheForecast,
  dryAtUser, inspectLatLon, mapExtent4326, mapTapped, modelCompareAt, radarStale,
  frameRequest, playbackRunning, capTimeIndicator,
} from "../stores";

import { DeviceDetect as dd } from "../lib/DeviceDetect";
import type RadarCapability from "../caps/RadarCapability";
import type { GridConfig } from "../caps/RadarCapability";

import LastUpdated from "./LastUpdated.svelte";
import RadarScaleLine from "./scales/RadarScaleLine.svelte";
import LiveIndicator from "./LiveIndicator.svelte";
import Timeline from "./Timeline.svelte";
import { _, locale } from "svelte-i18n";
import { get } from "svelte/store";
import { forecastGapFrom, hasEcho, timelineSteps } from "../lib/timeline";
import {
  chRadarExtent4326,
  czRadarExtent4326,
  dwdRadarExtent4326,
  frRadarExtent4326,
  plRadarExtent4326,
} from "../layers/extents";
import { reverseGeocode } from "../lib/reverseGeocode";
import DismissableStrip from "./DismissableStrip.svelte";
import { share, shareAvailable, shareIcon } from "../lib/share";
import DryOutlook from "./DryOutlook.svelte";
import { onWake } from "../lib/wakeup";
import ChartSkeleton from "./ChartSkeleton.svelte";

export let cap: RadarCapability;

let gridConfig: GridConfig | null = null;

/** How many frames ahead of playback to ask for tiles: about a second and a half of the loop. */
const PREFETCH_FRAMES = 3;

/** Manual subscriptions, so they are handed to onDestroy at the bottom. */
const subscriptions: (() => void)[] = [];

let showOpenControls = false;

let oldTimeStep = 0;

/**
 * The observation the scrubber is parked on while it is still tracking the
 * live edge, or null once the user has moved away from it.
 *
 * A new grid lands every few minutes. If the scrubber is sitting on what was
 * the newest observation, it should ride forward onto the new one -- that is
 * the "following live" case, and the map is showing that frame anyway. If the
 * user has dragged to an older frame, or out into the forecast, that position
 * is theirs and a refresh must leave it alone.
 */
let liveEdge: number | null = null;

let playPauseButton = faPlay;
let playTimeout;

/**
 * A frame the player was opened to show, rather than the live edge.
 *
 * Set from `frameRequest` -- a link naming a frame, or Back returning to one --
 * and read by the parking in onShowScrollbar, which otherwise puts the
 * scrubber on the newest observation, twice, the second time 200ms later.
 * Held until that second park has run, or it would drag the scrubber back to
 * live under a map already showing the frame asked for.
 */
let seekTo: number | null = null;

/**
 * The step the player is on, unix seconds: what the needle sits on and what
 * a playback tick advances. Zero until the player has been opened.
 */
let shown = 0;

let loop = true;
let historicActive = true;
let includeHistoric = false;

let autoPlay = false;

/**
 * How often the time axis is labelled, in minutes. The grid is on a 5-minute
 * step, so every interval here divides it exactly.
 */
const labelEvery = dd.breakpoint() === "reduced" || dd.breakpoint() === "small" ? 60 : 30;


/**
 * The newest step the scrubber may reach.
 *
 * The grid always runs to +2h, but the tail of the nowcast is published behind
 * it and those steps have no tile. Left at gridConfig.end, both playback and a
 * drag would run the clock over a map that cannot change. Recomputed with each
 * new grid, so the range grows as the backend fills the tail in.
 */
$: lastPlayableStep = gridConfig ? cap.getLastPlayableStep() : undefined;

/** The strip's bars, oldest first, cut where the scrubber stops. */
$: steps = gridConfig && lastPlayableStep !== undefined ? timelineSteps(gridConfig, lastPlayableStep) : [];

/**
 * Whether there is anything worth plotting: a step with measurable echo at the
 * client's position. Every dbz is null until a position has been shared, so
 * this keeps the strip away when there is no location either -- it used to
 * render a full-width row of zero-height bars over the map instead.
 */
$: hasPrecipitation = hasEcho(steps);

/**
 * Where along the track the forecast starts, as a fraction, when there is none
 * at the point being asked about -- and null whenever there is one, or nothing
 * at all. Flat bars there would say "dry" when the truth is "no forecast".
 */
$: noForecastFrom = forecastGapFrom(steps);

/**
 * Whether the forecast strip is on screen.
 *
 * The strip itself -- glass dock, swipe-to-clear, Hide button, title row -- is
 * DismissableStrip, shared with the lightning histogram. What stays here is
 * which layer's question it is answering and when it is worth asking.
 *
 * Dismissal is not permanent. It lasts as long as the thing it was about: once
 * there is nothing to plot, or the player is opened again, the strip is
 * re-armed -- otherwise flicking it away once would hide every later shower for
 * the rest of the session, with no control anywhere to bring it back.
 */
let chartDismissed = false;

/**
 * Whether any of what is on screen has radar behind it.
 *
 * meteocool's live radar is DWD's composite plus MeteoSwiss's and
 * Meteo-France's, which stop at Germany, Switzerland, France and the reach
 * around them; every other layer is global. Someone opening the app on holiday
 * sees an empty map and no reason for it, which reads as the app being broken
 * rather than as a coverage boundary. Answered from the layers' own extents, so
 * it cannot drift from what actually gets drawn.
 *
 * Only when the viewport misses the box entirely -- half a screen of coverage
 * is still coverage, and a notice over it would be wrong.
 */
function overlaps(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/* Every network's grid, not just DWD's: a viewport over Brittany or Corsica
   misses DWD's box entirely and is covered all the same, by Meteo-France. */
const radarExtents4326 = [
  dwdRadarExtent4326,
  chRadarExtent4326,
  frRadarExtent4326,
  czRadarExtent4326,
  plRadarExtent4326,
];

$: outOfCoverage = $sharedActiveCap === "radar"
  && $mapExtent4326 !== null
  && !radarExtents4326.some((extent) => overlaps(extent, $mapExtent4326));

let coverageDismissed = false;
/* Re-armed on the way back in, so panning out again says so again. */
$: if (!outOfCoverage) coverageDismissed = false;

/* A tapped point always gets an answer, even a flat one: the tap is a question,
   and a strip that refuses to appear reads as the tap not having registered.
   Without one, the strip only turns up when there is something to show. */
$: chartShowable = (hasPrecipitation || $inspectLatLon !== null)
  && $sharedActiveCap === "radar"
  // The coverage notice takes the slot: they share one position, and a forecast
  // for somewhere off screen is not the answer to "why is this map empty".
  && !outOfCoverage;
$: if (!chartShowable) chartDismissed = false;
$: if ($bottomToolbarMode === "player") chartDismissed = false;

/**
 * The same slot on a dry day: what the weather models say for the client's
 * own position, when the radar has nothing for it (see DryOutlook).
 *
 * Only when the rain chart has nothing to say -- which it cannot, over a dry
 * position with no tapped point -- and only for a position the radar covers:
 * outside every network "nothing on the radar" is no data, not no rain.
 * Dismissal lasts as long as the dry spell does, as the chart's lasts as long
 * as there is something to plot. It stands aside while the player is open,
 * and comes back when it closes unless it was dismissed. A failed forecast
 * fetch takes it down until the page next wakes -- the network back, the
 * page looked at again -- and at most once a minute: for the session, as it
 * was, one dropped request on a train lost the strip until a reload.
 */
const covers = (point: [number, number] | null): boolean => point !== null
  && radarExtents4326.some(([minLon, minLat, maxLon, maxLat]) => (
    point[1] >= minLon && point[1] <= maxLon && point[0] >= minLat && point[0] <= maxLat));
let outlookDismissed = false;
let outlookUnavailable = false;
let outlookFailedAt = 0;
const OUTLOOK_RETRY_MS = 60_000;
subscriptions.push(onWake(() => {
  if (outlookUnavailable && Date.now() - outlookFailedAt >= OUTLOOK_RETRY_MS) outlookUnavailable = false;
}));
$: outlookShowable = $dryAtUser
  && $latLon !== null
  && covers($latLon)
  && $inspectLatLon === null
  && $sharedActiveCap === "radar"
  && !outOfCoverage
  && !chartShowable
  && !$radarStale
  && !outlookUnavailable
  // The drawer it opens covers it, and the strip would only restate it.
  && !$modelCompareAt
  // Nor over the player: the reader is stepping through the radar's frames,
  // and what the models say about the coming days is not one of them. The
  // rain chart stays, because it is those frames at the reader's position.
  && $bottomToolbarMode !== "player";
$: if (!$dryAtUser) outlookDismissed = false;

/* Between a tap and the grid that answers it, the strip is up with the last
   point's bars still in it. Flagged here rather than read off the capability,
   because what matters is that the numbers on screen are about somewhere else
   -- not that a request happens to be open. */
let gridLoading = false;

function dismissChart() {
  chartDismissed = true;
  // The marker exists to feed this strip, so it goes with it -- which is also
  // the way back to sampling the client's own position.
  inspectLatLon.set(null);
}

/**
 * The tapped point's name for the title, once it comes back.
 *
 * The token guards against a slow lookup for an abandoned point landing after
 * a fast one for the current point -- the request is aborted too, but an abort
 * that arrives late still resolves.
 */
let placeName: string | null = null;
let placeToken = 0;

async function resolvePlace(
  point: [number, number] | null,
  language: string | null | undefined,
) {
  placeName = null;
  if (!point) return;
  const token = ++placeToken;
  const name = await reverseGeocode(point[0], point[1], language ?? "en", "local", "forecast");
  if (token === placeToken) placeName = name;
}

$: resolvePlace($inspectLatLon, $locale);

/* The place name is the title once there is one: a heading that says where, in
   a panel whose whole subject is already precipitation. Until then, and for the
   client's own position, the strip says what it is instead. */
$: chartTitle = $inspectLatLon
  ? (placeName ?? $_("precipitation_at_point"))
  : $_("precipitation_here");

/** Back to sampling the client's own position, without closing the strip. */
function returnToCurrentPosition() {
  inspectLatLon.set(null);
}

/* Tapping the map brings a cleared strip back -- otherwise the tap sets a
   marker, refetches the grid and shows nothing for it. LayerManager publishes
   the tap, because only the map can tell a tap from a pan.

   Component level, not inside an action: the strip mounts and unmounts every
   time it comes and goes, and a subscription made in there would stack up one
   live copy per appearance. */
subscriptions.push(mapTapped.subscribe((n) => {
  if (n > 0) chartDismissed = false;
}));

subscriptions.push(inspectLatLon.subscribe(() => { gridLoading = true; }));

/* Same reason as a tap: the bars on screen are about a different moment. The
   whole strip is laid out around "now", so once the clock has moved past the
   grid's own the axis under those bars is wrong and not just their age. Only
   the rising edge -- the grid that clears radarStale also clears this. */
subscriptions.push(radarStale.subscribe((value) => { if (value) gridLoading = true; }));

function updateSliderToLatest(_config) {
  // Never mid-playback: that would throw a running sequence back to now.
  if (fsm.state === "playing") return;
  // Only from the frame that was the newest observation last time round.
  if (liveEdge === null || shown !== liveEdge) return;
  const latest = cap.getMostRecentObservation();
  shown = latest;
  liveEdge = latest;
}
$: updateSliderToLatest(gridConfig);

const fsm = new StateMachine({
  init: "followLatest",
  transitions: [
    {
      name: "showScrollbar",
      from: "followLatest",
      to: "manualScrolling",
    },
    {
      name: "pressPlay",
      from: "manualScrolling",
      to: "playing",
    },
    {
      name: "pressPause",
      from: "playing",
      to: "manualScrolling",
    },
    {
      name: "hideScrollbar",
      from: "*",
      to: "followLatest",
    },
    {
      name: "hideScrollbar",
      from: "followLatest",
      to: "followLatest",
    },
  ],
  methods: {
    onShowScrollbar: () => {
      bottomToolbarMode.set("player");
      playPauseButton = faPlay;
      // Opening parks the scrubber on the live edge, so it tracks refreshes
      // until the user drags it somewhere else -- unless it was opened to show
      // one frame in particular, which is then where it parks.
      const park = () => {
        if (seekTo !== null) {
          shown = seekTo;
          return;
        }
        liveEdge = cap.getMostRecentObservation();
        shown = liveEdge;
      };
      park();
      setTimeout(() => {
        park();
        seekTo = null;
      }, 200);
      if (autoPlay) {
        setTimeout(() => {
          console.log("Triggering auto-play");
          if (cap.hasFrameLayer && fsm.state === "manualScrolling") {
            fsm.pressPlay();
          } else {
            setTimeout(() => {
              // Workaround for #2279954594 (wtf is going on Android people) and #2217587657
              // pressPlay is only legal from manualScrolling: the player can be
              // closed, or play pressed by hand, inside this second, and the
              // state machine throws on an illegal transition.
              if (fsm.state !== "manualScrolling") return;
              console.log("Triggering deferred auto-play");
              fsm.pressPlay();
            }, 1000);
          }
        }, 500);
        autoPlay = false;
      }
    },
    onEnterWaitingState: (t) => {
      if (t.from === "playing") {
        autoPlay = true;
        // XXX deduplicate with onPressPause:
        if (playTimeout !== 0) window.clearTimeout(playTimeout);
        playTimeout = 0;
        playPauseButton = faPlay;
      }
    },
    onPressPlay: () => {
      const playTick = () => {
        // Pause and close both cancel playTimeout; a tick that outlives them
        // would otherwise resume playback on its own.
        if (fsm.state !== "playing") return;
        let thisFrameDelayMs = 450;
        if (!gridConfig) return;
        const sliderValueInt = shown;
        const lastStep = lastPlayableStep ?? gridConfig.end;
        if (sliderValueInt >= lastStep) {
          shown = includeHistoric ? gridConfig.start : gridConfig.now;
        } else {
          shown = sliderValueInt + 5 * 60;
        }
        if (sliderValueInt === 0) {
          thisFrameDelayMs = 800;
        }
        sliderChangedHandler(shown);
        // The next frames' tiles, asked for before the player reaches them,
        // so each frame is whole when it is shown. The setting is the
        // "preload forecast" switch, which used to be wired to nothing.
        if ($precacheForecast) cap.prefetchFrames(shown, PREFETCH_FRAMES);
        if (shown !== gridConfig.now || loop) {
          playTimeout = window.setTimeout(playTick, thisFrameDelayMs);
        } else {
          playTimeout = 0;
          console.log("Pausing due to slider usage");
          fsm.pressPause();
        }
      };
      // From a timer rather than from here. A first tick that lands on the
      // live frame pauses -- play pressed on the last step, or on the one
      // before now, without the loop -- and a pause inside this transition
      // threw, leaving the machine mid-transition for good: from then on
      // pause, play and close all threw, and the player stayed open until
      // the page was reloaded.
      playTimeout = window.setTimeout(playTick, 0);
      playPauseButton = faPause;
    },
    onPressPause: () => {
      if (playTimeout !== 0) window.clearTimeout(playTimeout);
      playTimeout = 0;
      playPauseButton = faPlay;
    },
    // Entering and leaving the state rather than the transitions into it:
    // playback ends by pause and by close alike, and this cannot miss either.
    onEnterPlaying: () => playbackRunning.set(true),
    onLeavePlaying: () => playbackRunning.set(false),
    onHideScrollbar: (transition) => {
      // Set unconditionally, before the early return. A hide() that arrives
      // while the machine is already in followLatest -- the idle-refocus
      // handler below, or the capability's loseFocus event -- would otherwise
      // leave bottomToolbarMode on "player" with nothing left that can move it
      // back: the tray stays open and its close button does nothing, because
      // every later hide() takes this same early return.
      bottomToolbarMode.set("collapsed");
      if (transition.from === "followLatest") return;
      oldTimeStep = 0;
      liveEdge = null;
      cap.resetToLatest();
    },
  },
});

function show() {
  if (fsm.state === "followLatest") {
    fsm.showScrollbar();
  }
}

/**
 * Open on the frame something outside the player asked for.
 *
 * Waits for a grid, because only the grid can say whether the frame exists: a
 * link names an absolute time, and one opened hours later names a frame the
 * window has moved past. That, the live frame itself, and anything with no
 * tiles behind it all leave the player where it is -- following live -- which
 * is the honest answer to "show me a moment we no longer have".
 */
function takeFrameRequest() {
  const wanted = get(frameRequest);
  if (wanted === null || !gridConfig) return;
  frameRequest.set(null);
  if (wanted === "live") {
    hide();
    return;
  }
  if (!gridConfig.grid[wanted]?.url || wanted === cap.getMostRecentObservation()) return;
  if (fsm.state === "playing") fsm.pressPause();
  if (fsm.state === "followLatest") {
    seekTo = wanted;
    fsm.showScrollbar();
  } else {
    shown = wanted;
  }
  sliderChangedHandler(wanted);
}

subscriptions.push(frameRequest.subscribe(() => takeFrameRequest()));

function showAndPlay() {
  autoPlay = true;
  show();
}

function hide() {
  if (playTimeout !== 0) window.clearTimeout(playTimeout);
  playTimeout = 0;
  fsm.hideScrollbar();
}

// Recorded when the grid updates; not currently rendered.
let _latest: number;

onMount(async () => {
  window.leaveForeground = () => {
    if (fsm.state === "playing") {
      console.log("Pausing due to window.leaveForeground();");
      fsm.pressPause();
    }
  };

  cap.addObserver((subject, data) => {
    console.log(`NowcastPlayback observed event ${subject}`);
    if (subject === "grid" && data) {
      gridConfig = data as GridConfig;
      // The minute's re-announcement of a grid sampled before the last tap is
      // not the answer the skeleton is waiting for; see `sampledHere`.
      gridLoading = !cap.sampledHere();
      showOpenControls = true;
      _latest = cap.getMostRecentObservation();
      takeFrameRequest();
    }
    //   // const gridSteps = Object.keys(grid);
    //   let changed = false;
    //   // console.log(`Frontend grid: ${gridSteps.sort()}`);
    //   // console.log(`Backend grid: ${Object.keys(data).sort()}`);
    //   Object.keys(data)
    //           .forEach((key) => {
    //             if (key in grid) {
    //               grid[key].dbz = data[key].dbz;
    //               grid[key].dbzMin = data[key].dbzMin;
    //               grid[key].dbzMax = data[key].dbzMax;
    //               grid[key].url = data[key].url;
    //               grid[key].source = data[key].source;
    //               changed = true;
    //             }
    //           });
    //   if (changed) redraw();

    //   const mostRecentTimestamp = cap.getMostRecentObservation();
    //   if ($bottomToolbarMode !== 'player' && mostRecentTimestamp in grid) {
    //     cap.setUrl(grid[mostRecentTimestamp].url);
    //     capTimeIndicator.set(mostRecentTimestamp);
    //   }
    // }
    // if (subject === "historic") {
    //  historicLayers = data.sources;
    // } else if (subject === "nowcast") {
    //  nowcastLayers = data.sources;
    // } else {
    //  return;
    // }
    // if (historicLayers && nowcastLayers) {
    //   if (fsm.state === "waitingForServer") {
    //     fsm.showScrollbar();
    //   }
    //   const reversed = Object.values(historicLayers);
    //   reversed.reverse();
    //   rainValues = reversed
    //     .map((layer) => Math.round(layer.reported_intensity + 32.5))
    //     .concat(Object.values(nowcastLayers)
    //       .map((layer) => Math.round(layer.reported_intensity + 32.5)));
    //   setChart();
    // } else {
    //   switch (fsm.state) {
    //     case "manualScrolling":
    //       fsm.enterWaitingState();
    //       break;
    //     case "playing":
    //       autoPlay = true;
    //       fsm.enterWaitingState();
    //       break;
    //     default:
    //       break;
    //   }
    // }
  });
  cap.notifyObservers();

  cap.addObserver((event) => {
    if (event === "loseFocus") {
      hide();
    }
  });
});

function sliderChangedHandler(value, userInteraction = false) {
  if (Number.isNaN(value)) {
    console.log("sliderChangedHandler called with NaN");
    return;
  }
  if (value === oldTimeStep) return;

  if (userInteraction && fsm.state === "playing") {
    console.log("Pausing due to sliderChangedHandler");
    fsm.pressPause();
  }

  // Both callers land here -- a drag and a playback tick -- so this is the one
  // place that has to re-decide whether the scrubber is still on the live
  // edge. Dragging back onto the newest observation resumes tracking.
  liveEdge = value === cap.getMostRecentObservation() ? value : null;

  cap.setSource(value);
  // if (value in grid && 'url' in grid[value] && grid[value].url) {
  //   cap.setUrl(grid[value].url);
  //   capTimeIndicator.set(value);
  // }
  oldTimeStep = value;
}

/** A hand on the strip: playback stops where it is, and the hand has it. */
function grabbed() {
  if (fsm.state === "playing") {
    console.log("Pausing due to a grab on the timeline");
    fsm.pressPause();
  }
}

/** The needle has reached another step. */
function seek(event: CustomEvent<number>) {
  shown = event.detail;
  sliderChangedHandler(event.detail, true);
}

function playPause() {
  if (fsm.state === "playing") {
    console.log("Pausing due to button");
    fsm.pressPause();
  } else if (fsm.state === "manualScrolling") {
    fsm.pressPlay();
  }
}

function toggleLoop() {
  loop = !loop;
  historicActive = loop;
  if (!historicActive) includeHistoric = false;
}

function toggleHistoric() {
  includeHistoric = !includeHistoric;
}

let last = new Date();
subscriptions.push(lastFocus.subscribe((focus) => {
  if (focus.getTime() > (last.getTime() + 2 * 60 * 1000) && cap.trackingMode !== "live") {
    hide();
    cap.resetToLatest();
  }
  last = focus;
}));

onDestroy(() => {
  subscriptions.forEach((unsubscribe) => unsubscribe());
  if (playTimeout !== 0) window.clearTimeout(playTimeout);
  playbackRunning.set(false);
});
</script>

<style>
  /* The player inherits the tray material from :global(.bottomToolbar) in
     BottomToolbar.svelte. Its height is what Map.svelte measures; the forecast
     strip above the collapsed bar keys off the same token. */
  .timeslider {
    height: var(--mc-player-h);
    z-index: var(--mc-z-tray-player);
    padding: 8px var(--mc-tray-pad) 6px;
    overflow: hidden;
  }

  /* ---------------------------------------------------------------------
     The open player, three rows at every size:

         head      where the strip's numbers are from, and the way out
         timeline  the strip: forecast bars, needle, axis
         row       transport on the left, freshness and legend on the right
     --------------------------------------------------------------------- */
  .player {
    display: flex;
    flex-direction: column;
    gap: 4px;
    height: 100%;
  }

  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 28px;
    /* Clear of the tray's corner, so the title does not start inside the
       curve; the strip below keeps the tray's own inset so its bars line up
       with the minute the needle is at. */
    padding: 0 0 0 8px;
  }
  .title {
    flex: 1 1 auto;
    min-width: 0;
    font: 700 13px/1.3 var(--mc-font);
    letter-spacing: -0.01em;
    color: var(--mc-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title.quiet {
    font-weight: 500;
    color: var(--mc-text-2);
  }

  /* The way back to the client's own position: a tinted chip, the same one
     the collapsed strip carries, so it reads as a control beside a place name. */
  .link {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-accent-tint);
    color: var(--mc-accent);
    font: 600 12px/1.25 var(--mc-font);
    letter-spacing: -0.01em;
    white-space: nowrap;
    cursor: pointer;
    transition: background var(--mc-motion-fast) var(--mc-ease),
                transform var(--mc-motion-fast) var(--mc-ease),
                opacity var(--mc-motion-fast) var(--mc-ease);
  }
  .link:hover { background: color-mix(in srgb, var(--mc-accent) 26%, transparent); }
  .link:active { opacity: 0.6; transform: scale(0.96); }
  .link:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .link :global(svg) { width: 11px; height: 11px; }

  .plot {
    position: relative;
    flex: 0 0 auto;
    min-width: 0;
  }

  .row {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 0;
    min-width: 0;
  }
  .spacer { flex: 1 1 auto; min-width: 0; }
  .status {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .legend { display: none; min-width: 0; }

  /* A tint on the open tray; collapsed controls add their own glass below. */
  .controlButton {
    width: var(--mc-control);
    height: var(--mc-control);
    box-sizing: border-box;
    display: grid;
    place-items: center;
    padding: 0;
    margin: 0;
    border: 0;
    border-radius: 50%;
    flex: 0 0 auto;
    background: var(--mc-tint);
    color: var(--mc-text);
    font-size: 15px;
    text-align: center;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast), color var(--mc-motion-fast);
  }
  .controlButton:hover {
    cursor: pointer;
    background: var(--mc-tint-hover);
    color: var(--mc-text);
  }
  .controlButton:active {
    transform: scale(var(--mc-press));
    background: var(--mc-tint-active);
  }
  .controlButton:focus-visible {
    outline: 2px solid var(--mc-accent);
    outline-offset: 2px;
  }
  /* Play is the one filled control in the tray. */
  .controlButton.play {
    background: var(--mc-accent);
    color: #fff;
  }
  .controlButton.play:hover { background: var(--mc-accent-strong); }
  .controlButton.play :global(svg) { margin-left: 2px; }
  .controlButton.play.playing :global(svg) { margin-left: 0; }
  .controlButton.on {
    background: var(--mc-accent);
    color: #fff;
  }
  .controlButton.on:hover { background: var(--mc-accent-strong); }
  /* The collapse disc is smaller than the transport, like a close disc. */
  .controlButton.collapse {
    width: 30px;
    height: 30px;
    font-size: 13px;
    color: var(--mc-text-3);
  }
  .controlButton.collapse:hover { color: var(--mc-text); }

  /* "-2h": whether the loop runs from the start of the strip or from now.
     The same height as the play and loop discs beside it, so the three read as
     one row of controls rather than two discs and a smaller tag. */
  .chip {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--mc-control);
    box-sizing: border-box;
    padding: 0 14px;
    border: 0;
    border-radius: var(--mc-radius-pill);
    background: var(--mc-tint);
    color: var(--mc-text);
    font: 600 14px/1 var(--mc-font);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--mc-motion-fast) var(--mc-ease), background-color var(--mc-motion-fast), opacity var(--mc-motion-fast);
  }
  .chip:hover { background: var(--mc-tint-hover); }
  .chip:active { transform: scale(var(--mc-press)); }
  .chip:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .chip.on { background: var(--mc-accent); color: #fff; }
  .chip.on:hover { background: var(--mc-accent-strong); }
  .chip[disabled] { opacity: 0.4; cursor: default; }
  .chip :global(svg) { width: 14px; height: 14px; }

  /* The two collapsed-state controls: standalone discs at the bottom corners,
     flanking the tray rather than sitting on it -- the same kind of control as
     the zoom capsule and the locate disc at the top right, and disjunct from
     the bar that carries the legend. BottomToolbar insets .lastUpdatedBottom by
     exactly this much so the two never overlap.

     Centred on the bar whatever height it is: that differs per breakpoint, so
     it comes from --mc-bar-h rather than a second copy of the number. */
  .buttonBar {
    position: absolute;
    bottom: calc(
      var(--mc-collapsed-bottom)
      + (var(--mc-bar-h) - var(--mc-control)) / 2
    );
    left: var(--mc-gutter);
    z-index: var(--mc-z-tray-buttons);
  }
  .buttonBar.right {
    left: unset;
    right: var(--mc-gutter);
  }

  /* These two are over the map, so they are glass rather than a tint. */
  .buttonBar .controlButton {
    background: var(--mc-glass-fill);
    -webkit-backdrop-filter: var(--mc-glass-backdrop);
    backdrop-filter: var(--mc-glass-backdrop);
    border: 1px solid var(--mc-glass-edge);
    box-shadow: var(--mc-glass-ring);
  }
  .buttonBar .controlButton:hover,
  .buttonBar .controlButton:active {
    background: var(--mc-glass-fill-strong);
  }

  /* Desktop: the legend joins the row at the right. */
  @media only screen and (min-width: 1120px) {
    :global(html:not(.is-ios)) .legend { display: block; }
  }

  /* The collapsed strip's plot: the same timeline, read-only, spanning the
     strip's own inset. */
  .barChart-plot {
    position: relative;
    height: 100%;
    margin: 0 var(--mc-tray-pad);
  }

  /* Prose in the strip, set like the body text of a system alert: secondary
     ink under the primary-ink title, at the same size as the rest of the tray.
     Same leading inset as the title, so the two read as one block. */
  .notice {
    margin: 2px calc(var(--mc-tray-pad) + 8px) 0;
    font: 400 12px/1.35 var(--mc-font);
    letter-spacing: -0.005em;
    color: var(--mc-text-2);
    overflow: hidden;
  }

  /* Nothing fell in the window. Sits over the ruler rather than replacing it,
     so the strip keeps its height and the needle still has a track. Over the
     forecast half only when that is the half with nothing. */
  .no-forecast,
  .empty {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 16px;
    margin: 0;
    display: grid;
    place-items: center;
    padding: 0 8px;
    text-align: center;
    color: var(--mc-text-2);
    font: 400 12px/1.35 var(--mc-font);
    letter-spacing: -0.005em;
    pointer-events: none;
  }
  .empty {
    left: 0;
    padding: 0 16px;
  }
  .skeleton {
    position: absolute;
    inset: 0 0 16px;
  }

  @media only screen and (max-width: 620px) {
    .timeslider {
      padding: 6px 8px 4px;
    }
    .row { gap: 4px; }
    :global(.bottomToolbar.lastUpdatedBottom.player-open) {
      display: none;
    }
  }
</style>

<LiveIndicator {cap} />

{#if outOfCoverage && !coverageDismissed}
  <DismissableStrip
    title={$_("radar_no_coverage")}
    collapsed={$bottomToolbarMode !== "player"}
    on:dismiss={() => { coverageDismissed = true; }}>
    <p class="notice">{$_("radar_no_coverage_body")}</p>
  </DismissableStrip>
{/if}

{#if outlookShowable && !outlookDismissed && $latLon}
  <DryOutlook
    lat={$latLon[0]}
    lon={$latLon[1]}
    collapsed={$bottomToolbarMode !== "player"}
    on:dismiss={() => { outlookDismissed = true; }}
    on:unavailable={() => { outlookUnavailable = true; outlookFailedAt = Date.now(); }} />
{/if}

<!-- Collapsed: the forecast floats above the bar as a strip, the same timeline
     without a hand on it. Tapping it opens the player, where the strip becomes
     the scrubber. -->
{#if $bottomToolbarMode !== "player" && chartShowable && !chartDismissed}
  <DismissableStrip
    title={chartTitle}
    linkLabel={$inspectLatLon && $latLon ? $_("show_for_my_location") : null}
    linkIcon={faLocationCrosshairs}
    collapsed
    tappable
    on:tap={show}
    on:dismiss={dismissChart}
    on:link={returnToCurrentPosition}>
    <div class="barChart-plot">
      {#if gridLoading}
        <div class="skeleton"><ChartSkeleton bars={25} /></div>
      {:else}
        <Timeline
          {steps}
          now={gridConfig?.now ?? 0}
          latest={cap.getMostRecentObservation()}
          value={$capTimeIndicator}
          interactive={false}
          {labelEvery} />
        {#if !hasPrecipitation}
          <p class="empty">{$_(noForecastFrom === null ? "precipitation_none" : "precipitation_none_past")}</p>
        {:else if noForecastFrom !== null}
          <p class="no-forecast" style:left={`${noForecastFrom * 100}%`}>{$_("forecast_none_here")}</p>
        {/if}
      {/if}
    </div>
  </DismissableStrip>
{/if}

{#if $bottomToolbarMode === "player"}
  <div
    class="bottomToolbar timeslider"
    transition:fly={{ y: 150, duration: 400 }}
    on:introstart={toolbarTransitionStart}
    on:outrostart={toolbarTransitionStart}
    on:introend={toolbarTransitionEnd}
    on:outroend={toolbarTransitionEnd}>
    <div class="player">
      <div class="head">
        {#if $inspectLatLon || $latLon}
          <span class="title" class:quiet={!hasPrecipitation && !gridLoading}>
            {#if !gridLoading && !hasPrecipitation}
              {$_(noForecastFrom === null ? "precipitation_none" : "precipitation_none_past")}
            {:else}
              {chartTitle}
            {/if}
          </span>
          {#if $inspectLatLon && $latLon}
            <button type="button" class="link" on:click={returnToCurrentPosition}>
              <Icon icon={faLocationCrosshairs} />
              <span>{$_("show_for_my_location")}</span>
            </button>
          {/if}
        {:else}
          <span class="title quiet">{$_("chrome.playback.controls")}</span>
        {/if}
        <button type="button" class="controlButton collapse" on:click={hide}
          title={$_("chrome.playback.collapse")} aria-label={$_("chrome.playback.collapse")}>
          <Icon icon={faAngleDoubleDown} />
        </button>
      </div>

      <div class="plot">
        {#if gridLoading && !hasPrecipitation}
          <div class="skeleton"><ChartSkeleton bars={25} /></div>
        {/if}
        <Timeline
          {steps}
          now={gridConfig?.now ?? 0}
          latest={cap.getMostRecentObservation()}
          value={shown}
          {labelEvery}
          on:grab={grabbed}
          on:seek={seek} />
        {#if !gridLoading && hasPrecipitation && noForecastFrom !== null}
          <p class="no-forecast" style:left={`${noForecastFrom * 100}%`}>{$_("forecast_none_here")}</p>
        {/if}
      </div>

      <div class="row">
        <button type="button" class="controlButton play" class:playing={$playbackRunning}
          on:click={playPause}
          title={$_("chrome.playback.play")} aria-label={$_("chrome.playback.play")}>
          <Icon icon={playPauseButton} />
        </button>
        <button type="button" class="controlButton" class:on={loop} on:click={toggleLoop}
          title={$_("chrome.playback.loop")} aria-label={$_("chrome.playback.loop")} aria-pressed={loop}>
          <Icon icon={faRetweet} />
        </button>
        <button type="button" class="chip" class:on={includeHistoric} disabled={!historicActive} on:click={toggleHistoric}
          title={$_("chrome.playback.from_start")} aria-label={$_("chrome.playback.from_start")} aria-pressed={includeHistoric}>
          <Icon icon={faHistory} />
          <span>-2h</span>
        </button>
        <!-- The frame on screen, parked or live, and the point the strip is
             about: what a link from here says (lib/urlState.ts). -->
        {#if $shareAvailable}
          <button type="button" class="controlButton"
            on:click={(event) => share({ subject: $inspectLatLon ? placeName : null, anchor: event.currentTarget })}
            title={$_("share.share")} aria-label={$_("share.share")}>
            <Icon icon={shareIcon()} />
          </button>
        {/if}
        <div class="spacer"></div>
        {#if !dd.isApp()}
          <div class="legend">
            <RadarScaleLine />
          </div>
        {/if}
        <div class="status">
          <LastUpdated />
        </div>
      </div>
    </div>
  </div>
{:else}
  {#if $sharedActiveCap === "radar"}
    {#if showOpenControls}
      <div class="buttonBar right">
        <button type="button" class="controlButton" on:click={show}
          title={$_("chrome.playback.controls")} aria-label={$_("chrome.playback.controls")}>
          <Icon icon={faAngleDoubleUp} class="controlIcon" />
        </button>
      </div>
      <div class="buttonBar">
        <button type="button" class="controlButton" on:click={showAndPlay}
          title={$_("chrome.playback.play")} aria-label={$_("chrome.playback.play")}>
          <Icon icon={faPlay} class="controlIcon" />
        </button>
      </div>
    {/if}
  {/if}
{/if}
