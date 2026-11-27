/**
 * The captain's tablet, drawn: a moving map of the storms round the aircraft
 * over the app's own dark basemap, and the chosen storm's page beside it.
 * What it shows and how a hand uses it is lib/studio/flight/efb.ts; this is
 * its picture, on a sheet the flight deck stretches over the tablet's screen
 * (cockpitScreens.ts) and redraws a few times a second.
 *
 * The basemap is a small OpenLayers map of its own, never on the page: drawn
 * now and then, where the tablet's map has moved far enough from what it last
 * drew, and copied into a picture the sheet draws under the storms. Between
 * two of its drawings the picture is moved and scaled with the map, so a
 * drag or a change of range shows at once and the basemap catches up.
 */
import OlMap from "ol/Map";
import View from "ol/View";
import { AMBER, CYAN, DIM, FEET, FONT, GREEN, INK, KNOTS, MAGENTA, radarColour, tileKm } from "./instruments";
import { bearingDeg, distanceM, wrap180 } from "../../../lib/studio/flight/geo";
import {
  CHART_REACH_KM, EFB_BUTTONS, EFB_HEIGHT, EFB_LAYOUT, EFB_WIDTH, EfbState, MAP_MIDDLE, atTarget, echoAreas, onChart, RING_PX,
} from "../../../lib/studio/flight/efb";
import type { ChartFrame, EfbButton, Rect } from "../../../lib/studio/flight/efb";
import { tileBounds } from "../../../lib/volumeBox";
import type { Telemetry } from "../../../lib/studio/flight/pilot";
import logoUrl from "../../../assets/logo.svg";

const NM = 1852;
const RADIANS = Math.PI / 180;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** The basemap the tablet draws: the app's dark one, under which radar colours read best, as on a moving map at night. */
const BASEMAP = "dark";
/** How much further than the map the basemap is drawn each way, pixels: a drag shows basemap before it is drawn again. */
const BASEMAP_MARGIN = 96;
/** How far the map moves off the basemap last drawn before it is drawn again, pixels. */
const BASEMAP_STALE_PX = 72;
const PANEL_INK = "#0d1116";
const BUTTON = "rgba(18, 24, 31, 0.88)";
const EDGE = "#3a4552";

/** meteocool's logo, white, for the foot of the storm's page: loaded on first drawing, drawn once it is in. */
let logo: HTMLImageElement | null = null;
function logoImage(): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  if (!logo) {
    logo = new Image();
    logo.src = logoUrl;
  }
  return logo.complete && logo.naturalWidth > 0 ? logo : null;
}

/** What of the flight the tablet shows besides the telemetry. */
export interface EfbInputs {
  /** Whether time runs four times over: the time to a storm is the flight's own. */
  warp: boolean;
  /** The radar scan on the map, ms since 1970; null before one is. */
  scan: number | null;
  now: number;
  /** Other aircraft heard of, each where it is drawn now; none where not said. */
  others?: ReadonlyArray<EfbOther>;
}

/** Another aircraft, as the tablet's map needs it. */
export interface EfbOther {
  callsign?: string;
  shown: { lon: number; lat: number; heading: number; opacity: number };
}

/** How many aircraft off the map are marked at its edge, and how many of those are named. */
const OFF_MAP_MOST = 12;
const OFF_MAP_NAMED = 3;
/** How far inside the map's edge an aircraft off it is held, pixels. */
const OFF_MAP_INSET = 16;

/**
 * The basemap, drawn off the page: a picture of the map round a frame, and
 * which frame it is of. Made on first use and let go of with the flight.
 */
class Basemap {
  readonly canvas: HTMLCanvasElement;
  /** The frame the picture is of, null before it is drawn; and how often it has been. */
  frame: ChartFrame | null = null;
  version = 0;
  private readonly width = EFB_LAYOUT.map.width + 2 * BASEMAP_MARGIN;
  private readonly height = EFB_LAYOUT.map.height + 2 * BASEMAP_MARGIN;
  private element: HTMLDivElement | null = null;
  private map: OlMap | null = null;
  /** The frame asked of the map now, drawn when it has all its tiles. */
  private asked: ChartFrame | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  /** Have the basemap drawn round `frame`, if what was last drawn is too far off it or at another scale. */
  want(frame: ChartFrame): void {
    const near = (other: ChartFrame | null) => other !== null
      && Math.abs(other.resolution / frame.resolution - 1) < 0.01
      && Math.hypot(other.x - frame.x, other.y - frame.y) / frame.resolution < BASEMAP_STALE_PX;
    if (near(this.asked) || (this.asked === null && near(this.frame))) return;
    const map = this.map ?? this.make();
    if (!map) return;
    this.asked = { ...frame };
    map.getView().setCenter([frame.x, frame.y]);
    map.getView().setResolution(frame.resolution);
  }

  private make(): OlMap | null {
    const factory = typeof window === "undefined" ? undefined : window.lm?.baseLayerFactory;
    if (!factory) return null;
    const element = document.createElement("div");
    element.setAttribute("aria-hidden", "true");
    // Laid out, so the map has a size to draw at, but nowhere to be seen or touched.
    element.style.cssText = `position:fixed;left:-${this.width + 200}px;top:0;width:${this.width}px;height:${this.height}px;`
      + "pointer-events:none;visibility:hidden;contain:strict;";
    document.body.append(element);
    const map = new OlMap({
      target: element,
      layers: [factory.call(window.lm, BASEMAP)],
      controls: [],
      interactions: [],
      pixelRatio: 1,
      view: new View({ center: [0, 0], resolution: 1000 }),
    });
    // Each time it has drawn all it was asked, with its tiles in.
    map.on("rendercomplete", () => this.copy());
    [this.element, this.map] = [element, map];
    return map;
  }

  /** Copy what the map drew into the picture: each layer's canvas as it stands in the map. */
  private copy(): void {
    const context = this.canvas.getContext("2d");
    if (!context || !this.element || !this.asked) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.fillStyle = "#14171b";
    context.fillRect(0, 0, this.width, this.height);
    for (const layer of this.element.querySelectorAll<HTMLCanvasElement>(".ol-layer canvas, canvas.ol-layer")) {
      if (!layer.width || !layer.height) continue;
      const opacity = layer.parentElement?.style.opacity || layer.style.opacity;
      context.globalAlpha = opacity === "" ? 1 : Number(opacity);
      const matrix = /^matrix\(([^(]*)\)$/.exec(layer.style.transform)?.[1].split(",").map(Number);
      if (matrix?.length === 6) context.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      else context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(layer, 0, 0);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    this.frame = this.asked;
    this.asked = null;
    this.version += 1;
  }

  /** Draw the picture on the tablet's map as it is looked at now: moved and scaled from the frame it is of. */
  drawOn(context: CanvasRenderingContext2D, now: ChartFrame): boolean {
    const drawn = this.frame;
    if (!drawn) return false;
    const scale = drawn.resolution / now.resolution;
    const { map } = EFB_LAYOUT;
    const [mx, my] = [map.x + map.width / 2, map.y + map.height / 2];
    const x = mx + (drawn.x - now.x) / now.resolution - (this.width / 2) * scale;
    const y = my - (drawn.y - now.y) / now.resolution - (this.height / 2) * scale;
    context.drawImage(this.canvas, x, y, this.width * scale, this.height * scale);
    return true;
  }

  dispose(): void {
    if (this.map) {
      for (const layer of this.map.getLayers().getArray()) layer.dispose();
      this.map.setTarget(undefined);
      this.map.dispose();
    }
    this.element?.remove();
    [this.map, this.element, this.frame, this.asked] = [null, null, null, null];
    // Its pixels let go of at once, not when the canvas is collected.
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

function label(
  context: CanvasRenderingContext2D, value: string, x: number, y: number,
  { size = 18, colour = INK, align = "left", weight = 600 }: { size?: number; colour?: string; align?: CanvasTextAlign; weight?: number } = {},
): void {
  context.font = `${weight} ${size}px ${FONT}`;
  context.fillStyle = colour;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillText(value, x, y);
}

function rounded(context: CanvasRenderingContext2D, { x, y, width, height }: Rect, radius: number): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

/** A button of the tablet's: a dark key with its sign; lit where what it does is in force. */
function key(context: CanvasRenderingContext2D, button: EfbButton, sign: string, lit = false): void {
  const rect = EFB_BUTTONS[button];
  rounded(context, rect, 8);
  context.fillStyle = BUTTON;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = lit ? CYAN : EDGE;
  context.stroke();
  label(context, sign, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1, { size: sign.length > 1 ? 16 : 28, colour: lit ? CYAN : INK, align: "center", weight: 700 });
}

/** Minutes and seconds, or hours and minutes past an hour. */
function duration(seconds: number): string {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/** The tablet's chart and the chosen storm's page; `state` is what the hand has made of it. */
export class EfbChart {
  readonly state = new EfbState();
  private basemap: Basemap | null = null;

  /** Counts what changes the picture besides time: the hand's doing, and the basemap drawn again. */
  get version(): number {
    return this.state.version * 1000 + (this.basemap?.version ?? 0);
  }

  draw(context: CanvasRenderingContext2D, telemetry: Telemetry, inputs: EfbInputs): void {
    const { state: aircraft } = telemetry;
    const { chart } = telemetry;
    // The storm looked into in the view is the one the tablet turns to.
    this.state.update(chart.storms, aircraft, chart.target, telemetry.marks.find((seen) => seen.inspected)?.mark ?? null);
    const frame = this.state.frame();
    if (typeof document !== "undefined") {
      this.basemap ??= new Basemap();
      this.basemap.want(frame);
    }

    context.save();
    context.fillStyle = "#07090c";
    context.fillRect(0, 0, EFB_WIDTH, EFB_HEIGHT);
    this.drawMap(context, telemetry, frame, inputs.others ?? []);
    this.drawHeader(context, inputs);
    this.drawPanel(context, telemetry, inputs);
    context.restore();
  }

  private drawHeader(context: CanvasRenderingContext2D, { scan, now }: EfbInputs): void {
    const { header } = EFB_LAYOUT;
    context.fillStyle = "#11161c";
    context.fillRect(header.x, header.y, header.width, header.height);
    const middle = header.y + header.height / 2;
    label(context, "STORM MAP", 12, middle, { size: 17, weight: 800 });
    label(context, `${this.state.rangeNm} NM`, 128, middle, { size: 17, colour: CYAN, weight: 700 });
    label(context, "N↑", 206, middle, { size: 15, colour: DIM, weight: 700 });
    const utc = new Date(now);
    const clock = `${String(utc.getUTCHours()).padStart(2, "0")}:${String(utc.getUTCMinutes()).padStart(2, "0")}Z`;
    label(context, clock, EFB_WIDTH - 12, middle, { size: 17, align: "right", weight: 700 });
    if (scan !== null) {
      // How old the radar's picture is: the storms are where they were then.
      const minutes = Math.max(0, Math.round((now - scan) / 60_000));
      label(context, `RADAR ${minutes < 1 ? "NOW" : `−${minutes} MIN`}`, EFB_WIDTH - 86, middle, {
        size: 15, colour: minutes > 15 ? AMBER : GREEN, align: "right", weight: 700,
      });
    }
  }

  private drawMap(context: CanvasRenderingContext2D, telemetry: Telemetry, frame: ChartFrame, others: ReadonlyArray<EfbOther>): void {
    const { map } = EFB_LAYOUT;
    const { state: aircraft, chart } = telemetry;
    context.save();
    context.beginPath();
    context.rect(map.x, map.y, map.width, map.height);
    context.clip();
    if (!this.basemap?.drawOn(context, frame)) {
      context.fillStyle = "#14171b";
      context.fillRect(map.x, map.y, map.width, map.height);
    }

    // The radar's picture: the finer tiles where the list has them, the weakest first, each the square of the map it fills.
    const fine = telemetry.storms.filter((tile) => !tile.coarse);
    const tiles = [...(fine.length ? fine : telemetry.storms)].sort((a, b) => (a.peakDbz ?? 0) - (b.peakDbz ?? 0));
    // Half see-through, as on the plan's chart: the coast and the borders under the rain.
    context.globalAlpha = 0.55;
    for (const tile of tiles) {
      const colour = radarColour(tile.peakDbz ?? 0);
      if (!colour) continue;
      let corners: [[number, number], [number, number]];
      if (tile.tile) {
        const [west, south, east, north] = tileBounds(tile.tile[0], tile.tile[1], tile.tile[2]);
        corners = [onChart(frame, west, north), onChart(frame, east, south)];
      } else {
        const [x, y] = onChart(frame, tile.lon, tile.lat);
        const half = (tileKm(null, tile.lat) * 500) / (frame.resolution * Math.cos(tile.lat * RADIANS));
        corners = [[x - half, y - half], [x + half, y + half]];
      }
      const [[left, top], [right, bottom]] = corners;
      if (right < map.x || left > map.x + map.width || bottom < map.y || top > map.y + map.height) continue;
      context.fillStyle = colour;
      // Tiles abut: a hair over their side, so no seam shows between them.
      context.fillRect(left - 0.3, top - 0.3, right - left + 0.6, bottom - top + 0.6);
    }
    context.globalAlpha = 1;

    const [ax, ay] = onChart(frame, aircraft.lon, aircraft.lat);
    // The range rings round the aircraft, the inner one dashed, each with its range.
    context.lineWidth = 1.5;
    context.strokeStyle = "rgba(220, 230, 240, 0.55)";
    for (const [share, dash] of [[0.5, [5, 6]], [1, []]] as Array<[number, number[]]>) {
      context.setLineDash(dash);
      context.beginPath();
      context.arc(ax, ay, RING_PX * share, 0, Math.PI * 2);
      context.stroke();
      // Behind and left of the aircraft, south-west: where the way ahead and the storms flown at are least often.
      const at = (3 * Math.PI) / 4;
      label(context, String(this.state.rangeNm * share), ax + Math.cos(at) * RING_PX * share - 4, ay + Math.sin(at) * RING_PX * share + 10, {
        size: 14, colour: DIM, align: "right", weight: 700,
      });
    }
    context.setLineDash([]);

    // The way to the system flown at, as the plan drew it.
    if (chart.target) {
      const [tx, ty] = onChart(frame, chart.target.lon, chart.target.lat);
      context.strokeStyle = MAGENTA;
      context.lineWidth = 2.5;
      context.setLineDash([9, 7]);
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(tx, ty);
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      context.moveTo(tx, ty - 10);
      context.lineTo(tx + 10, ty);
      context.lineTo(tx, ty + 10);
      context.lineTo(tx - 10, ty);
      context.closePath();
      context.stroke();
    }

    // The storms: a dot in the radar's colour, its motion over the next half hour, hail marked with a white rim.
    const selected = this.state.storms[this.state.selected];
    for (const storm of this.state.storms) {
      const [sx, sy] = onChart(frame, storm.lon, storm.lat);
      if (sx < map.x - 20 || sx > map.x + map.width + 20 || sy < map.y - 20 || sy > map.y + map.height + 20) continue;
      if (storm.heading !== null && storm.speed !== null && storm.speed > 1) {
        const metres = storm.speed * 1800;
        const px = Math.max(10, metres / (frame.resolution * Math.cos(storm.lat * RADIANS)));
        const [dx, dy] = [Math.sin(storm.heading * RADIANS) * px, -Math.cos(storm.heading * RADIANS) * px];
        context.strokeStyle = "rgba(242, 244, 247, 0.85)";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(sx, sy);
        context.lineTo(sx + dx, sy + dy);
        const back = Math.atan2(dy, dx) + Math.PI;
        for (const side of [-0.45, 0.45]) {
          context.moveTo(sx + dx, sy + dy);
          context.lineTo(sx + dx + Math.cos(back + side) * 7, sy + dy + Math.sin(back + side) * 7);
        }
        context.stroke();
      }
      context.beginPath();
      context.arc(sx, sy, 5.5, 0, Math.PI * 2);
      context.fillStyle = radarColour(storm.peakDbz) ?? INK;
      context.fill();
      context.lineWidth = storm.hail ? 3 : 1.5;
      context.strokeStyle = storm.hail ? "#ffffff" : "rgba(7, 9, 12, 0.9)";
      context.stroke();
    }
    if (selected) {
      // The chosen storm, bracketed, with its strength beside it.
      const [sx, sy] = onChart(frame, selected.lon, selected.lat);
      context.strokeStyle = CYAN;
      context.lineWidth = 2.5;
      const [r, arm] = [15, 7];
      context.beginPath();
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        context.moveTo(sx + cx * r, sy + cy * (r - arm));
        context.lineTo(sx + cx * r, sy + cy * r);
        context.lineTo(sx + cx * (r - arm), sy + cy * r);
      }
      context.stroke();
      const right = sx + 20 + 60 < map.x + map.width - 60;
      label(context, `${Math.round(selected.peakDbz)}`, right ? sx + 20 : sx - 20, sy - 14, {
        size: 16, colour: CYAN, align: right ? "left" : "right", weight: 800,
      });
    }

    // Other aircraft: a chevron pointing its way where it is; one off the map an arrowhead at the edge
    // towards it, however far it is, the nearest few with their callsign and how far.
    const [mx, my] = MAP_MIDDLE;
    const [halfWidth, halfHeight] = [map.width / 2 - OFF_MAP_INSET, map.height / 2 - OFF_MAP_INSET];
    const off: Array<{ x: number; y: number; angle: number; nm: number; callsign: string }> = [];
    const mark = (x: number, y: number, angle: number, points: ReadonlyArray<readonly [number, number]>, filled: boolean, alpha: number) => {
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      context.globalAlpha = alpha;
      context.beginPath();
      points.forEach(([px, py], i) => (i ? context.lineTo(px, py) : context.moveTo(px, py)));
      context.closePath();
      context.lineWidth = 5;
      context.strokeStyle = "rgba(7, 9, 12, 0.9)";
      context.stroke();
      if (filled) {
        context.fillStyle = CYAN;
        context.fill();
      } else {
        context.lineWidth = 2.2;
        context.strokeStyle = CYAN;
        context.stroke();
      }
      context.restore();
    };
    for (const { shown, callsign } of others) {
      if (shown.opacity <= 0.05) continue;
      const [ox, oy] = onChart(frame, shown.lon, shown.lat);
      const [dx, dy] = [ox - mx, oy - my];
      const over = Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
      if (over <= 1) {
        mark(ox, oy, shown.heading * RADIANS, [[0, -9], [6.5, 7], [0, 3.5], [-6.5, 7]], false, Math.min(1, shown.opacity));
        continue;
      }
      off.push({
        x: mx + dx / over, y: my + dy / over, angle: Math.atan2(dx, -dy),
        nm: distanceM(aircraft.lon, aircraft.lat, shown.lon, shown.lat) / NM, callsign: callsign ?? "",
      });
    }
    off.sort((a, b) => a.nm - b.nm);
    off.slice(0, OFF_MAP_MOST).forEach((other, i) => {
      mark(other.x, other.y, other.angle, [[0, -8], [7, 6], [-7, 6]], true, 1);
      if (i >= OFF_MAP_NAMED) return;
      // Inside the edge, on the side of the mark the map is on.
      const [ix, iy] = [other.x - Math.sin(other.angle) * 20, other.y + Math.cos(other.angle) * 20];
      const miles = `${Math.round(other.nm)} NM`;
      label(context, other.callsign ? `${other.callsign} · ${miles}` : miles, ix, iy, {
        size: 14, colour: CYAN, align: ix < mx - halfWidth / 2 ? "left" : ix > mx + halfWidth / 2 ? "right" : "center", weight: 700,
      });
    });

    // The aircraft, and where its nose points out to the outer ring.
    context.strokeStyle = "rgba(255, 214, 10, 0.8)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(ax, ay);
    context.lineTo(ax + Math.sin(aircraft.heading * RADIANS) * RING_PX, ay - Math.cos(aircraft.heading * RADIANS) * RING_PX);
    context.stroke();
    context.save();
    context.translate(ax, ay);
    context.rotate(aircraft.heading * RADIANS);
    context.beginPath();
    // An airliner seen from above: fuselage, wings, tailplane.
    context.moveTo(0, -13);
    context.lineTo(2, -5);
    context.lineTo(12, 2);
    context.lineTo(12, 4.5);
    context.lineTo(2, 1);
    context.lineTo(1.6, 8);
    context.lineTo(5, 11);
    context.lineTo(5, 12.5);
    context.lineTo(0, 11);
    context.lineTo(-5, 12.5);
    context.lineTo(-5, 11);
    context.lineTo(-1.6, 8);
    context.lineTo(-2, 1);
    context.lineTo(-12, 4.5);
    context.lineTo(-12, 2);
    context.lineTo(-2, -5);
    context.closePath();
    context.fillStyle = "#ffd60a";
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = "#1a1a1a";
    context.stroke();
    context.restore();

    // The keys: the range in and out, and back to the aircraft (lit while the map is elsewhere).
    key(context, "zoomIn", "+");
    key(context, "zoomOut", "−");
    key(context, "centre", "CTR", this.state.centre !== null);
    context.restore();
  }

  private drawPanel(context: CanvasRenderingContext2D, telemetry: Telemetry, { warp }: EfbInputs): void {
    const { panel } = EFB_LAYOUT;
    const { state: aircraft, chart } = telemetry;
    context.fillStyle = PANEL_INK;
    context.fillRect(panel.x, panel.y, panel.width, panel.height);
    context.fillStyle = EDGE;
    context.fillRect(panel.x, panel.y, 2, panel.height);
    const middle = panel.x + panel.width / 2;
    const { storms, selected: index } = this.state;
    key(context, "previous", "◀");
    key(context, "next", "▶");
    const storm = storms[index];
    label(context, storm ? `${index + 1} / ${storms.length}` : "—", middle, 64, { size: 15, colour: DIM, align: "center", weight: 700 });
    // Chosen on the tablet, or by it: the system flown at's strongest, or the nearest ahead.
    label(context, this.state.chosen ? "SELECTED" : "AUTO", middle, 84, {
      size: 13, colour: DIM, align: "center", weight: 700,
    });
    if (!storm) {
      label(context, "NO STORMS", middle, 200, { size: 22, colour: DIM, align: "center", weight: 800 });
      label(context, `within ${CHART_REACH_KM} km`, middle, 230, { size: 15, colour: DIM, align: "center" });
      return;
    }

    const left = panel.x + 16;
    label(context, `${Math.round(storm.peakDbz)}`, left, 132, { size: 46, colour: radarColour(storm.peakDbz) ?? INK, weight: 800 });
    label(context, "dBZ", left + 64, 142, { size: 17, colour: DIM, weight: 700 });
    // What sets it apart, as tags: the system flown at, hail, a cell the radar follows.
    const tags: Array<[string, string]> = [];
    if (this.state.chosenLooked) tags.push(["IN VIEW", CYAN]);
    if (atTarget(storm, chart.target)) tags.push(["TARGET", MAGENTA]);
    if (storm.hail) tags.push(["HAIL", AMBER]);
    if (storm.heading !== null) tags.push(["TRACKED", GREEN]);
    let tagY = 116;
    for (const [tag, colour] of tags) {
      context.font = `800 12px ${FONT}`;
      const width = context.measureText(tag).width + 12;
      const x = panel.x + panel.width - 12 - width;
      rounded(context, { x, y: tagY - 10, width, height: 20 }, 4);
      context.strokeStyle = colour;
      context.lineWidth = 1.5;
      context.stroke();
      label(context, tag, x + width / 2, tagY + 1, { size: 12, colour, align: "center", weight: 800 });
      tagY += 26;
    }

    const metres = distanceM(aircraft.lon, aircraft.lat, storm.lon, storm.lat);
    const bearing = bearingDeg(aircraft.lon, aircraft.lat, storm.lon, storm.lat);
    const off = wrap180(bearing - aircraft.heading);
    const groundSpeed = aircraft.tas * Math.cos(aircraft.flightPath * RADIANS) * (warp ? 4 : 1);
    const area = echoAreas([storm], telemetry.storms)[0];
    const rows: Array<[string, string, string?]> = [
      ["DIST", `${(metres / NM).toFixed(metres < 20 * NM ? 1 : 0)} NM`],
      ["BRG", `${String(Math.round(bearing) % 360).padStart(3, "0")}°`, Math.abs(off) < 2 ? "AHEAD" : `${Math.round(Math.abs(off))}° ${off < 0 ? "L" : "R"}`],
      ["ETA", groundSpeed > 30 ? duration(metres / groundSpeed) : "—", groundSpeed > 30 ? `${Math.round(groundSpeed * KNOTS)} kt` : undefined],
      ["TOP", storm.top === null ? "—" : `FL${String(Math.round((storm.top * FEET) / 1000) * 10).padStart(3, "0")}`],
      ["MOVES", storm.heading !== null && storm.speed !== null && storm.speed > 1
        ? `${COMPASS[Math.round(storm.heading / 45) % 8]} ${Math.round(storm.speed * KNOTS)} kt` : "—"],
      ["LTNG", storm.strikes ? `${storm.strikes} ⚡` : "—", storm.strikes ? "5 MIN" : undefined],
      ["AREA", area === null ? "—" : `${area >= 1000 ? `${(area / 1000).toFixed(1)}k` : Math.round(area)} km²`],
    ];
    rows.forEach(([name, value, note], row) => {
      const y = 196 + row * 36;
      label(context, name, left, y, { size: 13, colour: DIM, weight: 700 });
      label(context, value, left + 62, y, { size: 21, weight: 700 });
      if (note) label(context, note, panel.x + panel.width - 12, y + 1, { size: 14, colour: DIM, align: "right", weight: 700 });
    });
    label(context, "TAP A STORM · DRAG THE MAP", middle, panel.y + panel.height - 40, { size: 11, colour: DIM, align: "center", weight: 700 });
    this.drawBrand(context);
  }

  /** The foot of the storm's page: whose radar it is, meteocool's logo and its address. */
  private drawBrand(context: CanvasRenderingContext2D): void {
    const { panel } = EFB_LAYOUT;
    const middle = panel.y + panel.height - 15;
    context.fillStyle = EDGE;
    context.fillRect(panel.x + 12, middle - 15, panel.width - 24, 1);
    const text = "meteocool.com";
    context.font = `800 15px ${FONT}`;
    const size = 20;
    const width = size + 7 + context.measureText(text).width;
    const left = panel.x + (panel.width - width) / 2;
    const image = logoImage();
    if (image) context.drawImage(image, left, middle - size / 2, size, (size * image.naturalHeight) / image.naturalWidth || size);
    label(context, text, left + size + 7, middle + 1, { size: 15, weight: 800 });
  }

  /** A tap on the tablet, across and down it 0 to 1. */
  tap(across: number, down: number): void {
    this.state.tap(across * EFB_WIDTH, down * EFB_HEIGHT);
  }

  drag(from: [number, number], to: [number, number]): void {
    this.state.drag([from[0] * EFB_WIDTH, from[1] * EFB_HEIGHT], [to[0] * EFB_WIDTH, to[1] * EFB_HEIGHT]);
  }

  release(): void {
    this.state.release();
  }

  dispose(): void {
    this.basemap?.dispose();
    this.basemap = null;
  }
}
