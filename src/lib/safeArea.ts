/**
 * Where the top line of the page's chrome starts, in pixels: the safe area's
 * top inset and a gutter (`--mc-top-stack`, glass.css).
 *
 * What a popover opened upward from the tray must stop under. On the iOS app
 * the page runs under the status bar, which the app blurs over, so a card
 * reaching the window's top edge has its header, close button included,
 * under the blur. Android's app pads the web view below its bars instead,
 * and its inset here is 0: the gutter alone.
 *
 * Measured off a probe, because `env()` resolves only in a stylesheet: the
 * custom property itself reads back as its unresolved text.
 */
export function topStackPx(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;height:0;padding-top:var(--mc-top-stack)";
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return px;
}
