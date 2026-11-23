/**
 * Thunder as it was recorded: field recordings of real storms, streamed as
 * the soundtrack is (soundtrack.ts), each from a media element of its own
 * into the flight's thunder (soundGraph.ts), which hears them as the view
 * does. Which one plays goes by how far off the thunder is:
 *
 * - close by: a heavy strike, its crack and the rolling after it;
 * - a few kilometres off: a softer crack that rolls away sooner;
 * - further: a long roll with hardly a crack in it;
 * - far: low rumbles, as from a storm on the horizon.
 *
 * Each plays to its end, the crackling and the last of the roll with it; a
 * clip still loud is not cut off for the next, which takes one from the
 * band beside it instead. Where none is free, or the files cannot be had,
 * or there is no media element at all, the graph's own thunder plays, and
 * always for a strike right by the aircraft deep in a storm's core: one
 * blast, with no ground nearby to roll it.
 *
 * Every file is a recording from freesound.org dedicated to the public
 * domain (CC0 1.0), trimmed, its level set, a fade at its end:
 * close 446753 by BlueDelta, near 534023 by Fission9, roll 367702 by
 * BlueDelta, far 1–3 361401 by richwise, far 4 347562 by mikala_oidua.
 */

const AUDIO = `${import.meta.env?.BASE_URL ?? "/"}audio/`;

export type ThunderClipName = "close" | "near" | "roll" | "far1" | "far2" | "far3" | "far4";

/**
 * Each recording: where it is served from; its level, to sit with the rest
 * as loud as the graph's own thunder from as far (each file peaks at full
 * scale, but a crack that dies away fast is quieter than a long roll); and
 * for how long from its start it is loud enough that starting it over for
 * the next thunder would be heard as a cut, seconds: after that its tail
 * may give way.
 */
export const THUNDER_CLIPS: Record<ThunderClipName, { url: string; level: number; loud: number }> = {
  close: { url: `${AUDIO}thunder-close.mp3`, level: 1.4, loud: 12 },
  near: { url: `${AUDIO}thunder-near.mp3`, level: 2.4, loud: 7 },
  roll: { url: `${AUDIO}thunder-roll.mp3`, level: 1.5, loud: 16 },
  far1: { url: `${AUDIO}thunder-far-1.mp3`, level: 1, loud: 18 },
  far2: { url: `${AUDIO}thunder-far-2.mp3`, level: 1.05, loud: 25 },
  far3: { url: `${AUDIO}thunder-far-3.mp3`, level: 1.25, loud: 20 },
  far4: { url: `${AUDIO}thunder-far-4.mp3`, level: 1.8, loud: 10 },
};

/** The bands, nearest first: up to which distance (0 to 1, the mix's) each is heard, and its recordings. */
const BANDS: ReadonlyArray<{ below: number; clips: readonly ThunderClipName[] }> = [
  { below: 0.16, clips: ["close"] },
  { below: 0.42, clips: ["near"] },
  { below: 0.72, clips: ["roll"] },
  { below: Infinity, clips: ["far1", "far2", "far3", "far4"] },
];

/** The ones fetched as soon as the flight starts: short, and wanted at once when a strike is close. */
const EAGER: readonly ThunderClipName[] = ["close", "near"];

/**
 * Which recording a thunder plays, so far off (0 to 1): one of its band's
 * that is free; else the next band's further off, else the next nearer;
 * null for the graph's own (deep in a core, or nothing free).
 */
export function pickThunder(
  distance: number, deep: boolean, free: (name: ThunderClipName) => boolean, random: () => number = Math.random,
): ThunderClipName | null {
  if (deep) return null;
  const at = BANDS.findIndex(({ below }) => distance < below);
  for (const index of [at, at + 1, at - 1]) {
    const choices = BANDS[index]?.clips.filter(free) ?? [];
    if (choices.length) return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
  }
  return null;
}

/** How a recording is heard from so far, 0 to 1: its level, and the low-pass the air puts on it, Hz. */
export function thunderHeard(distance: number, strength: number): { gain: number; cutoff: number } {
  const d = Math.min(1, Math.max(0, distance));
  return { gain: strength * (1 - 0.65 * d), cutoff: 400 + 14_000 * (1 - d) ** 2.5 };
}

/** One recording's element and its way into the thunder: its low-pass, level and side. */
interface Clip {
  element: HTMLAudioElement;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  /** Whether it cannot be had (the network, mostly): passed over this flight. */
  failed: boolean;
  /** Whether a click or a key has let it play, as Safari wants before it plays one unasked. */
  primed: boolean;
  /** Whether a thunder is playing it, not the click's priming. */
  sounding: boolean;
}

/** How quickly a recording still sounding is taken down before it starts over, seconds (a time constant). */
const DUCK_S = 0.012;
/** How far ahead of the context's clock a change is scheduled, seconds. */
const LEAD_S = 0.03;

export class ThunderClips {
  private readonly clips = new Map<ThunderClipName, Clip>();
  private disposed = false;
  private readonly context: AudioContext;

  constructor(context: AudioContext, into: AudioNode) {
    this.context = context;
    for (const [name, { url }] of Object.entries(THUNDER_CLIPS) as Array<[ThunderClipName, { url: string }]>) {
      const element = new Audio();
      element.preload = EAGER.includes(name) ? "auto" : "metadata";
      // Pitched as well as slowed by the rate it is played at: a little different each time.
      element.preservesPitch = false;
      (element as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = false;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 0.6;
      const gain = context.createGain();
      gain.gain.value = 0;
      const pan = context.createStereoPanner();
      context.createMediaElementSource(element).connect(filter).connect(gain).connect(pan).connect(into);
      const clip: Clip = { element, filter, gain, pan, failed: false, primed: false, sounding: false };
      element.addEventListener("ended", () => {
        clip.sounding = false;
      });
      element.addEventListener("error", () => {
        if (!element.error || this.disposed) return;
        console.warn("A thunder recording did not load", name, element.error);
        clip.failed = true;
      });
      element.src = url;
      this.clips.set(name, clip);
    }
  }

  /** In a click or a key: what lets every element play from now on, unheard (its level is nothing then). */
  unlock(): void {
    for (const clip of this.clips.values()) {
      if (clip.primed || clip.failed || !clip.element.paused) continue;
      clip.primed = true;
      const { element } = clip;
      void element.play().then(() => {
        if (clip.sounding) return;
        element.pause();
        element.currentTime = 0;
      }, () => {
        clip.primed = false;
      });
    }
  }

  /**
   * Play the thunder so far off (0 to 1), so strong, if a recording is free
   * for it; false where the graph's own is to play instead.
   */
  play(distance: number, strength: number, deep: boolean): boolean {
    if (this.disposed) return false;
    const name = pickThunder(distance, deep, (each) => this.free(each));
    const clip = name && this.clips.get(name);
    if (!clip) return false;
    const { element, gain, filter, pan } = clip;
    const heard = thunderHeard(distance, strength);
    const at = this.context.currentTime + LEAD_S;
    const start = () => {
      if (this.disposed) return;
      clip.sounding = true;
      element.playbackRate = 0.9 + 0.14 * Math.random();
      element.currentTime = 0;
      const now = this.context.currentTime + LEAD_S;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(heard.gain * THUNDER_CLIPS[name].level, now);
      filter.frequency.cancelScheduledValues(now);
      filter.frequency.setValueAtTime(heard.cutoff, now);
      // From one side, drifting across as it rolls.
      const side = Math.random() * 1.2 - 0.6;
      pan.pan.cancelScheduledValues(now);
      pan.pan.setValueAtTime(side, now);
      pan.pan.linearRampToValueAtTime(-side * 0.5, now + 20);
      void element.play().catch(() => {
        // Not let play yet: the next click or key does.
        clip.primed = false;
        clip.sounding = false;
      });
    };
    if (this.playing(clip)) {
      // Its quiet tail gives way: taken down first, so the jump back to its start is not heard.
      gain.gain.cancelScheduledValues(at);
      gain.gain.setTargetAtTime(0, at, DUCK_S);
      setTimeout(start, (LEAD_S + DUCK_S * 4) * 1000);
    } else {
      start();
    }
    return true;
  }

  /** Stop them all, and let go of the elements. */
  dispose(): void {
    this.disposed = true;
    for (const { element, pan } of this.clips.values()) {
      element.pause();
      element.removeAttribute("src");
      element.load();
      pan.disconnect();
    }
    this.clips.clear();
  }

  private playing(clip: Clip): boolean {
    return clip.sounding && !clip.element.paused && !clip.element.ended;
  }

  /** Whether a recording may play the next thunder: it is there, and not in its loud part now. */
  private free(name: ThunderClipName): boolean {
    const clip = this.clips.get(name);
    if (!clip || clip.failed || !clip.primed) return false;
    return !this.playing(clip) || clip.element.currentTime > THUNDER_CLIPS[name].loud;
  }
}
