/**
 * Drawing the two screens in the middle of the panel: the engine and
 * warning display above, the systems display's cruise page under it.
 *
 * As an Airbus draws them: green for what is normal, amber for a caution,
 * red for a warning, cyan for what is to be done, on black. The numbers and
 * words are the flight's own (lib/studio/flight/displays.ts); this only
 * puts them where the real displays have them.
 */
import { AMBER, CYAN, DIM, GREEN, INK, RED, text } from "./instruments";
import { EGT_RED, N1_MAX } from "../../../lib/studio/flight/displays";
import type { EcamColour, EcamLine } from "../../../lib/studio/flight/displays";

const RADIANS = Math.PI / 180;
const BLACK = "#05070a";
const MONO = "ui-monospace, Menlo, Consolas, monospace";

export const ECAM_COLOURS: Record<EcamColour | "magenta", string> = {
  red: RED, amber: AMBER, green: GREEN, cyan: CYAN, white: INK, magenta: "#ff4fd8",
};

/** One engine as the engine display shows it. */
export interface EngineReadout {
  n1: number;
  /** Where its thrust lever asks the N1 to go. */
  command: number;
  egt: number;
  fuelFlow: number;
}

/** A dial's arc: from 7 o'clock round to 1 o'clock, as an Airbus's N1 and EGT dials run. */
const ARC_FROM = 140;
const ARC_TO = 350;

function dial(
  context: CanvasRenderingContext2D, x: number, y: number, radius: number, fraction: number, colour: string,
  marker: number | null, redFrom: number | null,
): void {
  const angleOf = (f: number) => (ARC_FROM + (ARC_TO - ARC_FROM) * Math.min(Math.max(f, 0), 1.05)) * RADIANS;
  context.lineWidth = 2;
  context.strokeStyle = INK;
  context.beginPath();
  context.arc(x, y, radius, angleOf(0), angleOf(redFrom ?? 1));
  context.stroke();
  if (redFrom !== null) {
    context.strokeStyle = RED;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(x, y, radius, angleOf(redFrom), angleOf(1.05));
    context.stroke();
  }
  // The needle, from the middle to the arc.
  const angle = angleOf(fraction);
  context.strokeStyle = colour;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x + Math.cos(angle) * radius * 0.15, y + Math.sin(angle) * radius * 0.15);
  context.lineTo(x + Math.cos(angle) * (radius + 2), y + Math.sin(angle) * (radius + 2));
  context.stroke();
  // Where the lever asks for: a small cyan circle on the arc.
  if (marker !== null) {
    const at = angleOf(marker);
    context.strokeStyle = CYAN;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(x + Math.cos(at) * (radius + 5), y + Math.sin(at) * (radius + 5), 3, 0, Math.PI * 2);
    context.stroke();
  }
}

/** A number in a box under a dial. */
function readout(context: CanvasRenderingContext2D, value: string, x: number, y: number, colour: string, size = 15): void {
  context.strokeStyle = DIM;
  context.lineWidth = 1;
  context.strokeRect(x - 27, y - 10, 54, 20);
  context.font = `700 ${size}px ${MONO}`;
  context.fillStyle = colour;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(value, x, y + 1);
}

function lines(context: CanvasRenderingContext2D, items: EcamLine[], x: number, y: number, step: number, rows: number): void {
  items.slice(0, rows).forEach((line, i) => {
    context.font = `700 13px ${MONO}`;
    context.fillStyle = ECAM_COLOURS[line.colour];
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(line.text, x, y + i * step);
    // A warning's title is underlined, as the display does.
    if (line.colour === "red" || line.colour === "amber") {
      const width = context.measureText(line.text).width;
      context.fillRect(x, y + i * step + 8, width, 1.2);
    }
  });
}

/** The engine and warning display: N1, EGT and fuel flow of both engines, and the warnings and memos under them. */
export function drawUpperEcam(
  context: CanvasRenderingContext2D, width: number, height: number,
  engines: [EngineReadout, EngineReadout], warnings: EcamLine[], memo: EcamLine[], flashing: boolean,
): void {
  context.fillStyle = BLACK;
  context.fillRect(0, 0, width, height);
  const split = height * 0.62;
  const columns = [width * 0.25, width * 0.75];
  engines.forEach((engine, i) => {
    const x = columns[i];
    dial(context, x, 44, 30, engine.n1 / N1_MAX, GREEN, engine.command / N1_MAX, null);
    readout(context, engine.n1.toFixed(1), x + 8, 68, GREEN);
    dial(context, x, 112, 20, engine.egt / 1000, GREEN, null, EGT_RED / 1000);
    readout(context, String(Math.round(engine.egt)), x + 6, 128, GREEN, 13);
    context.font = `700 14px ${MONO}`;
    context.fillStyle = GREEN;
    context.textAlign = "center";
    context.fillText(String(Math.round(engine.fuelFlow / 20) * 20), x, 156);
  });
  // The labels between the engines.
  for (const [label, unit, y] of [["N1", "%", 54], ["EGT", "°C", 116], ["F.F", "KG/H", 156]] as const) {
    text(context, label, width / 2, y - 6, { size: 11, colour: INK, weight: 700 });
    text(context, unit, width / 2, y + 7, { size: 10, colour: CYAN, weight: 600 });
  }
  text(context, "ENG 1", width * 0.06, 12, { size: 10, colour: DIM, align: "left" });
  text(context, "ENG 2", width * 0.94, 12, { size: 10, colour: DIM, align: "right" });

  // The lower part: warnings left, memos right, under a line.
  context.strokeStyle = INK;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(6, split - 6);
  context.lineTo(width - 6, split - 6);
  context.moveTo(width * 0.6, split + 2);
  context.lineTo(width * 0.6, height - 8);
  context.stroke();
  // A warning flashes its title with the master warning light.
  const shown = warnings.map((line, i) => (i === 0 && line.colour === "red" && !flashing ? { ...line, text: "" } : line));
  lines(context, shown, 8, split + 10, 17, 5);
  lines(context, memo, width * 0.6 + 8, split + 10, 17, 5);
}

/** The systems display's cruise page: fuel used, the cabin's pressure, and the air outside, the time and the weight along the bottom. */
export function drawLowerEcam(
  context: CanvasRenderingContext2D, width: number, height: number,
  page: {
    fuelUsed: [number, number]; cabinAltitude: number; cabinVerticalSpeed: number; deltaP: number;
    tat: number; sat: number; utc: string; grossWeight: number;
  },
): void {
  context.fillStyle = BLACK;
  context.fillRect(0, 0, width, height);
  const title = (value: string, x: number, y: number) => {
    text(context, value, x, y, { size: 15, colour: INK, weight: 800, align: "left" });
    context.font = `800 15px ${MONO}`;
    context.fillStyle = INK;
    context.fillRect(x, y + 9, context.measureText(value).width * 1.05, 1.5);
  };
  const value = (v: string, x: number, y: number, colour = GREEN, align: CanvasTextAlign = "right") => {
    context.font = `700 15px ${MONO}`;
    context.fillStyle = colour;
    context.textAlign = align;
    context.textBaseline = "middle";
    context.fillText(v, x, y);
  };
  title("CRUISE", width / 2 - 34, 14);

  text(context, "ENG", 10, 42, { size: 12, colour: INK, weight: 700, align: "left" });
  text(context, "F.USED", width / 2, 50, { size: 11, colour: INK, weight: 700 });
  text(context, "KG", width / 2, 64, { size: 10, colour: CYAN });
  value(String(Math.round(page.fuelUsed[0] / 10) * 10), width / 2 - 38, 58);
  value(String(Math.round(page.fuelUsed[1] / 10) * 10), width / 2 + 82, 58);

  text(context, "AIR", 10, 92, { size: 12, colour: INK, weight: 700, align: "left" });
  text(context, "ΔP", 40, 112, { size: 11, colour: INK, weight: 700, align: "left" });
  value(page.deltaP.toFixed(1), 104, 112);
  text(context, "PSI", 108, 112, { size: 10, colour: CYAN, align: "left" });
  text(context, "CAB V/S", width - 128, 104, { size: 11, colour: INK, weight: 700, align: "left" });
  value(String(Math.round(page.cabinVerticalSpeed / 50) * 50), width - 48, 120);
  text(context, "FT/MIN", width - 44, 120, { size: 9, colour: CYAN, align: "left" });
  text(context, "CAB ALT", width - 128, 142, { size: 11, colour: INK, weight: 700, align: "left" });
  value(String(Math.round(page.cabinAltitude / 50) * 50), width - 48, 158);
  text(context, "FT", width - 44, 158, { size: 9, colour: CYAN, align: "left" });

  // The permanent data along the bottom.
  const bottom = height - 44;
  context.strokeStyle = INK;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(4, bottom);
  context.lineTo(width - 4, bottom);
  context.moveTo(width * 0.36, bottom);
  context.lineTo(width * 0.36, height - 4);
  context.moveTo(width * 0.62, bottom);
  context.lineTo(width * 0.62, height - 4);
  context.stroke();
  const signed = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v)}`;
  text(context, "TAT", 8, bottom + 13, { size: 11, colour: INK, weight: 700, align: "left" });
  value(signed(page.tat), 74, bottom + 13);
  text(context, "°C", 78, bottom + 13, { size: 10, colour: CYAN, align: "left" });
  text(context, "SAT", 8, bottom + 32, { size: 11, colour: INK, weight: 700, align: "left" });
  value(signed(page.sat), 74, bottom + 32);
  text(context, "°C", 78, bottom + 32, { size: 10, colour: CYAN, align: "left" });
  value(page.utc.slice(0, 2), width * 0.49 - 6, bottom + 22);
  text(context, "H", width * 0.49, bottom + 22, { size: 11, colour: CYAN });
  value(page.utc.slice(2, 4), width * 0.49 + 6, bottom + 22, GREEN, "left");
  text(context, "GW", width * 0.62 + 8, bottom + 22, { size: 11, colour: INK, weight: 700, align: "left" });
  value(String(Math.round(page.grossWeight / 100) * 100), width - 26, bottom + 22);
  text(context, "KG", width - 22, bottom + 22, { size: 10, colour: CYAN, align: "left" });
}
