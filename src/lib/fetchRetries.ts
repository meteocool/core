/**
 * The volumes that would not load, and when each is worth asking for again.
 *
 * A volume that failed to download was not asked for again until the camera
 * moved or the next list landed, which on a map left alone is minutes: the
 * storm stood there as a bare outline. So it is asked again, a little later
 * each time, and after a few tries let go of, which leaves its place to the
 * next storm in view and stops a stand-in waiting for it (`volumeHandover`).
 * One the server says is not there (`VolumeGone`) is let go of at once.
 */

/** Tries before a volume is let go of. */
export const FETCH_TRIES = 3;
/** The wait after the first failure; each one after doubles it. */
export const RETRY_MS = 2000;

export class FetchRetries {
  private failures = new Map<string, { count: number; at: number }>();

  /** A fetch failed at `now`; `gone` when the volume is not there at all. */
  failed(path: string, now: number, gone = false): void {
    const count = gone ? FETCH_TRIES : (this.failures.get(path)?.count ?? 0) + 1;
    this.failures.set(path, { count, at: now + RETRY_MS * 2 ** (count - 1) });
  }

  /** Whether a volume has failed too often to ask for again. */
  givenUp(path: string): boolean {
    return (this.failures.get(path)?.count ?? 0) >= FETCH_TRIES;
  }

  /** Whether a volume can be asked for at `now`: never failed, or its wait is over. */
  ready(path: string, now: number): boolean {
    const failure = this.failures.get(path);
    return !failure || (failure.count < FETCH_TRIES && failure.at <= now);
  }

  /** When the soonest volume still worth trying again can be; null for none. */
  next(): number | null {
    let soonest: number | null = null;
    for (const { count, at } of this.failures.values()) {
      if (count < FETCH_TRIES && (soonest === null || at < soonest)) soonest = at;
    }
    return soonest;
  }

  /** Forget every volume not in `listed`: each scan lists new paths. */
  keepOnly(listed: ReadonlySet<string>): void {
    for (const path of this.failures.keys()) if (!listed.has(path)) this.failures.delete(path);
  }

  clear(): void {
    this.failures.clear();
  }
}
