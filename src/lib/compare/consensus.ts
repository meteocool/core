/**
 * Turning many models' opinions into one number, plus how much to trust it.
 *
 * Ported from Flowm/meteocompare (src/domain/{aggregate,predictability}.ts and
 * the typical-spread table in src/domain/variables.ts). The weighting is
 * meteocompare's *default* ladder only: its learned per-location calibration
 * needs verification history this does not collect.
 */
import { effectiveModelCount, modelById } from "./models";
import type { DailyVar, PerModel } from "./openMeteo";

export interface Consensus {
  /** The weighted mean, or null when no model covered this point. */
  value: number | null;
  /** Inter-model standard deviation; 0 when only one model contributed. */
  stdDev: number;
  min: number | null;
  max: number | null;
  /** 0-1: how much the models agree, discounted for shared lineage. */
  predictability: number;
  /** Model ids that contributed. */
  contributors: string[];
}

export type Tier = "high" | "mid" | "low";

/** meteocompare's raw-scale cutoffs (ADR 0008). */
export function tierFor(predictability: number): Tier {
  if (predictability >= 0.7) return "high";
  if (predictability >= 0.4) return "mid";
  return "low";
}

/**
 * The inter-model standard deviation considered normal for a variable at a
 * given lead time. Agreement is scored against this, so "spread" means
 * "unusually wide for this far out" rather than an absolute number.
 */
function typicalSpread(variable: DailyVar, leadHours: number): number {
  switch (variable) {
    case "temperature_2m_max":
    case "temperature_2m_min":
      if (leadHours <= 24) return 1;
      if (leadHours <= 72) return 1 + ((leadHours - 24) / 48) * 1;
      if (leadHours <= 168) return 2 + ((leadHours - 72) / 96) * 1.5;
      return 3.5;
    case "precipitation_sum":
      return leadHours <= 48 ? 5 : 10; // mm/day
    case "precipitation_probability_max":
      return 25;
    case "wind_speed_10m_max":
      return leadHours <= 48 ? 4 : 7;
    case "weather_code":
      return 1; // unused: weather codes score by agreement, not spread
    default:
      return 1;
  }
}

/**
 * Base weight per model kind. Convection-allowing regional models get a boost
 * on precipitation, where their resolution actually tells.
 */
function weightFor(id: string, variable: DailyVar): number {
  const model = modelById(id);
  if (!model) return 1;
  let weight = 1;
  switch (model.kind) {
    case "global": weight = 1.0; break;
    case "regional-cam": weight = 1.1; break;
    case "regional-mid": weight = 1.0; break;
    case "ai": weight = 0.8; break;
    case "ensemble-mean": weight = 0.9; break;
  }
  const precipitation = variable === "precipitation_sum" || variable === "precipitation_probability_max";
  if (precipitation && model.kind === "regional-cam") weight *= 1.3;
  return weight;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const EMPTY: Consensus = {
  value: null, stdDev: 0, min: null, max: null, predictability: 0, contributors: [],
};

/**
 * Combine one variable's per-model values for one day.
 *
 * `leadHours` is how far ahead this day is, which sets the spread the models
 * are expected to disagree by.
 */
export function consensusOf(perModel: PerModel, variable: DailyVar, leadHours: number): Consensus {
  const contributors = Object.keys(perModel);
  if (contributors.length === 0) return EMPTY;

  if (variable === "weather_code") return byAgreement(perModel, contributors);

  let weightSum = 0;
  let weighted = 0;
  for (const id of contributors) {
    const weight = weightFor(id, variable);
    weighted += perModel[id] * weight;
    weightSum += weight;
  }
  const mean = weighted / weightSum;

  let variance = 0;
  for (const id of contributors) {
    const weight = weightFor(id, variable);
    variance += weight * (perModel[id] - mean) ** 2;
  }
  const stdDev = Math.sqrt(variance / weightSum);

  const values = contributors.map((id) => perModel[id]);
  const spreadScore = clamp01(1 - stdDev / typicalSpread(variable, leadHours));

  return {
    value: mean,
    stdDev,
    min: Math.min(...values),
    max: Math.max(...values),
    predictability: clamp01(spreadScore * modelCountFactor(contributors)),
    contributors,
  };
}

/**
 * Weather codes are categorical, so they take the weighted mode and score by
 * how much weight backs the winner rather than by spread.
 */
function byAgreement(perModel: PerModel, contributors: string[]): Consensus {
  const weights = new Map<number, number>();
  let total = 0;
  for (const id of contributors) {
    const weight = weightFor(id, "weather_code");
    const code = perModel[id];
    weights.set(code, (weights.get(code) ?? 0) + weight);
    total += weight;
  }
  let winner = contributors.length ? perModel[contributors[0]] : 0;
  let best = 0;
  for (const [code, weight] of weights) {
    if (weight > best) {
      best = weight;
      winner = code;
    }
  }
  const values = contributors.map((id) => perModel[id]);
  return {
    value: winner,
    stdDev: 0,
    min: Math.min(...values),
    max: Math.max(...values),
    predictability: clamp01((best / total) * modelCountFactor(contributors)),
    contributors,
  };
}

/** Fewer than ~3 independent models is thin corroboration, whatever they say. */
function modelCountFactor(contributors: string[]): number {
  return Math.min(1, effectiveModelCount(contributors) / 3);
}
