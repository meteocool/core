/**
 * How sharply a flight is drawn, kept to what the machine can draw fast
 * enough: counting the frames, and where there have been too few of them
 * for a moment, a step less; more again, slowly, once there have been
 * plenty for a while. Thirty a second is the least a flight should have.
 *
 * Less sharpness only helps when the flight's own drawing is what is slow.
 * Another tab or program can be using the GPU, and then a flight is as slow
 * at a tenth of its sharpness as at all of it: when half the work has been
 * given up without the frames coming a quarter faster, it is given back,
 * and nothing more is given up for a while, longer each time that happens.
 */

/** The fewest frames a second a flight should have, and how many are plenty. */
export const FPS_LEAST = 30;
export const FPS_PLENTY = 47;
/** How long into a flight its frames begin to count, seconds drawn. */
export const SETTLE_S = 6;
/** The least sharpness a flight is drawn at. */
export const QUALITY_LEAST = 0.1;
/** The longest a frame is taken to have been, seconds: a gap as long as that is a tab that was away, not a frame. */
export const LONGEST_FRAME_S = 8;
/**
 * A way down that has given up at least half of where it began, with the
 * frames not this much faster than they were there, has not been the
 * flight's own doing.
 */
export const HELPED = 1.25;
/** How long nothing is given up after a way down that did not help, seconds; doubled each time, up to the most. */
export const HOLD_S = 20;
export const HOLD_MOST_S = 160;
/** Frames enough for this long and the way down has worked: the next slow stretch starts a new one. */
const DESCENT_DONE_S = 3;

export class Sharpness {
  /** Frames a second, smoothed. */
  fps = 60;
  quality: number;
  private drawn = 0;
  private tooSlow = 0;
  private plenty = 0;
  private enough = 0;
  private sinceLowered = Infinity;
  /** Where the way down under way began: the sharpness, and the frames there. */
  private descent: { quality: number; fps: number } | null = null;
  private held = 0;
  private holdS = HOLD_S;

  constructor(quality: number) {
    this.quality = quality;
  }

  /** A frame drawn, `elapsed` seconds after the last: the new sharpness when it changed, otherwise null. */
  frame(elapsed: number): number | null {
    // A frame after a pause, or a tab that was away, says nothing of how fast frames come.
    if (elapsed <= 0 || elapsed > LONGEST_FRAME_S) return null;
    // Averaged over half a second, however many frames that is: a flight drawn once a second is told so within two of them.
    this.fps += (1 / elapsed - this.fps) * (1 - Math.exp(-elapsed / 0.5));
    // The first seconds of a flight are the map fetching what it is about to draw, not how fast it draws it.
    this.drawn += elapsed;
    if (this.drawn < SETTLE_S) return null;
    const slow = this.fps < FPS_LEAST + 2;
    // One long frame is a hitch, not a slow flight: it counts for no more than half a second of one.
    this.tooSlow = slow ? this.tooSlow + Math.min(elapsed, 0.5) : 0;
    this.plenty = this.fps > FPS_PLENTY ? this.plenty + elapsed : 0;
    this.enough = slow ? 0 : this.enough + elapsed;
    this.sinceLowered += elapsed;
    this.held = Math.max(0, this.held - elapsed);
    if (this.enough > DESCENT_DONE_S) this.descent = null;
    // Frames plenty for a while: whatever was in the way has gone.
    if (this.plenty > 6) this.holdS = HOLD_S;
    if (this.tooSlow > 1.5 && this.quality > QUALITY_LEAST && this.held === 0) {
      const descent = this.descent ?? { quality: this.quality, fps: this.fps };
      if (this.quality <= descent.quality / 2 && this.fps < descent.fps * HELPED) {
        // Half of it given up for nothing: all of it back.
        this.quality = descent.quality;
        this.descent = null;
        this.held = this.holdS;
        this.holdS = Math.min(HOLD_MOST_S, this.holdS * 2);
      } else {
        this.descent = descent;
        // A long way short of enough is made up in one step, not in six.
        this.quality = Math.max(QUALITY_LEAST, this.quality - (this.fps < 20 ? 0.3 : 0.15));
        this.sinceLowered = 0;
      }
    } else if (this.plenty > 6 && this.quality < 1 && this.sinceLowered > 25) {
      // Not straight back to where it was just too much: that only goes round again.
      this.quality = Math.min(1, this.quality + 0.15);
    } else {
      return null;
    }
    this.tooSlow = 0;
    this.plenty = 0;
    return this.quality;
  }
}
