import IndexedTileSource, { blankTile, fillTemplate, loadImage, present } from "./indexedTiles";
import { chBorders, czBordersNearDwd, frBordersNearDwd, plBordersNearDwd } from "./extents";
import { maskPath, maskTile, overlaps, tileExtent } from "./tileMask";
import type { TileIndex } from "../lib/tileIndex";
import type { NetworkEvent } from "../api/events";

/** A network, by the code the backend files it under. */
export type NetworkCode = NetworkEvent["network"];

/**
 * DWD tiles with the EUMETNET networks' countries cut out of them.
 *
 * Inside those networks' borders their own layers are the ones that
 * should be on screen, and they cannot simply be stacked on top: every palette
 * here is part transparent, so DWD underneath would blend through into colours
 * neither radar measured. The overlap has to actually go away, and it cannot
 * go away by clipping the DWD layer -- both of its variants are
 * `ol/layer/WebGLTile`, whose render events carry a `WebGLRenderingContext`
 * and no 2D context to call `clip()` on.
 *
 * So the holes are punched into the tile images themselves, before OpenLayers
 * ever sees them (`tileMask.ts`, which the 3D map cuts with too). That works
 * whichever renderer draws them.
 *
 * Only tiles that actually meet a hole are touched; the rest are handed back
 * exactly as loaded, so this costs nothing for the vast majority of the grid.
 */

/** Every network's hole, with its bounding box for a cheap first test. Shared with the 3D map. */
export const HOLES = ([
  ["ch", chBorders],
  ["fr", frBordersNearDwd],
  ["cz", czBordersNearDwd],
  ["pl", plBordersNearDwd],
] as [NetworkCode, number[][][]][]).map(([code, rings]) => ({ code, ...maskPath(rings) }));

/** Every network: what the live frame is holed for. */
export const ALL_NETWORKS: NetworkCode[] = HOLES.map((hole) => hole.code);

/**
 * An `ImageTileSource` whose tiles have the networks' countries erased -- on
 * the steps where those networks have a frame of their own to draw instead.
 *
 * The EUMETNET networks have history but no forecast. So a network is cut out
 * of an observed step when the grid has its composite for that step (see
 * `RadarCapability`), and on every other step DWD is left whole: scrubbing
 * forward would otherwise leave Switzerland and France without the only
 * forecast there is, and scrubbing back past a network's history would leave
 * them blank. The live frame is holed for every network, whatever the grid
 * says: those layers keep their own newest frame (`layers/network.ts`).
 *
 * `setUrl` is where the radar capability re-points this at every playback step,
 * so the decision is made there, per URL, against `holes` -- which the
 * capability keeps in step with the grid. Deciding once per source would be
 * wrong in both directions: playback walks a single source across every step,
 * observations and forecasts alike.
 */
export default class NetworkHoleTileSource extends IndexedTileSource {
  /* `declare`, not initialised: the base constructor calls `setUrl` before
     a subclass's field initialisers run, and initialisers here would wipe
     what that first call set. Every one of these is written in `setUrl`. */
  declare private url: string;

  /** Which networks to erase from which frame, by the frame's URL. */
  declare private holes: Map<string, NetworkCode[]>;

  /** `holes` as one string, so an unchanged grid is noticed as unchanged. */
  declare private holesSignature: string;

  constructor(options: ConstructorParameters<typeof IndexedTileSource>[0]) {
    // Built for the newest observation, which is what every caller hands it.
    // Set before super(): the base constructor calls setUrl, which reads them.
    NetworkHoleTileSource.pending = new Map([[options.url, ALL_NETWORKS]]);
    super(options);
  }

  /** The holes for a source under construction; see the constructor. */
  private static pending: Map<string, NetworkCode[]> | null = null;

  /** Which frames have which tiles, by URL; see lib/tileIndex.ts. */
  setIndices(indices: Map<string, TileIndex | null | undefined>) {
    for (const [url, index] of indices) this.remember(url, index);
  }

  /**
   * Which frames to cut which networks out of.
   *
   * `showing` is the URL the caller is about to put on screen, when it is not
   * the one there now. Re-deciding for the frame being left -- which is what
   * happened on every new observation while following live -- gave that frame
   * a fresh key for the instant before the newest replaced it, and a
   * viewport of its tiles was requested to be thrown away.
   */
  setHoles(holes: Map<string, NetworkCode[]>, showing: string = this.url) {
    const next = signature(holes);
    if (next === this.holesSignature && showing === this.url) return;
    this.holes = holes;
    this.holesSignature = next;
    // Re-decide for the URL on screen: its holes may just have changed.
    if (showing) this.setUrl(showing);
  }

  setUrl(url: string, index?: TileIndex | null) {
    if (NetworkHoleTileSource.pending) {
      this.holes = NetworkHoleTileSource.pending;
      this.holesSignature = signature(this.holes);
      NetworkHoleTileSource.pending = null;
    }
    this.url = url;
    // The base class installs the index gate, or OpenLayers' own loader.
    super.setUrl(url, index);
    const codes = this.holes.get(url);
    if (!codes?.length) return; // DWD is the only radar drawn on this step
    const holes = HOLES.filter((hole) => codes.includes(hole.code));
    const crossOrigin = this.crossOriginValue;
    const gate = this.indexFor(url);
    this.setLoader(async (z: number, x: number, y: number) => {
      if (!present(gate, z, x, y)) return blankTile();
      const extent = tileExtent(z, x, y);
      const image = await loadImage(fillTemplate(url, z, x, y), crossOrigin);
      const met = holes.filter((hole) => overlaps(extent, hole.bbox));
      return met.length ? maskTile(image, extent, met) : image;
    });
    // A key of their own for holed tiles, naming the holes. OpenLayers caches
    // tiles by key, and the key `super.setUrl` gave is the bare URL -- so
    // without this, a frame whose holes changed (the live frame becoming
    // history, a network's composite arriving for a step) would go on serving
    // the old tiles from the cache.
    this.setKey(`${url}#holes:${codes.join(",")}`);
  }
}

function signature(holes: Map<string, NetworkCode[]>): string {
  return [...holes].map(([url, codes]) => `${url}=${codes.join(",")}`).join("|");
}
