/**
 * The frame a link (or Back) asks the map to show: `frameRequest`.
 *
 * The player (NowcastPlayback) takes the request on a page that has one. A
 * page without it, `toolbar=no` and so every screenshot, has the radar take
 * it instead (`followLinkedFrames`), or a past window opened there stays on
 * the live frame it was loaded on: a frame outside the window, with none of
 * the networks' composites of the moment the link names.
 */
import { get } from "svelte/store";
import { archiveWindow, frameRequest } from "../stores";
import { frameInWindow, inWindow, sameWindow, windowSteps, type ArchiveWindow } from "./archive";

/** The part of a radar grid the request is answered from. */
export interface RequestGrid {
  grid: Record<number, { url?: string | null } | null | undefined>;
  /** The past window the grid is of, or null for the live one. */
  window: ArchiveWindow | null;
}

/**
 * What a request is once a window opens, changes or closes: into a window,
 * the frame asked for if it is in it, else the window's end; out of one, live.
 */
export function requestOnWindow(next: ArchiveWindow | null, request: number | "live" | null): number | "live" {
  if (!next) return "live";
  return typeof request === "number" && inWindow(next, request) ? request : next.end;
}

/**
 * The step a request opens the map on, against the grid in hand.
 *
 * `undefined`: nothing to take yet, no request, or no grid of the window the
 * map is in (a link names an absolute time, and only that grid can say
 * whether it has it). `null`: taken, but no step to move to: "live", or a
 * frame the live grid no longer holds or is already on. In a past window
 * every step is one to open on, its end included, and a missed scan opens on
 * the frame before it.
 */
export function requestedStep(
  wanted: number | "live" | null,
  grid: RequestGrid | null | undefined,
  open: ArchiveWindow | null,
  newest: number,
): number | null | undefined {
  if (wanted === null || !grid || !sameWindow(grid.window, open)) return undefined;
  if (wanted === "live") return null;
  const hasFrame = (t: number) => Boolean(grid.grid[t]?.url);
  if (grid.window) return frameInWindow(windowSteps(grid.window), hasFrame, wanted, newest);
  return hasFrame(wanted) && wanted !== newest ? wanted : null;
}

/** What `followLinkedFrames` needs of the radar. */
export interface FollowedRadar {
  clientGridConfig?: RequestGrid;
  getMostRecentObservation(): number;
  setSource(step: number): void;
  addObserver(cb: (subject: string, body: unknown) => void): void;
}

/**
 * Take frame requests on a page without the player: the radar is put on the
 * step asked for once its grid can answer. "live" is only cleared, as a
 * window closing returns the radar to the newest frame by itself. Returns
 * the store subscriptions' teardown; the observer goes with the radar.
 */
export function followLinkedFrames(radar: FollowedRadar): () => void {
  let stopped = false;
  const take = () => {
    if (stopped) return;
    const step = requestedStep(get(frameRequest), radar.clientGridConfig, get(archiveWindow), radar.getMostRecentObservation());
    if (step === undefined) return;
    frameRequest.set(null);
    if (step !== null) radar.setSource(step);
  };
  let windowWas = get(archiveWindow);
  const offWindow = archiveWindow.subscribe((next) => {
    if (sameWindow(next, windowWas)) return;
    windowWas = next;
    frameRequest.update((request) => requestOnWindow(next, request));
  });
  const offRequest = frameRequest.subscribe(take);
  radar.addObserver((subject) => {
    if (subject === "grid") take();
  });
  return () => {
    stopped = true;
    offWindow();
    offRequest();
  };
}
