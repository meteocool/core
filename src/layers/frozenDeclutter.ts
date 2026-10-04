import type { FeatureLike } from "ol/Feature";
import type { FrameState } from "ol/Map";
import type VectorTileSource from "ol/source/VectorTile";
import type VectorTile from "ol/VectorTile";
import type { Extent } from "ol/extent";
import { containsXY } from "ol/extent";
import { onMapMotion } from "../lib/mapMotion";

/**
 * Decluttering while the map is at rest, frozen while it moves.
 *
 * One decluttered layer puts the whole map in OpenLayers' deferred mode: every
 * canvas layer records its drawing and replays it after the labels are placed,
 * and the labels are placed again on every frame. Profiling put the place
 * labels alone at about a quarter of each frame of a pan, and the deferral at
 * several percent more, for labels that do not change while the map slides.
 *
 * So when the map starts to move, each layer registered here keeps exactly the
 * labels OpenLayers placed in the last frame at rest, and draws only those,
 * with decluttering off; when the map settles, decluttering comes back and
 * places them afresh. A pan looks as it did at rest. What a move uncovers is
 * labelled when it stops, and a zoom out shows the frozen labels closer
 * together until it does.
 */

/** Which labels a layer keeps while frozen: whatever the key says is the same label. */
type LabelKey = (feature: FeatureLike) => unknown;

/** What this needs of a vector layer: its declutter group, and a way to change it. */
export interface DeclutterLayer {
  getDeclutter(): string | undefined;
  setDeclutter(declutter: boolean | string | number): void;
}

interface Frozen {
  /** The layer's own declutter group, put back on a thaw. */
  group: string;
  key: LabelKey;
  /** The keys placed in the last frame at rest, while the map moves; null at rest. */
  kept: Set<unknown> | null;
}

const registered = new Map<DeclutterLayer, Frozen>();

/** Copies of a feature carried in a vector tile's buffer; see `markBufferCopies`. */
const bufferCopies = new WeakSet<object>();

/**
 * Freeze this layer's decluttering while the map moves. Call after the layer
 * is built, with its `declutter` already set.
 *
 * `key` names a label across copies of it: vector tiles carry the same place
 * once per zoom level, as different features, and the key is what keeps a
 * label through a zoom that changes level. By default a feature is itself.
 */
export function declutterAtRest(layer: DeclutterLayer, key: LabelKey = (feature) => feature) {
  const group = layer.getDeclutter();
  if (!group) return;
  registered.set(layer, { group, key, kept: null });
}

/** Whether this feature is to be left out of the layer's style while it is frozen. */
export function frozenOut(layer: DeclutterLayer, feature: FeatureLike): boolean {
  const frozen = registered.get(layer);
  if (!frozen?.kept) return false;
  return bufferCopies.has(feature) || !frozen.kept.has(frozen.key(feature));
}

/**
 * Mark the features a vector tile carries for its neighbours.
 *
 * A tile's buffer holds every place near its edge again -- half the places in
 * a mid-zoom tile -- so that a label crossing the edge is drawn whole.
 * Decluttering draws one copy and refuses the rest; with it off, every copy
 * is drawn, on top of each other. Frozen, a layer draws each place only from
 * the tile it falls in.
 */
export function markBufferCopies(source: VectorTileSource) {
  source.on("tileloadend", (event) => {
    const tile = event.tile as VectorTile<FeatureLike> & { extent?: Extent };
    const extent = tile.extent;
    if (!extent) return;
    for (const feature of tile.getFeatures()) {
      const geometry = feature.getGeometry();
      if (geometry?.getType() !== "Point") continue;
      const [x, y] = (geometry as unknown as { getFlatCoordinates(): number[] }).getFlatCoordinates();
      if (!containsXY(extent, x, y)) bufferCopies.add(feature);
    }
  });
}

/** Keep what the last frame at rest placed, and stop placing labels. */
export function freezeDeclutter(frameState: FrameState | null | undefined) {
  registered.forEach((frozen, layer) => {
    if (frozen.kept) return;
    const tree = frameState?.declutter?.[frozen.group];
    // A layer not drawn in that frame placed nothing, and keeps nothing.
    frozen.kept = new Set((tree?.all() ?? []).map((box) => frozen.key(box.value as FeatureLike)));
    layer.setDeclutter(false);
  });
}

/** Place labels again, as the map comes to rest. */
export function thawDeclutter() {
  registered.forEach((frozen, layer) => {
    if (!frozen.kept) return;
    frozen.kept = null;
    layer.setDeclutter(frozen.group);
  });
}

onMapMotion((moving, frameState) => {
  if (moving) freezeDeclutter(frameState);
  else thawDeclutter();
});
