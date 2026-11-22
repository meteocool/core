/**
 * The soundtrack, and the switch for all of the flight's sound, which the
 * menus share. Four files: the menus' own piece (the meteoair page and the
 * flight's plan); the flight's theme and a second one; and a suspenseful
 * one, which the flight's mix brings up under the flight's music when the
 * flight gets difficult (soundMix.ts: `tension`). The flight's music takes
 * the two themes and the menus' piece in turn (`FLIGHT_ROTATION`), and always
 * opens with the theme, so that a flight never starts on what the menus
 * played up to it.
 *
 * Streamed, never decoded whole: a piece as floats would be 60 MB and more,
 * far more than a phone should spend on music. Each file is fetched once
 * (preload.ts) and played from memory by a media element, whose sound goes
 * into the page's one audio context. Two elements take turns at each piece:
 * the next time round, or the next piece in turn, starts a few seconds before
 * it ends, under its closing fade, so it goes on without a gap.
 *
 * A browser lets a page play only once the reader has clicked or pressed a
 * key on it: the context is made and the elements are woken on the first
 * one. Where there is no Web Audio, or a file cannot be had, that music is
 * not played and nothing else changes.
 *
 * Two listen. A menu, to its own piece, through a fade of its own
 * (`claimMenuMusic`): in as a menu comes up, out as the last one goes. And
 * the flight, whose sound (sound.ts) takes its music and the suspenseful
 * piece into its own graph and sets them to the flight. The suspenseful
 * piece plays for as long as the flight's sound does, silent until the mix
 * wants it, so it rises out of nothing rather than starting. Taking off, the
 * menu's piece fades out across the loading and the take-off, and the theme
 * comes up as the flight begins; leaving, the flight's music goes with the
 * flight and the plan brings the menu's piece back.
 *
 * Small and free of the flight's code: the meteoair page loads it to play
 * while the reader reads.
 */
import { get, writable } from "svelte/store";

export type PieceName = "menu" | "theme" | "theme2" | "tension";

/**
 * Where each file is served from; its size, bytes, which its loading is
 * counted against until the server says; and how long before its end what
 * follows it begins, seconds: inside its own closing fade.
 */
const AUDIO = `${import.meta.env?.BASE_URL ?? "/"}audio/`;
export const SOUNDTRACK: Record<PieceName, { url: string; bytes: number; overlap: number }> = {
  menu: { url: `${AUDIO}menu.mp3`, bytes: 3_173_421, overlap: 4 },
  theme: { url: `${AUDIO}theme.mp3`, bytes: 2_560_128, overlap: 3.5 },
  theme2: { url: `${AUDIO}theme-2.mp3`, bytes: 3_316_269, overlap: 4 },
  tension: { url: `${AUDIO}tension.mp3`, bytes: 5_033_616, overlap: 4 },
};

/**
 * The flight's music, in the order it plays, round again: the theme first,
 * always, then the second, then the menus' piece, as far from the take-off
 * as it can be. A file not had (yet) is passed over.
 */
export const FLIGHT_ROTATION: readonly PieceName[] = ["theme", "theme2", "menu"];

/**
 * Which of a rotation's files follows the one at `from`: the next that has
 * come, round again; `from` itself where no other has.
 */
export function nextInRotation(from: number, had: readonly boolean[]): number {
  for (let step = 1; step <= had.length; step++) {
    const index = (from + step) % had.length;
    if (had[index]) return index;
  }
  return from;
}

/** Where a rotation opens: its first file that has come, or its first. */
export function rotationOpening(had: readonly boolean[]): number {
  return Math.max(0, had.indexOf(true));
}

/** Whether the reader turned the music off: kept for the next visit too. */
const MUTED_KEY = "studioFlightMuted";

function storedMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the music is off, the menus' and the flight's; the flight's own sounds are not. The deck and the menus show it. */
export const flightMuted = writable(storedMuted());

/** Turn the music off, or on again; remembered. */
export function setFlightMuted(muted: boolean): void {
  flightMuted.set(muted);
  try {
    if (muted) localStorage.setItem(MUTED_KEY, "1");
    else localStorage.removeItem(MUTED_KEY);
  } catch {
    // Storage blocked: for this visit only.
  }
}

/** Whether the page may not play yet: until the reader's first click or key on it lets it. */
export const soundLocked = writable(true);

/** How quickly the next time round comes in under the end of the last (a time constant, seconds). */
const LOOP_IN_S = 0.5;
/** A menu's music: how loud, and how quickly it comes in and goes (time constants, seconds). */
const MENU_LEVEL = 0.3;
const MENU_IN_S = 1;
const MENU_OUT_S = 0.8;
/**
 * How long the music plays on with no one listening before it stops, ms:
 * long enough for a fade to finish, and for the next menu to take it up.
 */
const REST_MS = 2500;
/** How often the end of a piece is looked out for, ms. */
const LOOP_WATCH_MS = 250;
/**
 * How far ahead of the context's clock a change is scheduled, seconds: its
 * audio thread runs ahead of the clock the page reads (soundGraph.ts).
 */
const LEAD_S = 0.03;

const hidden = () => typeof document !== "undefined" && document.hidden;

/** Whether the browser has Web Audio at all: where it has not, there is nothing to switch. */
export function soundAvailable(): boolean {
  return typeof window !== "undefined"
    && Boolean(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
}

let context: AudioContext | null | undefined;

/**
 * The page's one audio context, made on first asking; null where there is
 * no Web Audio. Made outside a click or a key, it waits, suspended, for one.
 */
export function pageAudio(): AudioContext | null {
  if (context !== undefined) return context;
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    context = Context ? new Context({ latencyHint: "interactive" }) : null;
  } catch {
    context = null;
  }
  return context;
}

type Listener = "menu" | "flight";

/** One of a piece's two elements, the file in it (its place in the piece's rotation), and its share of the piece: the one playing at 1, the one waiting at 0. */
interface Deck {
  element: HTMLAudioElement;
  gain: GainNode;
  file: number;
}

/**
 * A piece: one file looped, or several in turn (`FLIGHT_ROTATION`); two
 * media elements taking turns at it, into one node.
 */
class Piece {
  private decks: Deck[] = [];
  private out: GainNode | null = null;
  /** Which deck is playing the piece; and whether the other has begun what follows under its end. */
  private front = 0;
  private overlap = false;
  /** Each file of the rotation, in memory, once it has come. */
  private readonly srcs: Array<string | null>;
  /** Whether each element has been played once from a click or a key, as Safari wants before it plays one unasked. */
  private primed = false;
  private on = false;
  private watch: ReturnType<typeof setInterval> | null = null;

  /** The files, in the order they play. */
  private readonly files: readonly PieceName[];

  constructor(files: readonly PieceName[]) {
    this.files = files;
    this.srcs = files.map(() => null);
  }

  /** The node the piece comes out of, made with the context on first asking; null where there can be none. */
  output(): GainNode | null {
    if (this.out) return this.out;
    const audio = pageAudio();
    if (!audio || typeof Audio === "undefined") return null;
    try {
      const out = audio.createGain();
      const opening = this.opening();
      this.decks = [0, 1].map((index) => {
        const element = new Audio();
        element.preload = "auto";
        const gain = audio.createGain();
        gain.gain.value = index === this.front ? 1 : 0;
        audio.createMediaElementSource(element).connect(gain).connect(out);
        element.addEventListener("ended", () => this.ended(index));
        const deck = { element, gain, file: -1 };
        this.hold(deck, index === this.front ? opening : this.following(opening));
        return deck;
      });
      this.out = out;
    } catch {
      this.decks = [];
      return null;
    }
    return this.out;
  }

  /** One of the piece's files, in memory: played from now on, where it comes in turn. */
  setSource(name: PieceName, src: string): void {
    const file = this.files.indexOf(name);
    if (file < 0 || this.srcs[file] !== null) return;
    this.srcs[file] = src;
    const [front, back] = [this.decks[this.front], this.decks[1 - this.front]];
    if (front && !this.srcs[front.file]) this.hold(front, this.opening());
    if (back && !this.overlap) this.hold(back, this.following(front.file));
    this.primed = false;
  }

  available(): boolean {
    return this.srcs.some((src) => src !== null);
  }

  /** Whether everything a click or a key could do for the piece is done. */
  unlocked(): boolean {
    return this.primed || !this.available();
  }

  /** In a click or a key: what lets both elements play from now on. */
  unlock(): void {
    if (!this.output()) return;
    if (!this.available()) {
      // Nothing to play yet: loaded in the click, which is what Safari asks of an element before it plays one later.
      for (const { element } of this.decks) element.load();
      return;
    }
    if (this.primed) return;
    this.primed = true;
    this.decks.forEach((deck, index) => {
      if (!deck.element.paused || !deck.element.src) return;
      void deck.element.play().then(() => {
        if (this.sounding(index)) return;
        deck.element.pause();
        if (index !== this.front) deck.element.currentTime = 0;
      }, () => {
        this.primed = false;
      });
    });
  }

  /** Play, or stop where it is. */
  set(on: boolean): void {
    this.on = on && this.available() && this.decks.length > 0;
    if (this.on) {
      this.play(this.front);
      if (this.overlap) this.play(1 - this.front);
      this.watch ??= setInterval(() => this.loop(), LOOP_WATCH_MS);
      return;
    }
    for (const { element } of this.decks) element.pause();
    if (this.watch !== null) clearInterval(this.watch);
    this.watch = null;
  }

  /**
   * Back to the rotation's opening, from the top, unless it is in the middle
   * of that already: a flight starts on the theme, wherever the last one left
   * the music. A piece of one file is left where it is.
   */
  rewind(): void {
    const [front, back] = [this.decks[this.front], this.decks[1 - this.front]];
    const opening = this.opening();
    if (!front || !back || (front.file === opening && !this.overlap)) return;
    for (const { element } of this.decks) element.pause();
    this.overlap = false;
    this.hold(front, opening);
    this.hold(back, this.following(opening));
    front.element.currentTime = 0;
    back.element.currentTime = 0;
    for (const deck of [front, back]) {
      const level = deck === front ? 1 : 0;
      deck.gain.gain.cancelScheduledValues(0);
      if (context) deck.gain.gain.setValueAtTime(level, context.currentTime);
      else deck.gain.gain.value = level;
    }
    if (this.on) this.play(this.front);
  }

  /** Which files have come. */
  private had(): boolean[] {
    return this.srcs.map((src) => src !== null);
  }

  private opening(): number {
    return rotationOpening(this.had());
  }

  private following(file: number): number {
    return nextInRotation(file, this.had());
  }

  /** A deck given one of the files to play, if it has not got it. */
  private hold(deck: Deck, file: number): void {
    const src = this.srcs[file];
    if (deck.file === file || !src) return;
    deck.file = file;
    deck.element.src = src;
  }

  /** Whether a deck should be sounding now. */
  private sounding(index: number): boolean {
    return this.on && (index === this.front || this.overlap);
  }

  private play(index: number): void {
    const { element } = this.decks[index];
    if (!element.paused || !element.src) return;
    void element.play().catch(() => {
      // Not allowed yet: the next click or key tries again.
      this.primed = false;
      soundLocked.set(true);
      listen();
    });
  }

  /** Near the end of a file: what follows it, from the top, under its closing bars. */
  private loop(): void {
    const audio = context;
    const front = this.decks[this.front];
    const back = this.decks[1 - this.front];
    if (!audio || !front || this.overlap) return;
    const overlapS = SOUNDTRACK[this.files[front.file]].overlap;
    const { duration, currentTime } = front.element;
    if (!Number.isFinite(duration) || duration < overlapS * 4 || currentTime < duration - overlapS) return;
    this.overlap = true;
    const at = audio.currentTime + LEAD_S;
    this.hold(back, this.following(front.file));
    back.element.currentTime = 0;
    back.gain.gain.cancelScheduledValues(at);
    back.gain.gain.setValueAtTime(0, at);
    back.gain.gain.setTargetAtTime(1, at, LOOP_IN_S);
    // The file's own ending fades already; this takes the last of it under.
    front.gain.gain.cancelScheduledValues(at);
    front.gain.gain.setTargetAtTime(0, at + 1, Math.max(0.2, (duration - currentTime) / 4));
    this.play(1 - this.front);
  }

  /** A deck has played its file to the end: the other is the one playing now, and this one is given what follows that. */
  private ended(index: number): void {
    const deck = this.decks[index];
    deck.element.currentTime = 0;
    if (index !== this.front) return;
    const next = 1 - index;
    if (!this.overlap) {
      // The end came before it was looked out for (a slow timer): straight on to what follows, from the top.
      this.hold(this.decks[next], this.following(deck.file));
      const gain = this.decks[next].gain.gain;
      if (context) {
        gain.cancelScheduledValues(0);
        gain.setValueAtTime(1, context.currentTime);
      }
      this.decks[next].element.currentTime = 0;
    }
    this.front = next;
    this.overlap = false;
    this.hold(deck, this.following(this.decks[next].file));
    if (this.sounding(next)) this.play(next);
  }
}

/** The pieces, who listens to them, and the menus' fade. */
class Music {
  readonly pieces: Record<"menu" | "theme" | "tension", Piece> = {
    menu: new Piece(["menu"]),
    // The flight's music: the themes and the menus' piece in turn (`FLIGHT_ROTATION`).
    theme: new Piece(FLIGHT_ROTATION),
    tension: new Piece(["tension"]),
  };
  private menu: GainNode | null = null;
  private readonly wanted = new Set<Listener>();
  /** Until when what each listener stopped wanting plays on, ms on the page's clock. */
  private readonly lingers: Record<Listener, number> = { menu: 0, flight: 0 };
  private restTimer: ReturnType<typeof setTimeout> | null = null;

  /** The menus' fade, between their piece and the speakers; made with the context. */
  menuGain(): GainNode | null {
    if (this.menu) return this.menu;
    const audio = pageAudio();
    const piece = this.pieces.menu.output();
    if (!audio || !piece) return null;
    this.menu = audio.createGain();
    this.menu.gain.value = 0;
    piece.connect(this.menu).connect(audio.destination);
    return this.menu;
  }

  /** Whether everything a click or a key could do for the music is done. */
  unlocked(): boolean {
    return context?.state === "running" && Object.values(this.pieces).every((piece) => piece.unlocked());
  }

  /** Whether `who` wants the music now. What it stops wanting plays on a while, for its fade to finish. */
  want(who: Listener, on: boolean): void {
    if (on) this.wanted.add(who);
    else if (this.wanted.delete(who)) this.lingers[who] = performance.now() + REST_MS;
    this.sync();
  }

  /** In a click or a key: the context woken, and every element let play from now on. */
  unlock(): void {
    const audio = pageAudio();
    if (!audio) return;
    if (audio.state !== "running") {
      void audio.resume().then(() => {
        soundLocked.set(false);
        this.sync();
      }, () => undefined);
    } else {
      soundLocked.set(false);
    }
    this.menuGain();
    for (const piece of Object.values(this.pieces)) piece.unlock();
  }

  /**
   * Play or rest as the listeners and the page are now: the menus' piece for
   * a menu, the other two for the flight, each a while longer for its fade;
   * nothing while the page is hidden. With no one listening any more, the
   * context is suspended too.
   */
  sync(): void {
    const audio = context;
    if (!audio) return;
    const now = performance.now();
    const seen = !hidden();
    const hears = (who: Listener) => seen && (this.wanted.has(who) || now < this.lingers[who]);
    if (this.wanted.size > 0 && seen && audio.state !== "running") void audio.resume().catch(() => undefined);
    this.pieces.menu.set(hears("menu"));
    this.pieces.theme.set(hears("flight"));
    this.pieces.tension.set(hears("flight"));
    if (this.restTimer !== null) clearTimeout(this.restTimer);
    this.restTimer = null;
    const until = Math.max(...(["menu", "flight"] as const).filter((who) => !this.wanted.has(who)).map((who) => this.lingers[who]), 0);
    if (seen && until > now) {
      this.restTimer = setTimeout(() => this.sync(), until - now + 50);
    } else if (!this.wanted.size && audio.state === "running") {
      void audio.suspend().catch(() => undefined);
    }
  }
}

const music = new Music();

/**
 * The flight's two pieces into its graph, each into its own input, until what
 * is handed back is called; its music back to the theme, as a flight opens.
 * Null where there is no music at all.
 */
export function plugMusic(inputs: Record<"theme" | "tension", AudioNode>): (() => void) | null {
  music.pieces.theme.rewind();
  const plugged: Array<[GainNode, AudioNode]> = [];
  for (const name of ["theme", "tension"] as const) {
    const out = music.pieces[name].output();
    if (!out) continue;
    out.connect(inputs[name]);
    plugged.push([out, inputs[name]]);
  }
  if (!plugged.length) return null;
  return () => {
    for (const [out, input] of plugged) {
      try {
        out.disconnect(input);
      } catch {
        // Not connected any more.
      }
    }
  };
}

/** Whether the flight wants the music played now: while its sound is heard, paused or not. */
export function wantMusic(on: boolean): void {
  music.want("flight", on);
}

/** Whether there is music for the flight to play: loaded, and somewhere to play it. */
export function musicAvailable(): boolean {
  return music.pieces.theme.available() && soundAvailable();
}

/** Each file, in memory, once fetched: one copy, for every piece that plays it. */
const sources: Partial<Record<PieceName, string>> = {};

/** Whether a file has been fetched. */
export function pieceLoaded(name: PieceName): boolean {
  return sources[name] !== undefined;
}

/** A file, fetched (preload.ts): played from memory from now on, by every piece it is part of. */
export function setSoundtrack(name: PieceName, bytes: ArrayBuffer): void {
  if (pieceLoaded(name) || typeof URL === "undefined" || typeof Blob === "undefined") return;
  const src = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  sources[name] = src;
  for (const piece of Object.values(music.pieces)) piece.setSource(name, src);
  // A piece that came in after the first click still has to be played from one, where Safari is strict.
  if (!music.unlocked()) listen();
  music.sync();
  syncMenu();
}

let claims = 0;

/**
 * A menu is up: its piece fades in, from the first click or key on the page,
 * and plays for as long as any menu is up. What is handed back puts it away;
 * once the last is put away the music fades out.
 */
export function claimMenuMusic(): () => void {
  claims += 1;
  syncMenu();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    claims -= 1;
    syncMenu();
  };
}

/** The menus' fade, to whether one is up, the sound is on and the page is seen. */
function syncMenu(): void {
  const on = claims > 0 && !get(flightMuted) && !hidden();
  // Before the first click there is no context to fade in, and making one would only make a suspended one.
  const audio = context;
  const gain = audio ? music.menuGain() : null;
  music.want("menu", on);
  if (!audio || !gain) return;
  const at = audio.currentTime + LEAD_S;
  gain.gain.cancelScheduledValues(at);
  gain.gain.setTargetAtTime(on ? MENU_LEVEL : 0, at, on ? MENU_IN_S : MENU_OUT_S);
}

/** What a click or a key does for the sound: the context made and woken, and the music let play. */
function gesture(event: Event): void {
  // The sound's own switch decides for itself whether its press turns the sound on or off.
  if ((event.target as Element | null)?.closest?.("[data-sound-switch]")) return;
  unlockSound();
}

/** Let the page play now, from within a click or a key; the sound's switch calls it itself. */
export function unlockSound(): void {
  if (!soundAvailable()) return;
  music.unlock();
  syncMenu();
  if (music.unlocked()) unlisten();
}

const GESTURES = ["pointerdown", "pointerup", "touchend", "click", "keydown"];
let listening = false;

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  for (const type of GESTURES) window.addEventListener(type, gesture, true);
}

function unlisten(): void {
  if (!listening) return;
  listening = false;
  for (const type of GESTURES) window.removeEventListener(type, gesture, true);
}

if (typeof window !== "undefined" && soundAvailable()) {
  listen();
  // While developing, within reach of the console: where each piece is, and the menus' fade.
  if (import.meta.env?.DEV) (window as unknown as { flightMusic?: unknown }).flightMusic = { music, context: () => context };
  document.addEventListener("visibilitychange", () => {
    syncMenu();
    music.sync();
  });
  flightMuted.subscribe(() => syncMenu());
}
