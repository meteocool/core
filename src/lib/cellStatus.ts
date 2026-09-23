/**
 * Whether the storm in the panel is still there.
 *
 * Everything else in the detail view describes a detection, and a detection is
 * a photograph: the peak, the model, the charts all read the same whether DWD
 * saw this cell thirty seconds ago or lost it half an hour ago. The panel said
 * so in one muted word -- "dissipated", in the same grey as the age beside it
 * -- and said nothing at all about the two states between alive and gone.
 *
 * There are four, and they are different claims:
 *
 *   live        still being detected, and recently.
 *   stale       still flagged active, but nothing new has arrived. Either the
 *               cell is weakening past the detector's threshold or the feed
 *               has stopped; from here those look the same, and both mean the
 *               numbers above are older than they appear.
 *   superseded  ended, but into something -- it split or merged, and the
 *               family graph below has the cells that carry on. Not a storm
 *               that stopped; a storm that became other storms.
 *   ended       ended, full stop.
 *
 * Pure, because the distinction is the substance rather than the styling.
 */

export type CellStatusKind = "live" | "stale" | "superseded" | "ended";

export interface CellStatus {
  kind: CellStatusKind;
  /** Short enough for the header line, beside the band name and the age. */
  label: string;
}

/**
 * Past this, an active cell is reported stale.
 *
 * DWD publishes cell detections every five minutes, so one missed run is
 * ordinary jitter and says nothing. Three is not: by then the panel has been
 * describing the same detection for a quarter of an hour while presenting it
 * as current, which is the case this whole distinction exists for.
 */
export const STALE_MINUTES = 15;

export function cellStatus(track: {
  active: boolean;
  child_codes?: string[] | null;
  /** Minutes since the last detection; `cellRecency` computes it. */
  ageMinutes: number;
}): CellStatus {
  if (!track.active) {
    return (track.child_codes?.length ?? 0) > 0
      ? { kind: "superseded", label: "superseded" }
      : { kind: "ended", label: "dissipated" };
  }
  return track.ageMinutes >= STALE_MINUTES
    ? { kind: "stale", label: "no new data" }
    : { kind: "live", label: "live" };
}
