import Nanobar from "nanobar";

/**
 * Reference-counted wrapper around nanobar: several downloads share one bar,
 * and it only completes once the last of them finishes.
 */
export default class NanobarWrapper {
  private nb: Nanobar;

  /** Outstanding requests, keyed by the id passed to start(). */
  private clients: Record<string, number>;

  private activeTimeout: ReturnType<typeof setTimeout> | null;

  private manual: number;

  private manualHighwater: number;

  constructor(params: Record<string, unknown>) {
    this.nb = new Nanobar(params);
    this.clients = {};
    this.activeTimeout = null;
    this.manual = 0;
    this.manualHighwater = 0.1;
  }

  start(id) {
    if (id in this.clients) {
      this.clients[id] += 1;
    } else {
      this.clients[id] = 1;
    }
    this.tick();
  }

  manualUp() {
    this.manual += 1;
    if (this.manual > this.manualHighwater) {
      this.manualHighwater = this.manual;
    }
  }

  manualDown() {
    this.manual -= 1;
    if (this.manual <= 0) {
      this.manualHighwater = 0.1;
      this.nb.go(100);
    }
    if (this.manual % 11 === 0) this.tick();
  }

  finish(id) {
    if (id in this.clients) {
      this.clients[id] -= 1;
      if (this.clients[id] === 0) {
        delete this.clients[id];
      }
      this.tick();
    }
  }

  arm(target) {
    this.nb.go(target);
    if (target < 95) this.activeTimeout = setTimeout((t) => this.arm(t), 100, target + 0.1);
    else this.activeTimeout = null;
  }

  tick() {
    const nActive = Object.keys(this.clients).length;
    if (nActive === 0 && this.manual <= 0) {
      this.nb.go(100);
      if (this.activeTimeout !== null) clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    } else {
      let nSteps = nActive + 2;
      if (this.manual > 0) {
        nSteps += 1;
      }
      if (this.activeTimeout) {
        // Animation is running and needs to be restarted with new parameters
        if (this.activeTimeout !== null) clearTimeout(this.activeTimeout);
        this.activeTimeout = null;
      }
      this.arm(
        Math.ceil(100 / nSteps + 1) +
          ((this.manualHighwater - this.manual) / this.manualHighwater) *
            (100 / nSteps),
      );
    }
  }
}
