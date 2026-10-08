/**
 * Whether the storm in the panel is still there.
 *
 * Everything else in the detail view describes a detection, and a detection is
 * a photograph: the peak, the model, the charts all read the same whether DWD
 * saw this cell thirty seconds ago or lost it half an hour ago. The panel used
 * to say so in one muted word ("dissipated", in the same grey as the age
 * beside it) and said nothing about the two states between alive and gone.
 *
 * There are four, and they are different claims:
 *
 *   live        still being detected, and recently.
 *   stale       still flagged active, but nothing new has arrived. Either the
 *               cell is weakening past the detector's threshold or the feed
 *               has stopped; from here those look the same, and both mean the
 *               numbers above are older than they appear.
 *   superseded  ended by splitting or merging into other cells, which the
 *               family graph below shows carrying on.
 *   ended       ended, full stop.
 *
 * Pure, because the distinction is the substance rather than the styling.
 */
import type { Translate } from "../locale/t";

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
 * ordinary jitter and says nothing. After three, the panel has been showing
 * the same detection as current for a quarter of an hour, which is what the
 * stale state is for.
 */
export const STALE_MINUTES = 15;

export function cellStatus(track: {
  active: boolean;
  child_codes?: string[] | null;
  /** Minutes since the last detection; `cellRecency` computes it. */
  ageMinutes: number;
}, t: Translate): CellStatus {
  const status = (kind: CellStatusKind): CellStatus => ({ kind, label: t(`storm.status.${kind}`) });
  if (!track.active) {
    return status((track.child_codes?.length ?? 0) > 0 ? "superseded" : "ended");
  }
  return status(track.ageMinutes >= STALE_MINUTES ? "stale" : "live");
}
