/**
 * What a link to the map says.
 *
 * A link carries what the sender was looking at (which map, where, which
 * storm, how it was cut open) and nothing about how they like to look at
 * things. The basemap, the colour scheme, dark mode and units belong to
 * whoever opens the link, so they are never written here and a receiver keeps
 * their own. The line runs between content and presentation: two people
 * looking at the same link see the same weather, each in their own colours.
 *
 * Pure, and separate from the wiring in `urlState.ts`, because the rules are
 * all string handling and small invariants (what a malformed value falls back
 * to, which parameters only mean something together), and those are what a
 * test should hold down.
 *
 * Content is everything that changes what the receiver sees of the weather:
 * the overlays and what they show, the radar product, which storm marks the
 * key has put away, an open storm, station, radar or model comparison, the
 * frame or scan, the cut and the peel. A link made now says each of those
 * explicitly, so a receiver who keeps the stations on sees them off if the
 * sender had them off; a link from before a parameter existed leaves that
 * choice to the receiver, as it always did.
 *
 * Every parameter is optional and every value is validated on the way in: a
 * link is text anyone can edit, and a value that does not parse is dropped
 * rather than half-applied. Parameters this module does not own (`logo`,
 * `toolbar` and `layerswitcher`, which embeds set) are left where they are.
 */
import { normaliseCut } from "./cutAngle";
import type { Quantity } from "./siteSweeps";
import { OBSERVED_PRODUCTS } from "./observedProduct";
import type { ObservedProduct } from "./observedProduct";
import { STATION_CHOICES } from "./stations";
import type { StationChoice } from "./stations";
import { clampSpeed, formatManualMotion, snapHeading } from "./srvMotion";
import type { ManualMotion } from "./srvMotion";
import type { StormMarkToggle } from "../stores";

/**
 * The switchable overlays of either map, in the order a link lists them: the
 * radar map's storms, strikes, cyclones, radars' marks and weather stations,
 * and the 3D map's KONRAD3D cells drawn as tiers.
 */
export const OVERLAYS = ["cells", "lightning", "mesocyclones", "sites", "stations", "tiers"] as const;
export type Overlay = (typeof OVERLAYS)[number];

/**
 * The overlays a link could name before 2026-10-29, when it listed only the
 * ones that were on: what an `overlays` list made of these alone means; see
 * `parseOverlays`.
 */
const FIRST_OVERLAYS: readonly Overlay[] = ["cells", "lightning", "mesocyclones"];

/** The overlays each map has, all of which a link from that map names. */
export const MAP_OVERLAYS: Readonly<Record<string, readonly Overlay[]>> = {
  radar: ["cells", "lightning", "mesocyclones", "sites", "stations"],
  cells3d: ["tiers"],
};

/** Each overlay a link names, on or off; one it does not name is the reader's own. */
export type OverlayStates = Partial<Record<Overlay, boolean>>;

/** The storm marks the map key can put away (`StormMarkToggle`), in the order a link lists them. */
export const STORM_MARKS = [
  "dwd", "meteocool", "weak", "moderate", "strong", "extreme",
  "live", "path", "join", "hail", "rotation", "forecast", "volume",
] as const satisfies readonly StormMarkToggle[];
// Every toggle the key has, or a new one would never reach a link.
const ALL_MARKS: Exclude<StormMarkToggle, (typeof STORM_MARKS)[number]> extends never ? true : never = true;
void ALL_MARKS;

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
  /** A storm, by its id: what a link to a storm says since storms. */
  storm?: string;
  /**
   * A KONRAD3D cell, by track code: a link from before storms, or to a cell
   * no storm has claimed. Opened and redirected to its storm once found.
   */
  cell?: string;
  /**
   * Whether the cell's detail panel is open, as opposed to only its forecast
   * being drawn: the two steps a phone separates; see lib/cellSelection.ts.
   * Only ever false in a link: open is what a link to a cell means otherwise.
   */
  details?: boolean;
  /** A box of sky found in the composite, by the path of its volume; redirected to its storm like a cell. */
  cloud?: string;
  /** How far the cutaway's slice is turned, as `cutRotationDeg` holds it. */
  cut?: number;
  /** Which overlays are on and which off; an overlay left out is whatever the reader has chosen. */
  overlays?: OverlayStates;
  /** The product the radar map's observed frames are drawn from. */
  product?: ObservedProduct;
  /** The storm marks the map key has put away; empty for none. */
  hide?: StormMarkToggle[];
  /** What the weather stations show. Only with the stations on. */
  stationParameter?: StationChoice;
  /**
   * A frame off the live edge, in unix seconds as the radar grid keys it; on
   * the 3D map, the earlier scan its storms are from.
   */
  time?: number;
  /** The point the forecast strip is asked about, as [lat, lon]. */
  point?: [number, number];
  /** A radar open in site mode: its code, what is drawn of it (reflectivity unless said) and the tilt. */
  radar?: LinkRadar;
  /**
   * The storm motion storm-relative velocity takes out, as set by hand. Only
   * with SRV drawn, and only when it is the hand's rather than a storm's.
   */
  motion?: ManualMotion;
  /** How far the 3D map's storms are peeled, 0 to 1, when the reader set it. Only without a selection. */
  peel?: number;
  /** A weather station's sheet, by its id. */
  station?: string;
  /** The point the model comparison is open for, as [lat, lon]. */
  compare?: [number, number];
  /**
   * When the link was shared, in unix seconds, to the minute. Set only on a
   * link made to be sent (lib/shareLink.ts), so the receiver can be told how
   * old what they were sent is; never part of what is on screen, so the
   * address bar drops it with the first state the page writes.
   */
  shared?: number;
}

/** A radar open in site mode, as a link names it. */
export interface LinkRadar {
  site: string;
  quantity: Quantity;
  /** The tilt's elevation in degrees; absent, the lowest. */
  tilt?: number;
}

/**
 * The parameters this module reads and writes, in the order it writes them.
 *
 * `latLonZ` keeps the name and shape it has always had, so every link and
 * dashboard URL already in circulation still opens where it used to.
 */
const OWNED = [
  "layer", "latLonZ", "pitch", "bearing", "overlays", "product", "hide", "stationParameter",
  "t", "point", "radar", "sweep", "tilt", "motion",
  "storm", "cell", "details", "cloud", "cut", "peel", "station", "compare", "shared",
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

/** A radar site's code, `deoft` or `frave`: a plain word, which `/sweeps?site=` looks up. */
const RADAR = /^[a-z0-9]{3,12}$/;

/** What a link may say is drawn of a radar beside reflectivity, the default. */
const SWEEPS: readonly Quantity[] = ["velocity", "srv"];

/** A storm id: opaque, in the 26-character shape the backend hands out; anything else is not looked up. */
const STORM = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * A volume as a link names it: the scan and the core, `20260924T194500/R39853139`.
 *
 * The object's path with the constant parts taken off, which is shorter and
 * reads as an identifier. Because it is rebuilt from two validated pieces,
 * a link can only ever point the client at a volume, never at some
 * other object on the tile host. The layout is the backend's; a core's code
 * is its grid position, which is only unique within one scan, hence the scan
 * in front.
 *
 * Three namings: the network and a tile, `de-T100054400355`, since storms
 * were boxed by map tile; the network and a position, `de-G1401218632`, from
 * when the five networks were boxed until then; and the bare `R...` before.
 * Only the oldest was accepted until 2026-10-01, so no newer core opened on
 * the map was ever written into the address, and no link to one opened.
 */
const CLOUD_NAME = String.raw`((?:[a-z]{2}-)?(?:T\d{12}|G\d{10}|R\d{1,12}))`;
const CLOUD_LINK = new RegExp(String.raw`^(\d{8}T\d{6})\/${CLOUD_NAME}$`);
const CLOUD_PATH = new RegExp(String.raw`^meteoradar\/volumes\/(\d{8}T\d{6})\/${CLOUD_NAME}\.mcvx$`);

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
 * frame the receiver's grid no longer holds is not restored.
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

/**
 * The overlays a link names: `cells,lightning,-stations` is the storms and the
 * strikes on and the stations off.
 *
 * Two forms. A link made since 2026-10-29 names every overlay of its map, the
 * ones off with a minus, and an overlay it does not name (one added later, or
 * the other map's) is the reader's own. A link from before listed only the
 * ones that were on, and only of the first three (`FIRST_OVERLAYS`), or said
 * `none`: one of those three it leaves out is off, as it always was, and the
 * overlays added since are the reader's own. A list is the old form when it
 * could have been written then: no minus, and none of the newer names.
 */
function parseOverlays(text: string | null): OverlayStates | undefined {
  if (text === null) return undefined;
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1 && parts[0] === "none") {
    return Object.fromEntries(FIRST_OVERLAYS.map((overlay) => [overlay, false]));
  }
  const named = new Map<Overlay, boolean>();
  for (const part of parts) {
    const off = part.startsWith("-");
    const name = (off ? part.slice(1) : part) as Overlay;
    if (OVERLAYS.includes(name)) named.set(name, !off);
  }
  // A list that names nothing this app has is a typo, not "all off".
  if (!named.size) return undefined;
  const old = parts.every((part) => !part.startsWith("-"))
    && [...named.keys()].every((overlay) => FIRST_OVERLAYS.includes(overlay));
  const states: OverlayStates = {};
  for (const overlay of OVERLAYS) {
    if (named.has(overlay)) states[overlay] = named.get(overlay);
    else if (old && FIRST_OVERLAYS.includes(overlay)) states[overlay] = false;
  }
  return states;
}

/** `cells,-stations`: each overlay `states` names, in `OVERLAYS` order; null for none. */
function writeOverlays(states: OverlayStates): string | null {
  const named = OVERLAYS.filter((overlay) => states[overlay] !== undefined);
  return named.length ? named.map((overlay) => (states[overlay] ? overlay : `-${overlay}`)).join(",") : null;
}

/** The storm marks put away, `weak,path`, or `none`; a list naming none the key has is dropped. */
function parseHide(text: string | null): StormMarkToggle[] | undefined {
  if (text === null) return undefined;
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1 && parts[0] === "none") return [];
  const known = STORM_MARKS.filter((mark) => parts.includes(mark));
  return known.length ? known : undefined;
}

/** A storm motion set by hand, `heading,km/h`, as the `srvMotion` setting spells it; null for anything else. */
function parseMotion(text: string | null): ManualMotion | null {
  const parts = (text ?? "").split(",");
  if (parts.length !== 2) return null;
  const [heading, speed] = parts.map(finite);
  if (heading === null || speed === null || speed < 0) return null;
  return { headingDeg: snapHeading(heading), speedKmh: clampSpeed(speed) };
}

/** A weather station's id, DWD's `02290`: a plain word, safe as a path segment of `/stations/{id}/observations`. */
const STATION = /^[A-Za-z0-9]{1,16}$/;

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
 * - a storm, a cell and a cloud are one selection, and the storm wins, then
 *   the cell, since it has a track and a history and the cloud only a volume;
 * - a storm or a cell is only drawn on the newest frame (see the gate in
 *   App.svelte), so a frame off the live edge beside one is dropped;
 * - the panel and the slice both belong to a selection, and mean nothing
 *   without one;
 * - a storm's sheet is the one a station's or the model comparison's would
 *   take, so a storm beside either drops it, as opening one closes them;
 * - the peel is of storms nobody has opened, and is dropped beside one;
 * - the stations' parameter means nothing with the stations off, and a hand's
 *   storm motion nothing without storm-relative velocity drawn.
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

  const storm = params.get("storm");
  const cell = params.get("cell");
  const cloud = params.get("cloud");
  if (storm && STORM.test(storm)) {
    state.storm = storm;
  } else if (cell && CELL.test(cell)) {
    state.cell = cell;
  } else if (cloud) {
    const path = cloudPath(cloud);
    if (path) state.cloud = path;
  }

  if (state.storm || state.cell) {
    const details = parseFlag(params.get("details"));
    if (details === false) state.details = false;
  }
  if (state.storm || state.cell || state.cloud) {
    const cut = finite(params.get("cut"));
    if (cut !== null) state.cut = normaliseCut(Math.round(cut));
  }

  const overlays = parseOverlays(params.get("overlays"));
  if (overlays) state.overlays = overlays;

  const product = params.get("product") as ObservedProduct | null;
  if (product && OBSERVED_PRODUCTS.includes(product)) state.product = product;

  const hide = parseHide(params.get("hide"));
  if (hide) state.hide = hide;

  const selection = Boolean(state.storm || state.cell || state.cloud);
  const station = params.get("station");
  if (station && STATION.test(station) && !selection) state.station = station;

  const parameter = params.get("stationParameter") as StationChoice | null;
  if (parameter && STATION_CHOICES.includes(parameter) && (state.overlays?.stations || state.station)) {
    state.stationParameter = parameter;
  }

  const t = params.get("t");
  const time = t ? frameTime(t) : null;
  if (time !== null && !state.cell && !state.storm) state.time = time;

  const point = parsePair(params.get("point"));
  if (point) state.point = point;

  const radar = params.get("radar")?.toLowerCase();
  if (radar && RADAR.test(radar)) {
    const sweep = params.get("sweep") as Quantity | null;
    const tilt = finite(params.get("tilt"));
    state.radar = { site: radar, quantity: sweep && SWEEPS.includes(sweep) ? sweep : "reflectivity" };
    if (tilt !== null && tilt >= 0 && tilt <= 90) state.radar.tilt = tilt;
    const motion = state.radar.quantity === "srv" ? parseMotion(params.get("motion")) : null;
    if (motion) state.motion = motion;
  }

  const peel = finite(params.get("peel"));
  if (peel !== null && !selection) state.peel = Math.round(Math.min(Math.max(peel, 0), 1) * 100) / 100;

  const compare = parsePair(params.get("compare"));
  if (compare && !selection) state.compare = compare;

  // The same spelling as a frame's, which is what it is: a minute, in UTC.
  const sharedAt = params.get("shared");
  const shared = sharedAt ? frameTime(sharedAt) : null;
  if (shared !== null) state.shared = shared;

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
  const selection = Boolean(state.storm || state.cell || state.cloud);
  const tracked = Boolean(state.storm || state.cell);
  const station = !selection && state.station ? state.station : null;
  const stationsOn = Boolean(state.overlays?.stations || station);
  return {
    layer: state.layer ?? null,
    // Five decimals is a metre: already finer than any radar pixel.
    latLonZ: view ? `${fixed(view.lat, 5)},${fixed(view.lon, 5)},${fixed(view.zoom, 2)}` : null,
    pitch: state.pitch === undefined ? null : fixed(state.pitch, 0),
    bearing: state.bearing === undefined ? null : fixed(normaliseCut(Math.round(state.bearing)), 0),
    overlays: state.overlays === undefined ? null : writeOverlays(state.overlays),
    product: state.product ?? null,
    hide: state.hide === undefined
      ? null
      : (STORM_MARKS.filter((mark) => state.hide!.includes(mark)).join(",") || "none"),
    stationParameter: stationsOn && state.stationParameter ? state.stationParameter : null,
    t: state.time === undefined || tracked ? null : frameLink(state.time),
    point: state.point ? `${fixed(state.point[0], 5)},${fixed(state.point[1], 5)}` : null,
    radar: state.radar?.site ?? null,
    sweep: state.radar && state.radar.quantity !== "reflectivity" ? state.radar.quantity : null,
    // Two decimals, as the sites file them (Meteo-France's 0.39), without trailing zeros.
    tilt: state.radar?.tilt === undefined ? null : String(Math.round(state.radar.tilt * 100) / 100),
    motion: state.radar?.quantity === "srv" && state.motion ? formatManualMotion(state.motion) : null,
    storm: state.storm ?? null,
    cell: !state.storm && state.cell ? state.cell : null,
    details: tracked && state.details === false ? "0" : null,
    cloud: !tracked && state.cloud ? cloudLink(state.cloud) : null,
    cut: selection && state.cut !== undefined && Math.round(normaliseCut(state.cut)) !== 0
      ? fixed(Math.round(normaliseCut(state.cut)), 0)
      : null,
    peel: selection || state.peel === undefined ? null : String(Math.round(Math.min(Math.max(state.peel, 0), 1) * 100) / 100),
    station,
    compare: !selection && state.compare ? `${fixed(state.compare[0], 5)},${fixed(state.compare[1], 5)}` : null,
    shared: state.shared === undefined ? null : frameLink(state.shared),
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
 * than rewrite from `state`: for a value the page does not know yet, such as
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
 * Switching map, or opening, changing or closing a storm, a radar, a
 * station's sheet or the model comparison, is navigation: it is what a
 * reader would expect Back to take them out of. Everything else (panning,
 * zooming, tilting, turning the slice, scrubbing, toggling an overlay or
 * picking a product) is adjusting the view they are in, and a history entry
 * per pan would make Back unusable for leaving the page at all.
 *
 * A link that names no layer is not a different layer: it is an older link, or
 * none, and the first state written over it is not something to go back from.
 */
export function isNavigation(from: LinkState, to: LinkState): boolean {
  if (from.layer !== undefined && from.layer !== to.layer) return true;
  return (from.storm ?? null) !== (to.storm ?? null)
    || (from.cell ?? null) !== (to.cell ?? null) || (from.cloud ?? null) !== (to.cloud ?? null)
    || (from.radar?.site ?? null) !== (to.radar?.site ?? null)
    || (from.station ?? null) !== (to.station ?? null)
    || from.compare?.join(",") !== to.compare?.join(",");
}
