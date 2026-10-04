import { hasTile, sourceTile } from "../lib/tileIndex";
import { VALUE_DECODE, fillTemplate, magnify } from "./indexedTiles";
import { maskTile, overlaps, tileExtent } from "./tileMask";
import { paintValuePixels, rvp6Table } from "../lib/rvp6";
import type { MaskPath } from "./tileMask";
import type { TileIndex } from "../lib/tileIndex";
import { timedFetch } from "../lib/timedFetch";

/**
 * Radar tiles for MapLibre with the same cuts the flat map makes.
 *
 * On the flat map DWD's live frame has the EUMETNET networks' countries
 * erased (`networkHoles.ts`) and each network's layer is clipped to the
 * ground `extents.ts` gives it (`network.ts`), so exactly one radar colours
 * any pixel. MapLibre has no canvas clip and no loader hook on a raster
 * source; what it has is `addProtocol`, which lets a URL scheme answer a
 * tile request with an image of its own making. So the 3D map's radar
 * sources point at `masked://`, and each request here fetches the real tile,
 * makes the cut on a canvas, and hands the result back.
 *
 * The frame's tile index is consulted first, as the flat map's sources do:
 * a tile the frame does not have is answered as empty without a request.
 *
 * The tiles carry values (lib/rvp6.ts) and MapLibre has no single-band
 * palette, so each is decoded as its bytes, cut, and painted in the
 * palette here: the one place a tile's pixels still pass through the CPU.
 */

export const MASKED_SCHEME = "masked";

/** What one registered source's tiles are made from. */
export interface MaskedSpec {
  /** The published template, `{-y}` and all. */
  template: string;
  /** Which tiles the frame has; see lib/tileIndex.ts. Absent on older frames. */
  index?: TileIndex | null;
  /** Polygons to cut out of every tile they meet. */
  erase?: MaskPath[];
  /** Keep only what falls inside this polygon; nothing outside its box is even fetched. */
  keep?: MaskPath | null;
  /** The palette to draw the tiles in, as the flat map does. Classic if absent. */
  palette?: string;
}

const registry = new Map<string, MaskedSpec>();
let serial = 0;
let installed = false;

/**
 * Register a frame, and get the `tiles` template to give a MapLibre source.
 *
 * The returned key is what `forgetMaskedTiles` takes; a source that is
 * re-pointed should forget the frame it leaves, or the registry grows by one
 * entry per scan for as long as the page is open.
 */
export function registerMaskedTiles(spec: MaskedSpec): { key: string; tiles: string } {
  serial += 1;
  const key = String(serial);
  registry.set(key, spec);
  return { key, tiles: `${MASKED_SCHEME}://${key}/{z}/{x}/{y}` };
}

export function forgetMaskedTiles(key: string | null | undefined): void {
  if (key) registry.delete(key);
}

const REQUEST = new RegExp(`^${MASKED_SCHEME}://(\\d+)/(\\d+)/(\\d+)/(\\d+)$`);

/** A tile with nothing in it, which MapLibre draws as nothing. */
const EMPTY = { data: null };

/** A decoded value tile, or a canvas it was drawn on, painted in a palette onto a canvas of its own. */
export function paintValueImage(image: ImageBitmap | HTMLCanvasElement, palette: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  paintValuePixels(data.data, rvp6Table(palette));
  context.putImageData(data, 0, 0);
  return canvas;
}

/**
 * Answer one tile request. Exported for the protocol and for the test.
 *
 * A 404 is an empty tile rather than an error: frames from before the index
 * existed have no other way to say which tiles they lack.
 */
export async function loadMaskedTile(url: string, signal?: AbortSignal): Promise<{ data: ImageBitmap | null }> {
  const match = REQUEST.exec(url);
  if (!match) throw new Error(`Not a masked tile: ${url}`);
  const spec = registry.get(match[1]);
  if (!spec) return EMPTY; // a frame already forgotten: the source is being re-pointed
  const z = Number(match[2]);
  const x = Number(match[3]);
  const y = Number(match[4]);
  // Past the frame's deepest zoom, the part of its ancestor there: DWD's
  // observation goes to zoom 9 and its forecast to 8 (lib/tileIndex.ts).
  const from = sourceTile(spec.index, z, x, y);
  // The index is numbered the way the URL is: XYZ x, TMS y.
  if (!hasTile(spec.index, from.z, from.x, 2 ** from.z - 1 - from.y)) return EMPTY;

  const extent = tileExtent(z, x, y);
  const keep = spec.keep ?? null;
  if (keep && !overlaps(extent, keep.bbox)) return EMPTY;
  const erase = (spec.erase ?? []).filter((path) => overlaps(extent, path.bbox));
  const source = fillTemplate(spec.template, from.z, from.x, from.y);

  const response = await timedFetch(source, { signal });
  if (response.status === 404) return EMPTY;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${source}`);

  /* Fetched rather than loaded as an <img>, which could not tell a 404 from
     a network that dropped the request: every failure came back as an empty
     tile, and MapLibre kept it as one -- a hole in the radar until the frame
     changed. A failure now fails, and the 3D map asks for it again when the
     network is back (Cells3DCapability.resync). */
  const bitmap = await createImageBitmap(await response.blob(), VALUE_DECODE);
  const image = magnify(bitmap, from);
  const cut = erase.length || keep ? maskTile(image, extent, erase, keep) : image;
  const painted = paintValueImage(cut, spec.palette ?? "classic");
  bitmap.close();
  return { data: await createImageBitmap(painted) };
}

/** What MapLibre's `addProtocol` takes, narrowed to what is used. */
type Protocol = (params: { url: string }, abort: AbortController) => Promise<{ data: unknown }>;

/** Teach MapLibre the scheme, once; the module is a singleton like MapLibre's registry. */
export function installMaskedProtocol(maplibre: { addProtocol(scheme: string, load: Protocol): void }): void {
  if (installed) return;
  installed = true;
  maplibre.addProtocol(MASKED_SCHEME, (params, abort) => loadMaskedTile(params.url, abort.signal));
}
