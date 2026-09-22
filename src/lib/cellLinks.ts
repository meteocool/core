import type { CellStep, CellTrackProperties } from "../api";

/**
 * The joins between a storm and what it split into or merged from.
 *
 * DWD's tracker does not continue a cell through a split or a merge: it ends
 * the codes that went in and starts the ones that came out, and records the
 * relationship in `parent_codes` / `child_codes`. The map drew each code's own
 * centroids and nothing else, so one storm that split at 16:40 was two lines
 * with a gap between them, and two storms that merged were three lines
 * meeting nowhere. The lineage was in the data and on the family chart in the
 * panel, and absent from the one place the storm is actually being watched.
 *
 * A link is one (parent, child) pair as a two-point segment. That single shape
 * covers both events, because both are the same relationship counted
 * differently: a split is one parent with several children, a merge several
 * parents with one child. Nothing here knows which it is looking at, and the
 * map draws them identically -- what a reader sees is the track dividing or
 * converging, which is what happened.
 *
 * Pure, and separate from the drawing, because the fiddly part is choosing
 * *where* on the parent the join belongs rather than how to stroke it.
 */

/** Longitude, latitude -- the order the feed and OpenLayers' 4326 both use. */
export type LonLat = [number, number];

export interface CellLink {
  /** The parent's code. */
  from: string;
  /** The child's code. */
  to: string;
  /** Where the parent was when the child appeared. */
  start: LonLat;
  /** The child's first detection. */
  end: LonLat;
}

const at = (step: CellStep): LonLat => [step.lon, step.lat];

const timeOf = (step: CellStep): number => new Date(step.t).getTime();

/**
 * Where on the parent's track the join belongs: its position at `when`.
 *
 * Not simply the parent's last point. A split leaves the parent running --
 * DWD keeps the original code alive alongside the new one often enough that
 * it matters -- so a line drawn from where the parent ended to where the child
 * began runs backwards through half an hour of history and crosses the whole
 * track to get there. The honest anchor is where the parent was at the moment
 * the child was first detected, which for a merge or a hand-over is the
 * parent's last point anyway, because that is when the child starts.
 *
 * The step at or before `when`; the first step if the parent's own history
 * starts later, which `trimToLastRun` can produce by cutting a glued start off
 * a parent whose child was not trimmed the same way.
 */
export function anchorAt(series: CellStep[], when: number): LonLat | null {
  if (!series.length) return null;
  // The series runs forwards, so the last step not past `when` is the answer
  // and there is no reason to read the rest of the track.
  let chosen = series[0];
  for (let i = 0; i < series.length; i += 1) {
    if (timeOf(series[i]) > when) break;
    chosen = series[i];
  }
  return at(chosen);
}

/**
 * Every join between the tracks in `drawn`.
 *
 * Taken from the child's `parent_codes` only, as the family chart does: both
 * endpoints record the relationship, and reading it from both would emit every
 * join twice. A relative that is not in `drawn` -- outside the viewport, or
 * older than the window that was asked for -- has no position to draw to and
 * is skipped rather than guessed at.
 */
export function buildCellLinks(drawn: Map<string, CellTrackProperties>): CellLink[] {
  const links: CellLink[] = [];
  drawn.forEach((child, code) => {
    const born = (child.series ?? [])[0];
    if (!born) return;
    (child.parent_codes ?? []).forEach((parentCode) => {
      const parent = drawn.get(parentCode);
      if (!parent) return;
      const start = anchorAt(parent.series ?? [], timeOf(born));
      if (!start) return;
      links.push({
        from: parentCode, to: code, start, end: at(born),
      });
    });
  });
  return links;
}

/**
 * The cells that have been replaced by something else on the same map.
 *
 * DWD ends a code at a split or a merge and starts new ones, so for the hour a
 * track stays on screen the storm is drawn twice: the cell that became
 * something else sits at its last position with its dot, badge and outline,
 * beside the cell that carries on. Both look like storms, and only one is.
 *
 * The test is that a child has been detected more recently than it has --
 * evidence, from the two tracks themselves, that the detector has moved on
 * from this code onto that one. Not the `active` flag, which is what the panel
 * leans on and what this was first written against: upstream sets it from a
 * window rather than from the latest run, so in a real merge -- three cells
 * last seen at 00:30 absorbed into one that ran on to 00:35 -- all four were
 * still flagged active, and the map drew four storms where there was one.
 *
 * Strictly newer, so a split whose cells are both still being detected hides
 * neither: two cells in the same run are two storms, which is what a split is.
 *
 * What this takes away is the present tense: the dot, the badge and the
 * outline, which claim a cell is there now. The path stays, joined to the
 * continuation by `buildCellLinks`, because where the storm has been is still
 * true. A continuation has to be on the map for any of it to fire -- a child
 * named but not drawn is no reason to remove the only mark a storm has.
 */
export function supersededCodes(drawn: Map<string, CellTrackProperties>): Set<string> {
  const superseded = new Set<string>();
  drawn.forEach((track, code) => {
    const seen = new Date(track.last_seen).getTime();
    const continues = (track.child_codes ?? []).some((childCode) => {
      const child = drawn.get(childCode);
      return child !== undefined && new Date(child.last_seen).getTime() > seen;
    });
    if (continues) superseded.add(code);
  });
  return superseded;
}
