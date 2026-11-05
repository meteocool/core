import { derived, get } from "svelte/store";
import {
  archiveWindow, capDescription, capLastUpdated, capTimeIndicator, sharedActiveCap, showForecastPlaybutton,
} from "../stores";
import type { Map } from "ol";
import type BaseLayer from "ol/layer/Base";
import type NanobarWrapper from "../lib/NanobarWrapper";
import type { CapabilityOptions } from "./options";
import Capability from "./Capability";
import { NothingPublished, fetchPrecipitationTypes } from "../api";
import { dwdPrecipTypes } from "../layers/dwd";

export default class PrecipitationTypesCapability extends Capability {
  /** The current tile layer, replaced whenever a new tile set lands. */
  currentLayer: BaseLayer | null;

  private nb?: NanobarWrapper;

  /**
   * In a past window (lib/archive.ts), the step whose precipitation types
   * are drawn: the HG frame measured at or before it, within ten minutes.
   * Null live, for the newest.
   */
  private at: number | null = null;

  /** Numbers each request, so an answer for a step left behind is dropped. */
  private asked = 0;

  private atTimer: number | undefined;

  constructor(map: Map, additionalLayers: BaseLayer[], args: CapabilityOptions) {
    super(map, "precipTypes", () => {
      capDescription.set("foo");
      showForecastPlaybutton.set(false);
      this.fetchPrecipTypes();
    }, additionalLayers);

    if (args.cmap) super.setCmap(args.cmap);

    this.currentLayer = null;
    this.nb = args.nanobar;

    /* A step of a past window, once it rests; live again, the newest. */
    derived([archiveWindow, capTimeIndicator], ([past, shown]) => (past ? (shown || past.end) : null))
      .subscribe((at) => {
        if (at === this.at) return;
        const was = this.at;
        this.at = at;
        window.clearTimeout(this.atTimer);
        // Only while this map is the one on screen; switching to it fetches.
        if (get(sharedActiveCap) !== "precipTypes") return;
        if (at === null && was === null) return;
        this.atTimer = window.setTimeout(() => void this.fetchPrecipTypes(), at === null ? 0 : 300);
      });
  }

  /** Without this it only fetches when shown, so a failed first fetch would stay failed. */
  resync() {
    void this.fetchPrecipTypes();
  }

  async fetchPrecipTypes() {
    this.asked += 1;
    const asked = this.asked;
    const { at } = this;
    const data = await fetchPrecipitationTypes(this.nb, at ?? undefined).catch((error) => {
      // None measured near a past step: the map shows none, not the last step's.
      if (at !== null && error instanceof NothingPublished) this.removeLayer();
      return null;
    });
    if (!data || asked !== this.asked) return;
    if (this.currentLayer && this.currentLayer.get("tile_id") === data.tile_id) return;

    const newLayer = dwdPrecipTypes(data);
    newLayer.set("tile_id", data.tile_id);
    super.getMap().addLayer(newLayer);
    if (this.currentLayer) {
      super.getMap().removeLayer(this.currentLayer);
      // Removed is not released: its renderer, tiles and GPU target stayed.
      this.currentLayer.dispose();
    }
    this.currentLayer = newLayer;
    if (at === null) capLastUpdated.set(new Date(data.processed_time * 1000));
  }

  private removeLayer() {
    if (!this.currentLayer) return;
    super.getMap().removeLayer(this.currentLayer);
    this.currentLayer.dispose();
    this.currentLayer = null;
  }
}
