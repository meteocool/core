import { fetchLightningStrikes } from "../api";
import { STEP_S, chunksFor, sameWindow, strikesAt } from "./archive";
import type { ArchiveWindow, ArchivedStrike, StrikeChunk } from "./archive";

/**
 * A past window's strikes (lib/archive.ts), for both maps that draw them:
 * fetched from `/v3/lightning/strikes` in the three-hour pieces a step
 * needs, each piece asked for once while the window is open, and handed
 * out as the half hour up to the step on screen.
 */
export class ArchiveStrikes {
  private past: ArchiveWindow | null = null;

  private pieces = new Map<string, Promise<ArchivedStrike[]>>();

  constructor(private readonly fetch: (since: number, until: number) => Promise<{ strikes: ArchivedStrike[] }>) {}

  /** The window strikes are asked for in; another one forgets the last one's. */
  setWindow(next: ArchiveWindow | null): void {
    if (sameWindow(next, this.past)) return;
    this.past = next;
    this.pieces.clear();
  }

  /**
   * The strikes drawn on `shown`; null when the window has changed under the
   * question, whose answer is then nobody's. A piece that fails is asked
   * again next time.
   */
  async at(shown: number): Promise<ArchivedStrike[] | null> {
    const past = this.past;
    if (!past || !shown) return null;
    // A step after the window's last: its strikes up to its last moment, and
    // never past now, which the route refuses.
    const cap = Math.min(past.end + STEP_S, Math.floor(Date.now() / 1000));
    const parts = await Promise.all(chunksFor(shown, cap).map((chunk) => this.piece(chunk)));
    if (this.past !== past) return null;
    return strikesAt(parts.flat(), shown);
  }

  private piece(chunk: StrikeChunk): Promise<ArchivedStrike[]> {
    const key = `${chunk.since}:${chunk.until}`;
    const held = this.pieces.get(key);
    if (held) return held;
    const asked = this.fetch(chunk.since, chunk.until)
      .then((answer) => answer.strikes)
      .catch(() => {
        this.pieces.delete(key);
        return [];
      });
    this.pieces.set(key, asked);
    return asked;
  }
}

/** The one both maps share, so a piece is fetched once whichever map asks. */
export const archiveStrikes = new ArchiveStrikes((since, until) => fetchLightningStrikes(since, until));
