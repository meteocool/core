/**
 * Where to put the time labels under a chart.
 *
 * The panel's charts used to label three moments: the first reading, the last
 * one, and the end of the forecast. That was tied to a shaded lead-time band
 * which has since gone -- radar predicts a cell's position, not its intensity,
 * so there was never a forecast trace to mark the start of -- and what was
 * left was an axis whose labels moved with the data rather than standing at
 * readable times. A cell tracked from 16:07 to 16:52 had "16:07" and "16:52"
 * under it and nothing in between.
 *
 * So the ticks land on the clock instead: whole minutes at a step chosen to
 * fit, which is what makes two charts stacked over the same window line up
 * with each other and with the times written everywhere else in the panel.
 */

/**
 * The steps worth using, in minutes.
 *
 * Every one divides an hour or is a whole number of them, so a run of ticks
 * reads as a sequence rather than as arithmetic: 15, 30, 45 and not 13, 26, 39.
 * DWD's cadence is five-minutely, which is the floor -- a finer step would
 * label moments no reading exists at.
 */
export const STEPS_MINUTES = [5, 10, 15, 30, 60, 120, 180, 360, 720];

const MINUTE = 60_000;

/**
 * Ticks across `[from, to]`, aiming for about `target` of them.
 *
 * Aligned to the clock, so a tick falls on 16:30 rather than 16:31, and both
 * ends are included when nothing else lands near them. Always returns at least
 * the two ends: a chart with a span too short for any step -- a cell seen once
 * or twice -- still has to say what it is showing, which was the failure the
 * old three-point axis hid by labelling whatever the data happened to be.
 */
export function timeTicks(from: number, to: number, target = 4): number[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return Number.isFinite(from) ? [from] : [];
  }
  const spanMinutes = (to - from) / MINUTE;
  const step = (STEPS_MINUTES.find((minutes) => spanMinutes / minutes <= target)
    ?? STEPS_MINUTES[STEPS_MINUTES.length - 1]) * MINUTE;

  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);

  // The ends, unless a step already put a tick close enough that two labels
  // would collide. Half a step: a third was not enough and the charts showed
  // it -- an axis running 14:35 to 18:28 in hourly steps printed "14:35" hard
  // against "15:00" and "18:00" against "18:28", because a label is about as
  // wide as twenty minutes is at these scales.
  const gap = step / 2;
  if (!ticks.length || ticks[0] - from > gap) ticks.unshift(from);
  if (to - ticks[ticks.length - 1] > gap) ticks.push(to);
  // A window shorter than one step can come out with a single label sitting
  // near the middle of it, which says less than nothing: an axis has to state
  // the range it covers even when there is no room for a tick inside it.
  return ticks.length > 1 ? ticks : [from, to];
}
