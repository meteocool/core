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
 *   in, and then the whole network turns over at once, so the sky shows one
 *   scan or the next, never a patchwork of the two.
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
 * volume still to come; `wanted` all of them.
 */
export function handOver(
  wanted: readonly Placed[],
  held: readonly Placed[],
  pending: readonly Placed[],
  bytes: (volume: Placed) => number = () => 0,
  limit = Infinity,
): { keep: Set<string>; hide: Set<string> } {
  const wantedPaths = new Set(wanted.map((volume) => volume.path));
  const keep = new Set<string>();
  const kept: Placed[] = [];
  let total = 0;
  for (const volume of held) {
    if (wantedPaths.has(volume.path) || !pending.some((next) => replacedBy(volume, next))) continue;
    total += bytes(volume);
    if (total > limit) break;
    keep.add(volume.path);
    kept.push(volume);
  }
  const hide = new Set<string>();
  for (const volume of held) {
    if (wantedPaths.has(volume.path) && kept.some((old) => replacedBy(old, volume))) hide.add(volume.path);
  }
  return { keep, hide };
}
