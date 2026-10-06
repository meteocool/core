/**
 * What a tap on the map does to the cell selection.
 *
 * Two things hang off a selected cell and they are wanted at different times.
 * One is the drawing: the forecast centroids, the cone of uncertainty and the
 * ringed centroid, which appear on the map for the selected cell only. The
 * other is the detail panel, which on a phone is most of the screen.
 *
 * On a desktop that distinction does not matter -- the panel takes a corner of
 * a large map and the storm stays visible beside it -- so a tap does both at
 * once, as it always has. On a phone the panel covers the thing it is
 * describing, and a reader who wants to see where the storm is going has no
 * way to ask for that without also being handed a screen of numbers on top of
 * it. So the two steps separate: the first tap draws the forecast and says how
 * to get the rest, the second opens it.
 *
 * Pure, and separate from the click handler, because the rules are small and
 * fiddly -- what a tap on the *already* selected cell does, what a tap on a
 * different one does, what closing the panel leaves behind -- and each of them
 * is a sentence that is easy to get backwards and impossible to see backwards
 * once it is spread across a component.
 */

export interface CellSelection {
  /** The cell whose marks are drawn, or null for none. */
  code: string | null;
  /** Whether the detail panel is open on it. */
  details: boolean;
}

export const NO_SELECTION: CellSelection = { code: null, details: false };

/**
 * The selection after tapping `tapped`, which is null for the map background.
 *
 * `twoStage` is the phone: a tap on a cell that is not already selected stops
 * at the drawing. Everywhere else, and for a second tap on the same cell, the
 * panel opens with it.
 */
export function nextSelection(
  current: CellSelection,
  tapped: string | null,
  twoStage: boolean,
): CellSelection {
  if (tapped === null) return NO_SELECTION;
  if (!twoStage) return { code: tapped, details: true };
  // The second tap. Also the case where the panel is already open and the
  // reader taps its cell again, which should leave it open rather than
  // toggling the panel shut from the map behind it.
  if (tapped === current.code) return { code: tapped, details: true };
  return { code: tapped, details: false };
}

/**
 * The selection after the panel's close button.
 *
 * On a phone this drops back to the drawing rather than clearing: closing the
 * numbers is how a reader asks to see the map again, and throwing the forecast
 * away with them would mean tapping the cell twice to get it back. The map
 * background still clears everything, which is where "I am done with this
 * storm" belongs. On a desktop the panel is not in the way of anything, so
 * closing it means what it always did.
 */
export function afterClose(current: CellSelection, twoStage: boolean): CellSelection {
  return twoStage ? { code: current.code, details: false } : NO_SELECTION;
}
