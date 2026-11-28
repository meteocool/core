/**
 * A flight's score: points for every second flown inside a storm's cloud,
 * the more the stronger its echo, and a bonus, once a flight, for each of
 * the things a storm does to an aircraft that flies into it (St Elmo's fire
 * on the glass, hail striking it, lightning close by, ...) and for landing
 * afterwards.
 *
 * Worked out here from what the pilot measures each frame; kept by the
 * pilot (pilot.ts) for the flight, and the best of them for the reader.
 */

/** What a frame of flight gives the score to go on. */
export interface ScoreSample {
  /** The echo where the aircraft is, dBZ; null for none. And how much of a cloud it is in, 0 to 1. */
  dbz: number | null;
  cloud: number;
  /** St Elmo's fire on the glass, hail going past, a strike's glare, ice on the glass, a storm core's rough air: 0 to 1 each. */
  charge: number;
  hail: number;
  glare: number;
  frost: number;
  severity: number;
  /** In the air, and not a wreck: only that scores. */
  flying: boolean;
}

/** The echoes that score, dBZ, each for so many points a second: rain, heavy rain, a storm, a storm's core. */
export const SCORE_BANDS: ReadonlyArray<{ dbz: number; perSecond: number }> = [
  { dbz: 55, perSecond: 20 },
  { dbz: 45, perSecond: 8 },
  { dbz: 35, perSecond: 3 },
  { dbz: 20, perSecond: 1 },
];
/** As much of a cloud as it takes to be inside it. */
const IN_CLOUD = 0.3;

export type Feat = "stElmo" | "hail" | "lightning" | "iced" | "severe" | "core" | "landed" | "butter";

/**
 * The bonuses, once a flight each: what earns it, held for how long, s;
 * and its points. The core is the strongest band, flown in for long.
 */
export const FEATS: Record<Feat, { points: number; holdS: number }> = {
  stElmo: { points: 500, holdS: 1.5 },
  hail: { points: 400, holdS: 1 },
  lightning: { points: 300, holdS: 0 },
  iced: { points: 300, holdS: 0 },
  severe: { points: 400, holdS: 2 },
  core: { points: 1000, holdS: 10 },
  landed: { points: 500, holdS: 0 },
  butter: { points: 1000, holdS: 0 },
};

/** How the score of a landing is earned, by how fast it came down, m/s: a butter one under 120 ft a minute. */
export const BUTTER_SINK_MS = 0.6;

export interface FlightScore {
  points: number;
  /** Points a second being earned now, for the echo the aircraft is in; 0 out of cloud. */
  rate: number;
  /** The bonuses earned this flight, in the order they were. */
  feats: Feat[];
  /** How long each bonus's condition has held so far, s. */
  held: Partial<Record<Feat, number>>;
  /**
   * The board's correction, in `points` already: what the board, working
   * the flight out again, came to more or less than the cockpit (synced).
   */
  synced: number;
}

export const NO_SCORE: FlightScore = { points: 0, rate: 0, feats: [], held: {}, synced: 0 };

/** Points a second for an echo inside a cloud; none out of one. */
export function rateOf(dbz: number | null, cloud: number): number {
  if (dbz === null || cloud < IN_CLOUD) return 0;
  return SCORE_BANDS.find((band) => dbz >= band.dbz)?.perSecond ?? 0;
}

/** What earns each bonus that a frame can, by itself. */
function meets(sample: ScoreSample): Partial<Record<Feat, boolean>> {
  return {
    stElmo: sample.charge > 0.35,
    hail: sample.hail > 0.35,
    lightning: sample.glare > 0.5,
    iced: sample.frost > 0.5,
    severe: sample.severity > 0.5,
    core: sample.cloud >= IN_CLOUD && sample.dbz !== null && sample.dbz >= SCORE_BANDS[0].dbz,
  };
}

/** The score `seconds` of flight on, and the bonuses earned in them. */
export function scored(score: FlightScore, sample: ScoreSample, seconds: number): { score: FlightScore; earned: Feat[] } {
  if (!sample.flying || seconds <= 0) return { score: score.rate === 0 ? score : { ...score, rate: 0 }, earned: [] };
  const rate = rateOf(sample.dbz, sample.cloud);
  let points = score.points + rate * seconds;
  const held = { ...score.held };
  const earned: Feat[] = [];
  for (const [feat, met] of Object.entries(meets(sample)) as Array<[Feat, boolean]>) {
    if (score.feats.includes(feat)) continue;
    // A bonus held for long is earned; one let go of starts again.
    held[feat] = met ? (held[feat] ?? 0) + seconds : 0;
    if (met && held[feat]! >= FEATS[feat].holdS) {
      earned.push(feat);
      points += FEATS[feat].points;
    }
  }
  return { score: { ...score, points, rate, feats: earned.length ? [...score.feats, ...earned] : score.feats, held }, earned };
}

/** The points the cockpit earned itself, the board's correction left out. */
export function earnedPoints(score: FlightScore): number {
  return score.points - score.synced;
}

/** The score with the board's correction `correction` in it in place of the last one; never below none. */
export function synced(score: FlightScore, correction: number): FlightScore {
  const earned = earnedPoints(score);
  const corrected = Math.max(-earned, correction);
  return corrected === score.synced ? score : { ...score, points: earned + corrected, synced: corrected };
}

/** A landing made, with how fast it came down, m/s: its bonuses, the ones not earned this flight yet. */
export function landedScore(score: FlightScore, sink: number): { score: FlightScore; earned: Feat[] } {
  const earned = (["landed", ...(sink < BUTTER_SINK_MS ? ["butter"] : [])] as Feat[]).filter((feat) => !score.feats.includes(feat));
  if (!earned.length) return { score, earned };
  const points = score.points + earned.reduce((sum, feat) => sum + FEATS[feat].points, 0);
  return { score: { ...score, points, feats: [...score.feats, ...earned] }, earned };
}

const BEST_KEY = "meteoair.best";

/** The best score flown in this browser; none where it cannot keep one. */
export function bestScore(): number {
  try {
    return Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0);
  } catch {
    return 0;
  }
}

/** Keep a score as the best, if it is. */
export function keepBest(points: number): number {
  const best = bestScore();
  if (points <= best) return best;
  try {
    localStorage.setItem(BEST_KEY, String(Math.round(points)));
  } catch {
    // A browser that keeps nothing: the best is this flight's.
  }
  return points;
}
