import { isFresh } from "./network";
import type { Progress, RadarFrame } from "../api";

/**
 * One product's newest frame, with no layer of its own: DMAX's, which
 * `RadarCapability` draws through DWD's layer, on HX's grid and with HX's
 * holes, when the reader picks it.
 *
 * Refetched on the product's socket event, like a network's composite
 * (`network.ts`), and judged fresh by the same rule, against now.
 */
export default class LatestFrame {
  private readonly fetch: (nanobar?: Progress) => Promise<RadarFrame | null | undefined>;

  private frame: RadarFrame | null = null;

  constructor(fetch: (nanobar?: Progress) => Promise<RadarFrame | null | undefined>) {
    this.fetch = fetch;
  }

  /** Fetch the newest frame. A failed request keeps the one in hand. */
  async refresh(nanobar?: Progress): Promise<void> {
    const frame = await this.fetch(nanobar).catch(() => null);
    if (frame) this.frame = frame;
  }

  /** The newest frame, while it is still worth drawing; else null. */
  current(): RadarFrame | null {
    return this.frame && isFresh(this.frame) ? this.frame : null;
  }
}
