/**
 * The cockpit's windows, and the light on the flight deck: what the weather
 * does to both.
 *
 * Water on the windshield comes with the rain, and with cloud warm enough to
 * be water; at an airliner's speed the air drives it off in seconds, and
 * standing it runs off and dries over a minute. In a storm's cloud, where
 * ice and water meet and the air is charged, the glass crawls with St Elmo's
 * fire, and more of it the nearer the lightning. Cloud takes the sun off the
 * flight deck, a storm overhead much of the sky's light too, and a strike
 * nearby lights all of it for a moment.
 *
 * The numbers are worked out here; the glass is drawn by the aircraft's
 * renderer (layers/aircraftRenderer.ts), on the model's own windows.
 */

const ramp = (value: number, low: number, high: number) => Math.min(Math.max((value - low) / (high - low), 0), 1);

/** The echo as a number: none at all for no echo, or none the radar could give. */
const echoOf = (dbz: number | null) => (dbz === null || dbz === -Infinity ? -30 : dbz);

/** What the air round the aircraft puts on its windows. */
export interface GlassAir {
  /** Rain and cloud going past, 0 to 1 each (weather.ts's `Air`). */
  rain: number;
  cloud: number;
  /** The air's temperature, degrees C. */
  temperature: number;
  /** The true airspeed, m/s: what drives water off the glass. */
  tas: number;
}

/** How long water takes to come on the glass in rain, seconds. */
const WETTING_S = 0.8;
/** How long it takes to go once out of the rain: blown off at speed, and run off and dried standing, seconds. */
const BLOWN_OFF_S = 2;
const DRIED_S = 50;

/**
 * How wet the windshield is, 0 to 1, `dt` seconds on from `wet` in this air.
 * Below freezing what strikes it is ice, and the frost's (weatherPass.ts),
 * not water.
 */
export function wetted(wet: number, air: GlassAir, dt: number): number {
  const liquid = ramp(air.temperature, -4, 1);
  const target = Math.min(1, Math.max(air.rain, 0.45 * air.cloud) * liquid);
  const pace = target >= wet ? WETTING_S : BLOWN_OFF_S + (DRIED_S - BLOWN_OFF_S) * (1 - ramp(air.tas, 10, 80));
  return wet + (target - wet) * (1 - Math.exp(-Math.max(dt, 0) / pace));
}

/**
 * How charged the air round the aircraft is, 0 to 1: how much St Elmo's fire
 * there is on the glass. It takes cloud with a strong echo in it, more where
 * it is cold enough for ice and water to meet (graupel rubbing past is what
 * charges a storm), and more again with lightning nearby (`flash`, its glare
 * on the glass, lightning.ts).
 */
export function chargeOf(air: { cloud: number; dbz: number | null; temperature: number }, flash = 0): number {
  const mixed = ramp(-air.temperature, -6, 4);
  const storm = ramp(echoOf(air.dbz), 36, 52) * (0.35 + 0.65 * mixed);
  return Math.min(1, air.cloud * (storm + 0.6 * flash));
}

/**
 * The light on the flight deck, 0 to 1 each: how much of the sun reaches
 * it, and how light the sky round it is. In cloud the sun is gone and the
 * sky a flat grey; under a storm, in or out of its cloud, the heavier the
 * echo the darker it is.
 */
export function daylightOf(cloud: number, dbz: number | null): { sun: number; sky: number } {
  const storm = ramp(echoOf(dbz), 28, 55);
  return { sun: (1 - 0.92 * cloud) * (1 - 0.75 * storm), sky: 1 - 0.25 * cloud - 0.4 * storm };
}
