<script lang="ts">
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
  import { toolbarTransitionEnd, toolbarTransitionStart } from "../lib/toolbarTransition";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { faForwardStep } from "@fortawesome/free-solid-svg-icons/faForwardStep";
import { faHistory } from "@fortawesome/free-solid-svg-icons/faHistory";
import { faLocationCrosshairs } from "@fortawesome/free-solid-svg-icons/faLocationCrosshairs";
import Icon from "./Icon.svelte";
import StateMachine from "javascript-state-machine";
import { fly } from "svelte/transition";
import { onDestroy, onMount, tick } from "svelte";
import {
  sharedActiveCap,
  latLon,
  bottomToolbarMode, precacheForecast,
  dryAtUser, inspectLatLon, mapExtent4326, modelCompareAt, radarStale,
  frameRequest, playbackRunning, browsingFrames, live, openStripCount, openHintCount,
} from "../stores";

import { DeviceDetect as dd } from "../lib/DeviceDetect";
import type RadarCapability from "../caps/RadarCapability";
import type { GridConfig } from "../caps/RadarCapability";

import RadarScaleLine from "./scales/RadarScaleLine.svelte";
import RadarProductPicker from "./RadarProductPicker.svelte";
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
import { nearPlace, type NearPlace } from "../lib/reverseGeocode";
import DismissableStrip from "./DismissableStrip.svelte";
import DryOutlook from "./DryOutlook.svelte";
import { onWake } from "../lib/wakeup";
import ChartSkeleton from "./ChartSkeleton.svelte";

export let cap: RadarCapability;

let gridConfig: GridConfig | null = null;

/** How many frames ahead of playback to ask for tiles: about a second and a half of the loop. */
const PREFETCH_FRAMES = 3;

/** How long each frame of playback is on screen. */
const FRAME_MS = 450;

/** Manual subscriptions, so they are handed to onDestroy at the bottom. */
const subscriptions: (() => void)[] = [];

let oldTimeStep = 0;

/**
 * The observation the scrubber is parked on while it is still tracking the
 * live edge, or null once the user has moved away from it.
 *
 * A new grid lands every few minutes. If the scrubber is sitting on what was
 * the newest observation, it should ride forward onto the new one: that is
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
 * Set from `frameRequest` (a link naming a frame, or Back returning to one)
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

let includeHistoric = false;

/**
 * Whether playback was running when a hand took the strip, so it carries on
 * from wherever the needle is let go.
 */
let resumeOnRelease = false;

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
 * this also keeps the strip away when there is no location, instead of a
 * full-width row of zero-height bars over the map.
 */
$: hasPrecipitation = hasEcho(steps);

/**
 * Where along the track the forecast starts, as a fraction, when there is none
 * at the point being asked about; null whenever there is one, or nothing at
 * all. Flat bars there would say "dry" when the truth is "no forecast".
 */
$: noForecastFrom = forecastGapFrom(steps);

/**
 * Whether any of what is on screen has radar behind it.
 *
 * meteocool's live radar is DWD's composite plus MeteoSwiss's and
 * Meteo-France's, which stop at Germany, Switzerland, France and the reach
 * around them; every other layer is global. Someone opening the app on holiday
 * sees an empty map and no reason for it, which reads as the app being broken
 * rather than as a coverage boundary. Answered from the layers' own extents, so
 * it cannot drift from what gets drawn.
 *
 * Only when the viewport misses the box entirely: half a screen of coverage
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

/* Whether the player's strip has something to say: rain at the client's
   position, or a tapped point, which always gets an answer, even a flat one. */
$: chartShowable = (hasPrecipitation || $inspectLatLon !== null)
  && $sharedActiveCap === "radar"
  && !outOfCoverage;

/**
 * The same slot on a dry day: what the weather models say for the client's
 * own position, when the radar has nothing for it (see DryOutlook).
 *
 * Only when the rain chart has nothing to say (which it cannot, over a dry
 * position with no tapped point), and only for a position the radar covers:
 * outside every network "nothing on the radar" is no data, not no rain.
 * Dismissal lasts as long as the dry spell does. It stands aside while the
 * player is away from the live frame, and comes back on the way back to it
 * unless it was dismissed. A failed forecast
 * fetch takes it down until the page next wakes (the network back, the page
 * looked at again), at most once a minute. Taken down for the session, one
 * dropped request on a train would lose the strip until a reload.
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
  // Nor while the player is off the live frame: the reader is stepping through
  // the radar's frames, and what the models say about the coming days is not
  // one of them.
  && $live
  && !$playbackRunning;
$: if (!$dryAtUser) outlookDismissed = false;

/* Between a tap and the grid that answers it, the strip is up with the last
   point's bars still in it. Flagged here rather than read off the capability,
   because what matters is that the numbers on screen are about somewhere
   else, not that a request happens to be open. */
let gridLoading = false;

/**
 * The name of where the strip is about, for the title, once it comes back:
 * the tapped point, or else the client's own position.
 *
 * The token guards against a slow lookup for an abandoned point landing after
 * a fast one for the current point: the request is aborted too, but an abort
 * that arrives late still resolves.
 */
let place: NearPlace | null = null;
let placeToken = 0;

async function resolvePlace(
  point: [number, number] | null,
  language: string | null | undefined,
) {
  const token = ++placeToken;
  if (!point) {
    place = null;
    return;
  }
  const found = await nearPlace(point[0], point[1], language ?? "en", "forecast");
  // A position that moves keeps its old name until the new one is in, rather
  // than blinking back to the generic title on every fix.
  if (token === placeToken) place = found;
}

$: resolvePlace($inspectLatLon ?? $latLon, $locale);
/* A tap is somewhere else: its title starts over rather than naming the last place. */
function forgetPlace(_point: [number, number] | null) { place = null; }
$: forgetPlace($inspectLatLon);

/* The place name is the title once there is one: a heading that says where, in
   a panel whose whole subject is already precipitation. Until then the strip
   says what it is instead. */
$: placeTitle = place
  ? (place.district && withDistrict ? `${place.district}, ${place.name}` : place.name)
  : null;
$: chartTitle = placeTitle
  ?? $_($inspectLatLon ? "precipitation_at_point" : "precipitation_here");

/**
 * Whether the district fits in the head beside the name. Tried whenever the
 * name or the head's width changes, and dropped for the bare name if the
 * title would cut it off; before a paint, so the long form never shows cut.
 */
let head: HTMLDivElement;
let titleEl: HTMLSpanElement | undefined;
let withDistrict = true;
let headObserver: ResizeObserver | undefined;
async function fitTitle(_place?: NearPlace | null) {
  withDistrict = true;
  await tick();
  if (titleEl && titleEl.scrollWidth > titleEl.clientWidth) withDistrict = false;
}
$: fitTitle(place);
$: if (head) {
  headObserver?.disconnect();
  headObserver = new ResizeObserver(() => fitTitle());
  headObserver.observe(head);
}

/**
 * Back to sampling the client's own position, or to none: the marker exists
 * to feed the strip, so clearing it is also how a tapped point is let go.
 */
function returnToCurrentPosition() {
  inspectLatLon.set(null);
}

subscriptions.push(inspectLatLon.subscribe(() => { gridLoading = true; }));

/* Same reason as a tap: the bars on screen are about a different moment. The
   whole strip is laid out around "now", so once the clock has moved past the
   grid's own the axis under those bars is wrong and not just their age. Only
   the rising edge: the grid that clears radarStale also clears this. */
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
      // until the user drags it somewhere else, unless it was opened to show
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
    },
    onPressPlay: (_transition, firstDelayMs = 0) => {
      const playTick = () => {
        // Pause and close both cancel playTimeout; a tick that outlives them
        // would otherwise resume playback on its own.
        if (fsm.state !== "playing") return;
        let thisFrameDelayMs = FRAME_MS;
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
        // "preload forecast" switch.
        if ($precacheForecast) cap.prefetchFrames(shown, PREFETCH_FRAMES);
        // Always round again: a loop that stops at the end only ever asked
        // for another press of play.
        playTimeout = window.setTimeout(playTick, thisFrameDelayMs);
      };
      // From a timer rather than from here: a pause inside this transition
      // throws, leaving the machine mid-transition for good. A resume after a
      // drag waits a frame's length first, so the frame let go on is seen.
      playTimeout = window.setTimeout(playTick, firstDelayMs);
      playPauseButton = faPause;
    },
    onPressPause: () => {
      if (playTimeout !== 0) window.clearTimeout(playTimeout);
      playTimeout = 0;
      playPauseButton = faPlay;
    },
    // Entering and leaving the state rather than the transitions into it:
    // playback ends by pause and by close alike, and this cannot miss either.
    onEnterPlaying: () => {
      playbackRunning.set(true);
      browsingFrames.set(true);
    },
    onLeavePlaying: () => playbackRunning.set(false),
    onHideScrollbar: (transition) => {
      // Set unconditionally, before the early return. A hide() that arrives
      // while the machine is already in followLatest (the idle-refocus
      // handler below, or the capability's loseFocus event) would otherwise
      // leave bottomToolbarMode on "player" with nothing left that can move it
      // back: the tray stays open and its close button does nothing, because
      // every later hide() takes this same early return.
      bottomToolbarMode.set("collapsed");
      browsingFrames.set(false);
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
 * The player is the radar's bottom tray, so it is open whenever the radar is
 * the map on screen: there is no collapsed bar to fold it into. Not when a
 * link or a screenshot has hidden the toolbar.
 */
function open() {
  if (get(sharedActiveCap) !== "radar" || get(bottomToolbarMode) === "hidden") return;
  show();
}

subscriptions.push(sharedActiveCap.subscribe(() => open()));

/**
 * Whether the map is parked on an earlier or later frame than the live one.
 *
 * The player is always open, so being in it says nothing; what matters is
 * that the map shows a frame other than now, and with it none of what only
 * the live frame carries (the cells, the 3D tags). Not while playing, which
 * is passing through frames on purpose, nor while stale, where the radar is
 * behind rather than the reader.
 */
$: offLive = $bottomToolbarMode === "player" && $sharedActiveCap === "radar"
  && !$live && !$playbackRunning && !$radarStale && gridConfig !== null;

/**
 * `offLive`, slow to let go: a drag back and forth across now passes the live
 * frame for a step at a time, and a pill dropped and brought back on each
 * would jump. Shown at once; hidden only once it has stayed back on live a
 * moment.
 */
const BACK_TO_LIVE_LINGER_MS = 120;
let showBackToLive = false;
let backToLiveTimer: number | undefined;
$: settleBackToLive(offLive);
function settleBackToLive(off: boolean) {
  window.clearTimeout(backToLiveTimer);
  if (off) {
    showBackToLive = true;
    return;
  }
  backToLiveTimer = window.setTimeout(() => { showBackToLive = false; }, BACK_TO_LIVE_LINGER_MS);
}

/** Back onto the live frame, the player still open. */
function returnToLive() {
  hide();
  cap.resetToLatest();
  open();
}

/**
 * Open on the frame something outside the player asked for.
 *
 * Waits for a grid, because only the grid can say whether the frame exists: a
 * link names an absolute time, and one opened hours later names a frame the
 * window has moved past. That, the live frame itself, and anything with no
 * tiles behind it all leave the player where it is (following live), which
 * is the honest answer to "show me a moment we no longer have".
 */
function takeFrameRequest() {
  const wanted = get(frameRequest);
  if (wanted === null || !gridConfig) return;
  frameRequest.set(null);
  if (wanted === "live") {
    returnToLive();
    return;
  }
  if (!gridConfig.grid[wanted]?.url || wanted === cap.getMostRecentObservation()) return;
  resumeOnRelease = false;
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

function hide() {
  resumeOnRelease = false;
  if (playTimeout !== 0) window.clearTimeout(playTimeout);
  playTimeout = 0;
  fsm.hideScrollbar();
}

// Recorded when the grid updates; not currently rendered.
let _latest: number;

onMount(async () => {
  window.leaveForeground = () => {
    awayAt ??= Date.now();
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

  // Both callers land here (a drag and a playback tick), so this is the one
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

/**
 * A hand on the strip: playback holds while the hand has it, and picks up
 * again from wherever it is let go (see `released`).
 */
function grabbed() {
  browsingFrames.set(true);
  if (fsm.state === "playing") {
    console.log("Holding playback for a grab on the timeline");
    resumeOnRelease = true;
    fsm.pressPause();
  }
}

/** The needle is at rest again: playback, if a grab held it, goes on from there. */
function released() {
  if (!resumeOnRelease) return;
  resumeOnRelease = false;
  if (fsm.state === "manualScrolling") fsm.pressPlay(FRAME_MS);
}

/** The needle has reached another step. */
function seek(event: CustomEvent<number>) {
  shown = event.detail;
  sliderChangedHandler(event.detail, true);
}

function playPause() {
  resumeOnRelease = false;
  if (fsm.state === "playing") {
    console.log("Pausing due to button");
    fsm.pressPause();
  } else if (fsm.state === "manualScrolling") {
    fsm.pressPlay();
  }
}

function toggleHistoric() {
  includeHistoric = !includeHistoric;
}

/**
 * Back from five minutes or more away, the map is on now again, whatever frame
 * it was left on. A frame from before is no longer what anyone opening the app
 * is asking about, and everything that only the live frame carries (the
 * cells, the 3D tags) would be missing with no reason given.
 *
 * Away is timed from `leaveForeground`, which the native apps and the page's
 * own hiding both call, because the native foreground does not say how long it
 * was; and from what the wake itself says, which covers a device that slept
 * with the page still showing.
 */
const RETURN_TO_LIVE_AFTER_MS = 5 * 60 * 1000;
let awayAt: number | null = null;
function cameBack(awayMs: number | null) {
  const away = Math.max(awayAt === null ? 0 : Date.now() - awayAt, awayMs ?? 0);
  awayAt = null;
  if (away >= RETURN_TO_LIVE_AFTER_MS && cap.trackingMode !== "live") returnToLive();
}
subscriptions.push(onWake((_reason, awayMs) => cameBack(awayMs)));
/* Every return, not only those long enough to be a wake: one too short for
   that has to clear the time it left, or the next wake, however unrelated
   (the network coming back), would count from it. */
const onVisible = () => { if (document.visibilityState === "visible") cameBack(null); };
document.addEventListener("visibilitychange", onVisible);
subscriptions.push(() => document.removeEventListener("visibilitychange", onVisible));

onDestroy(() => {
  subscriptions.forEach((unsubscribe) => unsubscribe());
  if (playTimeout !== 0) window.clearTimeout(playTimeout);
  window.clearTimeout(backToLiveTimer);
  headObserver?.disconnect();
  playbackRunning.set(false);
  browsingFrames.set(false);
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
     The player, three rows at every size:

         head      where the strip's numbers are from, and the product picker
         timeline  the strip: forecast bars, needle, axis
         row       transport and the colour scale
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
  /* The colour scale takes what the transport leaves of the row. */
  .legend {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 4px;
  }
  .product-pill {
    flex: 0 0 auto;
    display: inline-flex;
  }

  /* A tint on the tray. */
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
  /* Letting a tapped point go: smaller than the transport, like a close disc. */
  .controlButton.clear {
    width: 30px;
    height: 30px;
    font-size: 13px;
    color: var(--mc-text-3);
  }
  .controlButton.clear:hover { color: var(--mc-text); }

  /* "-2h": whether the loop runs from the start of the strip or from now.
     The same height as the play disc beside it, so the two read as one row of
     controls rather than a disc and a smaller tag. */
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
  .chip :global(svg) { width: 14px; height: 14px; }

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

  /* No forecast at the point being asked about. Sits over the ruler rather
     than replacing it, so the strip keeps its height and the needle still has
     a track, and over the forecast half only. */
  .no-forecast {
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
  .skeleton {
    position: absolute;
    inset: 0 0 16px;
  }

  /* The way back to now, centred a gap above the top of the stack over the
     tray: the strips (a coverage notice, a chart) and the selected cell's bar,
     each a fixed height plus the gap it floats above. Never under any of them,
     so it is always there to tap. Moves with the stack the way the cell's bar
     does. A row the width of the screen that lets touches through, so the pill
     can be centred without a transform the fly transition would overwrite. */
  .back-to-live {
    position: absolute;
    left: var(--mc-gutter);
    right: var(--mc-gutter);
    bottom: calc(
      var(--mc-tray-bottom) + var(--mc-player-h) + var(--mc-tray-gap)
      + var(--open-strips, 0) * (var(--mc-strip-h) + var(--mc-tray-gap))
      + var(--open-hints, 0) * (var(--mc-hint-h) + var(--mc-tray-gap))
    );
    z-index: var(--mc-z-pill);
    display: flex;
    justify-content: center;
    pointer-events: none;
    transition: bottom var(--mc-motion-spring) var(--mc-ease-spring);
  }
  @media (prefers-reduced-motion: reduce) {
    .back-to-live { transition: none; }
  }
  .back-to-live button {
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px;
    font: 600 13px/1 var(--mc-font);
    letter-spacing: -0.01em;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background-color var(--mc-motion-fast), color var(--mc-motion-fast),
                transform var(--mc-motion-fast) var(--mc-ease);
  }
  .back-to-live button:hover { background: var(--mc-glass-fill-strong); color: var(--mc-accent); }
  .back-to-live button:active { transform: scale(var(--mc-press)); }
  .back-to-live button:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: 2px; }
  .back-to-live :global(svg) { width: 12px; height: 12px; color: var(--mc-accent); }

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

{#if showBackToLive}
  <div class="back-to-live" style:--open-strips={$openStripCount} style:--open-hints={$openHintCount}>
    <button type="button" class="glass glass-pill" on:click={returnToLive}
      transition:fly={{ y: 12, duration: 200 }}>
      <span>{$_("chrome.playback.back_to_latest")}</span>
      <Icon icon={faForwardStep} />
    </button>
  </div>
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
      <div class="head" bind:this={head}>
        {#if $inspectLatLon || $latLon}
          <span class="title" bind:this={titleEl}>{chartTitle}</span>
          {#if $inspectLatLon && $latLon}
            <button type="button" class="link" on:click={returnToCurrentPosition}>
              <Icon icon={faLocationCrosshairs} />
              <span>{$_("show_for_my_location")}</span>
            </button>
          {/if}
        {:else}
          <span class="title quiet">{$_("chrome.playback.controls")}</span>
        {/if}
        <!-- The legend's caption, up here rather than in the row of controls,
             which has no room left on a phone. -->
        <span class="product-pill"><RadarProductPicker variant="pill" /></span>
        {#if $inspectLatLon && !$latLon}
          <button type="button" class="controlButton clear" on:click={returnToCurrentPosition}
            title={$_("close")} aria-label={$_("close")}>
            <Icon icon={faXmark} />
          </button>
        {/if}
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
          on:release={released}
          on:seek={seek} />
        {#if !gridLoading && noForecastFrom !== null}
          <p class="no-forecast" style:left={`${noForecastFrom * 100}%`}>{$_("forecast_none_here")}</p>
        {/if}
      </div>

      <div class="row">
        <button type="button" class="controlButton play" class:playing={$playbackRunning}
          on:click={playPause}
          title={$_("chrome.playback.play")} aria-label={$_("chrome.playback.play")}>
          <Icon icon={playPauseButton} />
        </button>
        <button type="button" class="chip" class:on={includeHistoric} on:click={toggleHistoric}
          title={$_("chrome.playback.from_start")} aria-label={$_("chrome.playback.from_start")} aria-pressed={includeHistoric}>
          <Icon icon={faHistory} />
          <span>-2h</span>
        </button>
        <div class="legend">
          <RadarScaleLine />
        </div>
      </div>
    </div>
  </div>
{/if}
