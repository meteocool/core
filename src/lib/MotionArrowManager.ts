import { derived, get } from "svelte/store";
import { fetchMotionLayer } from "../api";
import type { MotionLayer, Progress } from "../api";
import type { MotionEvent } from "../api/events";
import { capTimeIndicator, motionLayerVisible, onForecastStep, sharedActiveCap } from "../stores";
import type { MotionArrowLayer } from "../layers/motionArrows";
import { arrowsStale } from "./motionArrow";
import { whenVisible } from "./wakeup";

/**
 * The rain's motion arrows over the radar map, end to end: when to ask for
 * the tile set, and when the arrows are faint.
 *
 * The arrows are the newest motion, whatever frame the timeline shows; they
 * go faint on an observed frame well before them (`arrowsStale`). The tile
 * set is asked for when they come on and on a wake; the `motion` event names
 * each new one, which is switched to without asking, and only while they are
 * on and the page is looked at. A backend with no arrows is no arrows.
 */
export default class MotionArrowManager {
  private shown = false;

  /** The newest field the arrows on the map were drawn from, unix seconds; null before any. */
  private validAt: number | null = null;

  /** Bumped by every fetch, so an answer that lands after a newer one is dropped. */
  private generation = 0;

  private readonly unsubscribers: (() => void)[] = [];

  constructor(private readonly arrows: MotionArrowLayer, private readonly bar: Progress) {
    this.unsubscribers.push(derived([motionLayerVisible, sharedActiveCap], ([on, cap]) => on && cap === "radar")
      .subscribe((shown) => this.showChanged(shown)));
    this.unsubscribers.push(derived([capTimeIndicator, onForecastStep], (pair) => pair)
      .subscribe(() => this.restyle()));
  }

  /** A new tile set was drawn: switch to it, if the arrows are on. */
  received(event: MotionEvent) {
    if (!this.shown) return;
    whenVisible("motion", () => {
      // Newer than any answer still on its way.
      this.generation += 1;
      this.use(event.tile_id, event.valid_at);
    });
  }

  /** Coming back to the page: the newest arrows, if they are on. */
  resync() {
    if (this.shown) void this.fetch();
  }

  private showChanged(shown: boolean) {
    if (shown === this.shown) return;
    this.shown = shown;
    this.arrows.layer.setVisible(shown);
    if (shown) void this.fetch();
  }

  private async fetch() {
    const generation = ++this.generation;
    let layer: MotionLayer | null;
    try {
      layer = await fetchMotionLayer(this.bar);
    } catch {
      // None published yet, or the backend has none: no arrows, and the next
      // `motion` event brings the first.
      layer = null;
    }
    if (generation !== this.generation) return;
    if (layer) this.use(layer.tile_id, layer.valid_at);
    else this.use(null, null);
  }

  private use(tileId: string | null, validAt: number | null) {
    this.arrows.show(tileId);
    this.validAt = validAt;
    this.restyle();
  }

  private restyle() {
    const shown = get(capTimeIndicator);
    this.arrows.setStale(arrowsStale(shown > 0 ? shown : null, this.validAt, get(onForecastStep)));
  }

  destroy() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
  }
}
