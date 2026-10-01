/**
 * Whether a panel is being drawn inside the phone's sheet (CellSheet).
 *
 * The sheet draws the way out itself: one close disc in its top corner,
 * outside the part that scrolls, so it stays put while the reading moves
 * under it. A panel's own disc lived in its header, and scrolled away with
 * it. So a panel asks this, and leaves its disc out when the sheet has one.
 *
 * Its own module rather than an export of CellSheet.svelte: the panels are
 * in the desktop's bundle, and importing the sheet would bring it there too.
 */
import { getContext, setContext } from "svelte";

const SHEET = "mc-sheet-draws-close";

/** Called by the sheet, during its own initialisation. */
export function provideSheet(): void {
  setContext(SHEET, true);
}

/** During a panel's initialisation: true inside a sheet. */
export function inSheet(): boolean {
  return getContext<boolean | undefined>(SHEET) === true;
}
