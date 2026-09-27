import ImageTileSource from "ol/source/ImageTile";
import { hasTile } from "../lib/tileIndex";
import type { TileIndex } from "../lib/tileIndex";

/**
 * Tile sources that consult a frame's tile index before asking the network.
 *
 * The renderer writes no tile that would be fully transparent, so a frame is
 * missing most of its grid on a dry day and every one of those tiles was a
 * request answered 404 -- per frame, per loop, never cached. Each frame now
 * says which tiles it has (lib/tileIndex.ts), and a tile it lacks is answered
 * here with a blank that OpenLayers draws as nothing.
 *
 * A frame from before the index existed has none, and loads as it always did.
 */

/** The URL template, with the tile filled in. `{-y}` is TMS, as the tiles are published. */
export function fillTemplate(template: string, z: number, x: number, y: number): string {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{-y}", String(2 ** z - 1 - y))
    .replace("{y}", String(y));
}

export function loadImage(url: string, crossOrigin: string | null): Promise<HTMLImageElement> {
  const image = new Image();
  if (crossOrigin !== null) image.crossOrigin = crossOrigin;
  image.src = url;
  return image.decode().then(() => image);
}

let blank: HTMLCanvasElement | null = null;

/** One transparent pixel, shared: stretched over a tile it draws nothing. */
export function blankTile(): HTMLCanvasElement {
  if (!blank) {
    blank = document.createElement("canvas");
    blank.width = 1;
    blank.height = 1;
  }
  return blank;
}

/** Whether the frame behind `template` has the tile OpenLayers is asking for. */
export function present(index: TileIndex | null | undefined, z: number, x: number, y: number): boolean {
  return hasTile(index, z, x, 2 ** z - 1 - y);
}

/** How many frames' indices a source remembers before starting afresh. */
const REMEMBERED = 400;

/**
 * An `ImageTileSource` that skips the tiles a frame does not have.
 *
 * `setUrl` takes the frame's index alongside its URL and remembers it, so a
 * later `setUrl` back to the same frame -- playback walks one source across
 * every step -- finds it again.
 */
export default class IndexedTileSource extends ImageTileSource {
  protected readonly crossOriginValue: string | null;

  protected readonly indices = new Map<string, TileIndex | null>();

  constructor(options: ConstructorParameters<typeof ImageTileSource>[0] & { url: string; index?: TileIndex | null }) {
    const { url, index, ...rest } = options;
    super(rest);
    this.crossOriginValue = options.crossOrigin ?? null;
    this.setUrl(url, index);
  }

  /** Keep a frame's index for when its URL comes round. */
  remember(url: string, index: TileIndex | null | undefined): void {
    if (index === undefined) return;
    if (this.indices.size > REMEMBERED) this.indices.clear();
    this.indices.set(url, index);
  }

  /** The index remembered for a URL, or nothing known about it. */
  indexFor(url: string): TileIndex | null | undefined {
    return this.indices.get(url);
  }

  setUrl(url: string, index?: TileIndex | null): void {
    this.remember(url, index);
    super.setUrl(url);
    const gate = this.indexFor(url);
    if (!gate) return; // nothing known: OpenLayers' own loader, as before
    const crossOrigin = this.crossOriginValue;
    this.setLoader(async (z: number, x: number, y: number) => (
      present(gate, z, x, y) ? loadImage(fillTemplate(url, z, x, y), crossOrigin) : blankTile()
    ));
  }
}
