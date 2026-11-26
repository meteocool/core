/**
 * The flight's sound, for as long as the flight lasts: the audio context,
 * when it may play, and the mute.
 *
 * A browser lets a page make sound only once the reader has done something
 * on it. The context is the page's one (soundtrack.ts), made by then, or on
 * taking off, which is a click or a key; where it is still not allowed to
 * play, the next key or click starts it. The flight falls silent while the
 * tab is hidden, and the context is suspended then, costing nothing;
 * paused, only the soundtrack plays on, lower and darker. The mute is the
 * music's alone: the engines, the weather and the cockpit's voice play on. Leaving
 * the flight fades it out and lets go of its graph. Where there is no Web
 * Audio at all, the flight is silent and nothing else changes.
 *
 * The soundtrack plays through the flight's graph, so a recording carries
 * it; the mix sets it to the flight (soundMix.ts, `mixMusic`).
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
import { get } from "svelte/store";
import type { FlightStatus } from "../store";
import type { FlightAction } from "./controls";
import type { Telemetry } from "./pilot";
import { MUSIC_LEAVE_S, SoundGraph } from "./soundGraph";
import type { SoundCue } from "./soundGraph";
import { CalloutQueue, initialMemory, mixSound, VOLUME } from "./soundMix";
import type { Callout, SoundInput, SoundMemory, Spoken } from "./soundMix";
import { flightMuted, musicAvailable, pageAudio, plugMusic, setFlightMuted, wantMusic } from "./soundtrack";
import { ThunderClips } from "./thunderClips";
import { flightSettings } from "./settings";

/** Whether the flight's sound is off, the music's with it (soundtrack.ts); the deck shows it. */
export { flightMuted };

/** What of the flight's picture the sound follows besides the telemetry: whether it is a wreck, and where the eye outside is. */
export interface SoundScene {
  ended: boolean;
  orbit: number;
  /** How far the eye outside is from the aircraft, metres. */
  eye: number;
  /** Which aircraft this is, counting each start again (the next approach, a restart). */
  flight: number;
}

/** How long a pause's or a mute's fade takes before the context is suspended, ms. */
const SUSPEND_MS = 320;
/** How long leaving fades out before the graph is let go, ms: the music's fade, the longest. */
const CLOSE_MS = MUSIC_LEAVE_S * 1000 + 200;

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
  /** How far off the nearest strike is whose thunder arrived since the last frame, metres; null where none did. */
  private strike: number | null = null;
  /** The thunder's recordings, streamed from the flight's start; null where there can be none. */
  private clips: ThunderClips | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  /** The cockpit's voice: whose turn it is, what the browser is saying for it now, and whether the browser cannot speak after all. */
  private readonly voice = new CalloutQueue();
  private utterance: SpeechSynthesisUtterance | null = null;
  /** Whether the voice, or a tone in its place, is saying a callout now: the music goes down under it. */
  private saying = false;
  /** Takes the soundtrack out of the graph again. */
  private unplug: (() => void) | null = null;
  private unlevel: (() => void) | null = null;
  /** How loud the calls are said, of their own loudness: the reader's level for the flight's sounds. */
  private voiceVolume = 1;
  private voiceless = typeof speechSynthesis === "undefined";
  private readonly listeners: Array<[EventTarget, string, EventListener, boolean]> = [];

  constructor() {
    try {
      this.context = pageAudio();
      if (!this.context) return;
      // Everything goes out through one node, so that a recording can listen at it too; see `stream`.
      this.out = this.context.createGain();
      this.out.connect(this.context.destination);
      this.graph = new SoundGraph(this.context, this.out);
      this.unplug = plugMusic(this.graph.musicInputs());
      // As loud as the reader has set it, from the first sound on.
      const graph = this.graph;
      this.unlevel = flightSettings.subscribe(({ musicVolume, soundVolume }) => {
        graph.setUserLevels(musicVolume, soundVolume);
        this.voiceVolume = soundVolume;
      });
    } catch {
      this.out?.disconnect();
      this.context = null;
      this.graph = null;
      return;
    }
    try {
      if (typeof Audio !== "undefined") this.clips = new ThunderClips(this.context, this.graph.thunderInput());
    } catch {
      this.clips = null;
    }
    this.graph.useRecordedThunder(this.clips);
    // A key or a click is what lets a page play; any of them may be the one.
    const wake = (event: Event) => {
      if (event.type !== "visibilitychange") this.clips?.unlock();
      this.sync();
    };
    this.listeners.push(
      [window, "keydown", wake, true],
      [window, "pointerdown", wake, true],
      [document, "visibilitychange", wake, false],
    );
    for (const [target, type, listener, capture] of this.listeners) target.addEventListener(type, listener, capture);
    this.sync();
    this.prime();
    this.clips?.unlock();
    // Heard as soon as the context runs, which may be a moment after it is made.
    if (this.wanted()) this.graph.cue("takeoff");
  }

  /** A frame of the flight, after it has flown: set the sound to it. */
  update(telemetry: Telemetry, status: FlightStatus, dt: number, scene?: SoundScene): void {
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
      cloud: telemetry.cloud,
      severity: telemetry.severity,
      hail: telemetry.hail,
      speaking: this.saying,
      lost: status.lost.length,
      ended: scene?.ended ?? Boolean(state.crash),
      orbit: scene?.orbit,
      eye: scene?.eye,
      flight: scene?.flight,
    };
    this.strike = null;
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
      // Heard as the flight was before the pause: once paused, its own sounds are not.
      const heard = this.playing();
      this.paused = status.paused;
      if (this.paused) {
        // The click first, then the rest fades: the soundtrack on, lower, or the context suspended.
        if (heard) this.graph.cue("pause");
        this.graph.setWorld(0);
        this.silence();
      }
      this.graph.setMusicPaused(this.paused);
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

  /** A strike's thunder arriving, from so far off, metres: heard whether or not a flash was drawn for it. */
  strikeNear(metres: number): void {
    this.strike = Math.min(this.strike ?? Infinity, metres);
  }

  /** M: the music off, or on again; remembered for the next flight. The flight's own sounds stay. */
  toggleMute(): void {
    this.muted = !this.muted;
    setFlightMuted(this.muted);
    this.sync();
    if (!this.muted && this.playing()) this.graph?.cue("unmute");
  }

  /**
   * Leave: fade out, and let go of the graph. The context is the page's and
   * stays: the plan's music takes up where the flight leaves off.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [target, type, listener, capture] of this.listeners) target.removeEventListener(type, listener, capture);
    this.listeners.length = 0;
    this.silence();
    this.unlevel?.();
    this.unlevel = null;
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    wantMusic(false);
    const { context, graph, out } = this;
    if (!context || !graph || !out) return;
    graph.leave();
    setTimeout(() => {
      this.unplug?.();
      this.unplug = null;
      this.clips?.dispose();
      this.clips = null;
      graph.dispose();
      out.disconnect();
      this.tap?.disconnect();
      this.tap = null;
    }, CLOSE_MS);
  }

  /** Whether the context should run: something is to be heard, the flight's sounds or, paused, the soundtrack. */
  private wanted(): boolean {
    return !this.disposed && !(typeof document !== "undefined" && document.hidden)
      && (!this.paused || (musicAvailable() && !this.muted));
  }

  /** Whether the flight's own sounds are heard now. */
  private playing(): boolean {
    return this.wanted() && !this.paused && this.context?.state === "running";
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
    wantMusic(this.wanted() && !this.muted);
    if (this.wanted()) {
      if (context.state !== "running") void context.resume().catch(() => undefined);
      graph.setWorld(this.paused ? 0 : 1);
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
   * or key is still being handled: Safari lets a page speak only once it
   * has from one, and the first words are slow to come there.
   */
  private prime(): void {
    // Only Safari's is so strict; elsewhere, on a Mac, a voice that speaks opens its own stream, and its opening clicks.
    if (this.voiceless || !/Apple/.test(navigator.vendor ?? "")) return;
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
    this.saying = true;
    const over = () => {
      this.saying = false;
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
        utterance.volume = 0.6 * this.voiceVolume;
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
    this.saying = false;
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
