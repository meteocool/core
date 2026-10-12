import type { CellTrackProperties } from "../api";

/**
 * A cell's copy with the radar volume already known for it, if it came without one.
 *
 * The viewport answer (`/cells/tracks?bbox=…`) never carries a volume: only
 * `/cells/tracks/{code}` and `/cells/current` do. So a copy without one says
 * nothing about the storm, and taking it as it came would drop the volume a
 * link or a tap fetched, and the "Inside" cutaway with it, from an open panel
 * at the first refresh. A copy that has a volume is the newer word and wins.
 *
 * `known` are the other copies held of the storm, in order of preference;
 * one for a different code is no evidence about this one and is passed over.
 */
export function withKnownVolume(
  next: CellTrackProperties,
  ...known: (CellTrackProperties | null | undefined)[]
): CellTrackProperties {
  if (next.volume) return next;
  const volume = known.find((copy) => copy?.code === next.code && copy.volume)?.volume;
  return volume ? { ...next, volume } : next;
}
