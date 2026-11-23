/**
 * The beams from the radars that saw the storm looked into, drawn over the
 * view (lib/studio/flight/radarRays.ts places them): light rather than
 * lines, as a head-up display draws, so they read against the cloud and the
 * sky alike and leave both visible through them.
 *
 * Each beam is a soft glow with a bright thread down its middle, faint at
 * the radar and full at the storm, brighter for a radar that saw the storm
 * lower down. Pulses run along it from the radar towards the storm, as the
 * radar's own pulses go out; a ring opens now and then round each radar's
 * place, and the storm's mark has a glow behind it where the beams meet.
 * When a storm is first looked into the beams grow out from it to their
 * radars. A reader who asks for less motion gets the beams whole and still.
 */
import { pointAlong, rayGrowth, runsFrom } from "../../../lib/studio/flight/radarRays";
import type { RayPoint } from "../../../lib/studio/flight/radarRays";
import type { Telemetry } from "../../../lib/studio/flight/pilot";

/** The beams' colour: a pale cyan, unlike any of the radar's own, which a storm's cloud is drawn in. */
const BEAM = "120, 226, 255";
const CORE = "226, 250, 255";
/** How long a pulse takes from the radar to the storm, seconds, and how many run along a beam at once. */
const PULSE_S = 2.4;
const PULSES = 3;
/** How often a ring opens round a radar, seconds. */
const PING_S = 3;

type Rays = NonNullable<Telemetry["rays"]>;

/** Size the canvas to its box at the screen's own sharpness; a 2D context drawing in CSS pixels. */
export function fit(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const [width, height] = [Math.round(canvas.clientWidth * ratio), Math.round(canvas.clientHeight * ratio)];
  if (canvas.width !== width || canvas.height !== height) [canvas.width, canvas.height] = [width, height];
  const context = canvas.getContext("2d");
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

/**
 * Draw the beams. `diamond` is where the storm's mark is drawn on the
 * screen, CSS pixels, and `anchor` where the beams' far end is placed: the
 * label's diamond does not sit exactly on its anchor, so the last stretch of
 * each beam is bent onto it. Both null where the mark is not shown.
 */
export function drawRays(
  canvas: HTMLCanvasElement, rays: Rays | null, time: number,
  diamond: { x: number; y: number } | null, anchor: { x: number; y: number } | null,
): void {
  const context = fit(canvas);
  if (!context) return;
  const [width, height] = [canvas.clientWidth, canvas.clientHeight];
  context.clearRect(0, 0, width, height);
  if (!rays?.beams.length) return;
  const age = time - rays.since;
  const grown = rays.still ? 1 : rayGrowth(age);
  const shift = diamond && anchor ? { x: diamond.x - anchor.x, y: diamond.y - anchor.y } : { x: 0, y: 0 };
  // Only the last stretch moves: a beam's far end onto the diamond, the rest where it is.
  const onScreen = (point: { x: number; y: number }, t: number) => {
    const bend = t ** 8;
    return { x: point.x * width + shift.x * bend, y: point.y * height + shift.y * bend };
  };

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";

  rays.beams.forEach(({ radar, runs, dish }, index) => {
    const strength = radar.strength;
    const shown = runsFrom(runs, 1 - grown);
    for (const points of shown) beam(context, points, strength, onScreen);

    if (!rays.still) {
      // The pulses, each along the part of the beam that has grown, fading in at the radar and out at the storm.
      for (let pulse = 0; pulse < PULSES; pulse++) {
        const t = (age / PULSE_S + pulse / PULSES + index * 0.13) % 1;
        if (t < 1 - grown) continue;
        const along = pointAlong(runs, t);
        if (!along) continue;
        const at = onScreen(along, t);
        glow(context, at.x, at.y, 11, 0.85 * strength * Math.sin(Math.PI * t));
      }
    }

    if (dish && grown >= 1) {
      const at = onScreen(dish, 0);
      // The radar's place: a small bright point, and a ring opening round it now and then.
      glow(context, at.x, at.y, 6, 0.6 * strength);
      if (!rays.still) {
        const ping = ((age + index * 0.37) % PING_S) / PING_S;
        context.strokeStyle = `rgba(${BEAM}, ${(0.55 * strength * (1 - ping)).toFixed(3)})`;
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(at.x, at.y, 4 + 18 * ping, 0, Math.PI * 2);
        context.stroke();
      }
    }
  });

  // Where the beams meet: a glow behind the storm's mark, breathing gently.
  if (diamond) {
    const breath = rays.still ? 1 : 0.85 + 0.15 * Math.sin(age * 2.2);
    glow(context, diamond.x, diamond.y, 22 * breath, 0.45 * grown);
  }
  context.restore();
}

/** One run of a beam: a wide soft glow, a narrower one, and a bright thread, each fading towards the radar. */
function beam(
  context: CanvasRenderingContext2D, points: readonly RayPoint[], strength: number,
  onScreen: (point: { x: number; y: number }, t: number) => { x: number; y: number },
): void {
  const placed = points.map((point) => onScreen(point, point.t));
  const [first, last] = [placed[0], placed[placed.length - 1]];
  const [near, far] = [points[0].t, points[points.length - 1].t];
  const along = (colour: string, alpha: number) => {
    const gradient = context.createLinearGradient(first.x, first.y, last.x, last.y);
    // Faint at the radar, full at the storm: the beam is the storm's, not the radar's.
    gradient.addColorStop(0, `rgba(${colour}, ${(alpha * (0.2 + 0.8 * near)).toFixed(3)})`);
    gradient.addColorStop(1, `rgba(${colour}, ${(alpha * (0.2 + 0.8 * far)).toFixed(3)})`);
    return gradient;
  };
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (const point of placed.slice(1)) context.lineTo(point.x, point.y);
  // Wide enough to read as light against a bright sky, where adding cyan to blue changes it little.
  for (const [lineWidth, colour, alpha] of [[16, BEAM, 0.09], [7, BEAM, 0.2], [3, BEAM, 0.4], [1.4, CORE, 0.95]] as const) {
    context.lineWidth = lineWidth;
    context.strokeStyle = along(colour, alpha * strength);
    context.stroke();
  }
}

/** A soft round glow. */
function glow(context: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number): void {
  if (alpha <= 0.002 || radius <= 0) return;
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${CORE}, ${Math.min(1, alpha).toFixed(3)})`);
  gradient.addColorStop(0.35, `rgba(${BEAM}, ${(alpha * 0.5).toFixed(3)})`);
  gradient.addColorStop(1, `rgba(${BEAM}, 0)`);
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}
