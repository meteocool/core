/**
 * The flight's sound, for as long as the flight lasts: the audio context,
 * when it may play, and the mute.
 *
 * A browser lets a page make sound only once the reader has done something
 * on it, so the context is made on taking off, which is a click or a key.
 * Where it is still not allowed to play, the next key or click starts it.
 * It falls silent while the flight is paused, while the tab is hidden and
 * while muted, and is suspended then, costing nothing; leaving the flight
 * fades it out and closes it. Where there is no Web Audio at all, the
 * flight is silent and nothing else changes.
 *
 * What it plays is the mix's (soundMix.ts) made audible by the graph
 * (soundGraph.ts). The terrain warning also says "pull up" between its
 * whoops, where the browser can speak.
 */
import { get, writable } from "svelte/store";
import type { FlightStatus } from "../store";
import type { FlightAction } from "./controls";
import type { Telemetry } from "./pilot";
import { SoundGraph } from "./soundGraph";
import type { SoundCue } from "./soundGraph";
import { initialMemory, mixSound, VOLUME } from "./soundMix";
import type { SoundInput, SoundMemory } from "./soundMix";

/** Whether the reader turned the flight's sound off: kept for the next flight too. */
const MUTED_KEY = "studioFlightMuted";

function storedMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the flight's sound is off; the deck shows it. */
export const flightMuted = writable(storedMuted());

/** How long a pause's or a mute's fade takes before the context is suspended, ms. */
const SUSPEND_MS = 320;
/** How long leaving fades out before the context is closed, ms. */
const CLOSE_MS = 450;

/** The interface's sound for an action, if it has one. */
const CUES: Partial<Record<FlightAction, SoundCue>> = {
  view: "view", style: "style", inspect: "style", next: "next", restart: "restart", help: "help",
};

/** The heights called out on the way down, metres, and as they are said: 500, 100, 50, 30, 20 and 10 ft. */
const HEIGHT_CALLS: Array<[number, string]> = [
  [152.4, "Five hundred"], [30.5, "One hundred"], [15.2, "Fifty"], [9.1, "Thirty"], [6.1, "Twenty"], [3, "Ten"],
];
const RETARD_M = 6.1;
/** What is said as a warning starts, besides what it sounds like. */
const WARNING_WORDS: Array<[FlightStatus["warnings"][number], string]> = [["gear", "Too low, gear"], ["sink", "Sink rate"]];

export class FlightSound {
  private readonly context: AudioContext | null = null;
  private readonly graph: SoundGraph | null = null;
  private memory: SoundMemory | null = null;
  private muted = get(flightMuted);
  private paused = false;
  private disposed = false;
  private readonly out: GainNode | null = null;
  private tap: MediaStreamAudioDestinationNode | null = null;
  private strike = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  /** The speech of the terrain warning: whether one of ours is under way, and which cycle of whoops is next to be spoken after. */
  private speaking = false;
  private terrainCycles = 0;
  /** The height over the ground a frame ago, metres, and what was being warned of then: what is said is said on passing. */
  private heightBefore = Infinity;
  private warnedOf: FlightStatus["warnings"] = [];
  private readonly listeners: Array<[EventTarget, string, EventListener, boolean]> = [];

  constructor() {
    try {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      this.context = new Context({ latencyHint: "interactive" });
      // Everything goes out through one node, so that a recording can listen at it too; see `stream`.
      this.out = this.context.createGain();
      this.out.connect(this.context.destination);
      this.graph = new SoundGraph(this.context, this.out);
    } catch {
      this.context = null;
      this.graph = null;
      return;
    }
    this.graph.onTerrainCycle = (at) => this.sayPullUp(at);
    // A key or a click is what lets a page play; any of them may be the one.
    const wake = () => this.sync();
    this.listeners.push(
      [window, "keydown", wake, true],
      [window, "pointerdown", wake, true],
      [document, "visibilitychange", wake, false],
    );
    for (const [target, type, listener, capture] of this.listeners) target.addEventListener(type, listener, capture);
    this.sync();
    // Heard as soon as the context runs, which may be a moment after it is made.
    if (this.wanted()) this.graph.cue("takeoff");
  }

  /** A frame of the flight, after it has flown: set the sound to it. */
  update(telemetry: Telemetry, status: FlightStatus, dt: number): void {
    if (!this.graph || this.disposed) return;
    const { state } = telemetry;
    const input: SoundInput = {
      // Behind the reversers the engines run up again, whatever the lever says.
      throttle: Math.max(state.throttle, 0.7 * state.reverse),
      ias: telemetry.ias,
      mach: telemetry.mach,
      dbz: telemetry.dbz,
      rain: telemetry.rain,
      turbulence: telemetry.turbulence,
      flash: telemetry.flash,
      strike: this.strike,
      brake: telemetry.brake,
      fade: telemetry.fade,
      storm: telemetry.target ? { peakDbz: telemetry.target.peakDbz, distance: telemetry.target.distance } : null,
      gear: telemetry.gear,
      flaps: state.flaps,
      rolling: state.onGround ? state.tas : 0,
    };
    this.strike = false;
    this.callOut(telemetry, status);
    this.memory ??= initialMemory(input, status);
    const { levels, events, memory } = mixSound(this.memory, input, status, this.muted, dt);
    this.memory = memory;
    // A context not playing would only pile the sounds up for when it does.
    if (!this.playing()) return;
    this.graph.set(levels);
    for (const event of events) this.graph.play(event);
    if (!levels.alerts.terrain) this.terrainCycles = 0;
    if (!levels.alerts.terrain && this.speaking) this.silence();
  }

  /** What the reader did: its click, and a pause's or a recording's sound. */
  act(action: FlightAction, status: FlightStatus): void {
    if (!this.graph || this.disposed) return;
    if (action === "pause") {
      this.paused = status.paused;
      if (this.paused) {
        // The click first, then the rest fades and the context is suspended.
        if (this.playing()) this.graph.cue("pause");
        this.graph.setWorld(0);
        this.silence();
      }
      this.sync();
      if (!this.paused && this.playing()) this.graph.cue("resume");
      return;
    }
    if (action === "record") {
      if (this.playing()) this.graph.cue(status.recording ? "recordStart" : "recordStop");
      return;
    }
    const cue = CUES[action];
    if (cue && this.playing()) this.graph.cue(cue);
  }

  /**
   * The flight's sound as a stream, for a video of the flight to carry: all
   * of it, as it is heard. Null where there is no sound to give.
   */
  stream(): MediaStream | null {
    if (!this.context || !this.out || this.disposed) return null;
    if (!this.tap) {
      this.tap = this.context.createMediaStreamDestination();
      this.out.connect(this.tap);
    }
    return this.tap.stream;
  }

  /** The wheels meeting the ground: how hard, m/s, and whether that was the end of the flight. */
  touchdown(sink: number, crash: boolean): void {
    if (!this.graph || !this.playing()) return;
    const strength = crash ? 1.6 : Math.min(1.4, 0.45 + sink / 4);
    this.graph.play({ kind: "thump", strength });
    this.graph.play({ kind: "rattle", strength: Math.min(1, strength) });
    if (sink > 1.5 || crash) this.graph.play({ kind: "creak", strength: 1 });
  }

  /**
   * What an airliner says on the way down to a landing, in the cockpit: the
   * height over the ground as it passes five hundred, a hundred, fifty,
   * thirty, twenty and ten feet with the gear down, "retard" at twenty with
   * the engines still pulling, and what it warns of low down, once each time
   * it starts to.
   */
  private callOut(telemetry: Telemetry, status: FlightStatus): void {
    const height = telemetry.state.onGround ? 0 : (telemetry.radarAltitude ?? Infinity);
    const before = this.heightBefore;
    this.heightBefore = height;
    const warned = this.warnedOf;
    this.warnedOf = status.warnings;
    if (status.view !== "cockpit" || !this.playing()) return;
    for (const [warning, words] of WARNING_WORDS) {
      if (status.warnings.includes(warning) && !warned.includes(warning)) this.say(words);
    }
    if (telemetry.gear < 1 || height >= before) return;
    for (const [metres, words] of HEIGHT_CALLS) {
      if (before > metres && height <= metres) {
        this.say(words);
        if (metres === RETARD_M && telemetry.state.throttle > 0.05) this.say("Retard");
      }
    }
  }

  /** Say a few words, in whatever voice the browser has; nothing where it has none. */
  private say(words: string): void {
    if (typeof speechSynthesis === "undefined") return;
    try {
      const utterance = new SpeechSynthesisUtterance(words);
      utterance.lang = "en-US";
      utterance.rate = 1.2;
      utterance.pitch = 0.8;
      utterance.volume = 0.6;
      utterance.onend = () => { this.speaking = false; };
      utterance.onerror = () => { this.speaking = false; };
      this.speaking = true;
      speechSynthesis.speak(utterance);
    } catch {
      // No voice here.
    }
  }

  /** A strike nearby: thunder, whether or not a flash was drawn for it. */
  strikeNear(): void {
    this.strike = true;
  }

  /** M: sound off, or on again; remembered for the next flight. */
  toggleMute(): void {
    this.muted = !this.muted;
    flightMuted.set(this.muted);
    try {
      if (this.muted) localStorage.setItem(MUTED_KEY, "1");
      else localStorage.removeItem(MUTED_KEY);
    } catch {
      // Storage blocked: muted for this flight only.
    }
    if (this.muted) this.silence();
    this.sync();
    if (!this.muted && this.playing()) this.graph?.cue("unmute");
  }

  /** Leave: fade out, and close the context. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [target, type, listener, capture] of this.listeners) target.removeEventListener(type, listener, capture);
    this.listeners.length = 0;
    this.silence();
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    const { context, graph } = this;
    if (!context || !graph) return;
    graph.onTerrainCycle = null;
    graph.setVolume(0, context.currentTime, 0.08);
    setTimeout(() => {
      graph.dispose();
      void context.close().catch(() => undefined);
    }, CLOSE_MS);
  }

  /** Whether the sound may be heard now. */
  private wanted(): boolean {
    return !this.disposed && !this.paused && !this.muted && !(typeof document !== "undefined" && document.hidden);
  }

  private playing(): boolean {
    return this.wanted() && this.context?.state === "running";
  }

  /**
   * Play or fall silent as the flight is now: resume the context and bring
   * the sound up, or fade it out and suspend the context once it is quiet.
   */
  private sync(): void {
    const { context, graph } = this;
    if (!context || !graph || this.disposed) return;
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (this.wanted()) {
      if (context.state !== "running") void context.resume().catch(() => undefined);
      graph.setWorld(1);
      graph.setVolume(VOLUME, context.currentTime, 0.12);
      return;
    }
    if (context.state !== "running") return;
    // A pause's click is let finish before the volume goes.
    graph.setVolume(0, context.currentTime + (this.paused ? 0.15 : 0), 0.04);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (!this.wanted()) void context.suspend().catch(() => undefined);
    }, SUSPEND_MS);
  }

  /** The terrain warning's voice, after every other pair of whoops: "pull up". */
  private sayPullUp(at: number): void {
    const context = this.context;
    if (!context || typeof speechSynthesis === "undefined" || this.terrainCycles++ % 2 !== 0) return;
    const delay = Math.max(0, (at + 1.05 - context.currentTime) * 1000);
    setTimeout(() => {
      if (!this.playing() || this.terrainCycles === 0) return;
      try {
        const utterance = new SpeechSynthesisUtterance("Pull up");
        utterance.lang = "en-US";
        utterance.rate = 1.15;
        utterance.pitch = 0.8;
        utterance.volume = 0.6;
        utterance.onend = () => { this.speaking = false; };
        utterance.onerror = () => { this.speaking = false; };
        this.speaking = true;
        speechSynthesis.speak(utterance);
      } catch {
        // No voice here: the whoops say it alone.
      }
    }, delay);
  }

  /** Stop the warning's voice, if it is ours that is speaking. */
  private silence(): void {
    if (!this.speaking) return;
    this.speaking = false;
    try {
      speechSynthesis.cancel();
    } catch {
      // Nothing to stop.
    }
  }
}
