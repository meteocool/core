/**
 * Which of the volumes held the 3D map draws while others are on their way.
 *
 * The map holds the volumes it wants in view (coarse tiles far off, fine
 * ones close up, each network's newest scan) and fetches the ones it has
 * not got a few at a time. Let go of as soon as they stopped being wanted,
 * a zoom across the line between coarse and fine took the coarse tiles away
 * at once and put the fine ones back one by one over a few seconds, and a
 * new scan did the same to every storm: the sky emptied and filled again in
 * blocks.
 *
 * So a volume no longer wanted stands in until what replaces it is in:
 *
 * - at its place: a coarse tile until every fine tile in it is in, and the
 *   fine tiles until the coarse tile over them is in. Meanwhile the ones that
 *   are in are held back, not drawn over the stand-in, so a place shows one
 *   picture, then the other.
 * - for its network: a scan until every tile of its network's next scan is
 *   in, and until that scan has been listed whole (below). Meanwhile the
 *   next scan's tiles are held back where a tile of the scan before stands,
 *   and drawn as they come where it had none, so a place shows one scan,
 *   then the next, and storms the scan before was never held for (ahead of a
 *   turn, a pan) are not kept waiting. What the next scan no longer has goes
 *   with the rest once it is in.
 *
 * A network's scan is listed in parts as they are built, tens of seconds
 * apart, the first sometimes a few tiles of a hundred. Turned over as soon
 * as the tiles listed so far were in, the scan before went everywhere the
 * rest would be, and the sky there stayed empty until the next part was
 * listed and loaded: from a cockpit, for half a minute at a time. So the
 * scan before also stands in while its network's next is still being
 * listed (`ScanListing`). Where they meet, the two scans stand side by side
 * meanwhile, which beside an empty sky is little.
 *
 * A place is a network's tile: two networks overlap at their borders and
 * each draws its own. A volume that turned out too faint to draw, or would
 * not load, is not waited for.
 */

/** A volume as handing over sees it: where it stands, in which network's scan. */
export interface Placed {
  path: string;
  network: string;
  /** Its tile, z, x, y; null for a box from before tiles, which has no place to hand over. */
  tile: readonly number[] | null;
  /** Its scan, as any comparable number (epoch seconds); null where unknown. */
  scan: number | null;
}

/** Whether two tiles cover any of the same ground: one lies in the other. */
export function overlaps(a: readonly number[], b: readonly number[]): boolean {
  const [fine, coarse] = a[0] >= b[0] ? [a, b] : [b, a];
  const shift = fine[0] - coarse[0];
  return fine[1] >> shift === coarse[1] && fine[2] >> shift === coarse[2];
}

/** Whether `older` has to wait for `newer`: the same place, or the same network in another scan. */
function replacedBy(older: Placed, newer: Placed): boolean {
  if (older.network !== newer.network) return false;
  if (older.scan !== null && newer.scan !== null && older.scan !== newer.scan) return true;
  return older.tile !== null && newer.tile !== null && overlaps(older.tile, newer.tile);
}

/**
 * What to keep of the held volumes no longer wanted, and which wanted ones
 * that are in to hold back meanwhile.
 *
 * `held` is every volume loaded, nearest first: past `limit` bytes of
 * stand-ins, the farther ones go without waiting. `pending` is every wanted
 * volume still to come; `wanted` all of them. `listing` is each network
 * whose newest scan is still being listed, with that scan (`ScanListing`).
 */
export function handOver(
  wanted: readonly Placed[],
  held: readonly Placed[],
  pending: readonly Placed[],
  bytes: (volume: Placed) => number = () => 0,
  limit = Infinity,
  listing: ReadonlyMap<string, number> = new Map(),
): { keep: Set<string>; hide: Set<string> } {
  const wantedPaths = new Set(wanted.map((volume) => volume.path));
  const keep = new Set<string>();
  const kept: Placed[] = [];
  let total = 0;
  const overtaken = (volume: Placed) => volume.scan !== null && (listing.get(volume.network) ?? -Infinity) > volume.scan;
  for (const volume of held) {
    if (wantedPaths.has(volume.path)) continue;
    if (!overtaken(volume) && !pending.some((next) => replacedBy(volume, next))) continue;
    total += bytes(volume);
    if (total > limit) break;
    keep.add(volume.path);
    kept.push(volume);
  }
  // Held back by a stand-in at its place; one with no place to stand in, a box from before tiles, by any.
  const atPlace = (old: Placed, volume: Placed) => old.tile === null || volume.tile === null || overlaps(old.tile, volume.tile);
  const hide = new Set<string>();
  for (const volume of held) {
    if (wantedPaths.has(volume.path) && kept.some((old) => replacedBy(old, volume) && atPlace(old, volume))) hide.add(volume.path);
  }
  return { keep, hide };
}

/**
 * How long a network's scan counts as still being listed after its list last
 * grew, ms. Parts were seen to land up to 40 s apart (November 2026).
 */
export const LISTING_QUIET_MS = 45_000;

/**
 * And at most since the network started listing, however its list goes on
 * changing or its scans on coming, ms: how much longer the scan before may
 * stand in. A scan was seen listed over 90 s.
 */
export const LISTING_MAX_MS = 120_000;

/**
 * Which networks' newest scans are still being listed in parts: each list
 * that brings a network a newer scan, or more of the same one, starts its
 * wait again, `LISTING_QUIET_MS`, up to `LISTING_MAX_MS` after it started
 * listing. Parts land tens of seconds apart; there is no word in a list that
 * one is the last, so a quiet while is taken for it.
 *
 * A network in the first list taken is not listing: nothing stood in before
 * it. Nor is a list older than one taken, which an answer landing late is.
 */
export class ScanListing {
  private readonly networks = new Map<string, { scan: number; paths: Set<string>; since: number; grew: number }>();

  /** Take a list of volumes, at `now` (ms). */
  take(volumes: readonly Placed[], now: number): void {
    const listed = new Map<string, { scan: number; paths: string[] }>();
    for (const volume of volumes) {
      if (volume.scan === null) continue;
      const known = listed.get(volume.network);
      if (!known || volume.scan > known.scan) listed.set(volume.network, { scan: volume.scan, paths: [volume.path] });
      else if (volume.scan === known.scan) known.paths.push(volume.path);
    }
    for (const [network, { scan, paths }] of listed) {
      const known = this.networks.get(network);
      if (!known) {
        this.networks.set(network, { scan, paths: new Set(paths), since: -Infinity, grew: -Infinity });
        continue;
      }
      const newer = scan > known.scan;
      if (!newer && (scan < known.scan || paths.every((path) => known.paths.has(path)))) continue;
      // A wait already running goes on from where it started.
      if (now >= this.settles(known)) known.since = now;
      known.grew = now;
      if (newer) {
        known.scan = scan;
        known.paths = new Set(paths);
      } else {
        for (const path of paths) known.paths.add(path);
      }
    }
  }

  /** Take everything listed so far as whole: a reader asked for the newest, and waits for nothing more. */
  settle(): void {
    for (const network of this.networks.values()) {
      network.since = -Infinity;
      network.grew = -Infinity;
    }
  }

  /** Each network still listing at `now`, with its newest scan. */
  listing(now: number): Map<string, number> {
    const listing = new Map<string, number>();
    for (const [network, known] of this.networks) {
      if (now < this.settles(known)) listing.set(network, known.scan);
    }
    return listing;
  }

  /** When the soonest network still listing at `now` stops (ms); null when none is. */
  nextSettled(now: number): number | null {
    let next: number | null = null;
    for (const known of this.networks.values()) {
      const at = this.settles(known);
      if (at > now && (next === null || at < next)) next = at;
    }
    return next;
  }

  private settles({ since, grew }: { since: number; grew: number }): number {
    return Math.min(grew + LISTING_QUIET_MS, since + LISTING_MAX_MS);
  }
}
