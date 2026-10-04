/**
 * Collect items as they arrive and hand them over together, at most once per
 * `windowMs`: the first item starts the window, and everything that arrives
 * before it closes goes in the same call.
 *
 * For a feed whose items each cost a full redraw. Live strikes are the case
 * it was written for: each one reclustered every strike on the map and drew
 * the whole map again, so a storm sending twenty a second kept the map
 * redrawing twenty times a second with nobody touching it.
 */
export interface Coalescer<T> {
  push(item: T): void;
  /** Drop whatever is waiting, for a feed that is being taken down. */
  cancel(): void;
}

export function coalesce<T>(flush: (items: T[]) => void, windowMs: number): Coalescer<T> {
  let pending: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    push(item: T) {
      pending.push(item);
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        const items = pending;
        pending = [];
        flush(items);
      }, windowMs);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = [];
    },
  };
}
