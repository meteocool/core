/**
 * The light aircraft other pilots are drawn as: the outside of the
 * cockpit's own model at about 8,000 triangles, and a silhouette of about
 * 400, coloured by their vertices. Written by
 * scripts/models/light-aircraft.py, which says how.
 *
 * The file: `MCL1`, the length of a JSON header, the header, then each
 * mesh's vertices and indices. A vertex is sixteen bytes: three signed
 * 16-bit steps across `extent` (metres either way of the middle: forward,
 * right, down) and a 16-bit flag (1 for the landing gear), a normal as
 * three signed bytes and a spare, a colour as four bytes. Indices are 16
 * bits.
 */

export const LIGHT_VERTEX_BYTES = 16;
/** Its file, beside the cockpit's own model. */
export const LIGHT_MODEL = "a320-light.bin";

export interface LightMesh {
  vertices: Uint8Array;
  indices: Uint16Array;
}

export interface LightModel {
  title: string;
  author: string;
  licence: string;
  extent: [number, number, number];
  model: LightMesh;
  silhouette: LightMesh;
}

/** Read the file. Throws on anything that is not one. */
export function parseLightModel(buffer: ArrayBuffer): LightModel {
  if (buffer.byteLength < 8 || String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== "MCL1") throw new Error("not a light aircraft model");
  const length = new DataView(buffer).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length))) as {
    title: string; author: string; licence: string; extent: [number, number, number];
    meshes: Array<{ name: string; vertices: number; indices: number; offset: number }>;
  };
  const body = 8 + length;
  const mesh = (name: string): LightMesh => {
    const found = header.meshes.find((each) => each.name === name);
    if (!found) throw new Error(`light aircraft model without its ${name}`);
    const at = body + found.offset;
    const bytes = found.vertices * LIGHT_VERTEX_BYTES;
    if (at + bytes + found.indices * 2 > buffer.byteLength) throw new Error("light aircraft model cut short");
    return { vertices: new Uint8Array(buffer, at, bytes), indices: new Uint16Array(buffer, at + bytes, found.indices) };
  };
  return { title: header.title, author: header.author, licence: header.licence, extent: header.extent, model: mesh("model"), silhouette: mesh("silhouette") };
}
