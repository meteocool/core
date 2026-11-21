/**
 * The flight's keys, and a gamepad if one is plugged in.
 *
 * By `event.code`, the key's place on the keyboard, not the letter it
 * types: W, A, S and D are a hand's resting place on any layout, and on an
 * AZERTY keyboard the letters they type are Z, Q, S and D.
 *
 * Held keys fly (`controlInput`, a pure mapping from what is held); the
 * others do one thing each press (`actionOf`). `Keys` reads the keyboard and
 * a gamepad into those two, and lets go of everything when the window loses
 * the focus or the tab is hidden, where a key's release never arrives and it
 * would stay held for good.
 *
 * A gamepad is the same two: its sticks, triggers and bumpers fly
 * (`gamepadInput`), and its other buttons do one thing each press
 * (`gamepadActions`), so that whatever a lever or a button of the flight
 * deck does can be done without letting go of it.
 */
import type { ControlInput } from "./physics";

/** What a press does, once. */
export type FlightAction =
  | "autopilot" | "next" | "restart" | "view" | "style" | "inspect" | "record" | "pause" | "mute" | "help" | "leave"
  | "gear" | "fullscreen" | "flapsOut" | "flapsIn" | "speedbrake" | "radar" | "confirm" | "autobrake" | "parkingBrake"
  /** The master warning or caution light pressed: the alarms raised now are silenced. */
  | "silence";

const HELD: Record<string, true> = {
  KeyW: true, KeyS: true, KeyA: true, KeyD: true,
  ArrowUp: true, ArrowDown: true, ArrowLeft: true, ArrowRight: true,
  Numpad8: true, Numpad5: true, Numpad4: true, Numpad6: true, Numpad2: true,
  ShiftLeft: true, ShiftRight: true, Space: true,
};

const ACTIONS: Record<string, FlightAction> = {
  KeyL: "autopilot",
  KeyN: "next",
  Backspace: "restart",
  KeyV: "view",
  KeyC: "style",
  KeyR: "record",
  KeyP: "pause",
  KeyM: "mute",
  KeyI: "inspect",
  KeyG: "gear",
  KeyF: "fullscreen",
  // U over J on the keyboard: up and down, in and out.
  KeyJ: "flapsOut",
  KeyU: "flapsIn",
  KeyB: "speedbrake",
  KeyX: "autobrake",
  KeyK: "parkingBrake",
  KeyO: "radar",
  // Q for quiet: the master lights' own button.
  KeyQ: "silence",
  Enter: "confirm",
  KeyH: "help",
  Slash: "help",
  Escape: "leave",
};

/** The action a key does, by its code; null for one that flies or does nothing here. */
export function actionOf(code: string, key = ""): FlightAction | null {
  // "?" is wherever a layout puts it.
  if (key === "?") return "help";
  return ACTIONS[code] ?? null;
}

/** Whether a key is one the flight uses, held or pressed: those it keeps from the page. */
export const isFlightKey = (code: string, key = ""): boolean => code in HELD || actionOf(code, key) !== null;

const has = (held: ReadonlySet<string>, ...codes: string[]) => codes.some((code) => held.has(code));
const axis = (positive: boolean, negative: boolean) => Number(positive) - Number(negative);

/** What the keys held ask of the aircraft; also whether time runs faster. */
export function controlInput(held: ReadonlySet<string>): ControlInput & { warp: boolean } {
  return {
    // As the planes of the games: forward is nose down.
    pitch: axis(has(held, "ArrowDown", "Numpad5", "Numpad2"), has(held, "ArrowUp", "Numpad8")),
    roll: axis(has(held, "ArrowRight", "Numpad6"), has(held, "ArrowLeft", "Numpad4")),
    yaw: axis(has(held, "KeyD"), has(held, "KeyA")),
    throttle: axis(has(held, "KeyW"), has(held, "KeyS")),
    brake: has(held, "Space"),
    warp: has(held, "ShiftLeft", "ShiftRight"),
  };
}

/** A stick barely off centre is centred: a worn one never rests at zero. */
const DEAD_ZONE = 0.12;
const deadened = (value: number) => (Math.abs(value) < DEAD_ZONE ? 0 : (value - Math.sign(value) * DEAD_ZONE) / (1 - DEAD_ZONE));

/**
 * What a gamepad in the standard layout asks: the left stick pitches (pulled
 * back, nose up) and rolls, the triggers move the throttle, the bumpers are
 * the rudder.
 */
export function gamepadInput(pad: { axes: readonly number[]; buttons: ReadonlyArray<{ value: number; pressed: boolean }> }): ControlInput {
  const button = (index: number) => pad.buttons[index]?.value ?? 0;
  return {
    pitch: deadened(pad.axes[1] ?? 0),
    roll: deadened(pad.axes[0] ?? 0),
    yaw: button(5) - button(4),
    throttle: button(7) - button(6),
    brake: Boolean(pad.buttons[1]?.pressed),
  };
}

/**
 * What a gamepad's other buttons do, once a press, by their place in the
 * standard layout: the flaps on the pad's up and down as on U and J, the
 * brakes to set on its left and right, the speed brake and the gear on the
 * two face buttons flying leaves free, and the autopilot and the view under
 * the sticks. The button time runs faster by also answers yes where the
 * flight asks whether to end, which the back button asks. The pad's own
 * button in its middle, where the browser passes it on, silences the alarms.
 */
const PAD_ACTIONS: Record<number, FlightAction> = {
  0: "confirm", 2: "speedbrake", 3: "gear", 8: "leave", 9: "pause", 10: "autopilot", 11: "view",
  12: "flapsIn", 13: "flapsOut", 14: "autobrake", 15: "parkingBrake", 16: "silence",
};

/**
 * The actions of the buttons that have just gone down: down now, and not
 * when the pad was last looked at (`before`, by the button's place).
 */
export function gamepadActions(buttons: ReadonlyArray<{ pressed: boolean }>, before: readonly boolean[]): FlightAction[] {
  return Object.entries(PAD_ACTIONS)
    .filter(([index]) => buttons[Number(index)]?.pressed && !before[Number(index)])
    .map(([, action]) => action);
}

/** How often a gamepad's buttons are looked at, ms: none is pressed for less. */
const PAD_EVERY_MS = 40;

/** The first gamepad in the standard layout, if one is plugged in. */
function standardPad(): Gamepad | undefined {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return undefined;
  return [...navigator.getGamepads()].find((one) => one?.connected && one.mapping === "standard") ?? undefined;
}

/** The keyboard and a gamepad together: whichever is pushed further, axis by axis. */
export function merged(a: ControlInput, b: ControlInput): ControlInput {
  const larger = (x: number, y: number) => (Math.abs(x) >= Math.abs(y) ? x : y);
  return {
    pitch: larger(a.pitch, b.pitch),
    roll: larger(a.roll, b.roll),
    yaw: larger(a.yaw, b.yaw),
    throttle: larger(a.throttle, b.throttle),
    brake: a.brake || b.brake,
  };
}

/**
 * Whether a key went to something being typed in, which keeps its keys; or
 * to a dialog of the page's over the flight (the share dialog for its link),
 * whose Enter and Escape are its own, not the flight's.
 */
function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest?.("input, select, textarea, [contenteditable], [role='dialog']"));
}

/**
 * The keyboard and gamepad, read while the flight runs. Listens on the
 * window in the capture phase, so the flight's keys reach nothing else on
 * the page (Studio's own Space and K, the map's arrows, a button's Space).
 */
export class Keys {
  private readonly held = new Set<string>();
  /** What the touch controls ask, where there are any and a finger is on them; see `setTouch`. */
  private touch: (ControlInput & { warp: boolean }) | null = null;
  /** A gamepad's buttons as they were when last looked at, down or not, and what looks at them. */
  private padDown: boolean[] = [];
  private padTimer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: Array<[EventTarget, string, EventListener, boolean]> = [];
  private readonly onAction: (action: FlightAction) => void;

  constructor(onAction: (action: FlightAction) => void) {
    this.onAction = onAction;
  }

  start(): void {
    const down = (event: Event) => {
      const key = event as KeyboardEvent;
      if (typing(key.target) || key.metaKey || key.ctrlKey || key.altKey) return;
      if (!isFlightKey(key.code, key.key)) return;
      key.preventDefault();
      key.stopPropagation();
      const action = actionOf(key.code, key.key);
      if (action) {
        if (!key.repeat) this.onAction(action);
        return;
      }
      this.held.add(key.code);
    };
    const up = (event: Event) => {
      const key = event as KeyboardEvent;
      if (!this.held.delete(key.code)) return;
      key.preventDefault();
      key.stopPropagation();
    };
    const release = () => this.held.clear();
    const hidden = () => {
      if (document.hidden) this.held.clear();
    };
    this.listeners.push(
      [window, "keydown", down, true],
      [window, "keyup", up, true],
      [window, "blur", release, false],
      [document, "visibilitychange", hidden, false],
    );
    for (const [target, type, listener, capture] of this.listeners) target.addEventListener(type, listener, capture);
    // On a clock of its own, not the flight's: a paused flight reads no stick, and a button still resumes it.
    this.padTimer = setInterval(() => this.pressPad(), PAD_EVERY_MS);
  }

  /** A gamepad's buttons, looked at again: each that has gone down since does its action. */
  private pressPad(): void {
    const pad = standardPad();
    if (!pad) {
      this.padDown = [];
      return;
    }
    const actions = gamepadActions(pad.buttons, this.padDown);
    this.padDown = pad.buttons.map((button) => button.pressed);
    for (const action of actions) this.onAction(action);
  }

  stop(): void {
    for (const [target, type, listener, capture] of this.listeners) target.removeEventListener(type, listener, capture);
    this.listeners.length = 0;
    this.held.clear();
    this.touch = null;
    if (this.padTimer !== null) clearInterval(this.padTimer);
    this.padTimer = null;
    this.padDown = [];
  }

  /** What the keys held and the first gamepad ask, now. */
  read(): ControlInput & { warp: boolean } {
    const keys = controlInput(this.held);
    const pad = standardPad();
    if (!pad) return this.withTouch(keys);
    return this.withTouch({ ...merged(keys, gamepadInput(pad)), warp: keys.warp || Boolean(pad.buttons[0]?.pressed) });
  }

  /**
   * A third hand on the controls, beside the keys and a gamepad: a phone's
   * stick, lever and buttons on the glass (components/studio/flight/TouchControls.svelte),
   * as they stand now; null with no finger on any of them.
   */
  setTouch(input: (ControlInput & { warp: boolean }) | null): void {
    this.touch = input;
  }

  private withTouch(input: ControlInput & { warp: boolean }): ControlInput & { warp: boolean } {
    const touch = this.touch;
    return touch ? { ...merged(input, touch), warp: input.warp || touch.warp } : input;
  }

  /** Whether anything is held at all: a stick input takes the autopilot off. */
  static moving(input: ControlInput): boolean {
    return input.pitch !== 0 || input.roll !== 0 || input.yaw !== 0;
  }
}
