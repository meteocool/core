/** How long the strip takes to grow to a new width. */
const GROW_MS = 200;

/**
 * How long the strip waits, after the last download lands, before running
 * out to the end. Downloads come in chains (a list, then what is in it, a
 * grid and then its tiles' neighbours), and the next one starting just after
 * went back to the left edge; inside this, it carries on from where the
 * strip is, as one run.
 */
const SETTLE_MS = 400;

/**
 * How long a download has to be outstanding before the strip shows at all.
 * Most of what the app fetches in the background (the volumes every few
 * seconds, a grid every minute) lands well inside this, and a strip that ran
 * for each of them flashed across the top of the map all the time with
 * nothing to wait for.
 */
const SHOW_DELAY_MS = 300;

/** How long it takes to fade once it has run out to the end. */
const FADE_MS = 300;

/** Between two nudges of a strip waiting on something slow. */
const CREEP_MS = 250;

/** As far as the strip goes before the last download lands: only that takes it to the end. */
const CEILING = 95;

/**
 * The loading bar along the top of the page: one strip, however many
 * downloads are behind it.
 *
 * It used to wrap nanobar, which starts a new bar every time one reaches the
 * end and leaves the finished one to run out and fade over it. Downloads here
 * start and finish all the time, so the top of the page routinely carried two
 * or three bars at once (one running out to the edge across another
 * starting from the left), and the last download landing began a fresh one
 * that swept the whole width over nothing. This is a single strip: it only
 * grows while anything is loading, runs out to the end when the last of it
 * lands, fades, and starts from the left again for whatever comes next.
 *
 * Reference-counted by id: a finish only counts against a start under the
 * same id. Built on first use, not on construction, so a module that imports
 * this without a page (the tests) builds nothing.
 */
export default class NanobarWrapper {
  /** Outstanding downloads, by the id passed to start(). */
  private readonly clients = new Map<string, number>();

  /** Downloads started and landed since the strip last stood empty: how far along it is. */
  private started = 0;

  private landed = 0;

  /** How full the strip is, in percent. It never shrinks while it is showing. */
  private width = 0;

  private strip: HTMLDivElement | null = null;

  private fill: HTMLDivElement | null = null;

  private creepTimer: ReturnType<typeof setTimeout> | null = null;

  /** The settle, run-out, fade and reset after the last download, while they are pending. */
  private doneTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether the strip has begun running out, so that what starts now is a new run. */
  private ending = false;

  /** The wait before a run's strip shows (`SHOW_DELAY_MS`), while it is pending. */
  private showTimer: ReturnType<typeof setTimeout> | null = null;

  start(id: string): void {
    if (this.width > 0 && !this.ending && this.doneTimer !== null) {
      // Still settling: this is part of the same run.
      clearTimeout(this.doneTimer);
      this.doneTimer = null;
    }
    this.clients.set(id, (this.clients.get(id) ?? 0) + 1);
    this.started += 1;
    if (this.width > 0 && !this.ending) {
      this.update();
    } else if (this.showTimer === null) {
      // A new run, shown only if it is still going in a moment. One that
      // starts while the last is running out lets it finish first rather
      // than cutting it off, which flashed one strip straight after another.
      this.showTimer = setTimeout(() => this.show(), SHOW_DELAY_MS);
    }
  }

  finish(id: string): void {
    const count = this.clients.get(id);
    if (count === undefined) return;
    if (count > 1) this.clients.set(id, count - 1);
    else this.clients.delete(id);
    this.landed += 1;
    if (this.width > 0 && !this.ending) {
      this.update();
    } else if (this.clients.size === 0 && this.showTimer !== null) {
      // Done before it was worth showing: nothing was drawn, and nothing is.
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  /** The delay is up: show the run, if any of it is still loading. */
  private show(): void {
    this.showTimer = null;
    if (this.clients.size === 0) return;
    if (this.ending) {
      // The last run is still running out or fading: bring the same strip
      // back up and carry on with it, rather than cut it off and start a
      // second one from the left straight after it.
      if (this.doneTimer !== null) clearTimeout(this.doneTimer);
      this.doneTimer = null;
      this.ending = false;
      if (this.strip) {
        this.strip.style.transition = `opacity ${GROW_MS}ms ease-out`;
        this.strip.style.opacity = "1";
      }
      this.creep();
      return;
    }
    // The run counts from what is still out: what landed inside the delay
    // was never shown.
    this.started = [...this.clients.values()].reduce((sum, count) => sum + count, 0);
    this.landed = 0;
    this.update();
  }

  private update(): void {
    if (this.clients.size === 0) {
      this.complete();
      return;
    }
    // A share of the way for each download that has landed, from a first
    // step that says something has started.
    this.grow(10 + (CEILING - 10) * (this.landed / this.started));
    this.creep();
  }

  /** Inch towards the ceiling while waiting, more slowly the closer it gets. */
  private creep(): void {
    if (this.creepTimer !== null) return;
    this.creepTimer = setTimeout(() => {
      this.creepTimer = null;
      if (this.clients.size === 0) return;
      this.grow(this.width + (CEILING - this.width) * 0.04);
      this.creep();
    }, CREEP_MS);
  }

  /** Settle, run out to the end, fade, and stand empty again. */
  private complete(): void {
    if (this.creepTimer !== null) clearTimeout(this.creepTimer);
    this.creepTimer = null;
    if (this.width === 0 || this.doneTimer !== null) return;
    this.doneTimer = setTimeout(() => {
      this.ending = true;
      this.grow(100);
      this.doneTimer = setTimeout(() => {
        if (this.strip) {
          this.strip.style.transition = `opacity ${FADE_MS}ms ease-out`;
          this.strip.style.opacity = "0";
        }
        this.doneTimer = setTimeout(() => this.reset(), FADE_MS);
      }, GROW_MS);
    }, SETTLE_MS);
  }

  /** Empty and hidden, at once. */
  private reset(): void {
    if (this.doneTimer !== null) clearTimeout(this.doneTimer);
    this.doneTimer = null;
    this.ending = false;
    this.started = 0;
    this.landed = 0;
    this.width = 0;
    if (!this.fill || !this.strip) return;
    this.fill.style.transition = "none";
    this.fill.style.width = "0%";
    this.strip.style.transition = "none";
    this.strip.style.opacity = "0";
  }

  private grow(target: number): void {
    const width = Math.min(Math.max(this.width, target), 100);
    const elements = this.elements();
    if (!elements) return;
    const [strip, fill] = elements;
    if (this.width === 0) {
      // Shown at once, from the left edge, with the width transition only
      // back on once the empty strip has been laid out.
      strip.style.transition = "none";
      strip.style.opacity = "1";
      void fill.offsetWidth;
    }
    fill.style.transition = `width ${GROW_MS}ms ease-out`;
    fill.style.width = `${width}%`;
    this.width = width;
  }

  private elements(): [HTMLDivElement, HTMLDivElement] | null {
    if (this.strip && this.fill) return [this.strip, this.fill];
    if (typeof document === "undefined") return null;
    const strip = document.createElement("div");
    strip.className = "nanobar";
    strip.style.opacity = "0";
    const fill = document.createElement("div");
    fill.className = "nanobar-fill";
    strip.appendChild(fill);
    document.body.appendChild(strip);
    this.strip = strip;
    this.fill = fill;
    return [strip, fill];
  }
}
