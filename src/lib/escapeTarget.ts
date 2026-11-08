/**
 * Whether an Escape belongs to the field it was typed in rather than to the
 * radar tray, which Escape otherwise closes.
 *
 * A key's target is not always an element: iOS's web view hands some keys to
 * the window itself, and the tray asking whether it contains the window threw
 * on every Escape there. Such a target is no field, so Escape closes the tray.
 */
export interface KeyTarget {
  /** A contenteditable element. */
  editable: boolean;
  /** An input, textarea or select. */
  field: boolean;
  /** Inside the tray, such as its own tilt control. */
  inTray: boolean;
}

/** `target` is null where the key's target is not an element. */
export function escapeBelongsToField(target: KeyTarget | null): boolean {
  if (!target) return false;
  return target.editable || (target.field && !target.inTray);
}
