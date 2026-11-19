/**
 * The flight deck's live screens and lights, as the cockpit's model shows
 * them (layers/aircraftRenderer.ts): each a canvas, stretched over its place
 * on the model (lib/studio/flight/cockpit.ts), and redrawn from the
 * telemetry as often as it changes.
 *
 * Only the primary flight display, the navigation display and the standby
 * instrument move with every frame; a page of numbers is redrawn a few
 * times a second, and the windows of the glareshield only when their text
 * changes. A canvas not redrawn is not sent to the GPU again either (its
 * `version` stays). The lights are parts of one small picture, taken once
 * from the model's own picture of them lit, and are shown or not.
 */
import { drawNd, drawPfd } from "./instruments";
import { drawLowerEcam, drawUpperEcam } from "./ecam";
import type { EngineReadout } from "./ecam";
import { drawBar, drawBaro, drawFcu, drawIsis, drawMcdu } from "./panel";
import { AIRCRAFT_FILES, COCKPIT_LIGHTS, COCKPIT_SCREENS, LIGHTS_TEXTURE } from "../../../lib/studio/flight/cockpit";
import type { CockpitLight, CockpitLightName, CockpitScreen, TexturePart } from "../../../lib/studio/flight/cockpit";
import {
  airTemperatures, baroOf, cabinOf, ecamOf, egtOf, fcuOf, flashOn, flightPlanPage, fuelFlowOf, gearLights, n1Of, progressPage, utc,
} from "../../../lib/studio/flight/displays";
import type { Telemetry } from "../../../lib/studio/flight/pilot";
import type { FlightStatus } from "../../../lib/studio/store";
import type { AircraftScreen } from "../../../layers/aircraftLayer";

/** The aircraft's weight, kg: the physics' own, which flies it at one weight throughout. */
const GROSS_WEIGHT_KG = 65_000;

/** How long the autopilot's loss is called out on the engine display, s. */
const AP_OFF_S = 3;

/** A canvas of the cockpit's: its size in pixels, how often it is redrawn (s, 0 for every frame), and when it last was. */
interface Sheet {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D | null;
  width: number;
  height: number;
  every: number;
  drawnAt: number;
  /** What was last drawn, where a sheet is redrawn only when that changes. */
  key: string;
  version: number;
}

function sheet(width: number, height: number, every: number): Sheet {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext("2d"), width, height, every, drawnAt: -Infinity, key: "", version: 0 };
}

type UvRect = [number, number, number, number];

type SheetName = "pfd" | "nd" | "upper" | "lower" | "isis" | "fcu" | "baro" | "mcduCaptain" | "mcduFo";

/** What the screens take of the flight besides the telemetry. */
export interface CockpitInputs {
  status: FlightStatus;
  /** The radar scan on the map, ms since 1970; null before one is. */
  scan: number | null;
}

/** The lights' picture: the rows of buttons unlit and lit in the model's texture, and a lit bar under them. */
const ROWS = { top: 0, height: 256, width: 832 };
const BAR = { top: 256, height: 16, width: 64 };

export class CockpitScreens {
  /** What the map draws: every screen and light, the same objects throughout, changed in place. */
  readonly screens: AircraftScreen[] = [];
  private readonly sheets: Record<SheetName, Sheet> = {
    // The two that every flight had already, at their size.
    pfd: sheet(320, 320, 0),
    nd: sheet(320, 320, 0),
    upper: sheet(320, 286, 0.1),
    lower: sheet(320, 286, 0.5),
    isis: sheet(160, 160, 1 / 30),
    fcu: sheet(860, 60, 0.2),
    baro: sheet(132, 60, 1),
    mcduCaptain: sheet(288, 272, 0.5),
    mcduFo: sheet(288, 272, 0.5),
  };
  private readonly atlas = sheet(ROWS.width, ROWS.height + BAR.height, Infinity);
  /** Each light's screens, and the parts of the lights' picture it shows lit and unlit (null: not drawn). */
  private readonly lights = new Map<CockpitLightName, { screens: AircraftScreen[]; lit: UvRect | null; unlit: UvRect | null }>();
  /** Each screen and light with the sheet it shows, whose version it takes. */
  private readonly bound: Array<[AircraftScreen, Sheet]> = [];
  /** The altitude the autopilot holds, caught as it is engaged, as the pilot takes it; null with it off. */
  private held: number | null = null;
  private autopilot = false;
  private autopilotLostAt = -Infinity;
  private fuelUsed = 0;
  private lastTime: number | null = null;
  private image: HTMLImageElement | null = null;
  private readonly reducedMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor() {
    const placed: Array<[CockpitScreen, SheetName]> = [
      ["pfd", "pfd"], ["nd", "nd"], ["foPfd", "pfd"], ["foNd", "nd"], ["upperEcam", "upper"], ["lowerEcam", "lower"],
      ["isis", "isis"], ["fcu", "fcu"], ["baroCaptain", "baro"], ["baroFo", "baro"], ["mcduCaptain", "mcduCaptain"], ["mcduFo", "mcduFo"],
    ];
    for (const [where, name] of placed) {
      const screen: AircraftScreen = { source: this.sheets[name].canvas, corners: COCKPIT_SCREENS[where], version: 0 };
      this.screens.push(screen);
      this.bound.push([screen, this.sheets[name]]);
    }
    const part = (rect: TexturePart | null): UvRect | null => rect && [
      rect[0] / this.atlas.width, (rect[1] - ROWS.top) / this.atlas.height, rect[2] / this.atlas.width, (rect[3] - ROWS.top) / this.atlas.height,
    ];
    const bar: UvRect = [0, BAR.top / this.atlas.height, BAR.width / this.atlas.width, (BAR.top + BAR.height) / this.atlas.height];
    for (const [name, lights] of Object.entries(COCKPIT_LIGHTS) as Array<[CockpitLightName, CockpitLight[]]>) {
      const lit = part(lights[0].lit) ?? bar;
      const unlit = part(lights[0].unlit);
      const screens: AircraftScreen[] = lights.map(({ corners }) => ({ source: this.atlas.canvas, corners, uv: unlit ?? lit, version: 0, hidden: true }));
      this.lights.set(name, { screens, lit, unlit });
      this.screens.push(...screens);
      for (const screen of screens) this.bound.push([screen, this.atlas]);
    }
    this.loadLights();
  }

  /** The lights' picture: the model's own lit buttons, and a bar drawn under them. */
  private loadLights(): void {
    if (typeof Image === "undefined") return;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const { context } = this.atlas;
      if (!context || this.image !== image) return;
      context.drawImage(image, 0, ROWS.top, ROWS.width, ROWS.height, 0, 0, ROWS.width, ROWS.height);
      drawBar(context, 0, BAR.top, BAR.width, BAR.height);
      this.atlas.version += 1;
    };
    this.image = image;
    image.src = `${AIRCRAFT_FILES}${LIGHTS_TEXTURE}`;
  }

  /** Let go of the lights' picture as it loads, if the flight is over first. */
  dispose(): void {
    if (this.image) this.image.onload = null;
    this.image = null;
  }

  /** Draw what is due this frame, from the telemetry. */
  draw(telemetry: Telemetry, inputs: CockpitInputs): void {
    const { state } = telemetry;
    const { status } = inputs;
    const now = Date.now();
    const dt = this.lastTime === null ? 0 : Math.max(0, telemetry.time - this.lastTime);
    this.lastTime = telemetry.time;
    const flow = fuelFlowOf(state.spool, state.altitude);
    this.fuelUsed += (flow * dt) / 3600;

    // The autopilot as the pilot has it: the altitude it holds, and its loss, unless to a cut back to the start.
    if (status.autopilot && !this.autopilot) this.held = state.altitude;
    if (!status.autopilot && this.autopilot) {
      this.held = null;
      if (telemetry.fade === 0) this.autopilotLostAt = telemetry.time;
    }
    this.autopilot = status.autopilot;

    const gear = (telemetry as { gear?: number }).gear ?? 0;
    const ecam = ecamOf({
      warnings: status.warnings, brake: telemetry.brake, throttle: state.throttle, turbulence: telemetry.turbulence,
      altitude: state.altitude, radarAltitude: telemetry.radarAltitude, gear,
      autopilotLost: telemetry.time - this.autopilotLostAt < AP_OFF_S,
      flaps: status.flaps, groundSpoilers: status.spoilers === "ground", reverse: status.reverse, alphaFloor: status.alphaFloor,
    });
    // With reduced motion, a flashing light is lit steadily.
    const flashing = this.reducedMotion || flashOn(telemetry.time);

    this.redraw("pfd", telemetry.time, (context, { width, height }) => drawPfd(context, width, height, telemetry, {
      autopilot: status.autopilot, warp: status.warp, recording: status.recording, brake: telemetry.brake,
      pullUp: status.warnings.includes("terrain"),
    }));
    this.redraw("nd", telemetry.time, (context, { width, height }) => drawNd(context, width, height, telemetry, status.clearSky));
    this.redraw("isis", telemetry.time, (context, { width }) => drawIsis(context, width, telemetry));

    const engine: EngineReadout = {
      n1: n1Of(state.spool), command: n1Of(state.throttle), egt: egtOf(n1Of(state.spool)), fuelFlow: flow,
    };
    // A warning's appearing, or its flash, is drawn at once, not at the page's next turn.
    const upperKey = `${ecam.warnings.map((line) => line.text).join()}|${ecam.memo.map((line) => line.text + line.colour).join()}|${flashing}`;
    this.redraw("upper", telemetry.time, (context, { width, height }) => (
      drawUpperEcam(context, width, height, [engine, engine], ecam.warnings, ecam.memo, flashing)), { key: upperKey, urgent: true });

    const { sat, tat } = airTemperatures(state.altitude, telemetry.mach);
    const cabin = cabinOf(state.altitude, state.verticalSpeed);
    this.redraw("lower", telemetry.time, (context, { width, height }) => drawLowerEcam(context, width, height, {
      fuelUsed: [this.fuelUsed / 2, this.fuelUsed / 2], cabinAltitude: cabin.altitude, cabinVerticalSpeed: cabin.verticalSpeed,
      deltaP: cabin.deltaP, sat, tat, utc: utc(now), grossWeight: GROSS_WEIGHT_KG,
    }));

    const windows = fcuOf({
      ias: telemetry.ias, mach: telemetry.mach, heading: state.heading, altitude: state.altitude,
      verticalSpeed: state.verticalSpeed, held: this.held,
    });
    this.redraw("fcu", telemetry.time, (context, { width, height }) => drawFcu(context, width, height, windows), { key: JSON.stringify(windows) });
    const baro = baroOf(state.altitude);
    this.redraw("baro", telemetry.time, (context, { width, height }) => drawBaro(context, width, height, baro), { key: baro });

    const groundSpeed = state.tas * Math.cos((state.flightPath * Math.PI) / 180);
    const plan = flightPlanPage({ altitude: state.altitude, ias: telemetry.ias, target: telemetry.target, now, scan: inputs.scan });
    this.redraw("mcduCaptain", telemetry.time, (context, { width, height }) => drawMcdu(context, width, height, plan), { key: JSON.stringify(plan) });
    const progress = progressPage({ altitude: state.altitude, tas: state.tas, groundSpeed, mach: telemetry.mach, fuelUsed: this.fuelUsed });
    this.redraw("mcduFo", telemetry.time, (context, { width, height }) => drawMcdu(context, width, height, progress), { key: JSON.stringify(progress) });

    // The lights: shown or not, nothing redrawn.
    const loaded = this.atlas.version > 0;
    const { unlocked, down } = gearLights(gear);
    this.light("masterWarning", ecam.masterWarning && flashing, loaded);
    this.light("masterCaution", ecam.masterCaution, loaded);
    this.light("pullUp", status.warnings.includes("terrain"), loaded);
    this.light("gearUnlocked", unlocked, loaded);
    this.light("gearDown", down, loaded);
    this.light("autopilot", status.autopilot, loaded);
    // No autothrust: the thrust is the reader's own, autopilot or not.
    this.light("autothrust", false, loaded);
    // The flight directors are on throughout, as they are in flight.
    this.light("flightDirector", true, loaded);
    this.light("terrainOnNd", status.warnings.includes("terrain"), loaded);
    for (const dark of ["gpwsFault", "autoLand", "autoBrake", "brakeFanHot", "engineFire", "atcMessage"] as const) this.light(dark, false, loaded);
    for (const [screen, drawn] of this.bound) screen.version = drawn.version;
  }

  /** A light on or off: its lit picture, or its unlit one over the model's own; one drawn here is not drawn when off. */
  private light(name: CockpitLightName, on: boolean, loaded: boolean): void {
    const light = this.lights.get(name);
    if (!light) return;
    const uv = on ? light.lit : light.unlit;
    for (const screen of light.screens) {
      screen.hidden = !loaded || uv === null;
      if (uv) screen.uv = uv;
    }
  }

  /**
   * Redraw a sheet when it is due, every `every` seconds of its own. With a
   * `key`, what the sheet shows in short: redrawn at once when that changes
   * (`urgent`), or at its turn and then only if it changed.
   */
  private redraw(
    name: SheetName, time: number, paint: (context: CanvasRenderingContext2D, size: { width: number; height: number }) => void,
    { key, urgent = false }: { key?: string; urgent?: boolean } = {},
  ): void {
    const sheet = this.sheets[name];
    // A cut back to the start sets the flight's clock back too.
    const due = time - sheet.drawnAt >= sheet.every || time < sheet.drawnAt;
    const changed = key !== undefined && key !== sheet.key;
    const wanted = key === undefined ? due : urgent ? due || changed : due && changed;
    if (!wanted || !sheet.context) return;
    sheet.drawnAt = time;
    if (key !== undefined) sheet.key = key;
    paint(sheet.context, sheet);
    sheet.version += 1;
  }
}
