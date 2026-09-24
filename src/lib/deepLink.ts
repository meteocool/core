/**
 * What a link to the map says.
 *
 * A link carries what the sender was looking at -- which map, where, which
 * storm, how it was cut open -- and nothing about how they like to look at
 * things. The basemap, the colour scheme, dark mode and units belong to
 * whoever opens the link, so they are never written here and a receiver keeps
 * their own. The line runs between content and presentation: two people
 * looking at the same link see the same weather, each in their own colours.
 *
 * Pure, and separate from the wiring in `urlState.ts`, because the rules are
 * all string handling and small invariants -- what a malformed value falls back
 * to, which parameters only mean something together -- and those are what a
 * test should hold down.
 *
 * Every parameter is optional and every value is validated on the way in: a
 * link is text anyone can edit, and a value that does not parse is dropped
 * rather than half-applied. Parameters this module does not own (`logo`,
 * `toolbar` and `layerswitcher`, which embeds set) are left exactly where they
 * are.
 */
import { normaliseCut } from "./cutAngle";

/** The radar map's switchable overlays, in the order a link lists them. */
export const OVERLAYS = ["cells", "lightning", "mesocyclones"] as const;
export type Overlay = (typeof OVERLAYS)[number];

/** Centre and zoom, in the flat map's zoom levels on either map. */
export interface LinkView {
  lat: number;
  lon: number;
  zoom: number;
}

export interface LinkState {
  /** The capability on screen: `radar`, `lightning`, `cells3d`, `precipTypes`. */
  layer?: string;
  view?: LinkView;
  /** The 3D map's tilt, degrees from straight down. */
  pitch?: number;
  /** The 3D map's heading, degrees clockwise from north, in [-180, 180) as MapLibre keeps it. */
  bearing?: number;
  /** A KONRAD3D cell, by track code. */
  cell?: string;
  /**
   * Whether the cell's detail panel is open, as opposed to only its forecast
   * being drawn -- the two steps a phone separates; see lib/cellSelection.ts.
   * Only ever false in a link: open is what a link to a cell means otherwise.
   */
  details?: boolean;
  /** A storm core found in the composite, by the path of its volume. */
  cloud?: string;
  /** How far the cutaway's slice is turned, as `cutRotationDeg` holds it. */
  cut?: number;
  /** Which overlays are on. Absent means whatever the reader has chosen. */
  overlays?: Overlay[];
  /** A frame off the live edge, in unix seconds as the radar grid keys it. */
  time?: number;
  /** The point the forecast strip is asked about, as [lat, lon]. */
  point?: [number, number];
}

/**
 * The parameters this module reads and writes, in the order it writes them.
 *
 * `latLonZ` keeps the name and shape it has always had, so every link and
 * dashboard URL already in circulation still opens where it used to.
 */
const OWNED = [
  "layer", "latLonZ", "pitch", "bearing", "overlays", "t", "point", "cell", "details", "cloud", "cut",
] as const;
type OwnedKey = (typeof OWNED)[number];

/* ---- values ------------------------------------------------------------- */

const finite = (text: string | null): number | null => {
  if (text === null || text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const validLat = (lat: number) => lat >= -90 && lat <= 90;
const validLon = (lon: number) => lon >= -180 && lon <= 180;

/** "lat,lon" as the forecast point and the view both spell it. */
function parsePair(text: string | null): [number, number] | null {
  const parts = (text ?? "").split(",");
  if (parts.length !== 2) return null;
  const [lat, lon] = parts.map(finite);
  if (lat === null || lon === null || !validLat(lat) || !validLon(lon)) return null;
  return [lat, lon];
}

function parseView(text: string | null): LinkView | null {
  const parts = (text ?? "").split(",");
  if (parts.length !== 3) return null;
  const [lat, lon, zoom] = parts.map(finite);
  if (lat === null || lon === null || zoom === null) return null;
  if (!validLat(lat) || !validLon(lon) || zoom < 0 || zoom > 24) return null;
  return { lat, lon, zoom };
}

/**
 * A capability name. Checked against what is registered by LayerManager, which
 * is the only thing that knows; this only keeps the value a plain word.
 */
const LAYER = /^[A-Za-z0-9]{1,32}$/;

/**
 * A track code. KONRAD3D's are 22 digits today; the pattern is looser than
 * that on purpose, since the backend owns the format, and only strict enough
 * that the value is safe as a path segment of `/cells/tracks/{code}`.
 */
const CELL = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A volume as a link names it: the scan and the core, `20260924T194500/R39853139`.
 *
 * The object's path with the constant parts taken off, which is shorter and
 * reads as an identifier -- and, because it is rebuilt from two validated
 * pieces, a link can only ever point the client at a volume, never at some
 * other object on the tile host. The layout is the worker's, in meteocool/ng
 * services/worker-analysis/src/clouds.py `_key`; a core's code is its grid
 * position, which is only unique within one scan, hence the scan in front.
 */
const CLOUD_LINK = /^(\d{8}T\d{6})\/(R\d{1,12})$/;
const CLOUD_PATH = /^meteoradar\/volumes\/(\d{8}T\d{6})\/(R\d{1,12})\.mcvx$/;

/** The link form of a volume's path, or null for one laid out some other way. */
export function cloudLink(path: string): string | null {
  const match = CLOUD_PATH.exec(path);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** The volume's path back from its link form, or null if it is not one. */
export function cloudPath(link: string): string | null {
  const match = CLOUD_LINK.exec(link);
  return match ? `meteoradar/volumes/${match[1]}/${match[2]}.mcvx` : null;
}

/**
 * A frame's time, `20260924T1945Z`: ISO 8601's basic format, in UTC.
 *
 * Absolute rather than an offset from now, because a link is opened later than
 * it was sent, and "the 30-minute forecast" by then is a different frame. A
 * frame the receiver's grid no longer holds is simply not restored.
 */
const FRAME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/;

export function frameLink(unixSeconds: number): string {
  const iso = new Date(unixSeconds * 1000).toISOString();
  // "2026-09-24T19:45:00.000Z" -> "20260924T1945Z"
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}

export function frameTime(link: string): number | null {
  const match = FRAME.exec(link);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  const back = new Date(ms);
  // Date.UTC rolls 25:70 over into the next day rather than refusing it.
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day
    || back.getUTCHours() !== hour || back.getUTCMinutes() !== minute) return null;
  return ms / 1000;
}

function parseOverlays(text: string | null): Overlay[] | undefined {
  if (text === null) return undefined;
  const named = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (named.length === 1 && named[0] === "none") return [];
  const known = OVERLAYS.filter((overlay) => named.includes(overlay));
  // A list that names nothing this app has is a typo, not "all off".
  return known.length ? known : undefined;
}

function parseFlag(text: string | null): boolean | undefined {
  if (text === null) return undefined;
  if (/^(1|true|yes)$/i.test(text)) return true;
  if (/^(0|false|no)$/i.test(text)) return false;
  return undefined;
}

/* ---- reading ------------------------------------------------------------ */

/**
 * The state a query string describes.
 *
 * Also settles the combinations a link cannot mean, so a hand-edited one is
 * read the way the app could have written it:
 *
 * - a cell and a cloud are one selection, and the cell wins -- it has a track
 *   and a history, the cloud only a volume;
 * - a cell is only drawn on the newest frame (see the gate in App.svelte), so
 *   a frame off the live edge beside one is dropped rather than the cell;
 * - the panel and the slice both belong to a selection, and mean nothing
 *   without one.
 */
export function parseLink(search: string | URLSearchParams): LinkState {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const state: LinkState = {};

  const layer = params.get("layer");
  if (layer && LAYER.test(layer)) state.layer = layer;

  const view = parseView(params.get("latLonZ"));
  if (view) state.view = view;

  const pitch = finite(params.get("pitch"));
  if (pitch !== null) state.pitch = Math.min(Math.max(pitch, 0), 85);
  const bearing = finite(params.get("bearing"));
  // Folded the way a slice angle is, and the way MapLibre folds its own.
  if (bearing !== null) state.bearing = normaliseCut(bearing);

  const cell = params.get("cell");
  const cloud = params.get("cloud");
  if (cell && CELL.test(cell)) {
    state.cell = cell;
  } else if (cloud) {
    const path = cloudPath(cloud);
    if (path) state.cloud = path;
  }

  if (state.cell) {
    const details = parseFlag(params.get("details"));
    if (details === false) state.details = false;
  }
  if (state.cell || state.cloud) {
    const cut = finite(params.get("cut"));
    if (cut !== null) state.cut = normaliseCut(Math.round(cut));
  }

  const overlays = parseOverlays(params.get("overlays"));
  if (overlays) state.overlays = overlays;

  const t = params.get("t");
  const time = t ? frameTime(t) : null;
  if (time !== null && !state.cell) state.time = time;

  const point = parsePair(params.get("point"));
  if (point) state.point = point;

  return state;
}

/* ---- writing ------------------------------------------------------------ */

const fixed = (value: number, digits: number): string => {
  const text = value.toFixed(digits);
  // "-0.00000" is a real toFixed() answer, and not a value anyone means.
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
};

/** Each owned parameter's value for `state`, or null to leave it out. */
function values(state: LinkState): Record<OwnedKey, string | null> {
  const { view } = state;
  const selection = Boolean(state.cell || state.cloud);
  return {
    layer: state.layer ?? null,
    // Five decimals is a metre: already finer than any radar pixel.
    latLonZ: view ? `${fixed(view.lat, 5)},${fixed(view.lon, 5)},${fixed(view.zoom, 2)}` : null,
    pitch: state.pitch === undefined ? null : fixed(state.pitch, 0),
    bearing: state.bearing === undefined ? null : fixed(normaliseCut(Math.round(state.bearing)), 0),
    overlays: state.overlays === undefined
      ? null
      : (OVERLAYS.filter((overlay) => state.overlays!.includes(overlay)).join(",") || "none"),
    t: state.time === undefined || state.cell ? null : frameLink(state.time),
    point: state.point ? `${fixed(state.point[0], 5)},${fixed(state.point[1], 5)}` : null,
    cell: state.cell ?? null,
    details: state.cell && state.details === false ? "0" : null,
    cloud: !state.cell && state.cloud ? cloudLink(state.cloud) : null,
    cut: selection && state.cut !== undefined && Math.round(normaliseCut(state.cut)) !== 0
      ? fixed(Math.round(normaliseCut(state.cut)), 0)
      : null,
  };
}

/**
 * A value as it goes into the query, keeping the separators readable.
 *
 * `URLSearchParams` would write the cloud's slash and every comma as `%2F` and
 * `%2C`, which a browser shows as-is in the address bar and which turn a link
 * someone is about to paste into a line of noise. Both are legal unescaped in
 * a query value.
 */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, "/").replace(/%2C/gi, ",");
}

/**
 * The query string for `state`, keeping every parameter it does not own.
 *
 * Foreign parameters stay first and in their own order; the owned ones follow
 * in a fixed one, so the same state always produces the same string and the
 * caller can tell "nothing changed" by comparing two of them.
 *
 * `keep` names owned parameters to carry over from `search` unchanged rather
 * than rewrite from `state` -- for a value the page does not know yet, such as
 * a view before the first map has rendered.
 */
export function linkSearch(search: string, state: LinkState, keep: readonly string[] = []): string {
  const current = new URLSearchParams(search);
  const owned = values(state);
  const parts: string[] = [];
  current.forEach((value, key) => {
    if (!(OWNED as readonly string[]).includes(key)) parts.push(`${encodeURIComponent(key)}=${encodeValue(value)}`);
  });
  for (const key of OWNED) {
    const value = keep.includes(key) ? current.get(key) : owned[key];
    if (value !== null) parts.push(`${key}=${encodeValue(value)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * Whether going from one state to the other is a step the Back button should
 * be able to undo.
 *
 * Switching map, or opening, changing or closing a storm, is navigation: it is
 * what a reader would expect Back to take them out of. Everything else --
 * panning, zooming, tilting, turning the slice, scrubbing, toggling an overlay
 * -- is adjusting the view they are in, and a history entry per pan would make
 * Back unusable for leaving the page at all.
 *
 * A link that names no layer is not a different layer: it is an older link, or
 * none, and the first state written over it is not something to go back from.
 */
export function isNavigation(from: LinkState, to: LinkState): boolean {
  if (from.layer !== undefined && from.layer !== to.layer) return true;
  return (from.cell ?? null) !== (to.cell ?? null) || (from.cloud ?? null) !== (to.cloud ?? null);
}
