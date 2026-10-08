import MVT from "ol/format/MVT";
import type { Options } from "ol/format/MVT";
import type { ReadOptions } from "ol/format/Feature";
import type RenderFeature from "ol/render/Feature";

/**
 * Mapbox Vector Tiles, with the layers nobody asked for cut out before they
 * are read.
 *
 * OpenLayers' `layers` option filters features, not bytes: it reads every
 * layer's key and value tables first and only then drops the layers it was not
 * asked for. Protomaps' `landuse` is most of a mid-zoom tile, and neither the
 * light nor the dark basemap draws any of it, so most of the parse went to
 * nothing. The label layer, which wants `places` alone, paid that cost for
 * every other layer too. Here the tile is first copied without the unwanted
 * layers, which only skips over their bytes; what OpenLayers reads after that
 * is exactly the same.
 *
 * Tiles arrive on the main thread, so the parse is time out of a frame: a
 * tile landing during a pan was the longest frame left in it.
 */
export default class TrimmedMVT extends MVT {
  private readonly keep: Set<string> | null;

  constructor(options: Options<RenderFeature> = {}) {
    super(options);
    this.keep = options.layers ? new Set(options.layers) : null;
  }

  override readFeatures(source: ArrayBuffer, options?: ReadOptions): RenderFeature[] {
    return super.readFeatures(this.keep ? trimTile(source, this.keep) : source, options);
  }
}

/**
 * The tile with only the `keep` layers in it, or the tile itself when there
 * is little else in it.
 *
 * A vector tile is a protobuf message whose only field is its layers (field 3),
 * each a length-prefixed message with its name in field 1. So the layers can be
 * walked, named and copied without decoding any of them.
 */
export function trimTile(tile: ArrayBuffer, keep: Set<string>): ArrayBuffer {
  const bytes = new Uint8Array(tile);
  const kept: Uint8Array[] = [];
  let dropped = 0;
  let pos = 0;
  try {
    while (pos < bytes.length) {
      const start = pos;
      const [key, afterKey] = varint(bytes, pos);
      if (key >>> 3 !== 3 || (key & 7) !== 2) {
        // Not a layer: nothing else is defined at this level, so keep it as is.
        pos = skip(bytes, afterKey, key & 7);
        kept.push(bytes.subarray(start, pos));
        continue;
      }
      const [length, body] = varint(bytes, afterKey);
      pos = body + length;
      if (pos > bytes.length) return tile;
      const name = layerName(bytes, body, pos);
      if (name !== null && !keep.has(name)) {
        dropped += pos - start;
        continue;
      }
      kept.push(bytes.subarray(start, pos));
    }
  } catch {
    // A tile that cannot be walked goes to OpenLayers whole, which then fails
    // on it or not, the same as without trimming.
    return tile;
  }
  // Copying most of a tile to save reading a sliver of it costs more than it
  // saves. The OSM theme keeps nearly everything.
  if (dropped < bytes.length / 8) return tile;
  const out = new Uint8Array(kept.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return out.buffer;
}

const utf8 = new TextDecoder();

/** A layer's name, field 1 of the layer message between `pos` and `end`; null if it has none. */
function layerName(bytes: Uint8Array, pos: number, end: number): string | null {
  while (pos < end) {
    const [key, next] = varint(bytes, pos);
    if (key >>> 3 === 1 && (key & 7) === 2) {
      const [length, start] = varint(bytes, next);
      return utf8.decode(bytes.subarray(start, start + length));
    }
    pos = skip(bytes, next, key & 7);
  }
  return null;
}

/** A base-128 varint at `pos`, and where the next field starts. */
function varint(bytes: Uint8Array, pos: number): [number, number] {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (pos >= bytes.length) throw new RangeError("truncated varint");
    const byte = bytes[pos++];
    // Multiplying rather than shifting: field lengths can pass 2^28, where a
    // 32-bit shift would start to wrap.
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [value, pos];
    shift += 7;
    if (shift > 49) throw new RangeError("varint too long");
  }
}

/** Past the value of a field of this wire type, starting at `pos`. */
function skip(bytes: Uint8Array, pos: number, wireType: number): number {
  switch (wireType) {
    case 0: return varint(bytes, pos)[1];
    case 1: return pos + 8;
    case 2: {
      const [length, start] = varint(bytes, pos);
      return start + length;
    }
    case 5: return pos + 4;
    default: throw new RangeError(`wire type ${wireType}`);
  }
}
