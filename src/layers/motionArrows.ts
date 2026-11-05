import MVT from "ol/format/MVT";
import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import Style from "ol/style/Style";
import Icon from "ol/style/Icon";
import type { FeatureLike } from "ol/Feature";
import { imprintAttribution } from "./attributions";
import { DARK_CASING, DARK_INK, LIGHT_CASING, LIGHT_INK, isDarkBasemap, watchBasemap } from "./casing";
import { motionArrow } from "../lib/motionArrow";
import type { ArrowShape } from "../lib/motionArrow";
import { tileBaseUrl } from "../urls";

/**
 * The rain's motion over the radar map: one arrow per block of the map, the
 * block's mean motion (ng's ADR 0042), from a vector tile set the server
 * renders from every domain's newest motion field.
 *
 * The server sends each zoom the arrows of one block size, so they stay
 * about as far apart on the screen at every zoom and nothing here thins or
 * declutters them. Arrows are drawn once per speed, direction and basemap
 * into a canvas and kept (lib/motionArrow.ts rounds both), as the station
 * barbs are, and turn with the map.
 */

/** The tile set's deepest zoom: past it, its arrows are drawn as they are. */
const MAX_ZOOM = 10;
/** How faint the arrows are while they are not the shown frame's motion. */
const STALE_OPACITY = 0.35;
/** Room around an arrow on its canvas, for the casing. */
const MARGIN = 3;

interface Palette {
  ink: string;
  casing: string;
}

const LIGHT: Palette = { ink: DARK_INK, casing: LIGHT_CASING };
const DARK: Palette = { ink: LIGHT_INK, casing: DARK_CASING };

export interface MotionArrowLayer {
  layer: VectorTileLayer;
  /** Draw a tile set's arrows, or none. */
  show(tileId: string | null): void;
  /** Faint: the timeline shows a frame from well before the arrows. */
  setStale(stale: boolean): void;
}

/** The arrow into a canvas of its own, its middle in the canvas's. */
function drawArrow(shape: ArrowShape, palette: Palette, ratio: number): HTMLCanvasElement {
  const points = [...shape.shaft, ...shape.head];
  const reach = Math.max(...points.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]));
  const half = Math.ceil(reach + MARGIN);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = half * 2 * ratio;
  const context = canvas.getContext("2d")!;
  context.scale(ratio, ratio);
  context.translate(half, half);
  context.lineCap = "round";
  context.lineJoin = "round";
  // Twice: the casing wide underneath, then the ink.
  for (const [colour, width] of [[palette.casing, 4.5], [palette.ink, 2]] as const) {
    context.strokeStyle = colour;
    context.fillStyle = colour;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(...shape.shaft[0]);
    context.lineTo(...shape.shaft[1]);
    context.stroke();
    context.beginPath();
    context.moveTo(...shape.head[0]);
    context.lineTo(...shape.head[1]);
    context.lineTo(...shape.head[2]);
    context.closePath();
    context.fill();
    context.stroke();
  }
  return canvas;
}

export default function makeMotionArrowLayer(): MotionArrowLayer {
  let palette = LIGHT;
  let tileId: string | null = null;
  const styles = new Map<string, Style>();

  const style = (feature: FeatureLike): Style | undefined => {
    const shape = motionArrow(Number(feature.get("e")), Number(feature.get("n")));
    if (!shape) return undefined;
    const key = `${shape.kmh}:${shape.towardDeg}`;
    let found = styles.get(key);
    if (!found) {
      const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));
      found = new Style({
        image: new Icon({ img: drawArrow(shape, palette, ratio), scale: 1 / ratio, rotateWithView: true }),
      });
      styles.set(key, found);
    }
    return found;
  };

  const layer = new VectorTileLayer({
    // Over the radar and the lightning (90 to 120), under the stations (150)
    // and the storm marks from 200 up: either is what a tap is for.
    zIndex: 140,
    visible: false,
    declutter: false,
    style,
    updateWhileAnimating: true,
    updateWhileInteracting: true,
  });

  watchBasemap((basemap) => (isDarkBasemap(basemap) ? DARK : LIGHT), (next) => {
    palette = next;
    styles.clear();
    layer.changed();
  });

  return {
    layer,
    show(next) {
      if (next === tileId) return;
      tileId = next;
      layer.setSource(next
        ? new VectorTileSource({
          format: new MVT(),
          attributions: [imprintAttribution],
          url: `${tileBaseUrl}/meteoradar/${next}/{z}/{x}/{y}.pbf`,
          maxZoom: MAX_ZOOM,
          // The server's zooms, one block size each, are 256-pixel tiles'.
          // At OpenLayers' default 512 a phone screen held about 20 arrows,
          // 113 pixels apart, too few to see the field turn; at 256 about
          // 100, 56 apart, and no frame took longer for them.
          tileSize: 256,
        })
        : null);
    },
    setStale(stale) {
      layer.setOpacity(stale ? STALE_OPACITY : 1);
    },
  };
}
