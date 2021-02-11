export function roundToHour(date) {
  const p = 60 * 60 * 1000; // milliseconds in an hour
  return new Date(Math.round(date.getTime() / p) * p).getHours();
}

export class Observable {
  constructor() {
    this.observers = [];
  }

  addObserver(cb) {
    this.observers.push(cb);
  }

  notify(subject, body) {
    console.log(`emitting ${subject} event`);
    this.observers.forEach((h) => h(subject, body));
  }
}
