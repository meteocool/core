/**
 * A few features out of a vector tile, read straight from its bytes.
 *
 * The flight wants a handful of a basemap tile's thousands of features (its
 * runways, its airports' names), and none of the rest. So one layer is
 * walked, each feature's properties are looked at first, and only the
 * geometry of those asked for is read; the other layers are stepped over
 * without being read at all. Nothing of the tile is kept.
 *
 * A vector tile is a protobuf message: layers (field 3), each with its name
 * (1), features (2), the keys (3) and values (4) their properties are
 * numbered from, and the side of the tile in its own units (5).
 */

/** What a property is: text, a number, or yes or no. */
export type TileValue = string | number | boolean;

export interface TileFeature {
  /** 1 points, 2 lines, 3 polygons. */
  type: number;
  properties: Record<string, TileValue>;
  /** Each part of it (a point, a line, a ring) as x, y, x, y in the tile's units, east and south of its top left corner. */
  parts: number[][];
}

export interface TileLayer {
  /** The side of the tile in the units the features are in. */
  extent: number;
  features: TileFeature[];
}

const utf8 = new TextDecoder();

/** A place in the tile's bytes, moved on by every read. */
interface Cursor {
  bytes: Uint8Array;
  pos: number;
}

function varint(cursor: Cursor): number {
  let value = 0;
  let scale = 1;
  for (let read = 0; read < 10; read += 1) {
    if (cursor.pos >= cursor.bytes.length) throw new RangeError("vector tile cut short");
    const byte = cursor.bytes[cursor.pos++];
    // Multiplied, not shifted: a number may be longer than 32 bits.
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return value;
    scale *= 128;
  }
  throw new RangeError("vector tile number too long");
}

/** The length-prefixed field at the cursor, as a cursor over it alone. */
function inside(cursor: Cursor): Cursor & { end: number } {
  const length = varint(cursor);
  const start = cursor.pos;
  cursor.pos = start + length;
  if (cursor.pos > cursor.bytes.length) throw new RangeError("vector tile cut short");
  return { bytes: cursor.bytes, pos: start, end: start + length };
}

function skip(cursor: Cursor, wire: number): void {
  if (wire === 0) varint(cursor);
  else if (wire === 1) cursor.pos += 8;
  else if (wire === 2) inside(cursor);
  else if (wire === 5) cursor.pos += 4;
  else throw new RangeError(`vector tile wire type ${wire}`);
}

const text = (field: { bytes: Uint8Array; pos: number; end: number }) => utf8.decode(field.bytes.subarray(field.pos, field.end));

/** A signed number as the tiles write it: 0, -1, 1, -2, … */
const signed = (value: number) => (value % 2 ? -(value + 1) / 2 : value / 2);

function readValue(field: Cursor & { end: number }): TileValue {
  let value: TileValue = "";
  const view = new DataView(field.bytes.buffer, field.bytes.byteOffset);
  while (field.pos < field.end) {
    const key = varint(field);
    const tag = key >>> 3;
    if (tag === 1) value = text(inside(field));
    else if (tag === 2) {
      value = view.getFloat32(field.pos, true);
      field.pos += 4;
    } else if (tag === 3) {
      value = view.getFloat64(field.pos, true);
      field.pos += 8;
    } else if (tag === 4 || tag === 5) value = varint(field);
    else if (tag === 6) value = signed(varint(field));
    else if (tag === 7) value = varint(field) !== 0;
    else skip(field, key & 7);
  }
  return value;
}

/** A feature's parts from its drawing commands: move to, line to, close. */
function readParts(field: Cursor & { end: number }): number[][] {
  const parts: number[][] = [];
  let part: number[] | null = null;
  let x = 0;
  let y = 0;
  while (field.pos < field.end) {
    const command = varint(field);
    const count = command >>> 3;
    if ((command & 7) === 7) continue;
    for (let i = 0; i < count; i += 1) {
      x += signed(varint(field));
      y += signed(varint(field));
      // A new part at every move, but for points, which are one part of many moves.
      if ((command & 7) === 1 && (i === 0 || !part)) {
        part = [];
        parts.push(part);
      }
      part?.push(x, y);
    }
  }
  return parts;
}

/**
 * The features of one layer of a tile that `wanted` says yes to, by their
 * properties. An empty layer for a tile without it, or one that cannot be
 * read.
 */
export function readTileLayer(
  tile: ArrayBuffer | Uint8Array, name: string, wanted: (properties: Record<string, TileValue>) => boolean,
): TileLayer {
  const bytes = tile instanceof Uint8Array ? tile : new Uint8Array(tile);
  const none: TileLayer = { extent: 4096, features: [] };
  try {
    const cursor: Cursor = { bytes, pos: 0 };
    while (cursor.pos < bytes.length) {
      const key = varint(cursor);
      if (key >>> 3 !== 3 || (key & 7) !== 2) {
        skip(cursor, key & 7);
        continue;
      }
      const layer = readLayer(inside(cursor), name, wanted);
      if (layer) return layer;
    }
  } catch {
    return none;
  }
  return none;
}

function readLayer(
  layer: Cursor & { end: number }, name: string, wanted: (properties: Record<string, TileValue>) => boolean,
): TileLayer | null {
  const keys: string[] = [];
  const values: TileValue[] = [];
  const features: Array<Cursor & { end: number }> = [];
  let extent = 4096;
  let named = false;
  while (layer.pos < layer.end) {
    const key = varint(layer);
    const tag = key >>> 3;
    if (tag === 1) {
      if (text(inside(layer)) !== name) return null;
      named = true;
    } else if (tag === 2) features.push(inside(layer));
    else if (tag === 3) keys.push(text(inside(layer)));
    else if (tag === 4) values.push(readValue(inside(layer)));
    else if (tag === 5) extent = varint(layer);
    else skip(layer, key & 7);
  }
  if (!named) return null;
  const out: TileFeature[] = [];
  for (const feature of features) {
    const properties: Record<string, TileValue> = {};
    let type = 0;
    let geometry: (Cursor & { end: number }) | null = null;
    while (feature.pos < feature.end) {
      const key = varint(feature);
      const tag = key >>> 3;
      if (tag === 2) {
        const tags = inside(feature);
        while (tags.pos < tags.end) {
          const property = keys[varint(tags)];
          const value = values[varint(tags)];
          if (property !== undefined && value !== undefined) properties[property] = value;
        }
      } else if (tag === 3) type = varint(feature);
      else if (tag === 4) geometry = inside(feature);
      else skip(feature, key & 7);
    }
    if (geometry && wanted(properties)) out.push({ type, properties, parts: readParts(geometry) });
  }
  return { extent, features: out };
}
