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
import { writable } from "svelte/store";
import type { Writable } from "svelte/store";

const SHEET = "mc-sheet-draws-close";
const SHARE = "mc-sheet-share";

/**
 * A panel's share action, which the sheet draws beside its close disc for the
 * same reason it draws that: so it stays put while the panel scrolls. Given
 * the control it was pressed on, which an iPad's popover points at.
 */
export type SheetShare = (anchor: Element | null) => void;

/** Called by the sheet, during its own initialisation. Returns where a panel puts its share action. */
export function provideSheet(): Writable<SheetShare | null> {
  setContext(SHEET, true);
  const share = writable<SheetShare | null>(null);
  setContext(SHARE, share);
  return share;
}

/** During a panel's initialisation: where to hand the sheet a share action, inside a sheet. */
export function sheetShare(): Writable<SheetShare | null> | undefined {
  return getContext<Writable<SheetShare | null> | undefined>(SHARE);
}

/** During a panel's initialisation: true inside a sheet. */
export function inSheet(): boolean {
  return getContext<boolean | undefined>(SHEET) === true;
}
