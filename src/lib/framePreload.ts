/**
 * Every frame of the timeline fetched ahead, for the map in view.
 *
 * Scrubbing re-points the radar at a frame whose tiles are asked for only
 * then: dragged quickly through the two hours, the map shows each frame
 * blocky, from a coarser zoom, or half-drawn. So once the reader starts
 * moving through frames (`preloadMode`), the tiles every frame needs for the
 * map's viewport and zoom are fetched, nearest the
 * needle first, a few at a time and at low priority, so the frame on screen
 * still loads first. The tiles are cacheable by URL (a tile id names one
 * rendering), so the HTTP cache has them when the map asks.
 *
 * What has been fetched is drawn on the timeline (Timeline.svelte), each
 * step's slot filling as its tiles arrive. No DOM, no OpenLayers: which
 * tiles a frame needs is the radar capability's to say.
 */

/** What to preload: every frame, the next few after the needle, or nothing. */
export type PreloadMode = "all" | "ahead" | "none";

/**
 * Whether to preload, and how much.
 *
 * Only once the reader shows they will move through frames: a hand or a key
 * on the timeline, or play. A page opened to see the radar now costs the
 * frame it shows and nothing more; every frame of a viewport is 3 to 8 MB.
 * On a slow or data-saving connection, only the next few frames, and only
 * while playing, as before there was a timeline to fill.
 */
export function preloadMode({
  setting, radarShown, browsing, playing, slow,
}: {
  /** The "preload forecast" switch. */
  setting: boolean;
  /** The radar is the map on screen, with frames to show and ground it covers. */
  radarShown: boolean;
  /** The reader is moving through frames (`browsingFrames`). */
  browsing: boolean;
  playing: boolean;
  slow: boolean;
}): PreloadMode {
  if (!setting || !radarShown || !browsing) return "none";
  if (!slow) return "all";
  return playing ? "ahead" : "none";
}

/** A frame, and the tile URLs it needs for the map in view. */
export type FrameNeeds = ReadonlyArray<readonly [step: number, urls: readonly string[]]>;

/**
 * The order to fetch frames in: nearest `from` first, the later of two as
 * near, since playback and a flick both go forward.
 */
export function preloadOrder(steps: readonly number[], from: number): number[] {
  return [...steps].sort((a, b) => Math.abs(a - from) - Math.abs(b - from) || b - a);
}

/**
 * How much of each frame's tiles has been fetched, 0 to 1. A frame that needs
 * none (a missed scan, nothing of it in view) has nothing left to fetch.
 */
export function frameProgress(needs: FrameNeeds, loaded: ReadonlySet<string>): Map<number, number> {
  const progress = new Map<number, number>();
  for (const [step, urls] of needs) {
    progress.set(step, urls.length ? urls.filter((url) => loaded.has(url)).length / urls.length : 1);
  }
  return progress;
}

/**
 * Whether every step the needle can reach has all its tiles: the timeline's
 * band is whole, and drawn as one piece of glass. Not for a timeline with no
 * steps, nor one where nothing is being preloaded.
 */
export function allPreloaded(
  steps: ReadonlyArray<{ t: number; playable: boolean }>,
  progress: ReadonlyMap<number, number>,
): boolean {
  const reachable = steps.filter((step) => step.playable);
  return reachable.length > 0 && reachable.every((step) => progress.get(step.t) === 1);
}

/**
 * How full a step's slot on the timeline is drawn, 0 to 1. A step the needle
 * can reach shows its own progress. The unpublished tail has nothing to
 * fetch: it fills with the rest once the band is whole, so the band runs to
 * the end of the strip, and stays empty until then rather than looking done
 * before anything is.
 */
export function slotShare(
  step: { t: number; playable: boolean },
  progress: ReadonlyMap<number, number>,
  whole: boolean,
): number {
  if (step.playable) return progress.get(step.t) ?? 0;
  return whole ? 1 : 0;
}

/** How many tiles are fetched at once: few enough that the frame on screen is not kept waiting. */
export const PRELOAD_PARALLEL = 4;

/** How many fetched URLs are remembered before those no frame needs any more are let go. */
const REMEMBERED = 6000;

/**
 * Fetches what a plan needs, a few at a time, and says how far each frame
 * has got.
 *
 * A new plan (the map moved, the needle moved, a frame arrived) replaces the
 * queue, not what is in flight. A tile that failed is not asked for again
 * until the next plan.
 */
export class FramePreloader {
  private needs: FrameNeeds = [];

  private queue: string[] = [];

  private readonly loaded = new Set<string>();

  private readonly inFlight = new Set<string>();

  private failed = new Set<string>();

  private readonly fetchTile: (url: string) => Promise<boolean>;

  private readonly onProgress: (progress: Map<number, number>) => void;

  private readonly mayFetch: () => boolean;

  private readonly parallel: number;

  /**
   * `fetchTile` resolves true once a tile is in the cache. `mayFetch` is asked
   * before each fetch: false (a hidden page) leaves the rest for the next plan.
   */
  constructor(
    fetchTile: (url: string) => Promise<boolean>,
    onProgress: (progress: Map<number, number>) => void,
    { mayFetch = () => true, parallel = PRELOAD_PARALLEL }: { mayFetch?: () => boolean; parallel?: number } = {},
  ) {
    this.fetchTile = fetchTile;
    this.onProgress = onProgress;
    this.mayFetch = mayFetch;
    this.parallel = parallel;
  }

  /** Fetch what these frames need, in this order. */
  plan(needs: FrameNeeds): void {
    this.needs = needs;
    this.failed = new Set();
    if (this.loaded.size > REMEMBERED) {
      const wanted = new Set(needs.flatMap(([, urls]) => urls));
      for (const url of this.loaded) if (!wanted.has(url)) this.loaded.delete(url);
    }
    const queued = new Set<string>();
    for (const [, urls] of needs) {
      for (const url of urls) if (!this.loaded.has(url) && !this.inFlight.has(url)) queued.add(url);
    }
    this.queue = [...queued];
    this.report();
    this.pump();
  }

  /** Nothing more fetched, and nothing said to be: the timeline shows no progress. */
  stop(): void {
    this.needs = [];
    this.queue = [];
    this.report();
  }

  private report(): void {
    this.onProgress(frameProgress(this.needs, this.loaded));
  }

  private pump(): void {
    while (this.inFlight.size < this.parallel && this.queue.length) {
      if (!this.mayFetch()) {
        this.queue = [];
        return;
      }
      const url = this.queue.shift()!;
      if (this.loaded.has(url) || this.inFlight.has(url) || this.failed.has(url)) continue;
      this.inFlight.add(url);
      this.fetchTile(url)
        .catch(() => false)
        .then((ok) => {
          this.inFlight.delete(url);
          if (ok) this.loaded.add(url);
          else this.failed.add(url);
          if (ok && this.needs.some(([, urls]) => urls.includes(url))) this.report();
          this.pump();
        });
    }
  }
}
