/**
 * The cutaway's slice angle, as a reader turns it.
 *
 * Kept apart from `cellCutaway.ts`, which fetches and so imports the URL
 * configuration -- and that reads Vite's `import.meta.env`, which does not
 * exist under the test runner. Arithmetic about angles has no business
 * depending on the bundler.
 */
/**
 * A slice angle, folded into [-180, 180).
 *
 * A full turn and not a half, although a vertical plane turned by 180 degrees
 * is the same plane: the cut keeps one side of it, so turning it half way
 * round keeps the other half of the storm -- the view from ahead of it rather
 * than from behind.
 */
export function normaliseCut(degrees: number): number {
  const folded = ((degrees + 180) % 360 + 360) % 360 - 180;
  return Object.is(folded, -0) ? 0 : folded;
}

/**
 * What the caption says about the slice.
 *
 * Named by its angle to the track, because the track is what the angle means
 * anything against: along it is where an overhang shows, across it is where
 * the width does. Which half is kept does not change what the cut is, so 0 and
 * 180 both read "along".
 */
export function cutLabel(degrees: number): string {
  const off = Math.abs(normaliseCut(degrees));
  const toTrack = Math.min(off, 180 - off);
  if (toTrack < 1) return "cut along the storm's track";
  if (Math.abs(toTrack - 90) < 1) return "cut across the storm's track";
  return `cut ${Math.round(toTrack)}° off the storm's track`;
}
