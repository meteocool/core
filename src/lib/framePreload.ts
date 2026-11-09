/**
 * Every frame of the timeline decoded ahead, for the map in view.
 *
 * Scrubbing or playing re-points the radar at a frame whose tiles are asked
 * for only then: each goes through OpenLayers' queue, the service worker,
 * the cache or the network and a worker to decode it, one after another, and
 * the map shows the frame blocky, from a coarser zoom, or half one time and
 * half another. So once the reader starts moving through frames
 * (`preloadMode`), the tiles every frame needs for the map's viewport and
 * zoom are loaded and decoded here, nearest the needle first, a few at a
 * time so the frame on screen still loads first, and kept decoded
 * (lib/decodedTiles.ts) for the layers' loaders to answer from at once.
 *
 * What has been decoded is drawn on the timeline (Timeline.svelte), each
 * step's slot filling as its tiles are ready. No DOM, no OpenLayers: which
 * tiles a frame needs, and what one is keyed by, is the radar capability's
 * to say.
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

/**
 * A frame, and the tiles it needs for the map in view, each by its key: a
 * URL, or what the decoded tiles are kept under.
 */
export type FrameNeeds = ReadonlyArray<readonly [step: number, keys: readonly string[]]>;

/**
 * The order to fetch frames in: nearest `from` first, the later of two as
 * near, since playback and a flick both go forward.
 */
export function preloadOrder(steps: readonly number[], from: number): number[] {
  return [...steps].sort((a, b) => Math.abs(a - from) - Math.abs(b - from) || b - a);
}

/**
 * How much of each frame's tiles is ready, 0 to 1. A frame that needs none
 * (a missed scan, nothing of it in view) has nothing left to load.
 */
export function frameProgress(needs: FrameNeeds, loaded: ReadonlySet<string> | ((key: string) => boolean)): Map<number, number> {
  const has = typeof loaded === "function" ? loaded : (key: string) => loaded.has(key);
  const progress = new Map<number, number>();
  for (const [step, keys] of needs) {
    progress.set(step, keys.length ? keys.filter(has).length / keys.length : 1);
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

/** How many tiles are loaded at once: few enough that the frame on screen is not kept waiting. */
export const PRELOAD_PARALLEL = 4;

/** How many loaded keys are remembered before those no frame needs any more are let go. */
const REMEMBERED = 6000;

/**
 * Loads what a plan needs, a few at a time, and says how far each frame
 * has got.
 *
 * A new plan (the map moved, the needle moved, a frame arrived) replaces the
 * queue, not what is in flight. A tile that failed is not asked for again
 * until the next plan. Given `has`, a tile counts as ready while `has` says
 * so (a store that may let it go again); else once it has loaded.
 */
export class FramePreloader {
  private needs: FrameNeeds = [];

  private queue: string[] = [];

  private readonly loaded = new Set<string>();

  private readonly inFlight = new Set<string>();

  private failed = new Set<string>();

  private readonly fetchTile: (key: string) => Promise<boolean>;

  private readonly onProgress: (progress: Map<number, number>) => void;

  private readonly mayFetch: () => boolean;

  private readonly parallel: number;

  private readonly has: (key: string) => boolean;

  private readonly onIdle: (() => void) | undefined;

  private readonly reportEvery: number;

  private reportTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * `fetchTile` resolves true once a tile is ready. `mayFetch` is asked
   * before each load: false (a hidden page) leaves the rest for the next plan.
   */
  constructor(
    fetchTile: (key: string) => Promise<boolean>,
    onProgress: (progress: Map<number, number>) => void,
    { mayFetch = () => true, parallel = PRELOAD_PARALLEL, has, onIdle, reportEvery = 0 }: {
      mayFetch?: () => boolean;
      parallel?: number;
      has?: (key: string) => boolean;
      /** Told when the last tile of a plan has been loaded or has failed. */
      onIdle?: () => void;
      /**
       * At most how often, in milliseconds, a tile coming in is reported:
       * decoded tiles come in by the hundred a second, and each report
       * redraws the timeline. A plan, and stopping, are reported at once.
       */
      reportEvery?: number;
    } = {},
  ) {
    this.fetchTile = fetchTile;
    this.onProgress = onProgress;
    this.mayFetch = mayFetch;
    this.parallel = parallel;
    this.has = has ?? ((key) => this.loaded.has(key));
    this.onIdle = onIdle;
    this.reportEvery = reportEvery;
  }

  /** Load what these frames need, in this order. */
  plan(needs: FrameNeeds): void {
    this.needs = needs;
    this.failed = new Set();
    if (this.loaded.size > REMEMBERED) {
      const wanted = new Set(needs.flatMap(([, keys]) => keys));
      for (const key of this.loaded) if (!wanted.has(key)) this.loaded.delete(key);
    }
    const queued = new Set<string>();
    for (const [, keys] of needs) {
      for (const key of keys) if (!this.has(key) && !this.inFlight.has(key)) queued.add(key);
    }
    this.queue = [...queued];
    this.report();
    this.pump();
  }

  /** Nothing more loaded, and nothing said to be: the timeline shows no progress. */
  stop(): void {
    this.needs = [];
    this.queue = [];
    this.report();
  }

  /** Say again how far each frame has got: tiles may have come ready, or gone, by other ways. */
  report(): void {
    if (this.reportTimer !== null) clearTimeout(this.reportTimer);
    this.reportTimer = null;
    this.onProgress(frameProgress(this.needs, this.has));
  }

  /** Report soon, once for however many tiles come in meanwhile. */
  private reportSoon(): void {
    if (!this.reportEvery) {
      this.report();
      return;
    }
    this.reportTimer ??= setTimeout(() => this.report(), this.reportEvery);
  }

  private pump(): void {
    while (this.inFlight.size < this.parallel && this.queue.length) {
      if (!this.mayFetch()) {
        this.queue = [];
        return;
      }
      const key = this.queue.shift()!;
      if (this.has(key) || this.inFlight.has(key) || this.failed.has(key)) continue;
      this.inFlight.add(key);
      this.fetchTile(key)
        .catch(() => false)
        .then((ok) => {
          this.inFlight.delete(key);
          if (ok) this.loaded.add(key);
          else this.failed.add(key);
          if (ok && this.needs.some(([, keys]) => keys.includes(key))) this.reportSoon();
          this.pump();
          if (!this.queue.length && !this.inFlight.size) this.onIdle?.();
        });
    }
  }
}
