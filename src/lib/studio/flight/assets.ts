/**
 * The flight's large files, fetched once for the page: the aircraft's model
 * and textures, and the soundtrack. Whoever asks first starts a file coming,
 * and everyone after gets the same bytes, with how many have come so far,
 * so that the loading (preload.ts) and what uses a file (the aircraft's
 * renderer, the music) never fetch it twice.
 *
 * A file that stops coming for a while is given up on, and a failed one is
 * fetched afresh by the next to ask: neither hangs a loading screen forever.
 */

/** Where the aircraft's files are served from, and its model's size, bytes, until the server says. */
export const AIRCRAFT_FILES = `${import.meta.env?.BASE_URL ?? "/"}models/a320/`;
export const AIRCRAFT_MODEL = "a320.bin";
export const AIRCRAFT_BYTES = 13_861_648;

/** How long a file may send nothing before it is given up on, ms. */
const STALL_MS = 30_000;

type Progress = (loaded: number, total: number) => void;

interface Asset {
  promise: Promise<ArrayBuffer>;
  loaded: number;
  total: number;
  listeners: Set<Progress>;
}

const assets = new Map<string, Asset>();

/**
 * A file's bytes, fetched once. `expected` is what its size is taken to be
 * until the server says; `progress` hears how much of it has come, now and
 * as more does.
 */
export function fetchAsset(url: string, expected = 0, progress?: Progress): Promise<ArrayBuffer> {
  let asset = assets.get(url);
  if (!asset) {
    const made: Asset = { promise: Promise.resolve(new ArrayBuffer(0)), loaded: 0, total: expected, listeners: new Set() };
    made.promise = download(url, made);
    // A failure is not kept: the next to ask fetches it afresh.
    made.promise.catch(() => {
      if (assets.get(url) === made) assets.delete(url);
    });
    assets.set(url, made);
    asset = made;
  }
  if (progress) {
    asset.listeners.add(progress);
    progress(asset.loaded, asset.total);
  }
  return asset.promise;
}

/** Let go of a file's bytes, once what uses them has made what it needs of them (the music's copy, a decoded texture). */
export function forgetAsset(url: string): void {
  assets.delete(url);
}

async function download(url: string, asset: Asset): Promise<ArrayBuffer> {
  const tell = () => {
    for (const listener of asset.listeners) listener(asset.loaded, asset.total);
  };
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), STALL_MS);
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), STALL_MS);
  };
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    // A compressed file's length is not the length of what is read.
    const length = response.headers.get("content-encoding") ? 0 : Number(response.headers.get("content-length")) || 0;
    if (length) asset.total = length;
    tell();
    if (!response.body) {
      const whole = await response.arrayBuffer();
      asset.loaded = asset.total = whole.byteLength;
      tell();
      return whole;
    }
    const reader = response.body.getReader();
    let bytes = new Uint8Array(length || asset.total || 1 << 20);
    let at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      alive();
      if (at + value.length > bytes.length) {
        const grown = new Uint8Array(Math.max(bytes.length * 2, at + value.length));
        grown.set(bytes.subarray(0, at));
        bytes = grown;
      }
      bytes.set(value, at);
      at += value.length;
      asset.loaded = at;
      asset.total = Math.max(asset.total, at);
      tell();
    }
    asset.loaded = asset.total = at;
    tell();
    return at === bytes.length ? bytes.buffer : bytes.slice(0, at).buffer;
  } finally {
    clearTimeout(timer);
    asset.listeners.clear();
  }
}
