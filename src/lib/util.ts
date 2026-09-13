/** What an observer is handed: the subject that changed, and its payload. */
export type ObserverCallback = (subject: string, body: unknown) => void;

/**
 * The hand-rolled observer the capabilities notify through. Subjects are
 * strings ("grid", "loseFocus"), matched by the components that listen.
 */
export class Observable {
  private observers: ObserverCallback[] = [];

  addObserver(cb: ObserverCallback) {
    this.observers.push(cb);
  }

  notify(subject: string, body: unknown) {
    this.observers.forEach((h) => h(subject, body));
  }
}
