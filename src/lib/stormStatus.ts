/**
 * Whether the storm in the panel is still there: lib/cellStatus.ts's four
 * states, for a storm instead of a KONRAD3D cell.
 *
 *   live    still being seen, and recently.
 *   stale   still active, but nothing new has arrived for a while.
 *   merged  ran into another storm, which carries on (`merged_into`).
 *   ended   no track of it has been seen for long enough to call it gone.
 *
 * A storm's status is the backend's (active, ended or merged, as `/storms`
 * answers it); only the line between live and stale is drawn here, from how
 * long ago it was last seen, as a cell's is.
 */
import type { Translate } from "../locale/t";
import { STALE_MINUTES } from "./cellStatus";
import type { StormStatus } from "../api";

export type StormStatusKind = "live" | "stale" | "merged" | "ended";

export interface StormStatusLabel {
  kind: StormStatusKind;
  /** Short enough for the header line. */
  label: string;
}

export function stormStatus(
  storm: { status: StormStatus },
  ageMinutes: number,
  t: Translate,
): StormStatusLabel {
  const status = (kind: StormStatusKind): StormStatusLabel => ({ kind, label: t(`storm.status.${kind}`) });
  if (storm.status === "merged") return status("merged");
  if (storm.status === "ended") return status("ended");
  return status(ageMinutes >= STALE_MINUTES ? "stale" : "live");
}
