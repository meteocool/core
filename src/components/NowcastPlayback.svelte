<script module lang="ts">
/** The notices dismissed this session (lib/noticeQueue.ts): kept if the player is built again, gone on a reload. */
let sessionDismissed = new Set<string>();
</script>

<script lang="ts">
import { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
  import { toolbarTransitionEnd, toolbarTransitionStart } from "../lib/toolbarTransition";
import { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
import { faXmark } from "@fortawesome/free-solid-svg-icons/faXmark";
import { faClockRotateLeft } from "@fortawesome/free-solid-svg-icons/faClockRotateLeft";
import { faLocationCrosshairs } from "@fortawesome/free-solid-svg-icons/faLocationCrosshairs";
import Icon from "./Icon.svelte";
import StateMachine from "javascript-state-machine";
import { fly } from "svelte/transition";
import { onDestroy, onMount, tick } from "svelte";
import {
  sharedActiveCap,
  latLon,
  bottomToolbarMode, precacheForecast,
  dryAtUser, inspectLatLon, mapExtent4326, modelCompareAt, radarStale, onForecastStep,
  frameRequest, playbackRunning, browsingFrames, live, openStripCount, openHintCount, playbackFromStart,
  nowcastCoverage, framesPreloaded, networkStatus, siteMode, siteSweepView, cellLayerVisible, stationLayerVisible,
  drawnEncoding, archiveWindow, archivePickerOpen, stalledNetworks,
} from "../stores";

import { DeviceDetect as dd } from "../lib/DeviceDetect";
import type RadarCapability from "../caps/RadarCapability";
import type { GridConfig } from "../caps/RadarCapability";

import RadarScaleLine from "./scales/RadarScaleLine.svelte";
import StormKey from "./StormKey.svelte";
import RadarProductPicker from "./RadarProductPicker.svelte";
import SiteSweepTray from "./SiteSweepTray.svelte";
import StationToggle from "./StationToggle.svelte";
import StationPicker from "./StationPicker.svelte";
import { fadeEdges } from "../lib/fadeEdges";
import VelocityScaleLine from "./scales/VelocityScaleLine.svelte";
import ColumnScaleLine from "./scales/ColumnScaleLine.svelte";
import { isColumnEncoding } from "../lib/columnValues";
import LiveIndicator from "./LiveIndicator.svelte";
import Appendix from "./Appendix.svelte";
import Timeline from "./Timeline.svelte";
import { _, locale } from "svelte-i18n";
import { get } from "svelte/store";
import { forecastGapFrom, hasEcho, timelineSteps } from "../lib/timeline";
import {
  beRadarExtent4326,
  chRadarExtent4326,
  czRadarExtent4326,
  dkRadarExtent4326,
  dwdCoverageInv,
  dwdRadarExtent4326,
  eeRadarExtent4326,
  fiRadarExtent4326,
  frRadarExtent4326,
  hrRadarExtent4326,
  ieRadarExtent4326,
  ltRadarExtent4326,
  nlRadarExtent4326,
  noRadarExtent4326,
  plRadarExtent4326,
  seRadarExtent4326,
  skRadarExtent4326,
} from "../layers/extents";
import { saysNoForecast, uncoveredShare } from "../lib/forecastCoverage";
import { saysFeedStopped } from "../lib/feedOutage";
import { statusVerdict } from "../lib/statusFeed";
import { dismissalKey, nextNotice, rearmed, type Candidates, type QueuedNotice } from "../lib/noticeQueue";
import { drawnByDomains } from "../layers/statusCoverage";
import { viewCentre } from "../lib/status";
import { preloadMode } from "../lib/framePreload";
import type { PreloadMode } from "../lib/framePreload";
import { holdsForTiles, playOrder, shouldAdvance, waitLeft } from "../lib/playbackGate";
import { uploadAheadSteps } from "../lib/gpuBudget";
import { drawnByAny } from "../layers/networkAt";
import type { CountryNetwork } from "../api/events";
import { canPlay, nearestStep, nextFrame } from "../lib/playbackLoop";
import { listedFor, stepsWithSweep, tiltNear } from "../lib/siteSweeps";
import Polygon from "ol/geom/Polygon";
import { fromLonLat } from "ol/proj";
import { nearPlace, type NearPlace } from "../lib/reverseGeocode";
import DismissableStrip from "./DismissableStrip.svelte";
import DryOutlook from "./DryOutlook.svelte";
import { onWake } from "../lib/wakeup";
import { outlookSnoozed, snoozeOutlook } from "../lib/outlookDismissal";
import ChartSkeleton from "./ChartSkeleton.svelte";
import ArchivePill from "./ArchivePill.svelte";
import ArchivePicker from "./ArchivePicker.svelte";
import { frameInWindow, inWindow, nextWindowFrame, sameWindow, windowSteps } from "../lib/archive";

export let cap: RadarCapability;

let gridConfig: GridConfig | null = null;

/**
 * The past window the strip is of (lib/archive.ts), or null live. The
 * grid's, not the store's: between opening a window and its grid landing,
 * the strip on screen is still the last one.
 */
$: past = gridConfig?.window ?? null;

/**
 * An echo top's or VIL's encoding while one is drawn on the step on screen,
 * whose legend is its own; null for reflectivity. Not in site mode, whose
 * sweep is the radar the legend is for.
 */
$: columnEncoding = !$siteMode && isColumnEncoding($drawnEncoding) ? $drawnEncoding : null;

/** On a slow or data-saving connection, how many frames ahead of playback are preloaded: about a second and a half of the loop. */
const PRELOAD_AHEAD_SLOW = 3;

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
 * A tick holding the frame on screen for the next one's tiles; aborted by
 * pause and close, so a wait that outlives them moves nothing on. Nothing
 * is uploaded ahead for the steps that would have come next either.
 */
let readyWait: AbortController | null = null;
function stopWaiting() {
  readyWait?.abort();
  readyWait = null;
  cap?.prepareSteps([]);
}

/** How many steps after the one shown have their tiles uploaded ahead (`RadarCapability.prepareSteps`). */
const UPLOAD_AHEAD = uploadAheadSteps();

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
 * The second park, pending. A reader who moves the needle before it runs
 * has put it where they want it: on a slow device the timer can come late,
 * and would throw their first steps back to live.
 */
let parkTimer: number | undefined;
function cancelPark() {
  window.clearTimeout(parkTimer);
  parkTimer = undefined;
  seekTo = null;
}

/**
 * The step the player is on, unix seconds: what the needle sits on and what
 * a playback tick advances. Zero until the player has been opened.
 */
let shown = 0;
/** Where playback was started from: where a loop over the past goes back to. */
let loopFrom = 0;

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

/**
 * The newest observation, where the strip draws "now". Recomputed with each
 * new grid: read straight off the capability in the markup, it was taken once,
 * before the first grid had come in, and the line sat on the strip's first
 * step for good.
 */
$: latestObservation = gridConfig ? cap.getMostRecentObservation() : 0;

/** The strip's bars, oldest first, cut where the scrubber stops. */
$: steps = gridConfig && lastPlayableStep !== undefined ? timelineSteps(gridConfig, lastPlayableStep) : [];

/**
 * Whether there is anything worth plotting: a step with measurable echo at the
 * client's position. Every dbz is null until a position has been shared, so
 * this also keeps the strip away when there is no location, instead of a
 * full-width row of zero-height bars over the map.
 */
$: hasPrecipitation = hasEcho(steps);
/* With none, the strip is a bare ruler and shrinks to suit (--mc-plot-h in src/glass.css). */
$: document.documentElement.classList.toggle("plot-dry", !hasPrecipitation);

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
  beRadarExtent4326,
  skRadarExtent4326,
  ltRadarExtent4326,
  eeRadarExtent4326,
  ieRadarExtent4326,
  hrRadarExtent4326,
  dkRadarExtent4326,
  nlRadarExtent4326,
  fiRadarExtent4326,
  seRadarExtent4326,
  noRadarExtent4326,
];

$: outOfCoverage = $sharedActiveCap === "radar"
  && $mapExtent4326 !== null
  && !radarExtents4326.some((extent) => overlaps(extent, $mapExtent4326));

/* DWD's reach, the hole in the wash a forecast step draws (dwd.ts). */
const forecastReach = new Polygon([dwdCoverageInv.getLinearRing(1)!.getCoordinates()]);
/** Whether a forecast draws at a point: WN in DWD's reach, or one of these networks' nowcast runs on its own ground. */
const forecastCovers = (runs: readonly CountryNetwork[]) => (lon: number, lat: number): boolean => {
  const point = fromLonLat([lon, lat]);
  return forecastReach.intersectsCoordinate(point) || drawnByAny(runs, point);
};

/**
 * On a forecast step, whether none of the screen has a forecast behind it.
 *
 * WN is DWD's. Over France or Poland the present has radar and a forecast
 * step washes it all out, which reads as "no rain coming". With meteocool's
 * nowcast on, a network whose run has a lead at the step covers its ground
 * too, so only what no run covers counts. Only for the whole screen: where
 * any of it has a forecast, the forecast shows where. The radar's own notice
 * comes first; with no radar there is no forecast either.
 */
$: forecastReachable = $sharedActiveCap === "radar" && $mapExtent4326 !== null && !outOfCoverage;
$: runsAtAll = $nowcastCoverage?.withRun ?? [];
$: runsShown = $nowcastCoverage?.shown ?? [];
/* With any run: whether playback has anything past now to show. */
$: anyForecastMissing = forecastReachable && $mapExtent4326 ? uncoveredShare($mapExtent4326, forecastCovers(runsAtAll)) : 0;
/* With the runs that have the step on screen: the notice. The same sum, unless the two differ. */
$: forecastMissing = !forecastReachable || !$mapExtent4326 ? 0
  : runsShown.join() === runsAtAll.join() ? anyForecastMissing
    : uncoveredShare($mapExtent4326, forecastCovers(runsShown));
$: outOfForecast = $onForecastStep && saysNoForecast(forecastMissing);
/* The share of the screen drawn by a network whose radar has stopped
   arriving (lib/feedOutage.ts, or the backend's status, which can blame
   DWD's too): there the map's present is the last picture that came, and
   the nowcast has no run, so the player says the weather service's data is
   not coming in rather than "No Forecast Here". */
$: stalledShare = !forecastReachable || !$mapExtent4326 || $stalledNetworks.length === 0 ? 0
  : 1 - uncoveredShare($mapExtent4326, (lon, lat) => drawnByDomains($stalledNetworks, lon, lat));
$: stalledAtCentre = stalledShare > 0 && $mapExtent4326 !== null
  && drawnByDomains($stalledNetworks, ...viewCentre($mapExtent4326));
$: feedStopped = saysFeedStopped(stalledShare, outOfForecast, stalledAtCentre);
/* The forecast not being made where the radar is arriving, by the backend's
   status alone: the map cannot tell a forecast that is late from one that
   was never made. Over as much of the screen as the radar's notice, by the
   same rule. */
$: forecastStopped = forecastReachable && $statusVerdict !== null
  && saysFeedStopped($statusVerdict.forecastStopped, outOfForecast, $statusVerdict.forecastStoppedAtCentre);
/* None of the screen: playback has nothing to show past now (playbackLoop). */
$: noForecast = anyForecastMissing === 1;

/*
 * With a radar open, the steps it has a sweep for at the tilt on screen:
 * playback steps through those alone (playbackLoop), the strip hatches the
 * rest and the needle stays out of them. Null with none open, before its
 * listing is in (the view still holds the radar open before it), or with
 * none in the strip's hours, when there is nothing to keep it to.
 */
$: sweepSteps = $siteMode && $siteSweepView?.site.site === $siteMode.site
  ? nonEmpty(stepsWithSweep(
    tiltNear(listedFor($siteSweepView.site, $siteMode.quantity), $siteMode.elevation)?.scans ?? [],
    steps.map((step) => step.t),
    latestObservation,
  ))
  : null;
const nonEmpty = (list: number[]) => (list.length ? list : null);

/* The strip as the needle sees it: with a radar open, its sweepless steps out of reach. */
$: stripSteps = sweepSteps ? steps.map((step) => (sweepSteps.includes(step.t) ? step : { ...step, noSweep: true })) : steps;

/*
 * A radar opened on a step it has no sweep for: the player moves to one, as
 * the needle would not have stopped there. Outside its sweeps' hours (a
 * forecast step, or a link's time the radar has since moved past) that is
 * its newest, the live edge; in a gap between them, the nearest.
 */
$: keepToSweeps(sweepSteps);
function keepToSweeps(only: number[] | null) {
  if (!only || fsm.state !== "manualScrolling" || !shown || only.includes(shown)) return;
  const inside = shown > only[0] && shown < only[only.length - 1];
  shown = inside ? nearestStep(only, shown) : only[only.length - 1];
  sliderChangedHandler(shown);
}

/* In a past window anything with two frames plays, round and round it. */
$: playable = past ? steps.filter((step) => step.playable).length > 1 : canPlay({
  outOfRadar: outOfCoverage,
  noForecast,
  // 0 until the scrubber is first moved: the player is following the live frame.
  shown: shown || latestObservation,
  latestObservation,
  only: sweepSteps,
});

/**
 * Every frame's tiles decoded ahead for the map in view, nearest the needle
 * first, and drawn filling the timeline (lib/framePreload.ts): once the
 * reader starts moving through frames, until the player is back on live.
 * Planned again whenever the map settles, the needle moves or the frames
 * change. The setting is the "preload forecast" switch.
 */
function currentPreloadMode(): PreloadMode {
  return preloadMode({
    setting: $precacheForecast,
    radarShown: $sharedActiveCap === "radar" && !outOfCoverage && steps.length > 0,
    browsing: $browsingFrames,
    playing: $playbackRunning,
    slow: $networkStatus.isSlow,
  });
}
/**
 * The step playback shows after `from`, by the loop's rules (lib/playbackLoop.ts,
 * or a past window's).
 */
function stepAfter(from: number, grid: GridConfig): number {
  return grid.window ? nextWindowFrame(from, grid.window, lastPlayableStep ?? grid.end) : nextFrame({
    shown: from,
    latestObservation: cap.getMostRecentObservation(),
    now: grid.now,
    lastStep: lastPlayableStep ?? grid.end,
    start: grid.start,
    loopFrom,
    fromStart: $playbackFromStart,
    noForecast,
    only: sweepSteps,
  });
}
/**
 * Plan the preload in `mode` from `from`: that step first, or the few after
 * it. While playing, in the order the loop will show them, so what is
 * decoded is what comes next and the steps the loop never visits are not.
 */
function planPreload(mode: PreloadMode, from: number): void {
  const grid = gridConfig;
  const order = $playbackRunning && grid ? playOrder(from, (step) => stepAfter(step, grid), steps.length + 1) : undefined;
  if (mode === "all") cap.preloadTimeline(from, { order });
  else if (mode === "ahead") cap.preloadTimeline(from, { ahead: PRELOAD_AHEAD_SLOW, order });
  // No frame's tiles, every frame's preview.
  else if (mode === "previews") cap.preloadTimeline(from, { ahead: 0 });
  else cap.stopPreload();
}
function preload(..._changed: unknown[]): void {
  planPreload(currentPreloadMode(), shown);
}
$: preload(shown, steps, $mapExtent4326, $precacheForecast, $sharedActiveCap, outOfCoverage,
  $browsingFrames, $playbackRunning, $networkStatus.isSlow);
/* A hidden page fetches nothing more; back on it, the rest. */
subscriptions.push(onWake(() => preload()));

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
 * Closing it keeps it away for a day, across reloads (see
 * lib/outlookDismissal.ts). It stands aside while the
 * player is away from the live frame, and comes back on the way back to it
 * unless it was dismissed. A failed forecast
 * fetch takes it down until the page next wakes (the network back, the page
 * looked at again), at most once a minute. Taken down for the session, one
 * dropped request on a train would lose the strip until a reload.
 */
const covers = (point: [number, number] | null): boolean => point !== null
  && radarExtents4326.some(([minLon, minLat, maxLon, maxLat]) => (
    point[1] >= minLon && point[1] <= maxLon && point[0] >= minLat && point[0] <= maxLat));
let outlookDismissed = outlookSnoozed();
let outlookUnavailable = false;
let outlookFailedAt = 0;
const OUTLOOK_RETRY_MS = 60_000;
subscriptions.push(onWake(() => {
  if (outlookUnavailable && Date.now() - outlookFailedAt >= OUTLOOK_RETRY_MS) outlookUnavailable = false;
  // A page left open past the day is offered the strip again on its way back.
  if (outlookDismissed && !outlookSnoozed()) outlookDismissed = false;
}));
function dismissOutlook() {
  snoozeOutlook();
  outlookDismissed = true;
}
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

/**
 * The one notice in the slot above the tray (lib/noticeQueue.ts): ours for
 * this view first, then what the map finds for itself, a dismissed one
 * yielding to the next. A condition dismissed comes back once it has
 * cleared and returns; ours stay dismissed by id until a reload. The dry
 * outlook keeps its own day-long snooze (lib/outlookDismissal.ts).
 */
$: candidates = {
  ours: $statusVerdict?.notices ?? [],
  noCoverage: outOfCoverage,
  radarStopped: feedStopped,
  forecastStopped,
  noForecast: outOfForecast,
  dryOutlook: outlookShowable && !outlookDismissed && $latLon !== null,
} satisfies Candidates;
let dismissed: ReadonlySet<string> = sessionDismissed;
function rearm(applying: Candidates) {
  const kept = rearmed(dismissed, applying);
  if (kept.size !== dismissed.size) dismissed = sessionDismissed = kept;
}
$: rearm(candidates);
$: shownNotice = nextNotice(candidates, dismissed);

function dismissNotice(notice: QueuedNotice) {
  if (notice.kind === "dry-outlook") {
    dismissOutlook();
    return;
  }
  dismissed = sessionDismissed = new Set([...dismissed, dismissalKey(notice)]);
}

/** A strip's heading and text, by what it is about. */
function noticeWords(notice: QueuedNotice, nowcast: boolean): { title: string; body: string } {
  switch (notice.kind) {
    case "ours":
      return { title: $_(notice.notice.level === "warning" ? "notice_warning" : "notice_info"), body: notice.notice.text };
    case "no-coverage":
      return { title: $_("radar_no_coverage"), body: $_("radar_no_coverage_body") };
    case "radar-stopped":
      return { title: $_("radar_feed_stopped"), body: $_("radar_feed_stopped_body") };
    case "forecast-stopped":
      return { title: $_("forecast_feed_stopped"), body: $_("forecast_feed_stopped_body") };
    default:
      return {
        title: $_("forecast_no_coverage"),
        body: $_(nowcast ? "forecast_no_coverage_body_nowcast" : "forecast_no_coverage_body"),
      };
  }
}
$: words = shownNotice && shownNotice.kind !== "dry-outlook" ? noticeWords(shownNotice, $nowcastCoverage !== null) : null;

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

function updateSliderToLatest(config: GridConfig | null) {
  // Never mid-playback: that would throw a running sequence back to now.
  if (fsm.state === "playing") return;
  // A past window has no live edge to follow.
  if (config?.window) return;
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
        // A past window's newest step, which nothing else puts on the map:
        // following, there is the newest frame live, but nothing in one.
        if (gridConfig?.window) {
          shown = cap.getMostRecentObservation();
          sliderChangedHandler(shown);
          return;
        }
        liveEdge = cap.getMostRecentObservation();
        shown = liveEdge;
      };
      park();
      window.clearTimeout(parkTimer);
      parkTimer = window.setTimeout(() => {
        parkTimer = undefined;
        park();
        seekTo = null;
      }, 200);
    },
    onPressPlay: (_transition, firstDelayMs = 0) => {
      /** Put `target` on screen, and the next tick after it. */
      const advance = (target: number, from: number) => {
        shown = target;
        sliderChangedHandler(shown);
        const grid = gridConfig;
        if (grid) cap.prepareSteps(playOrder(target, (step) => stepAfter(step, grid), UPLOAD_AHEAD + 1).slice(1));
        // Always round again: a loop that stops at the end only ever asked
        // for another press of play.
        playTimeout = window.setTimeout(playTick, from === 0 ? 800 : FRAME_MS);
      };
      /**
       * Move on to `target` once its tiles for the map in view are decoded,
       * holding the frame on screen meanwhile, but no longer than
       * READY_TIMEOUT_MS from `started` (lib/playbackGate.ts). Asked again
       * after each wait: the map may have moved, and the step need other tiles.
       */
      const hold = (target: number, from: number, started: number, mode: PreloadMode) => {
        if (fsm.state !== "playing") return;
        const waited = performance.now() - started;
        if (!holdsForTiles(mode, cap.mapMoving) || shouldAdvance(cap.stepReady(target), waited)) {
          advance(target, from);
          return;
        }
        // The preloader goes for that step first.
        if (readyWait === null) planPreload(mode, target);
        const wait = new AbortController();
        readyWait = wait;
        cap.whenStepReady(target, waitLeft(waited), wait.signal).then(() => {
          if (wait.signal.aborted) return;
          hold(target, from, started, mode);
        });
      };
      const playTick = () => {
        // Pause and close both cancel playTimeout; a tick that outlives them
        // would otherwise resume playback on its own.
        if (fsm.state !== "playing") return;
        if (!gridConfig) return;
        readyWait = null;
        hold(stepAfter(shown, gridConfig), shown, performance.now(), currentPreloadMode());
      };
      // From a timer rather than from here: a pause inside this transition
      // throws, leaving the machine mid-transition for good. A resume after a
      // drag waits a frame's length first, so the frame let go on is seen.
      loopFrom = shown;
      playTimeout = window.setTimeout(playTick, firstDelayMs);
      playPauseButton = faPause;
    },
    onPressPause: () => {
      if (playTimeout !== 0) window.clearTimeout(playTimeout);
      playTimeout = 0;
      stopWaiting();
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

/** A hand is on the timeline: from the grab until the needle is at rest. */
let scrubbing = false;

/**
 * Whether the map is away from the live frame, parked on another or playing.
 *
 * The player is always open, so being in it says nothing; what matters is
 * that the map shows a frame other than now, and with it none of what only
 * the live frame carries (the cells, the 3D tags). Playing counts throughout,
 * the loop's pass over now included, so the way back stays put. Not while
 * scrubbing, where the hand is choosing a frame and the pill would only
 * flicker, nor while stale, where the radar is behind rather than the reader.
 */
$: offLive = $bottomToolbarMode === "player" && $sharedActiveCap === "radar"
  && ($playbackRunning || !$live) && !scrubbing && !$radarStale && gridConfig !== null
  // In a past window the pill at the top is the way back (LiveIndicator).
  && !$archiveWindow;

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

/** Back onto the live frame, the player still open; out of a past window first. */
function returnToLive() {
  if (get(archiveWindow)) {
    archiveWindow.set(null);
    return;
  }
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
  // Only the grid of the window the map is in (or the live one) can answer:
  // until it lands, the request waits.
  if (!sameWindow(gridConfig.window, get(archiveWindow))) return;
  frameRequest.set(null);
  if (wanted === "live") {
    returnToLive();
    return;
  }
  const { window: open } = gridConfig;
  // In a past window every step is the reader's to open on, its end
  // included; a missed scan opens on the frame before it.
  const target = open
    ? frameInWindow(windowSteps(open), (t) => Boolean(gridConfig?.grid[t]?.url), wanted, cap.getMostRecentObservation())
    : wanted;
  if (!open && (!gridConfig.grid[wanted]?.url || wanted === cap.getMostRecentObservation())) return;
  resumeOnRelease = false;
  if (fsm.state === "playing") fsm.pressPause();
  if (open) oldTimeStep = 0;
  if (fsm.state === "followLatest") {
    seekTo = target;
    fsm.showScrollbar();
  } else {
    shown = target;
  }
  sliderChangedHandler(target);
}

/*
 * A past window opened, changed or left: playback stops, and the player
 * asks for its frame, which waits for the window's grid. Into a window, the
 * frame a link named if it is in it, else the window's end; out of one,
 * the live frame.
 */
let windowWas: import("../lib/archive").ArchiveWindow | null = null;
subscriptions.push(archiveWindow.subscribe((next) => {
  if (sameWindow(next, windowWas)) return;
  windowWas = next;
  resumeOnRelease = false;
  if (fsm.state === "playing") fsm.pressPause();
  liveEdge = null;
  frameRequest.update((request) => {
    if (!next) return "live";
    return typeof request === "number" && inWindow(next, request) ? request : next.end;
  });
}));

subscriptions.push(frameRequest.subscribe(() => takeFrameRequest()));

function hide() {
  resumeOnRelease = false;
  scrubbing = false;
  if (playTimeout !== 0) window.clearTimeout(playTimeout);
  playTimeout = 0;
  stopWaiting();
  fsm.hideScrollbar();
}

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
  scrubbing = true;
  browsingFrames.set(true);
  if (fsm.state === "playing") {
    console.log("Holding playback for a grab on the timeline");
    resumeOnRelease = true;
    fsm.pressPause();
  }
}

/** The needle is at rest again: playback, if a grab held it, goes on from there. */
function released() {
  scrubbing = false;
  if (!resumeOnRelease) return;
  resumeOnRelease = false;
  // Let go on now or after it with no forecast on screen: nothing to play from there.
  if (fsm.state === "manualScrolling" && playable) fsm.pressPlay(FRAME_MS);
}

/** The needle has reached another step. */
function seek(event: CustomEvent<number>) {
  cancelPark();
  shown = event.detail;
  sliderChangedHandler(event.detail, true);
}

function playPause() {
  resumeOnRelease = false;
  if (fsm.state === "playing") {
    console.log("Pausing due to button");
    fsm.pressPause();
  } else if (fsm.state === "manualScrolling" && playable) {
    fsm.pressPlay();
  }
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
  // A past window was chosen on purpose, and is where the reader comes back to.
  if (get(archiveWindow)) return;
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
  stopWaiting();
  window.clearTimeout(backToLiveTimer);
  window.clearTimeout(parkTimer);
  headObserver?.disconnect();
  document.documentElement.classList.remove("plot-dry");
  cap.stopPreload();
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
     The player, three rows:

         head      where the strip's numbers are from, and the pills
         timeline  the strip: forecast bars, needle, axis
         row       transport and the colour scale

     The head stays on top on a wide screen too, so the pills sit over the
     strip. An open radar's controls (SiteSweepTray) and the weather
     stations' parameter picker (StationPicker) grow no row: they are pills
     of their own over the player. The head's pills scroll sideways when
     they are more than it holds. The strip is shorter where it has no rain
     to plot (--mc-plot-h in src/glass.css).
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
  /* Its own width, up to a cap, whatever the pills beside it do: where they
     are more than the head holds they scroll, rather than the place name
     being cut shorter and moving them. */
  .title {
    flex: 0 0 auto;
    max-width: min(40%, 16em);
    min-width: 0;
    font: 700 13px/1.3 var(--mc-font);
    letter-spacing: -0.01em;
    color: var(--mc-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
  /* Straight after the title, or first in the head with none (there is none
     while the client's position is unknown), and left-aligned, the
     Stations pill first: the storm key coming and going after it never
     moves it. */
  .product-pill {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    /* Sideways, when the pills are more than the head holds, beside a long
       place name on a phone. Room above and below, so a focus ring or a
       badge is not cut off. */
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    padding: 3px 0;
    margin-block: -3px;
  }
  .product-pill::-webkit-scrollbar { display: none; }
  .pills {
    flex: 0 0 auto;
    display: inline-flex;
    gap: 6px;
  }

  /* The apps' badges and the repo mark, which the bottom bar carries on the
     other maps and this tray covers: at the end of the scale's row once the
     screen is wide enough to leave the scale its labels beside them. */
  .appendix { display: none; }
  @media (min-width: 1280px) {
    .appendix {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
    }
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
  .controlButton.play:disabled {
    background: var(--mc-tint-active);
    color: var(--mc-text-3);
    cursor: default;
    transform: none;
  }
  .controlButton.play :global(svg) { margin-left: 2px; }
  .controlButton.play.playing :global(svg) { margin-left: 0; }
  /* Letting a tapped point go: smaller than the transport, like a close disc. */
  .controlButton.clear {
    margin-left: auto;
    width: 30px;
    height: 30px;
    font-size: 13px;
    color: var(--mc-text-3);
  }
  .controlButton.clear:hover { color: var(--mc-text); }

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
      var(--mc-tray-bottom) + var(--mc-player-h) + var(--mc-tray-gap) + var(--mc-float-stack)
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

  /* On a desktop the bottom row is as slim as the strip above it: a smaller
     play button and a thinner colour scale, its labels moved up to suit. A
     phone keeps the full-size button for the thumb. */
  @media (min-width: 621px) {
    .controlButton.play {
      width: 32px;
      height: 32px;
      font-size: 13px;
    }
    .player .legend :global(.scale) { height: 22px; }
    .player .legend :global(.scale-line) { height: 6px; }
    .player .legend :global(.scale-dividers),
    .player .legend :global(.scale-ticks) { top: 8px; }
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

<!-- The archive's picker, over the map: from the pill below, or the frame's tab. -->
{#if $archivePickerOpen}
  <ArchivePicker on:close={() => archivePickerOpen.set(false)} />
{/if}

<!-- One notice at a time, the queue's (lib/noticeQueue.ts); keyed, so one
     replacing another leaves and comes in as a strip of its own. -->
{#if shownNotice}
  {#key dismissalKey(shownNotice)}
    {#if shownNotice.kind === "dry-outlook"}
      {#if $latLon}
        <DryOutlook
          lat={$latLon[0]}
          lon={$latLon[1]}
          collapsed={$bottomToolbarMode !== "player"}
          on:dismiss={dismissOutlook}
          on:unavailable={() => { outlookUnavailable = true; outlookFailedAt = Date.now(); }} />
      {/if}
    {:else if words}
      {@const notice = shownNotice}
      <DismissableStrip
        title={words.title}
        collapsed={$bottomToolbarMode !== "player"}
        on:dismiss={() => dismissNotice(notice)}>
        <p class="notice">{words.body}</p>
      </DismissableStrip>
    {/if}
  {/key}
{/if}

<!-- Site mode: one radar's own sweep over the dimmed composites
     (lib/SiteSweepManager.ts), its controls in pills over the player, whose
     timeline scrubs its sweeps as it scrubs frames. -->
{#if $bottomToolbarMode === "player" && $siteMode && $siteSweepView}
  <SiteSweepTray />
{/if}

<!-- Which parameter the weather stations show, a pill of its own over the
     player (and an open radar's) while they are on; the rest of the stack
     stands on it. -->
{#if $bottomToolbarMode === "player" && $stationLayerVisible}
  <StationPicker />
{/if}

{#if showBackToLive}
  <div class="back-to-live" style:--open-strips={$openStripCount} style:--open-hints={$openHintCount}>
    <button type="button" class="glass glass-pill" on:click={returnToLive}
      transition:fly={{ y: 12, duration: 200 }}>
      <span>{$_("chrome.playback.back_to_latest")}</span>
      <Icon icon={faClockRotateLeft} />
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
        <!-- A past window has no chart, so no place it is about. -->
        {#if ($inspectLatLon || $latLon) && !past}
          <span class="title" bind:this={titleEl}>{chartTitle}</span>
          {#if $inspectLatLon && $latLon}
            <button type="button" class="link" on:click={returnToCurrentPosition}>
              <Icon icon={faLocationCrosshairs} />
              <span>{$_("show_for_my_location")}</span>
            </button>
          {/if}
        {/if}
        <!-- The legend's caption, up here rather than in the row of controls,
             which has no room left on a phone. -->
        <!-- An edge with more beyond it fades out (lib/fadeEdges.ts). -->
        <span class="product-pill mc-fade-x" use:fadeEdges>
          <span class="pills">
            <!-- DWD's weather stations over the map, on or off. First, so
                 the pills after it never move it. -->
            <StationToggle />
            <!-- What the storm marks on the map are, while they are drawn. -->
            {#if $cellLayerVisible}<StormKey />{/if}
            <RadarProductPicker variant="pill" />
            <!-- A past window, the archive's (lib/archive.ts). -->
            <ArchivePill on:open={() => archivePickerOpen.set(true)} />
          </span>
        </span>
        {#if $inspectLatLon && !$latLon && !past}
          <button type="button" class="controlButton clear" on:click={returnToCurrentPosition}
            title={$_("close")} aria-label={$_("close")}>
            <Icon icon={faXmark} />
          </button>
        {/if}
      </div>

      <div class="plot">
        {#if gridLoading && !hasPrecipitation && !past}
          <div class="skeleton"><ChartSkeleton bars={25} /></div>
        {/if}
        <Timeline
          steps={stripSteps}
          now={gridConfig?.now ?? 0}
          latest={latestObservation}
          value={shown}
          {past}
          preloaded={$framesPreloaded}
          {labelEvery}
          on:grab={grabbed}
          on:release={released}
          on:seek={seek} />
        {#if !gridLoading && noForecastFrom !== null}
          <p class="no-forecast" style:left={`${noForecastFrom * 100}%`}>{$_("forecast_none_here")}</p>
        {/if}
      </div>

      <div class="row">
        <!-- Nothing on screen to play (playbackLoop); a running playback can still be paused. -->
        <button type="button" class="controlButton play" class:playing={$playbackRunning}
          disabled={!$playbackRunning && !playable}
          on:click={playPause}
          title={$_("chrome.playback.play")} aria-label={$_("chrome.playback.play")}>
          <Icon icon={playPauseButton} />
        </button>
        <div class="legend">
          {#if $siteMode && $siteMode.quantity !== "reflectivity"}
            <VelocityScaleLine nyquist={$siteSweepView?.nyquist ?? null} relative={$siteMode.quantity === "srv"} />
          {:else if columnEncoding}
            <ColumnScaleLine encoding={columnEncoding} />
          {:else}
            <RadarScaleLine />
          {/if}
        </div>
        {#if !dd.isApp()}
          <div class="appendix"><Appendix /></div>
        {/if}
      </div>
    </div>
  </div>
{/if}
