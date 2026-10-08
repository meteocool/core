import { NothingPublished } from "../api";
import type { Progress, RadarFrame } from "../api";

/**
 * A frame older than this is not shown. The backend publishes whenever a radar
 * reports, every few minutes; a frame this old means the ingest has stopped,
 * and old weather drawn as the live frame is worse than none.
 */
const STALE_AFTER_SECONDS = 30 * 60;

/** Whether a frame is still worth drawing as the newest: see `STALE_AFTER_SECONDS`. */
function isFresh(frame: RadarFrame, nowS = Date.now() / 1000): boolean {
  return nowS - frame.processed_time < STALE_AFTER_SECONDS;
}

/**
 * One product's newest frame, refetched on its socket event and judged fresh
 * against now (`isFresh`): a network's composite, which `NetworkRadarLayer`
 * draws, or DMAX's, which `RadarCapability` draws through DWD's own layer.
 */
export default class LatestFrame {
  private readonly fetch: (nanobar?: Progress) => Promise<RadarFrame | null | undefined>;

  private frame: RadarFrame | null = null;

  /** Whether the backend has answered at all, a frame or "nothing published"; a failed request is not an answer. */
  answered = false;

  constructor(fetch: (nanobar?: Progress) => Promise<RadarFrame | null | undefined>) {
    this.fetch = fetch;
  }

  /** Fetch the newest frame; null when there is none yet or the request failed, which keeps the one in hand. */
  async refresh(nanobar?: Progress): Promise<RadarFrame | null> {
    const frame = await this.fetch(nanobar).then(
      (answer) => {
        this.answered = true;
        return answer;
      },
      (error: unknown) => {
        if (error instanceof NothingPublished) this.answered = true;
        return null;
      },
    );
    if (frame) this.frame = frame;
    return frame ?? null;
  }

  /** The newest frame, while it is still worth drawing; else null. */
  current(): RadarFrame | null {
    return this.frame && isFresh(this.frame) ? this.frame : null;
  }
}
