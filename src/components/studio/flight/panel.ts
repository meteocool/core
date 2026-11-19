/**
 * Drawing the flight deck's smaller screens: the autopilot's window on the
 * glareshield and the altimeter settings beside it, the standby instrument,
 * the flight management keyboards' pages on the pedestal; and the lit bar
 * an engaged button on the glareshield shows.
 *
 * Each is small on the model: few things, big, so they read from the seat.
 */
import { EARTH, GREEN, INK, SKY, text } from "./instruments";
import { ECAM_COLOURS } from "./ecam";
import type { FcuWindows, McduPage } from "../../../lib/studio/flight/displays";
import type { Telemetry } from "../../../lib/studio/flight/pilot";

const KNOTS = 1.943844;
const FEET = 3.28084;
const RADIANS = Math.PI / 180;
const BLACK = "#05070a";
const MONO = "ui-monospace, Menlo, Consolas, monospace";
/** The autopilot window's digits: a warm white, as its lit liquid crystal is. */
const LCD = "#ffd9a0";

/**
 * Where each window's numbers stand along the autopilot's strip, 0 to 1:
 * over the knob that sets them on the model's panel.
 */
const FCU_AT = { speed: 0.1, heading: 0.29, altitude: 0.69, verticalSpeed: 0.91 };

/** The autopilot's window: speed or Mach, heading, altitude, vertical speed, each over its knob. */
export function drawFcu(context: CanvasRenderingContext2D, width: number, height: number, windows: FcuWindows): void {
  context.fillStyle = BLACK;
  context.fillRect(0, 0, width, height);
  const digits = (value: string, at: number, label: string) => {
    const x = at * width;
    context.font = `700 ${Math.round(height * 0.72)}px ${MONO}`;
    context.fillStyle = LCD;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(value, x, height * 0.56);
    const left = x - context.measureText(value).width / 2;
    text(context, label, left - 4, height * 0.3, { size: Math.round(height * 0.3), colour: LCD, align: "right", weight: 700 });
  };
  digits(windows.speed, FCU_AT.speed, windows.mach ? "MACH" : "SPD");
  digits(windows.heading, FCU_AT.heading, "HDG");
  digits(windows.altitude, FCU_AT.altitude, "ALT");
  digits(windows.verticalSpeed, FCU_AT.verticalSpeed, "V/S");
}

/** An altimeter setting's window: "Std" or a pressure. */
export function drawBaro(context: CanvasRenderingContext2D, width: number, height: number, setting: string): void {
  context.fillStyle = BLACK;
  context.fillRect(0, 0, width, height);
  context.font = `700 ${Math.round(height * 0.7)}px ${MONO}`;
  context.fillStyle = LCD;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(setting, width / 2, height * 0.55);
}

/** The standby instrument: the attitude, and the speed and the altitude either side of it, in one small square. */
export function drawIsis(context: CanvasRenderingContext2D, size: number, telemetry: Telemetry): void {
  const { state } = telemetry;
  context.fillStyle = BLACK;
  context.fillRect(0, 0, size, size);
  const centre = size / 2;
  const perDeg = size / 50;
  context.save();
  context.beginPath();
  context.rect(0, 0, size, size);
  context.clip();
  context.translate(centre, centre);
  context.rotate(-state.roll * RADIANS);
  const horizon = state.pitch * perDeg;
  context.fillStyle = SKY;
  context.fillRect(-size, -2 * size + horizon, 2 * size, 2 * size);
  context.fillStyle = EARTH;
  context.fillRect(-size, horizon, 2 * size, 2 * size);
  context.strokeStyle = INK;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(-size, horizon);
  context.lineTo(size, horizon);
  for (const mark of [-20, -10, 10, 20]) {
    const y = (state.pitch - mark) * perDeg;
    context.moveTo(-size * 0.1, y);
    context.lineTo(size * 0.1, y);
  }
  context.stroke();
  context.restore();
  // The aircraft, fixed.
  context.strokeStyle = "#ffd60a";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(centre - size * 0.2, centre);
  context.lineTo(centre - size * 0.07, centre);
  context.moveTo(centre + size * 0.07, centre);
  context.lineTo(centre + size * 0.2, centre);
  context.stroke();
  // The speed down the left, the altitude down the right, each in a box.
  const box = (value: string, x: number, w: number) => {
    context.fillStyle = BLACK;
    context.fillRect(x, centre - size * 0.08, w, size * 0.16);
    context.strokeStyle = INK;
    context.lineWidth = 1;
    context.strokeRect(x, centre - size * 0.08, w, size * 0.16);
    context.font = `700 ${Math.round(size * 0.12)}px ${MONO}`;
    context.fillStyle = INK;
    context.textAlign = "center";
    context.textBaseline = "middle";
    // Narrowed to its box where a number is long.
    context.fillText(value, x + w / 2, centre + 1, w - 4);
  };
  box(String(Math.round(telemetry.ias * KNOTS)), 2, size * 0.24);
  box(String(Math.round((state.altitude * FEET) / 10) * 10), size * 0.6, size * 0.39);
}

/**
 * A flight management keyboard's page: its title, then label and line by
 * pairs, each split left and right, as the real one sets out its fourteen
 * lines of twenty-four characters; here fewer and bigger.
 */
export function drawMcdu(context: CanvasRenderingContext2D, width: number, height: number, page: McduPage): void {
  context.fillStyle = BLACK;
  context.fillRect(0, 0, width, height);
  const big = Math.round(height * 0.085);
  const small = Math.round(height * 0.06);
  const font = (px: number) => `700 ${px}px ${MONO}`;
  const put = (value: string, y: number, px: number, colour: string, side: "left" | "right" | "center") => {
    context.font = font(px);
    context.fillStyle = colour;
    context.textBaseline = "middle";
    context.textAlign = side;
    context.fillText(value, side === "left" ? 8 : side === "right" ? width - 8 : width / 2, y);
  };
  put(page.title, height * 0.08, big, INK, "center");
  const step = (height * 0.86) / Math.max(page.rows.length, 4);
  page.rows.forEach((row, i) => {
    const y = height * 0.2 + i * step;
    put(row.label[0], y, small, INK, "left");
    put(row.label[1], y, small, INK, "right");
    put(row.line[0], y + small * 1.25, big, ECAM_COLOURS[row.colour[0]], "left");
    put(row.line[1], y + small * 1.25, big, ECAM_COLOURS[row.colour[1]], "right");
  });
}

/** The lit bar of an engaged button: three short green dashes, as on the glareshield's buttons. */
export function drawBar(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  context.clearRect(x, y, width, height);
  context.fillStyle = GREEN;
  context.shadowColor = GREEN;
  context.shadowBlur = height * 0.4;
  const dash = width / 3.6;
  for (let i = 0; i < 3; i += 1) {
    context.fillRect(x + width * 0.06 + i * (dash + width * 0.07), y + height * 0.3, dash, height * 0.4);
  }
  context.shadowBlur = 0;
}
