/**
 * meteocool's own nowcast outside Germany (ng ADR 0022), behind the
 * experimental "meteocool nowcast" setting.
 *
 * Each of the four networks around DWD (`ch`, `fr`, `cz`, `pl`) has a run of
 * its own: up to 24 leads, five to 120 minutes, on the timeline's own steps.
 * `/v3/radar/timeseries?products=nowcast` answers them under `products` as
 * `nowcast_<domain>`, each keyed by the step a lead is valid at and shaped as
 * WN's steps are in `frames`. A network without a fresh run is absent.
 * Germany's run is never served: WN is Germany's forecast, with the setting
 * on or off.
 *
 * Pure, with no store and no clock: RadarCapability holds the runs and draws
 * them, the player reads what it publishes.
 */
import type { CountryNetwork } from "../api/events";

/** The networks with a nowcast of their own, in the order the map lists them. */
export const NOWCAST_DOMAINS: readonly CountryNetwork[] = ["ch", "fr", "cz", "pl"];

/** The `products` value that asks for the runs. */
export const NOWCAST_PRODUCT = "nowcast";

/** One network's run: its steps, by the unix time each is valid at. */
export type NowcastRun<F> = Record<string, F>;

/** Every network's run in a response, by network; a network without one is absent. */
export type NowcastRuns<F> = Partial<Record<CountryNetwork, NowcastRun<F>>>;

/** The runs in a timeseries' `products`, under their `nowcast_<domain>` keys. */
export function nowcastRuns<F>(products: Record<string, Record<string, F>> | null | undefined): NowcastRuns<F> {
  const runs: NowcastRuns<F> = {};
  for (const domain of NOWCAST_DOMAINS) {
    const run = products?.[`nowcast_${domain}`];
    if (run && Object.keys(run).length) runs[domain] = run;
  }
  return runs;
}

/** The networks whose run has a lead valid at `step`. */
export function domainsAt<F>(runs: NowcastRuns<F>, step: number): CountryNetwork[] {
  return NOWCAST_DOMAINS.filter((domain) => runs[domain]?.[step] != null);
}

/**
 * How many steps WN's last may run past a network's run before the run is
 * taken to have stalled rather than to be catching up.
 */
export const RUN_CATCH_UP_STEPS = 2;

/** The timeline's step, in seconds. */
const STEP_SECONDS = 5 * 60;

/**
 * The newest step the player may reach, given WN's `last` and the runs.
 *
 * Each network's run is made a few minutes after WN's, so for part of every
 * cycle WN has a step its runs do not reach yet. On that step every network
 * with a run was washed out as having no forecast, while the step before had
 * one for all of them. So the timeline ends where every run ends, for the few
 * minutes the runs take to catch up. A run further behind than
 * `RUN_CATCH_UP_STEPS` has stalled and does not hold WN back: past its end
 * the wash is the truth, that network has no forecast.
 */
export function lastStepWithRuns<F>(last: number, runs: NowcastRuns<F>): number {
  let held = last;
  for (const domain of NOWCAST_DOMAINS) {
    const run = runs[domain];
    if (!run) continue;
    const end = Math.max(...Object.keys(run).map(Number));
    if (end < last && last - end <= RUN_CATCH_UP_STEPS * STEP_SECONDS) held = Math.min(held, end);
  }
  return held;
}

/** The networks with a run at all. */
export function domainsWithRun<F>(runs: NowcastRuns<F>): CountryNetwork[] {
  return NOWCAST_DOMAINS.filter((domain) => runs[domain] !== undefined);
}

/**
 * The series the chart is drawn from at a point a network draws, with the
 * forecast steps' readings taken from that network's run: its `dbz` on the
 * leads it has, and nothing on the steps past its last lead, which is "no
 * forecast" rather than "dry". The observed steps are the timeseries' own.
 *
 * Unchanged without a run for the point's network: the point is DWD's, or
 * the network has no fresh run, and WN's readings stand as they always have.
 */
export function chartFrames<F extends { source: string; dbz?: number | null }>(
  frames: Record<string, F | null>,
  run: NowcastRun<{ dbz?: number | null }> | undefined,
): Record<string, F | null> {
  if (!run) return frames;
  const chart: Record<string, F | null> = {};
  for (const [key, frame] of Object.entries(frames)) {
    chart[key] = frame && frame.source !== "observation" ? { ...frame, dbz: run[key]?.dbz ?? null } : frame;
  }
  return chart;
}
