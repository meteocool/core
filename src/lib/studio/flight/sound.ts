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
 * (soundGraph.ts); what the reader has silenced (alarms.ts) the mix leaves
 * out. The cockpit's callouts ("bank angle", "pull up",
 * "retard", the heights) are spoken with the browser's own voice, where it
 * has one: one at a time, in the order the mix's queue gives them, a
 * warning cutting a lesser callout off. Where it has none, each is a short
 * tone instead. The browser's voice is not part of the graph, so a
 * recording of the flight carries the tones and the whoops but not the
 * words.
 */
import { get, writable } from "svelte/store";
import type { FlightStatus } from "../store";
import type { FlightAction } from "./controls";
import type { Telemetry } from "./pilot";
import { SoundGraph } from "./soundGraph";
import type { SoundCue } from "./soundGraph";
import { CalloutQueue, initialMemory, mixSound, VOLUME } from "./soundMix";
import type { Callout, SoundInput, SoundMemory, Spoken } from "./soundMix";

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

/** The interface's sound for an action, if it has one: a master light pressed clicks as a key does. */
const CUES: Partial<Record<FlightAction, SoundCue>> = {
  view: "view", style: "style", inspect: "style", next: "next", restart: "restart", help: "help", silence: "help",
};

/** How long a tone in place of a callout takes, ms: the voice's turn passes on after it. */
const TONE_MS = 450;
/** The ways a browser's voice fails that are not its being cut off: after one of them it is not asked again. */
const INTERRUPTED = ["interrupted", "canceled"];

/** Now, in seconds: the clock the callouts' turns are kept on. */
const seconds = () => performance.now() / 1000;

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
  /** The cockpit's voice: whose turn it is, what the browser is saying for it now, and whether the browser cannot speak after all. */
  private readonly voice = new CalloutQueue();
  private utterance: SpeechSynthesisUtterance | null = null;
  private voiceless = typeof speechSynthesis === "undefined";
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
    // A key or a click is what lets a page play; any of them may be the one.
    const wake = () => this.sync();
    this.listeners.push(
      [window, "keydown", wake, true],
      [window, "pointerdown", wake, true],
      [document, "visibilitychange", wake, false],
    );
    for (const [target, type, listener, capture] of this.listeners) target.addEventListener(type, listener, capture);
    this.sync();
    this.prime();
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
      lever: state.throttle,
      height: telemetry.radarAltitude ?? Infinity,
      sink: -state.verticalSpeed,
      onGround: state.onGround,
    };
    this.strike = false;
    this.memory ??= initialMemory(input, status);
    const { levels, events, callouts, quiet, memory } = mixSound(this.memory, input, status, this.muted, dt);
    this.memory = memory;
    // A context not playing would only pile the sounds up for when it does.
    if (!this.playing()) return;
    this.graph.set(levels);
    for (const event of events) this.graph.play(event);
    const now = seconds();
    for (const kind of quiet) this.speak(this.voice.drop(kind, now));
    for (const callout of callouts) this.speak(this.voice.push(callout, now));
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
   * The airframe giving way: a wing or the tail tearing off, 0 to 1 by how
   * much of it goes. Heard in every view.
   */
  breakup(strength: number): void {
    if (!this.graph || !this.playing()) return;
    this.graph.play({ kind: "breakup", strength });
  }

  /** An explosion: the aircraft meeting the ground for good, 0 to 1 by how large. Heard in every view. */
  explosion(strength: number): void {
    if (!this.graph || !this.playing()) return;
    this.graph.play({ kind: "explosion", strength });
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
    this.silence();
    if (context.state !== "running") return;
    // A pause's click is let finish before the volume goes.
    graph.setVolume(0, context.currentTime + (this.paused ? 0.15 : 0), 0.04);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (!this.wanted()) void context.suspend().catch(() => undefined);
    }, SUSPEND_MS);
  }

  /**
   * Have the browser's voice say nothing, now, while the take-off's click
   * or key is still being handled: some browsers let a page speak only
   * once it has from one, and the first words are slow to come anywhere.
   */
  private prime(): void {
    if (this.voiceless) return;
    try {
      const utterance = new SpeechSynthesisUtterance(" ");
      utterance.volume = 0;
      speechSynthesis.speak(utterance);
    } catch {
      this.voiceless = true;
    }
  }

  /** Do as the callouts' queue says: stop what is being said, and say the next. */
  private speak({ cut, say }: Spoken): void {
    if (cut) this.stopSpeaking();
    if (say) this.utter(say);
  }

  /**
   * Say a callout in whatever voice the browser has, and pass the turn on
   * when it is over; a tone through the graph where it has none.
   */
  private utter(callout: Callout): void {
    const over = () => {
      if (this.disposed) return;
      const next = this.voice.done(callout, seconds());
      // What waited is only worth saying while the sound plays.
      if (this.playing()) this.speak(next);
      else this.silence();
    };
    if (!this.voiceless) {
      try {
        const utterance = new SpeechSynthesisUtterance(callout.words);
        utterance.lang = "en-US";
        utterance.rate = 1.2;
        utterance.pitch = 0.8;
        utterance.volume = 0.6;
        utterance.onend = () => {
          if (this.utterance !== utterance) return;
          this.utterance = null;
          over();
        };
        utterance.onerror = (event) => {
          if (!INTERRUPTED.includes(event.error)) this.voiceless = true;
          if (this.utterance !== utterance) return;
          this.utterance = null;
          over();
        };
        // Held on to until it ends: a browser may drop one nothing refers to, and never say it ended.
        this.utterance = utterance;
        speechSynthesis.speak(utterance);
        return;
      } catch {
        this.utterance = null;
        this.voiceless = true;
      }
    }
    this.graph?.play({ kind: "attention", rank: callout.rank });
    setTimeout(over, TONE_MS);
  }

  /** Stop the browser's voice, if it is one of ours it is saying. */
  private stopSpeaking(): void {
    if (!this.utterance) return;
    this.utterance = null;
    try {
      speechSynthesis.cancel();
    } catch {
      // Nothing to stop.
    }
  }

  /** Nothing more is said: what is being said is cut off, and what waited is forgotten. */
  private silence(): void {
    this.voice.clear();
    this.stopSpeaking();
  }
}
