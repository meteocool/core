/**
 * Where things are in the aircraft's model (public/models/a320), in its own
 * frame: metres forward of its middle, right of its centreline, and down.
 * Measured on the model; they move only if the model is exchanged.
 */
import type { FlightAction } from "./controls";
import type { Vec3 } from "./view";

/** Where the model and its textures are served from (assets.ts, which the flight's loading reads without the rest of this). */
export { AIRCRAFT_FILES } from "./assets";

/** Where each engine's exhaust leaves it: where a condensation trail begins. */
export const EXHAUSTS: Vec3[] = [[-1.2, -5.75, 1.9], [-1.2, 5.75, 1.9]];

/** Towards the storm layer's sun in the world: north, east, down. What lights the storms lights the aircraft. */
export const SUN: Vec3 = [-0.25 / 1.0025, -0.8 / 1.0025, -0.55 / 1.0025];

/** The captain's eye: the left seat, at the height the windshield is looked through from. */
export const SEAT: Vec3 = [14.62, -0.54, -0.74];

/** How far under the middle the aircraft is placed by its wheels reach, down and locked, metres. */
export const WHEELS_BELOW_M = 4.1;

/** A flat four-cornered place on the model: top left, top right, bottom right, bottom left, as a picture on it is seen. */
export type Quad = [Vec3, Vec3, Vec3, Vec3];

const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * A quad moved off its face by `metres`, towards whoever looks at its
 * picture: a sheet in front of a button, which the button's own picture
 * would otherwise show through.
 */
export function lifted(quad: Quad, metres: number): Quad {
  const across = minus(quad[1], quad[0]);
  const down = minus(quad[3], quad[0]);
  const normal: Vec3 = [
    down[1] * across[2] - down[2] * across[1],
    down[2] * across[0] - down[0] * across[2],
    down[0] * across[1] - down[1] * across[0],
  ];
  const length = Math.hypot(...normal) || 1;
  const by = normal.map((value) => (value / length) * metres) as Vec3;
  return quad.map((corner) => [corner[0] + by[0], corner[1] + by[1], corner[2] + by[2]]) as Quad;
}

/** Part of a quad: from `left` to `right` across and `top` to `bottom` down it, 0 to 1 each. */
export function partOf(quad: Quad, left: number, top: number, right: number, bottom: number): Quad {
  const at = (u: number, v: number): Vec3 => {
    const upper = quad[0].map((value, i) => value + (quad[1][i] - value) * u);
    const lower = quad[3].map((value, i) => value + (quad[2][i] - value) * u);
    return upper.map((value, i) => value + (lower[i] - value) * v) as Vec3;
  };
  return [at(left, top), at(right, top), at(right, bottom), at(left, bottom)];
}

/** The same place on the first officer's side: the flight deck is a mirror of itself across the centreline. */
export function mirrored(quad: Quad): Quad {
  const [a, b, c, d] = quad.map(([forward, right, down]) => [forward, -right, down] as Vec3);
  // Mirrored, the left corners come out on the right: swapped back, the picture reads the right way round.
  return [b, a, d, c];
}

/** The sheets of the windows and lights stand this far in front of the paint they cover, m. */
const OVER_PANEL = 0.0012;

const PFD: Quad = [[15.629, -0.655, -0.394], [15.629, -0.459, -0.394], [15.579, -0.459, -0.213], [15.579, -0.655, -0.213]];
const ND: Quad = [[15.629, -0.426, -0.394], [15.629, -0.232, -0.394], [15.579, -0.232, -0.213], [15.579, -0.426, -0.213]];

/**
 * The live screens, each as the four corners its picture is stretched
 * over: the display units of the main panel (a few millimetres in front of
 * the model's own glass, which is a still picture) and the windows and
 * keyboards' screens painted on the glareshield and the pedestal (just off
 * their paint). Measured on the model's texture: each is where the model
 * draws that screen's dark glass.
 */
export const COCKPIT_SCREENS = {
  pfd: PFD,
  nd: ND,
  /** The first officer's two, the same pictures as the captain's, the other way round: the navigation display inboard. */
  foPfd: mirrored(PFD),
  foNd: mirrored(ND),
  /** The engine and warning display, and the systems display under it, in the middle of the panel. */
  // Their glass is set a hand's breadth into the panel; these stand just behind the bezel's opening instead, square with it.
  upperEcam: [[15.5375, -0.079, -0.4315], [15.5375, 0.103, -0.4315], [15.4893, 0.103, -0.2685], [15.4893, -0.079, -0.2685]] as Quad,
  lowerEcam: [[15.4854, -0.079, -0.2553], [15.4854, 0.103, -0.2553], [15.4379, 0.103, -0.0942], [15.4379, -0.079, -0.0942]] as Quad,
  /** The standby instrument, between the captain's navigation display and the engine display. */
  isis: lifted([[15.513, -0.1744, -0.3609], [15.513, -0.0997, -0.3609], [15.4924, -0.0997, -0.2891], [15.4924, -0.1744, -0.2891]], OVER_PANEL),
  /** The autopilot's one long window on the glareshield: speed, heading, altitude, vertical speed. */
  fcu: lifted([[15.3356, -0.1081, -0.6332], [15.3356, 0.1072, -0.6332], [15.3312, 0.1072, -0.6189], [15.3312, -0.1081, -0.6189]], OVER_PANEL),
  /** The altimeter setting's windows either side of it. */
  baroCaptain: lifted([[15.3323, -0.2677, -0.6227], [15.3323, -0.2348, -0.6227], [15.3276, -0.2348, -0.6074], [15.3276, -0.2677, -0.6074]], OVER_PANEL),
  baroFo: lifted([[15.3323, 0.2349, -0.6227], [15.3323, 0.2668, -0.6227], [15.3279, 0.2668, -0.6084], [15.3279, 0.2349, -0.6084]], OVER_PANEL),
  /** The flight management keyboards on the pedestal, their tops forward. */
  mcduCaptain: lifted([[15.4118, -0.2337, -0.0669], [15.4124, -0.1331, -0.0671], [15.319, -0.1332, -0.0516], [15.3184, -0.2337, -0.0514]], OVER_PANEL),
  mcduFo: lifted([[15.4118, 0.1318, -0.0669], [15.4124, 0.2334, -0.0671], [15.319, 0.2334, -0.0516], [15.3184, 0.1319, -0.0514]], OVER_PANEL),
} satisfies Record<string, Quad>;

export type CockpitScreen = keyof typeof COCKPIT_SCREENS;

/** The model's own picture of its lights, lit and unlit: each light's look is taken from it. */
export const LIGHTS_TEXTURE = "m1mat_001.webp";

/** A part of `LIGHTS_TEXTURE`, in its pixels: left, top, right, bottom. */
export type TexturePart = [number, number, number, number];

/**
 * A light: where it is, and its picture lit and unlit. The model has each
 * of these buttons twice, lit and unlit a fraction of a millimetre apart,
 * and which shows is down to the depth buffer: covered by one or the other
 * picture, a light is the way the flight has it. Null for a light drawn
 * here, which is not drawn at all when off.
 */
export interface CockpitLight {
  corners: Quad;
  lit: TexturePart | null;
  unlit: TexturePart | null;
}

/**
 * A button's cell in the lights' texture, from `left` to `right` across,
 * and from `top` to `bottom` of it down (0 to 1): unlit in one row, lit in
 * the row under it, 64 pixels down.
 */
function cell(left: number, right: number, top = 0, bottom = 1): Pick<CockpitLight, "lit" | "unlit"> {
  const [from, to] = [132 + 58 * top, 132 + 58 * bottom];
  return { unlit: [left, from, right, to], lit: [left, from + 64, right, to + 64] };
}

/* The buttons, as the model draws their pictures. */
const MASTER_WARN: Quad = [[15.323, -0.4072, -0.6126], [15.323, -0.3886, -0.6126], [15.318, -0.3886, -0.5954], [15.318, -0.4072, -0.5954]];
const MASTER_CAUT: Quad = [[15.3159, -0.4067, -0.5882], [15.3159, -0.3888, -0.5882], [15.3109, -0.3888, -0.5709], [15.3109, -0.4067, -0.5709]];
const PULL_UP: Quad = [[15.5313, -0.6882, -0.4263], [15.5313, -0.6709, -0.4263], [15.5263, -0.6709, -0.4091], [15.5263, -0.6882, -0.4091]];
/** The landing gear's three, left, nose and right, beside the systems display. */
const GEAR: Quad[] = [
  [[15.534, 0.1425, -0.4304], [15.534, 0.1611, -0.4304], [15.529, 0.1611, -0.4131], [15.529, 0.1425, -0.4131]],
  [[15.534, 0.1623, -0.4304], [15.534, 0.1809, -0.4304], [15.529, 0.1809, -0.4131], [15.529, 0.1623, -0.4131]],
  [[15.534, 0.1822, -0.4304], [15.534, 0.2008, -0.4304], [15.529, 0.2008, -0.4131], [15.529, 0.1822, -0.4131]],
];
/** Where a gear light's word ends and its triangle begins, down the button. */
const GEAR_SPLIT = 0.52;
/** The autopilot's and the autothrust's buttons on the glareshield, and the flight directors' either side. */
const AP1: Quad = [[15.3218, -0.018, -0.5986], [15.3218, -0.002, -0.5987], [15.3172, -0.0025, -0.5846], [15.3172, -0.0185, -0.5845]];
const ATHR: Quad = [[15.3155, -0.0084, -0.5788], [15.3155, 0.0085, -0.5788], [15.3108, 0.0085, -0.5636], [15.3108, -0.0084, -0.5636]];
const FD: Quad = [[15.3133, -0.2684, -0.5725], [15.3134, -0.2526, -0.5727], [15.3103, -0.2529, -0.5619], [15.3102, -0.2687, -0.5617]];

/*
 * Buttons the model would show lit for as long as the flight lasts, where
 * nothing about a flight in cruise lights them: kept dark.
 */
const AUTO_LAND: Quad = [[15.3159, -0.5593, -0.5882], [15.3159, -0.5408, -0.5882], [15.3109, -0.5408, -0.5709], [15.3109, -0.5593, -0.5709]];
const ATC_MESSAGE: Quad = [[15.3075, -0.7132, -0.5827], [15.3075, -0.7008, -0.5827], [15.3032, -0.7008, -0.5672], [15.3032, -0.7132, -0.5672]];
/** The autobrake's LO, MED and MAX, beside the gear's lights. */
const AUTO_BRAKE: Quad[] = [0.1404, 0.1601, 0.1874].map((left) => [
  [15.5222, left, -0.3925], [15.5222, left + 0.0174, -0.3925], [15.5172, left + 0.0174, -0.3752], [15.5172, left, -0.3752],
]);
/** The one of them the flight has: MED, which brakes as hard as the aircraft's own autobrake does. */
const AUTO_BRAKE_MED = AUTO_BRAKE[1];
/** Where an autobrake button's DECEL ends and its ON begins, down the button. */
const AUTO_BRAKE_SPLIT = 0.42;
const BRAKE_FAN_HOT: Quad = [[15.5339, 0.2166, -0.4303], [15.5339, 0.2339, -0.4303], [15.5289, 0.2339, -0.4131], [15.5289, 0.2166, -0.4131]];
/** The engines' fire lights on the pedestal, either side of the middle. */
const ENGINE_FIRE: Quad[] = [-0.0396, 0.0234].map((left) => [
  [14.9489, left, 0.0141], [14.9489, left + 0.0165, 0.0141], [14.932, left + 0.0165, 0.0169], [14.932, left, 0.0169],
]);
/** TERR ON ND, beside each pilot's navigation display. */
const TERRAIN_ON_ND: Quad[] = [
  [[15.4931, -0.2302, -0.2953], [15.4931, -0.2128, -0.2953], [15.4881, -0.2128, -0.2781], [15.4881, -0.2302, -0.2781]],
  [[15.5075, 0.2192, -0.3444], [15.5075, 0.2365, -0.3444], [15.5025, 0.2365, -0.3272], [15.5025, 0.2192, -0.3272]],
];

/** The lit bar of an engaged button on the glareshield: across its lower part, under the button's name. */
const bar = (quad: Quad) => partOf(quad, 0.18, 0.7, 0.82, 0.86);

export const COCKPIT_LIGHTS = {
  masterWarning: [MASTER_WARN, mirrored(MASTER_WARN)].map((corners) => ({ corners: lifted(corners, OVER_PANEL), ...cell(66, 126) })),
  masterCaution: [MASTER_CAUT, mirrored(MASTER_CAUT)].map((corners) => ({ corners: lifted(corners, OVER_PANEL), ...cell(132, 190) })),
  /** The ground proximity warning's PULL UP, the upper half of its button. */
  pullUp: [PULL_UP, mirrored(PULL_UP)].map((corners) => ({ corners: lifted(partOf(corners, 0, 0, 1, 0.5), OVER_PANEL), ...cell(196, 252, 0, 0.5) })),
  /** And its GPWS fault light, the lower half, which nothing here lights. */
  gpwsFault: [PULL_UP, mirrored(PULL_UP)].map((corners) => ({ corners: lifted(partOf(corners, 0, 0.5, 1, 1), OVER_PANEL), ...cell(196, 252, 0.5, 1) })),
  gearUnlocked: GEAR.map((corners) => ({ corners: lifted(partOf(corners, 0, 0, 1, GEAR_SPLIT), OVER_PANEL), ...cell(642, 702, 0, GEAR_SPLIT) })),
  gearDown: GEAR.map((corners) => ({ corners: lifted(partOf(corners, 0, GEAR_SPLIT, 1, 1), OVER_PANEL), ...cell(642, 702, GEAR_SPLIT, 1) })),
  /** With the ground ahead, the terrain is on the navigation displays. */
  terrainOnNd: TERRAIN_ON_ND.map((corners) => ({ corners: lifted(corners, OVER_PANEL), ...cell(516, 572) })),
  autoLand: [AUTO_LAND, mirrored(AUTO_LAND)].map((corners) => ({ corners: lifted(corners, OVER_PANEL), ...cell(770, 830) })),
  /** LO and MAX, which the flight has not: kept dark. */
  autoBrake: [AUTO_BRAKE[0], AUTO_BRAKE[2]].map((corners) => ({ corners: lifted(corners, OVER_PANEL), ...cell(580, 636) })),
  /** MED's two lights: ON while it is armed, under DECEL while it is braking. */
  autoBrakeDecel: [{ corners: lifted(partOf(AUTO_BRAKE_MED, 0, 0, 1, AUTO_BRAKE_SPLIT), OVER_PANEL), ...cell(580, 636, 0, AUTO_BRAKE_SPLIT) }],
  autoBrakeArmed: [{ corners: lifted(partOf(AUTO_BRAKE_MED, 0, AUTO_BRAKE_SPLIT, 1, 1), OVER_PANEL), ...cell(580, 636, AUTO_BRAKE_SPLIT, 1) }],
  brakeFanHot: [{ corners: lifted(BRAKE_FAN_HOT, OVER_PANEL), ...cell(452, 508) }],
  engineFire: ENGINE_FIRE.map((corners) => ({ corners: lifted(corners, OVER_PANEL), ...cell(388, 444) })),
  /** Its unlit picture is in the texture's top row, the lit one under it. */
  atcMessage: [ATC_MESSAGE, mirrored(ATC_MESSAGE)].map((corners) => ({
    corners: lifted(corners, OVER_PANEL), unlit: [396, 8, 436, 58] as TexturePart, lit: [396, 70, 436, 120] as TexturePart,
  })),
  /** Bars, drawn here: not taken from the texture. */
  autopilot: [{ corners: lifted(bar(AP1), OVER_PANEL), lit: null, unlit: null }],
  autothrust: [{ corners: lifted(bar(ATHR), OVER_PANEL), lit: null, unlit: null }],
  flightDirector: [FD, mirrored(FD)].map((corners) => ({ corners: lifted(bar(corners), OVER_PANEL), lit: null, unlit: null })),
} satisfies Record<string, CockpitLight[]>;

export type CockpitLightName = keyof typeof COCKPIT_LIGHTS;

/**
 * Whether a direction from the captain's seat goes out through a window:
 * forward, right and down in the aircraft's frame. Roughly, which is enough
 * for what it is for (a storm's mark is not drawn over the panel): above
 * the glareshield ahead and the sills to the sides, below the roof, and not
 * behind the seat.
 */
export function throughWindows([forward, right, down]: Vec3): boolean {
  const degrees = 180 / Math.PI;
  const round = Math.abs(Math.atan2(right, forward)) * degrees;
  const up = Math.atan2(-down, Math.hypot(forward, right)) * degrees;
  if (round > 115 || up > 30) return false;
  // The glareshield hides more than the side windows' sills do.
  return up > (round < 55 ? -11 : -19);
}

/**
 * One face of a control a hand can be put on: flat on the model, as a
 * `Quad`, and how far what stands on it (a lever's handle, a knob) reaches
 * off the face towards whoever looks at it, metres. A pedal's also says
 * which way it pushes the rudder.
 */
export interface ControlFace {
  corners: Quad;
  height: number;
  push?: -1 | 1;
}

/**
 * A control of the flight deck: where it is, and what a hand on it does.
 * Either a click does what a key does (`press`: one thing, or for a lever
 * one for the forward half of its face and one for the aft half), or the
 * control is the hand's for as long as the mouse is held on it (`hold`),
 * and moves with it: the stick, the rudder, the thrust levers.
 */
export interface CockpitControl {
  faces: ControlFace[];
  press?: FlightAction | [FlightAction, FlightAction];
  hold?: "stick" | "rudder" | "thrust";
}

/** A face on the pedestal, seen from above: from `forward` aft to `aft`, `left` to `right`, at `down`. */
const onPedestal = (forward: number, aft: number, left: number, right: number, down: number): Quad => (
  [[forward, left, down], [forward, right, down], [aft, right, down], [aft, left, down]]
);
/** The top of the pedestal's aft panels, which lie level. */
const PEDESTAL = 0.011;
/** A small button's face, a little larger than its picture: a hand is not as exact as a light. */
const button = (quad: Quad): Quad => partOf(quad, -0.15, -0.15, 1.15, 1.15);
/** A rudder pedal, its top forward: from `left` to `right`. */
const pedal = (left: number, right: number): Quad => [[15.62, left, 0.14], [15.62, right, 0.14], [15.34, right, 0.23], [15.34, left, 0.23]];

/**
 * The controls of the flight deck that do something in a flight, each
 * where the model has it: measured as the screens and the lights are. The
 * captain's own stick and pedals; the first officer's are out of reach.
 */
export const COCKPIT_CONTROLS = {
  /** The flap lever's panel, right of the thrust levers, as high as its handle: its scale runs from 0 forward to FULL aft. Forward half in a notch, aft half out. */
  flaps: { faces: [{ corners: onPedestal(14.915, 14.82, 0.05, 0.19, PEDESTAL), height: 0.045 }], press: ["flapsIn", "flapsOut"] },
  /** The speed brake's lever and panel, left of them. */
  speedBrake: { faces: [{ corners: onPedestal(14.93, 14.82, -0.19, -0.048, PEDESTAL), height: 0.05 }], press: "speedbrake" },
  /** The landing gear's lever, on the main panel right of the engine display. */
  gear: {
    faces: [{ corners: [[15.487, 0.124, -0.278], [15.487, 0.1825, -0.278], [15.4602, 0.1825, -0.18], [15.4602, 0.124, -0.18]], height: 0.055 }],
    press: "gear",
  },
  /** The thrust levers' quadrant, between the trim wheels, as high as their handles reach: dragged forward and back. */
  thrust: { faces: [{ corners: onPedestal(15.21, 15.015, -0.076, 0.076, 0), height: 0.175 }], hold: "thrust" },
  /** The captain's sidestick, on the console left of the seat: the ailerons and the elevator. */
  sidestick: { faces: [{ corners: onPedestal(15.24, 15.07, -0.91, -0.81, -0.12), height: 0.21 }], hold: "stick" },
  /** The captain's rudder pedals, under the main panel. */
  pedals: {
    faces: [{ corners: pedal(-0.62, -0.537), height: 0.03, push: -1 }, { corners: pedal(-0.509, -0.425), height: 0.03, push: 1 }],
    hold: "rudder",
  },
  /** The rudder trim's knob behind the levers, sprung to its middle: turned and held either way, the rudder goes with it. */
  rudderTrim: {
    faces: [
      { corners: onPedestal(14.848, 14.806, -0.002, 0.0175, PEDESTAL), height: 0.03, push: -1 },
      { corners: onPedestal(14.848, 14.806, 0.0175, 0.037, PEDESTAL), height: 0.03, push: 1 },
    ],
    hold: "rudder",
  },
  /** AP1, on the glareshield. */
  autopilot: { faces: [{ corners: button(AP1), height: 0.004 }], press: "autopilot" },
  /** MASTER WARN and MASTER CAUT on the glareshield, in front of each pilot: lights, and buttons that silence what they light for. */
  masterWarning: {
    faces: [MASTER_WARN, mirrored(MASTER_WARN)].map((corners) => ({ corners: button(corners), height: 0.004 })), press: "silence",
  },
  masterCaution: {
    faces: [MASTER_CAUT, mirrored(MASTER_CAUT)].map((corners) => ({ corners: button(corners), height: 0.004 })), press: "silence",
  },
  /** The autobrake's MED, beside the gear's lights. */
  autobrake: { faces: [{ corners: button(AUTO_BRAKE_MED), height: 0.004 }], press: "autobrake" },
  /** The parking brake's handle, at the pedestal's aft end. */
  parkingBrake: { faces: [{ corners: onPedestal(14.77, 14.71, -0.045, 0.045, PEDESTAL), height: 0.025 }], press: "parkingBrake" },
  /** The weather radar's panel, on the pedestal's left: its colours painted on the ground, or not. */
  weatherRadar: {
    faces: [{ corners: [[14.985, -0.2533, 0.0081], [14.985, -0.1117, 0.0081], [14.92, -0.1117, 0.0184], [14.92, -0.2533, 0.0184]], height: 0.02 }],
    press: "radar",
  },
} satisfies Record<string, CockpitControl>;

export type CockpitControlName = keyof typeof COCKPIT_CONTROLS;

/**
 * A control a line of sight meets: which, which of its faces, where on that
 * face it is pointed at (across and down it, 0 to 1 each), and how far off
 * it is, metres.
 */
export interface CockpitPick {
  name: CockpitControlName;
  face: number;
  across: number;
  down: number;
  distance: number;
}

/** A hand reaches no control further off than this, metres. */
const REACH_M = 3;
/** A face is met this far behind itself too, metres: a flat button has no depth to be met in otherwise. */
const SKIN_M = 0.003;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Where a line from `eye` along `way` meets a face: the box the face makes
 * with what stands on it. In the face's own measures (across it, down it,
 * and off it), the box is three pairs of walls, and the line is inside it
 * between the last wall it comes in through and the first it leaves by.
 * Null where it misses, or meets the face from behind.
 */
function met(eye: Vec3, way: Vec3, { corners, height }: ControlFace): { distance: number; across: number; down: number } | null {
  const across = minus(corners[1], corners[0]);
  const down = minus(corners[3], corners[0]);
  const normal: Vec3 = [
    down[1] * across[2] - down[2] * across[1], down[2] * across[0] - down[0] * across[2], down[0] * across[1] - down[1] * across[0],
  ];
  const length = Math.hypot(...normal);
  const off = normal.map((value) => value / length) as Vec3;
  // A vector as so much of the face's two edges, which need not be square to each other, and so far off it.
  const [aa, ab, bb] = [dot(across, across), dot(across, down), dot(down, down)];
  const within = (v: Vec3): Vec3 => {
    const [va, vb] = [dot(v, across), dot(v, down)];
    return [(va * bb - vb * ab) / (aa * bb - ab * ab), (vb * aa - va * ab) / (aa * bb - ab * ab), dot(v, off)];
  };
  const from = within(minus(eye, corners[0]));
  const along = within(way);
  if (along[2] >= 0) return null;
  const walls: Array<[number, number]> = [[0, 1], [0, 1], [-SKIN_M, height]];
  let [enters, leaves] = [0, Infinity];
  for (let i = 0; i < 3; i += 1) {
    const [low, high] = walls[i];
    if (Math.abs(along[i]) < 1e-12) {
      if (from[i] < low || from[i] > high) return null;
      continue;
    }
    const [a, b] = [(low - from[i]) / along[i], (high - from[i]) / along[i]];
    enters = Math.max(enters, Math.min(a, b));
    leaves = Math.min(leaves, Math.max(a, b));
  }
  if (enters > leaves) return null;
  // Pointed at: where the line reaches the face itself, which under a lever's handle may be past the face's edge.
  const reaches = -from[2] / along[2];
  const on = (i: number) => Math.min(1, Math.max(0, from[i] + along[i] * reaches));
  return { distance: enters * Math.hypot(...way), across: on(0), down: on(1) };
}

/**
 * The control a line of sight meets first: from `eye` along `way`, both in
 * the aircraft's frame (`lookedAlong` in view.ts makes the way from a point
 * of the picture). Null where it meets none within reach.
 */
export function controlAlong(eye: Vec3, way: Vec3): CockpitPick | null {
  let nearest: CockpitPick | null = null;
  for (const [name, control] of Object.entries(COCKPIT_CONTROLS) as Array<[CockpitControlName, CockpitControl]>) {
    for (const [face, box] of control.faces.entries()) {
      const hit = met(eye, way, box);
      if (hit && hit.distance <= REACH_M && (!nearest || hit.distance < nearest.distance)) nearest = { name, face, ...hit };
    }
  }
  return nearest;
}
