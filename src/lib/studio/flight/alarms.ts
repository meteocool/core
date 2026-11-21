/**
 * The flight's alarms, as an Airbus raises them, and the reader's silencing
 * of them.
 *
 * An alarm is a warning of the flight's (`FlightWarning`), or a control
 * surface it has lost, one each. Each is raised at one of two levels: a
 * warning lights MASTER WARN in front of both pilots, red and flashing, a
 * caution MASTER CAUT, amber and steady; a few (the bank angle) are a voice
 * only. What sounds with it is the continuous repetitive chime for as long as
 * it lasts (an overspeed, the gear not down for a landing, a surface lost),
 * a single chime as it starts (every caution), or a sound of its own (the
 * stall's cricket, the terrain's whoops, the callouts).
 *
 * Pressing either master light silences what is raised now: its chime, its
 * voice and its light go, until it clears. A new alarm, or one that clears
 * and comes back, sounds again; one that comes back within moments of
 * clearing (an overspeed that wavers about the limit) has not cleared.
 *
 * Pure: the pilot keeps the memory (`AlarmMemory`) and publishes what is
 * raised and silenced in the flight's status, which the lights, the warning
 * display and the sound read.
 */
import type { FlightAlarm, FlightWarning, LostSurface } from "../store";

/** The light an alarm raises: red MASTER WARN, or amber MASTER CAUT. */
export type AlarmLevel = "warning" | "caution";

/** How an alarm is raised: its light, if any, and its chime: continuous while it lasts, once as it starts, or none of its own. */
export interface AlarmKind {
  level: AlarmLevel | null;
  chime: "continuous" | "single" | null;
}

const KINDS: Record<FlightWarning, AlarmKind> = {
  overspeed: { level: "warning", chime: "continuous" },
  gear: { level: "warning", chime: "continuous" },
  // These have their own sounds: the cricket, the whoops, the voice.
  stall: { level: "warning", chime: null },
  terrain: { level: "warning", chime: null },
  sink: { level: "warning", chime: null },
  // The bank angle is called, and lights nothing.
  bank: { level: null, chime: null },
  ice: { level: "caution", chime: "single" },
  flapsJammed: { level: "caution", chime: "single" },
  gearJammed: { level: "caution", chime: "single" },
};

/** A control surface gone: a warning, with the chime for as long as it is gone. */
const LOST: AlarmKind = { level: "warning", chime: "continuous" };
/** What a warning not listed here is: a caution, as the warning display has it. */
const OTHER: AlarmKind = { level: "caution", chime: "single" };

const LOST_PREFIX = "lost.";

/** The alarm of a surface lost, by its name (`FlightStatus.lost`). */
export const lostAlarm = (surface: LostSurface): FlightAlarm => `lost.${surface}`;

/** The surface an alarm says is lost; null for a warning. */
export const lostSurface = (alarm: string): LostSurface | null => (alarm.startsWith(LOST_PREFIX) ? alarm.slice(LOST_PREFIX.length) as LostSurface : null);

export function kindOf(alarm: string): AlarmKind {
  if (lostSurface(alarm) !== null) return LOST;
  return KINDS[alarm as FlightWarning] ?? OTHER;
}

/** The alarms of a moment: the surfaces lost first, in the order they went, then the warnings. */
export function alarmsOf(warnings: readonly FlightWarning[], lost: readonly LostSurface[]): FlightAlarm[] {
  return [...lost.map(lostAlarm), ...warnings];
}

/**
 * An alarm silenced stays so while it is raised, and for this long after it
 * clears, seconds: a condition that wavers about its limit is one alarm, not
 * a new one at every crossing.
 */
export const ALARM_CLEAR_S = 2;

/** What the alarms carry from one frame to the next: those silenced, each with how long it has been clear, seconds. */
export interface AlarmMemory {
  silenced: ReadonlyArray<{ alarm: FlightAlarm; clear: number }>;
}

export const NO_ALARMS: AlarmMemory = { silenced: [] };

/** A frame on: a silenced alarm still raised stays silenced; one clear for long enough is forgotten, to sound again if it comes back. */
export function alarmStep(memory: AlarmMemory, raised: readonly FlightAlarm[], dt: number): AlarmMemory {
  const silenced = memory.silenced
    .map(({ alarm, clear }) => ({ alarm, clear: raised.includes(alarm) ? 0 : clear + dt }))
    .filter(({ clear }) => clear < ALARM_CLEAR_S);
  return silenced.length === memory.silenced.length && silenced.every((one, i) => one.clear === memory.silenced[i].clear)
    ? memory
    : { silenced };
}

/** The master light pressed: everything raised now is silenced. */
export function silence(memory: AlarmMemory, raised: readonly FlightAlarm[]): AlarmMemory {
  const fresh = raised.filter((alarm) => !memory.silenced.some((one) => one.alarm === alarm));
  return {
    silenced: [...memory.silenced.map((one) => (raised.includes(one.alarm) ? { ...one, clear: 0 } : one)), ...fresh.map((alarm) => ({ alarm, clear: 0 }))],
  };
}

/** Which of the alarms raised are silenced, in their order. */
export function silencedOf(memory: AlarmMemory, raised: readonly FlightAlarm[]): FlightAlarm[] {
  return raised.filter((alarm) => memory.silenced.some((one) => one.alarm === alarm));
}

/** Whether an alarm is heard: raised, and not silenced. */
export const sounding = (alarm: string, status: { alarms: readonly string[]; silenced: readonly string[] }): boolean =>
  status.alarms.includes(alarm) && !status.silenced.includes(alarm);

/**
 * The master lights for the alarms raised and silenced: MASTER WARN for a
 * warning not silenced, MASTER CAUT for a caution; and whether anything is
 * heard at all, a voice alone included, that pressing either would silence.
 */
export function masterLights(alarms: readonly string[], silenced: readonly string[]): { warning: boolean; caution: boolean; sounding: boolean } {
  const heard = alarms.filter((alarm) => !silenced.includes(alarm));
  return {
    warning: heard.some((alarm) => kindOf(alarm).level === "warning"),
    caution: heard.some((alarm) => kindOf(alarm).level === "caution"),
    sounding: heard.length > 0,
  };
}
