/**
 * What the player's play button does where the screen has no forecast.
 *
 * Playback runs from the past through the forecast. Where the forecast covers
 * none of the screen (Aquitaine, Poland: radar, but no forecast), the forecast
 * steps are washed out and playing into them shows nothing. So play is off on
 * now and after it, and from the past it loops the past radar instead.
 */

const STEP_S = 5 * 60;

export interface LoopState {
  /** The frame on screen, epoch seconds. */
  shown: number;
  /** The newest observed frame. */
  latestObservation: number;
  /** The grid's now, where a full playback starts again. */
  now: number;
  /** The last frame playback may reach: the forecast's end. */
  lastStep: number;
  /** The grid's first frame. */
  start: number;
  /** Where playback was started from. */
  loopFrom: number;
  /** The "play from the start" setting. */
  fromStart: boolean;
  /** The forecast covers none of the screen. */
  noForecast: boolean;
}

/** Whether play can be pressed: there is anything on screen to play. */
export function canPlay({ outOfRadar, noForecast, shown, latestObservation }: {
  outOfRadar: boolean;
  noForecast: boolean;
  shown: number;
  latestObservation: number;
}): boolean {
  if (outOfRadar) return false;
  return !noForecast || shown < latestObservation;
}

/** The frame after `shown`, wrapping round at the end of what is worth playing. */
export function nextFrame(state: LoopState): number {
  const { shown, latestObservation, now, lastStep, start, loopFrom, fromStart, noForecast } = state;
  if (noForecast) {
    if (shown < latestObservation) return shown + STEP_S;
    // Back to where play was pressed, unless that was no earlier than now.
    return fromStart || loopFrom >= latestObservation ? start : loopFrom;
  }
  if (shown >= lastStep) return fromStart ? start : now;
  return shown + STEP_S;
}
