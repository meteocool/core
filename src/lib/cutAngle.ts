/**
 * The cutaway's slice angle, as a reader turns it.
 *
 * Kept apart from `cellCutaway.ts`, which fetches and so imports the URL
 * configuration -- and that reads Vite's `import.meta.env`, which does not
 * exist under the test runner. Arithmetic about angles has no business
 * depending on the bundler.
 */
import type { Translate } from "../locale/t";

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
 * What the slice is measured from.
 *
 * A KONRAD3D cell has a track, and the track is what makes an angle mean
 * something: along it is where an overhang shows. A storm core found only in
 * the radar composite has no track at all, so its slice is measured from north
 * instead -- and saying "along the track" about it would be claiming a
 * direction of travel nobody measured.
 */
export type CutReference = "track" | "north";

/**
 * What the caption says about the slice.
 *
 * Named by its angle to whatever it is measured from. Which half is kept does
 * not change what the cut is, so 0 and 180 read the same.
 */
export function cutLabel(degrees: number, t: Translate, reference: CutReference = "track"): string {
  const off = Math.abs(normaliseCut(degrees));
  const toAxis = Math.min(off, 180 - off);
  if (reference === "north") {
    if (toAxis < 1) return t("storm.cut.north_south");
    if (Math.abs(toAxis - 90) < 1) return t("storm.cut.east_west");
    return t("storm.cut.off_north", { values: { deg: Math.round(toAxis) } });
  }
  if (toAxis < 1) return t("storm.cut.along");
  if (Math.abs(toAxis - 90) < 1) return t("storm.cut.across");
  return t("storm.cut.off_track", { values: { deg: Math.round(toAxis) } });
}

/** The two snap buttons' labels, for whichever the slice is measured from. */
export function cutSnapLabels(reference: CutReference, t: Translate): [string, string] {
  return reference === "north"
    ? [t("storm.cut.snap_ns"), t("storm.cut.snap_ew")]
    : [t("storm.cut.snap_along"), t("storm.cut.snap_across")];
}
