import Nanobar from 'nanobar';

export class NanobarWrapper {
  constructor(params) {
    this.nb = new Nanobar(params);
    this.clients = {};
    this.activeTimeout = null;
  }

  start(id) {
    if (id in this.clients) {
      this.clients[id] += 1;
    } else {
      this.clients[id] = 1;
    }
    this.tick();
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
    if (nActive === 0) {
      this.nb.go(100);
      clearTimeout(this.activeTimeout);
      this.activeTimeout = null;
    } else {
      const nSteps = nActive + 2;
      if (this.activeTimeout) {
        // Animation is running and needs to be restarted with new parameters
        clearTimeout(this.activeTimeout);
        this.activeTimeout = null;
      }
      this.arm(Math.ceil(100 / nSteps + 1));
    }
  }
}
