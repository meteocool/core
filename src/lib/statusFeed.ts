import { derived, get, type Readable } from "svelte/store";
import { locale } from "svelte-i18n";
import {
  archiveWindow, cellLayerVisible, lightningLayerVisible, mapExtent4326, serverStatus, sharedActiveCap, socketDown,
  stationLayerVisible,
} from "../stores";
import { fetchStatus, NothingPublished, quietly } from "../api";
import {
  affected, forecastStoppedAtCentre, forecastStoppedShare, headline, inView, noticesFor, radarDownInView, stalledDomains, trusted, TRUST_MS,
  type Affected, type DrawnLayers, type ServiceStatus, type ShownNotice,
} from "./status";
import { STATUS_COVERAGE } from "../layers/statusCoverage";

/**
 * Asking the backend what is late (lib/status.ts), and publishing the answer
 * while it can be trusted.
 *
 * Split from the rules the way degradedStatus.ts is from degraded.ts: the
 * clock, the fetch and the stores are here, the decisions there.
 *
 * Asked on load, on the socket's `status` and on waking (App.svelte), and on
 * a timer: every few minutes, every minute while the socket is down. An
 * answer is trusted for `TRUST_MS` with no newer one; past that, or with
 * none (a backend without the route answers 404), `serverStatus` is null and
 * the map's own rules judge.
 */

/**
 * How often the status is asked for with the socket up. A little inside the
 * trust window, so the next answer is in before the last one runs out; the
 * socket's `status` says when anything changes in between.
 */
export const POLL_MS = TRUST_MS - 30_000;

/** How often while the socket is down, when no `status` can come. */
export const SOCKET_DOWN_POLL_MS = 60_000;

/** The newest answer, trusted or not. */
let latest: { status: ServiceStatus; receivedAt: number } | null = null;
let expiry: ReturnType<typeof setTimeout> | null = null;

/** Hand the newest answer to the map while it is trusted and the map is live. */
function publish(now = Date.now()) {
  const usable = latest && trusted(latest.receivedAt, now) && !get(archiveWindow) ? latest : null;
  if (get(serverStatus) !== usable) serverStatus.set(usable);
  if (expiry !== null) clearTimeout(expiry);
  expiry = null;
  if (usable && typeof window !== "undefined") {
    expiry = setTimeout(() => publish(), Math.max(0, usable.receivedAt + TRUST_MS - now));
  }
}

let asking: Promise<void> | null = null;

/**
 * Ask for the status now. A 404 forgets any earlier answer: the backend has
 * no status to give. Any other failure keeps it until it runs out, and is
 * the API's failure to report (api/index.ts).
 */
export function refreshStatus(): Promise<void> {
  if (asking) return asking;
  asking = fetchStatus(quietly)
    .then((status) => { latest = { status, receivedAt: Date.now() }; })
    .catch((error) => { if (error instanceof NothingPublished) latest = null; })
    .finally(() => {
      asking = null;
      publish();
    });
  return asking;
}

let poll: ReturnType<typeof setInterval> | null = null;
const unsubscribe: (() => void)[] = [];

function schedule(down: boolean) {
  if (poll !== null) clearInterval(poll);
  poll = setInterval(() => void refreshStatus(), down ? SOCKET_DOWN_POLL_MS : POLL_MS);
}

/** Start asking. Idempotent, like the other init functions. */
export function initStatusFeed() {
  cleanupStatusFeed();
  if (typeof window === "undefined") return;
  void refreshStatus();
  unsubscribe.push(archiveWindow.subscribe(() => publish()));
  // Called at once with the socket as it is, which starts the timer.
  unsubscribe.push(socketDown.subscribe(schedule));
}

export function cleanupStatusFeed() {
  if (poll !== null) clearInterval(poll);
  poll = null;
  if (expiry !== null) clearTimeout(expiry);
  expiry = null;
  while (unsubscribe.length) unsubscribe.pop()!();
}

/** Which layers draw what the status judges, on the map on screen. */
export const drawnLayers: Readable<DrawnLayers> = derived(
  [sharedActiveCap, lightningLayerVisible, stationLayerVisible, cellLayerVisible],
  ([cap, lightning, stations, cells]) => ({
    radar: cap === "radar",
    lightning: cap === "lightning" || (cap === "radar" && lightning),
    stations: cap === "radar" && stations,
    storms: cap === "cells3d" || (cap === "radar" && cells),
  }),
);

/** What the trusted status says about this screen. */
export interface StatusVerdict {
  /** What is late on screen, worst first. */
  affected: Affected[];
  /** What the pill says of it (lib/status.ts `headline`). */
  headline: "down" | "delayed" | null;
  /** Our notices for this screen, `warning` first, in the reader's language. */
  notices: ShownNotice[];
  /** A `radar` on screen is `down`. */
  radarDown: boolean;
  /** The domains whose radar is not `ok`, wherever they are. */
  stalled: string[];
  /** The share of the screen whose forecast is not arriving while its radar is. */
  forecastStopped: number;
  /** Whether that forecast is under the middle of the screen. */
  forecastStoppedAtCentre: boolean;
  /** The newest radar scan on screen, unix seconds on the server's clock, for "everything is arriving". */
  newestRadar: number | null;
  /** When the answer was received, epoch ms; with `serverTime`, what "ago" is measured from. */
  receivedAt: number;
  serverTime: number;
}

/**
 * The trusted status, read for the screen; null without one, when the
 * map's own rules apply. A view not known yet is the whole world.
 */
export const statusVerdict: Readable<StatusVerdict | null> = derived(
  [serverStatus, mapExtent4326, drawnLayers, locale],
  ([trustedStatus, extent, layers, tag]) => {
    if (!trustedStatus) return null;
    const { status, receivedAt } = trustedStatus;
    const view = extent ?? [-180, -85, 180, 85];
    const radarsHere = status.components.filter((component) => component.kind === "radar"
      && component.newest != null && inView(component, view, STATUS_COVERAGE));
    const late = affected(status, view, layers, STATUS_COVERAGE);
    return {
      affected: late,
      headline: headline(late),
      notices: noticesFor(status, view, tag, STATUS_COVERAGE),
      radarDown: layers.radar && radarDownInView(status, view, STATUS_COVERAGE),
      stalled: stalledDomains(status),
      forecastStopped: layers.radar ? forecastStoppedShare(status, view, STATUS_COVERAGE) : 0,
      forecastStoppedAtCentre: layers.radar && forecastStoppedAtCentre(status, view, STATUS_COVERAGE),
      newestRadar: radarsHere.length ? Math.max(...radarsHere.map((component) => component.newest as number)) : null,
      receivedAt,
      serverTime: status.server_time,
    };
  },
);
