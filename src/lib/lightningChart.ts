/**
 * The lightning histogram's y axis, which is labelled at its two ends only:
 * 0 at the foot and the busiest minute at the top, where the axis ends.
 *
 * Read off the tick's value rather than its place in the list: Chart.js
 * lists a vertical axis's ticks from the bottom up, and a rule that took the
 * first one for the top put the peak at the foot of the chart and the
 * quietest minute at its top.
 */
export function yTickLabel(value: number, peak: number): string {
  return value === 0 || value === peak ? String(value) : "";
}
