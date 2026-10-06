/**
 * Telling apart what on the 3D map is from the radar's scan and what is older.
 *
 * Three products describe each five-minute scan, and none of them arrives at
 * the same time as another. Live, DWD's composite for a scan is out about
 * four minutes after the scan starts; KONRAD3D's cells for that same scan come
 * about two minutes later; the volumes are built by a slower job of our own,
 * from every radar's sweeps around storms found in a column maximum -- DWD's
 * DMAX in Germany, ng's own of each network elsewhere (ng ADR 0019) -- and
 * land half a minute after the cells. So the older ones stand a scan upwind of the echo
 * under them for part of every cycle.
 *
 * It is only lateness. In data time they agree: checked against 486 KONRAD3D
 * cells from two convective days in September 2026, 355 overlapped the
 * composite of their own scan best, and 3 the scan before. So the 3D map draws
 * them in full colour all the same, the newest picture of each storm there is
 * (ng ADR 0018), and only the flat map's "3D" tag leaves out a storm from an
 * older scan than its radar, until its own scan arrives.
 *
 * Against its own network's radar, not DWD's. A storm from France's run is
 * stamped with the newest scan in France's composite, which is on France's
 * clock -- 15:29, 15:34 -- and the frame draped over France carries the same
 * stamp (`RadarFrame.upstream_time`). Judged against DWD's five-minute frame
 * instead, every one of them was a minute or more behind the moment DWD's next
 * scan landed, built in time or not.
 */

/** The network a volume's storm was found in; volumes from before networks were recorded are DWD's. */
export function networkOf(volume: { network?: string | null }): string {
  return volume.network || "de";
}

/** A scan's time, epoch seconds: what the radar grid is keyed by. */
export type Scan = number;

/** The ISO time a run or a list of volumes carries, as a scan; null for none. */
export function scanTime(value: string | null | undefined): Scan | null {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : null;
}

/**
 * Whether something measured at `scan` is older than the radar drawn under it.
 *
 * Not when either is unknown: there is nothing to be behind.
 */
export function isBehind(scan: Scan | null | undefined, radar: Scan | null): boolean {
  return scan !== null && scan !== undefined && radar !== null && scan < radar;
}

/** The radar drawn under the storms, as far as telling which are behind it goes. */
export interface RadarScans {
  /** DWD's frame's scan; null where no frame is drawn. */
  scan: Scan | null;
  /** Each network's newest frame, where it has a fresh one; its `upstream_time` is its scan. */
  networks: Partial<Record<string, { upstream_time?: Scan | null }>>;
}

/** The scan of the radar a storm from `network` is judged against: its own network's frame. */
export function radarScanOf(network: string, radar: RadarScans): Scan | null {
  if (network === "de") return radar.scan;
  return radar.networks[network]?.upstream_time ?? null;
}

/** Whether a storm's volume is from an older scan than its radar: what the flat map leaves untagged. */
export function isVolumeBehind(
  volume: { network?: string | null; reference_time?: string | null },
  radar: RadarScans,
): boolean {
  return isBehind(scanTime(volume.reference_time), radarScanOf(networkOf(volume), radar));
}

/** A volume as far as telling whether a list has moved past it goes. */
interface Listed {
  path: string;
  network?: string | null;
  reference_time?: string | null;
}

/**
 * Whether a volume is past its scan: the list has a newer scan from its
 * network, and the volume is not in it. The 3D map keeps an open storm on
 * through that, and it has nothing newer to show. Not merely missing from the
 * list, which before the first one lands is every storm.
 */
export function isPastItsScan(volume: Listed, listed: ReadonlyArray<Listed>): boolean {
  if (listed.some((other) => other.path === volume.path)) return false;
  const scan = scanTime(volume.reference_time);
  const network = networkOf(volume);
  return scan !== null && listed.some((other) => (
    networkOf(other) === network && (scanTime(other.reference_time) ?? -Infinity) > scan
  ));
}

/** Between two asks for a scan's volumes that are not built yet. */
export const VOLUME_RETRY_MS = 20_000;

/** Asks at most -- two minutes of them -- after which that scan has none coming. */
export const VOLUME_RETRIES = 6;

/** What `/cells/volumes` answers, as far as following it goes. */
interface Scanned {
  reference_time?: string | null;
}

/**
 * The newest volumes, kept up with the KONRAD3D runs.
 *
 * Volumes are asked for when a run lands, which is the one moment their scan's
 * are reliably not there yet. So `follow` asks again, every
 * `VOLUME_RETRY_MS`, until an answer reaches the run's scan.
 *
 * Every answer, whoever fetched it, goes through `offer`, which passes on only
 * those no older than the last: two requests in flight can come back in either
 * order, and the older one landing second would put the previous scan back.
 */
export class VolumeFeed<T extends Scanned> {
  /** The scan of the last answer passed on; null before one, or when none was built. */
  private newest: Scan | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Bumped by every new wait and every stop, so an ask already in flight lands nowhere. */
  private generation = 0;

  private readonly fetch: () => Promise<T | null>;

  private readonly apply: (volumes: T) => void;

  constructor(fetch: () => Promise<T | null>, apply: (volumes: T) => void) {
    this.fetch = fetch;
    this.apply = apply;
  }

  /**
   * Pass an answer on, unless it is older than the last one; true when it was.
   *
   * One as new is passed on too. `reference_time` is the newest of every
   * network's runs, so Germany's run landing after Switzerland's newer one
   * leaves it where it was -- and a run is built in parts, each listed as it
   * lands, under the same scan.
   */
  offer(answer: T): boolean {
    const scan = scanTime(answer.reference_time);
    if (scan !== null && this.newest !== null && scan < this.newest) return false;
    this.newest = scan;
    this.apply(answer);
    return true;
  }

  /**
   * Keep asking until the volumes reach `run`'s scan, replacing any earlier wait.
   *
   * Nothing to wait for without a run, or when nothing has been built at all:
   * the volumes come from the newest scan that has any, so an empty answer is
   * not a scan running late.
   */
  follow(run: Scan | null): void {
    this.stop();
    this.wait(this.generation, run, VOLUME_RETRIES);
  }

  /** Stop waiting; an ask already in flight is dropped when it lands. */
  stop(): void {
    this.generation += 1;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private wait(generation: number, run: Scan | null, left: number): void {
    if (run === null || this.newest === null || this.newest >= run || left <= 0) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      // A hidden tab lets its turns pass unasked; back within the two
      // minutes, the next one asks, and after that the wake refresh does.
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      const answer = hidden ? null : await this.fetch();
      if (generation !== this.generation) return;
      if (answer) this.offer(answer);
      this.wait(generation, run, left - 1);
    }, VOLUME_RETRY_MS);
  }
}
