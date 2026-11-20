/**
 * Drawing the flight deck's two screens: the primary flight display and the
 * navigation display with its weather radar.
 *
 * Plain canvas, redrawn every frame from the pilot's telemetry. In the
 * colours an airliner's glass cockpit uses (white scales, green for what is
 * engaged, amber for caution, magenta for what is flown at), which read at a
 * glance against the black of a screen.
 */
import { wrap180, wrap360 } from "../../../lib/studio/flight/geo";
import type { Telemetry } from "../../../lib/studio/flight/pilot";

export const KNOTS = 1.943844;
export const FEET = 3.28084;
const NM = 1852;
const RADIANS = Math.PI / 180;

export const INK = "#f2f4f7";
export const DIM = "#9aa3ad";
export const GREEN = "#3ddc84";
export const AMBER = "#ffb02e";
export const RED = "#ff453a";
export const MAGENTA = "#ff4fd8";
export const CYAN = "#5ac8fa";
export const SKY = "#1c6fd1";
export const EARTH = "#8a5a2b";
export const FONT = "system-ui, -apple-system, sans-serif";

/** A canvas sized to its box at the screen's pixel density, and its context scaled to CSS pixels. */
export function prepare(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
  if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

export function text(
  context: CanvasRenderingContext2D, value: string, x: number, y: number,
  { size = 11, colour = INK, align = "center", weight = 600 }: { size?: number; colour?: string; align?: CanvasTextAlign; weight?: number } = {},
): void {
  context.font = `${weight} ${size}px ${FONT}`;
  context.fillStyle = colour;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillText(value, x, y);
}

/**
 * The radar's colours: green, yellow, red, and magenta for the strongest.
 *
 * For a tile's peak, not for the echo at a point, which is what an
 * aircraft's radar paints: the strongest voxel of a tile of thunderstorm is
 * past 50 dBZ nearly everywhere, and on a point's scale the whole system
 * came out one magenta block. Each step stands some ten higher here, so the
 * picture tells the rain round a system from its towers.
 */
export function radarColour(peakDbz: number): string | null {
  if (peakDbz < 25) return null;
  if (peakDbz < 40) return "rgba(61, 220, 132, 0.75)";
  if (peakDbz < 50) return "rgba(255, 214, 10, 0.85)";
  if (peakDbz < 58) return "rgba(255, 69, 58, 0.9)";
  return "rgba(255, 79, 216, 0.95)";
}

/** The primary flight display: attitude, speed and altitude tapes, vertical speed, heading, annunciators. */
export function drawPfd(
  context: CanvasRenderingContext2D, width: number, height: number, telemetry: Telemetry,
  flags: { autopilot: boolean; warp: boolean; recording: boolean; brake: boolean; pullUp?: boolean },
): void {
  const { state } = telemetry;
  context.fillStyle = "#05070a";
  context.fillRect(0, 0, width, height);

  // The annunciators along the top.
  const annunciators: Array<[string, string]> = [[`THR ${Math.round(state.throttle * 100)}%`, INK]];
  if (flags.autopilot) annunciators.push(["AP", GREEN]);
  if (flags.warp) annunciators.push(["WARP ×4", AMBER]);
  if (flags.brake) annunciators.push(["SPD BRK", AMBER]);
  if (flags.recording) annunciators.push(["REC", RED]);
  annunciators.forEach(([label, colour], i) => {
    text(context, label, 70 + i * 62, 10, { size: 10, colour, align: "left", weight: 700 });
  });

  const top = 24;
  const bottom = height - 40;
  const middle = (top + bottom) / 2;
  const attitude = { left: 66, right: width - 96 };
  const centre = (attitude.left + attitude.right) / 2;

  // The attitude: the horizon turned by the bank and moved by the pitch, six pixels a degree.
  const perDeg = 5;
  context.save();
  context.beginPath();
  context.roundRect(attitude.left, top, attitude.right - attitude.left, bottom - top, 8);
  context.clip();
  context.translate(centre, middle);
  context.rotate(-state.roll * RADIANS);
  const horizon = state.pitch * perDeg;
  context.fillStyle = SKY;
  context.fillRect(-400, -800 + horizon, 800, 800);
  context.fillStyle = EARTH;
  context.fillRect(-400, horizon, 800, 800);
  context.strokeStyle = INK;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(-400, horizon);
  context.lineTo(400, horizon);
  context.stroke();
  context.lineWidth = 1;
  for (let mark = -90; mark <= 90; mark += 2.5) {
    if (mark === 0) continue;
    const y = (state.pitch - mark) * perDeg;
    if (Math.abs(y) > 80) continue;
    const half = mark % 10 === 0 ? 26 : mark % 5 === 0 ? 14 : 6;
    context.beginPath();
    context.moveTo(-half, y);
    context.lineTo(half, y);
    context.stroke();
    if (mark % 10 === 0) {
      text(context, String(Math.abs(mark)), -half - 10, y, { size: 9 });
      text(context, String(Math.abs(mark)), half + 10, y, { size: 9 });
    }
  }
  // The sky pointer, turning with the horizon over the fixed bank scale.
  context.fillStyle = INK;
  context.beginPath();
  context.moveTo(0, -62);
  context.lineTo(-6, -52);
  context.lineTo(6, -52);
  context.closePath();
  context.fill();
  context.restore();

  // The bank scale: 10, 20, 30, 45 and 60 degrees each way.
  context.save();
  context.translate(centre, middle);
  context.strokeStyle = INK;
  context.lineWidth = 1.5;
  for (const bank of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const angle = (bank - 90) * RADIANS;
    const long = bank % 30 === 0 ? 10 : 6;
    context.beginPath();
    context.moveTo(Math.cos(angle) * 64, Math.sin(angle) * 64);
    context.lineTo(Math.cos(angle) * (64 + long), Math.sin(angle) * (64 + long));
    context.stroke();
  }
  // The aircraft, fixed: two wings and a dot.
  context.strokeStyle = "#ffd60a";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(-44, 0);
  context.lineTo(-16, 0);
  context.lineTo(-16, 6);
  context.moveTo(44, 0);
  context.lineTo(16, 0);
  context.lineTo(16, 6);
  context.stroke();
  context.fillStyle = "#ffd60a";
  context.fillRect(-2.5, -2.5, 5, 5);
  context.restore();

  // The ground ahead: the ground proximity warning, red across the horizon, as on an Airbus's display.
  if (flags.pullUp) {
    context.fillStyle = "#05070a";
    context.fillRect(centre - 34, middle + 26, 68, 18);
    text(context, "PULL UP", centre, middle + 35, { size: 13, colour: RED, weight: 800 });
  }

  // The height over the ground, once it matters.
  if (telemetry.radarAltitude !== null && telemetry.radarAltitude * FEET < 2500) {
    text(context, `RA ${Math.max(0, Math.round(telemetry.radarAltitude * FEET / 10) * 10)}`, centre, bottom - 12, {
      size: 12, colour: telemetry.radarAltitude * FEET < 1000 ? AMBER : INK, weight: 700,
    });
  }

  // The speed tape, in knots, and the Mach number under it.
  const knots = telemetry.ias * KNOTS;
  tape(context, { left: 4, right: 58, top, bottom }, knots, 2.4, 10, 20, (value) => String(value), "right");
  text(context, `M .${String(Math.round(telemetry.mach * 1000)).padStart(3, "0").slice(0, 3)}`, 31, bottom + 12, {
    size: 11, colour: telemetry.mach > 0.86 ? RED : INK,
  });

  // The altitude tape, in feet, the flight level over it.
  const feet = state.altitude * FEET;
  const tapeLeft = width - 90;
  tape(context, { left: tapeLeft, right: width - 34, top, bottom }, feet, 0.12, 100, 500, (value) => String(value / 100), "left");
  text(context, `FL${String(Math.round(feet / 100)).padStart(3, "0")}`, tapeLeft + 28, bottom + 12, { size: 11 });

  // The vertical speed: a needle from the middle, steep near zero and flatter out to 6,000 ft/min.
  const fpm = state.verticalSpeed * FEET * 60;
  const vsLeft = width - 28;
  context.fillStyle = "#11161d";
  context.fillRect(vsLeft, top, 24, bottom - top);
  const reach = (bottom - top) / 2 - 6;
  const offset = Math.sign(fpm) * Math.sqrt(Math.min(Math.abs(fpm), 6000) / 6000) * reach;
  context.strokeStyle = Math.abs(fpm) > 4000 ? AMBER : GREEN;
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(vsLeft + 22, middle);
  context.lineTo(vsLeft + 4, middle - offset);
  context.stroke();
  if (Math.abs(fpm) >= 200) {
    text(context, String(Math.round(Math.abs(fpm) / 100)), vsLeft + 12, fpm > 0 ? top + 8 : bottom - 8, { size: 10, colour: GREEN });
  }

  // The heading, on a strip under the attitude.
  const headingTop = bottom + 4;
  context.save();
  context.beginPath();
  context.rect(attitude.left, headingTop, attitude.right - attitude.left, 30);
  context.clip();
  context.fillStyle = "#11161d";
  context.fillRect(attitude.left, headingTop, attitude.right - attitude.left, 30);
  context.strokeStyle = INK;
  context.lineWidth = 1;
  const perHeading = 4;
  for (let mark = Math.floor(state.heading / 5) * 5 - 30; mark <= state.heading + 30; mark += 5) {
    const x = centre + wrap180(mark - state.heading) * perHeading;
    context.beginPath();
    context.moveTo(x, headingTop);
    context.lineTo(x, headingTop + (mark % 10 === 0 ? 8 : 4));
    context.stroke();
    if (mark % 10 === 0) text(context, String(wrap360(mark) / 10).padStart(2, "0"), x, headingTop + 17, { size: 10 });
  }
  context.restore();
  context.fillStyle = "#05070a";
  context.strokeStyle = INK;
  context.beginPath();
  context.roundRect(centre - 20, headingTop + 4, 40, 22, 3);
  context.fill();
  context.stroke();
  text(context, String(Math.round(state.heading) % 360).padStart(3, "0"), centre, headingTop + 15, { size: 13, weight: 700 });
}

/** A moving tape with the value boxed in its middle. */
function tape(
  context: CanvasRenderingContext2D, box: { left: number; right: number; top: number; bottom: number },
  value: number, perUnit: number, tick: number, label: number, format: (value: number) => string, side: "left" | "right",
): void {
  const { left, right, top, bottom } = box;
  const middle = (top + bottom) / 2;
  context.save();
  context.beginPath();
  context.rect(left, top, right - left, bottom - top);
  context.clip();
  context.fillStyle = "#11161d";
  context.fillRect(left, top, right - left, bottom - top);
  context.strokeStyle = INK;
  context.lineWidth = 1;
  const span = (bottom - top) / 2 / perUnit;
  for (let mark = Math.ceil((value - span) / tick) * tick; mark <= value + span; mark += tick) {
    if (mark < 0) continue;
    const y = middle - (mark - value) * perUnit;
    const edge = side === "right" ? right : left;
    const long = mark % label === 0 ? 8 : 4;
    context.beginPath();
    context.moveTo(edge, y);
    context.lineTo(side === "right" ? edge - long : edge + long, y);
    context.stroke();
    if (mark % label === 0) {
      text(context, format(mark), side === "right" ? right - 12 : left + 12, y, {
        size: 10, align: side === "right" ? "right" : "left", colour: DIM,
      });
    }
  }
  context.restore();
  context.fillStyle = "#05070a";
  context.strokeStyle = INK;
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(left, middle - 11, right - left, 22, 3);
  context.fill();
  context.stroke();
  text(context, String(Math.round(value)), (left + right) / 2, middle, { size: 13, weight: 700 });
}

/** The tile a storm stands in, across, km. */
export const tileKm = (tile: readonly number[] | null, lat: number) => (
  tile ? (40075 * Math.cos(lat * RADIANS)) / 2 ** tile[0] : 26
);

/**
 * The listed storms as a radar's picture paints them, the weakest first so
 * the strongest is painted last. The finer tiles where the list has them: a
 * coarse one is the same sky again as one square forty kilometres across,
 * at its strongest tile's peak.
 */
export function stormPicture(storms: Telemetry["storms"]): Telemetry["storms"] {
  const fine = storms.filter((storm) => !storm.coarse);
  return [...(fine.length ? fine : storms)].sort((one, other) => (one.peakDbz ?? 0) - (other.peakDbz ?? 0));
}

/** The ranges the rings stand at, NM; the outermost is the edge of the display. */
export const RINGS_NM = [20, 40, 80];

/** The navigation display: a heading-up arc with the weather radar's picture and the storm flown at. */
export function drawNd(context: CanvasRenderingContext2D, width: number, height: number, telemetry: Telemetry, clearSky: boolean): void {
  const { state } = telemetry;
  context.fillStyle = "#05070a";
  context.fillRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height - 22;
  const radius = Math.min(cy - 14, width / 2 / Math.sin(60 * RADIANS) - 4);
  const perNm = radius / RINGS_NM[RINGS_NM.length - 1];
  const place = (bearing: number, metres: number): [number, number] => {
    const off = wrap180(bearing - state.heading) * RADIANS;
    const r = (metres / NM) * perNm;
    return [cx + Math.sin(off) * r, cy - Math.cos(off) * r];
  };

  // The radar's picture, clipped to the arc it sweeps: 60 degrees each side.
  context.save();
  context.beginPath();
  context.moveTo(cx, cy);
  context.arc(cx, cy, radius, (-90 - 60) * RADIANS, (-90 + 60) * RADIANS);
  context.closePath();
  context.clip();
  for (const storm of stormPicture(telemetry.storms)) {
    const colour = radarColour(storm.peakDbz ?? 0);
    if (!colour) continue;
    const dLon = (storm.lon - state.lon) * Math.cos(state.lat * RADIANS) * 111_195;
    const dLat = (storm.lat - state.lat) * 111_195;
    const metres = Math.hypot(dLon, dLat);
    if (metres / NM > RINGS_NM[RINGS_NM.length - 1] * 1.2) continue;
    const [x, y] = place(Math.atan2(dLon, dLat) / RADIANS, metres);
    const side = (tileKm(storm.tile, storm.lat) * 1000 / NM) * perNm;
    context.save();
    context.translate(x, y);
    // Heading up: north turns with it.
    context.rotate(-state.heading * RADIANS);
    context.fillStyle = colour;
    // Tiles abut: a hair over their side, so no seam shows between them.
    const drawn = side * 1.03 + 0.5;
    context.fillRect(-drawn / 2, -drawn / 2, drawn, drawn);
    context.restore();
  }
  context.restore();

  // The range rings, dashed but the outermost.
  context.strokeStyle = DIM;
  context.lineWidth = 1;
  RINGS_NM.forEach((nm, i) => {
    context.setLineDash(i === RINGS_NM.length - 1 ? [] : [3, 4]);
    context.beginPath();
    context.arc(cx, cy, nm * perNm, (-90 - 60) * RADIANS, (-90 + 60) * RADIANS);
    context.stroke();
    const [x, y] = [cx + Math.sin(-55 * RADIANS) * nm * perNm, cy - Math.cos(-55 * RADIANS) * nm * perNm];
    text(context, String(nm), x - 4, y, { size: 9, colour: DIM, align: "right" });
  });
  context.setLineDash([]);

  // The compass along the outer arc.
  for (let mark = Math.ceil((state.heading - 60) / 10) * 10; mark <= state.heading + 60; mark += 10) {
    const off = wrap180(mark - state.heading) * RADIANS;
    const inner = mark % 30 === 0 ? radius - 9 : radius - 5;
    context.beginPath();
    context.moveTo(cx + Math.sin(off) * inner, cy - Math.cos(off) * inner);
    context.lineTo(cx + Math.sin(off) * radius, cy - Math.cos(off) * radius);
    context.strokeStyle = INK;
    context.stroke();
    if (mark % 30 === 0 && Math.abs(off) < 55 * RADIANS) {
      text(context, String(wrap360(mark) / 10).padStart(2, "0"), cx + Math.sin(off) * (radius - 18), cy - Math.cos(off) * (radius - 18), {
        size: 10,
      });
    }
  }
  // The lubber line, and the heading over it.
  context.strokeStyle = "#ffd60a";
  context.beginPath();
  context.moveTo(cx, cy - radius - 2);
  context.lineTo(cx, cy - radius + 12);
  context.stroke();
  text(context, `HDG ${String(Math.round(state.heading) % 360).padStart(3, "0")}`, cx, 9, { size: 11, weight: 700 });

  // The storm flown at: a diamond, at the edge where it is out of range, and how far and how long.
  const target = telemetry.target;
  if (target) {
    const metres = Math.min(target.distance, RINGS_NM[RINGS_NM.length - 1] * NM);
    const off = wrap180(target.bearing - state.heading);
    if (Math.abs(off) <= 60) {
      const [x, y] = place(target.bearing, metres);
      context.save();
      context.translate(x, y);
      context.rotate(Math.PI / 4);
      context.strokeStyle = MAGENTA;
      context.lineWidth = 2;
      context.strokeRect(-6, -6, 12, 12);
      context.restore();
    }
    const nm = target.distance / NM;
    const minutes = Math.floor(target.seconds / 60);
    const seconds = String(Math.floor(target.seconds % 60)).padStart(2, "0");
    text(context, `${nm.toFixed(nm < 10 ? 1 : 0)} NM`, 6, 9, { size: 11, colour: MAGENTA, align: "left", weight: 700 });
    text(context, `${minutes}:${seconds}`, 6, 23, { size: 10, colour: MAGENTA, align: "left" });
  }
  text(context, `GS ${Math.round(state.tas * Math.cos(state.flightPath * RADIANS) * KNOTS)}`, width - 6, 9, {
    size: 10, colour: INK, align: "right",
  });
  text(context, "WXR", width - 6, 23, { size: 10, colour: CYAN, align: "right" });
  if (clearSky) text(context, "NO WX", cx, cy - radius / 2, { size: 13, colour: CYAN, weight: 700 });

  // The aircraft, at the bottom.
  context.strokeStyle = "#ffd60a";
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(cx, cy - 10);
  context.lineTo(cx, cy + 8);
  context.moveTo(cx - 9, cy - 1);
  context.lineTo(cx + 9, cy - 1);
  context.moveTo(cx - 4, cy + 7);
  context.lineTo(cx + 4, cy + 7);
  context.stroke();
}
