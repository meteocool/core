/**
 * The air the flight flies through: the International Standard Atmosphere.
 *
 * Up to 11 km the temperature falls 6.5 degrees a kilometre; above, in the
 * lower stratosphere, it stays at -56.5 C. Density and the speed of sound
 * follow from it, and from those the speeds a cockpit shows: the true
 * airspeed is how fast the aircraft moves through the air, the indicated one
 * what the wing feels (it falls with the density, so the same indicated
 * speed is ever faster over the ground the higher one flies), and the Mach
 * number the true speed against the speed of sound, which is what limits an
 * airliner high up.
 */

/** Sea level: 15 C, 1.225 kg a cubic metre. */
export const SEA_LEVEL_TEMPERATURE_K = 288.15;
export const SEA_LEVEL_DENSITY = 1.225;

/** Where the troposphere ends, metres, and how fast it cools on the way up, kelvin a metre. */
const TROPOPAUSE_M = 11000;
const LAPSE_K_PER_M = 0.0065;
const TROPOPAUSE_K = SEA_LEVEL_TEMPERATURE_K - LAPSE_K_PER_M * TROPOPAUSE_M;
/** g / (R lapse), the exponent of the troposphere's pressure. */
const PRESSURE_EXPONENT = 5.25588;
/** The pressure ratio at the tropopause, and the stratosphere's scale height above it. */
const TROPOPAUSE_PRESSURE_RATIO = (TROPOPAUSE_K / SEA_LEVEL_TEMPERATURE_K) ** PRESSURE_EXPONENT;
const STRATOSPHERE_SCALE_M = 6341.62;

const GAMMA = 1.4;
const GAS_CONSTANT = 287.053;

/** The air's temperature at a height, kelvin. */
export function temperatureK(altitude: number): number {
  return altitude < TROPOPAUSE_M ? SEA_LEVEL_TEMPERATURE_K - LAPSE_K_PER_M * altitude : TROPOPAUSE_K;
}

/** The pressure at a height, against sea level's. */
export function pressureRatio(altitude: number): number {
  if (altitude < TROPOPAUSE_M) return (temperatureK(altitude) / SEA_LEVEL_TEMPERATURE_K) ** PRESSURE_EXPONENT;
  return TROPOPAUSE_PRESSURE_RATIO * Math.exp(-(altitude - TROPOPAUSE_M) / STRATOSPHERE_SCALE_M);
}

/** The density at a height, against sea level's (sigma). */
export function densityRatio(altitude: number): number {
  return (pressureRatio(altitude) * SEA_LEVEL_TEMPERATURE_K) / temperatureK(altitude);
}

/** The density at a height, kg a cubic metre. */
export const density = (altitude: number): number => SEA_LEVEL_DENSITY * densityRatio(altitude);

/** The speed of sound at a height, m/s. */
export function speedOfSound(altitude: number): number {
  return Math.sqrt(GAMMA * GAS_CONSTANT * temperatureK(altitude));
}

/**
 * The speed the wing feels for a true airspeed, m/s: the equivalent
 * airspeed, which is what an airspeed indicator reads short of the
 * compressibility correction, a few knots at an airliner's speeds.
 */
export function indicatedFromTrue(tas: number, altitude: number): number {
  return tas * Math.sqrt(densityRatio(altitude));
}

/** The true airspeed an indicated one is at a height, m/s. */
export function trueFromIndicated(ias: number, altitude: number): number {
  return ias / Math.sqrt(densityRatio(altitude));
}

/** The Mach number of a true airspeed at a height. */
export function machOf(tas: number, altitude: number): number {
  return tas / speedOfSound(altitude);
}
