/**
 * Whether a radar grid sampled at one point has no rain at it.
 *
 * The same line the forecast strip draws: above 0 dBZ is something to plot.
 * Dry steps come back at the scale's floor (-32.5). A grid with no reading at
 * all -- every dbz null, which is what a request without a position gets, or
 * a point outside every network -- is not dry but unknown, and says false.
 */
export function isDry(frames: Record<string, { dbz?: number | null } | null> | null | undefined): boolean {
  const readings = Object.values(frames ?? {})
    .map((frame) => frame?.dbz)
    .filter((dbz): dbz is number => typeof dbz === "number" && Number.isFinite(dbz));
  return readings.length > 0 && readings.every((dbz) => dbz <= 0);
}
