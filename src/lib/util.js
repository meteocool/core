export class Observable {
  constructor() {
    this.observers = [];
  }

  addObserver(cb) {
    this.observers.push(cb);
  }

  notify(subject, body) {
    // console.log(`emitting ${subject} event`);
    this.observers.forEach((h) => h(subject, body));
  }
}
