/**
 * An MP3 file played through Web Audio alone, streamed: fetched as it comes,
 * cut into its frames (mp3Frames.ts), decoded a few seconds ahead of where
 * it plays by WebCodecs' AudioDecoder, and played as short buffers one after
 * another. Never decoded whole: a piece as floats would be 60 MB and more.
 *
 * Why not a media element, which streams a file by itself: Safari and the
 * apps' web views make any media element that holds a file the system's
 * player for the page. The lock screen and Control Center then show the
 * flight's music with its controls for as long as the page is kept. Sound
 * made by Web Audio alone is not a player.
 *
 * A `StreamTrack` stands in for the media element where the soundtrack and
 * the thunder's recordings used one (soundtrack.ts, thunderClips.ts): the
 * same `src`, `preload`, `currentTime`, `duration`, `paused`, `ended`,
 * `error`, `playbackRate`, `play()`, `pause()` and `load()`, and the same
 * `ended` and `error` events, so their logic is the element's. Its sound
 * comes out of `output`. Where a browser cannot decode MP3 by WebCodecs, or
 * has not said yet, `makeTrack` hands out a media element as before.
 */
import { audioStart, readHeader, scanFrames, xingFrames } from "./mp3Frames";
import type { Frame, FrameHeader } from "./mp3Frames";

/** What the soundtrack and the thunder use of a media element, which both a `StreamTrack` and an `HTMLAudioElement` are. */
export interface Track {
  src: string;
  preload: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly error: unknown;
  playbackRate: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
  addEventListener(type: string, listener: () => void): void;
}

/** Whether WebCodecs here decodes MP3: asked once, as this is first loaded; unknown until it answers. */
let mp3Decodes: boolean | undefined;
if (typeof AudioDecoder === "undefined" || typeof EncodedAudioChunk === "undefined" || typeof fetch !== "function") {
  mp3Decodes = false;
} else {
  AudioDecoder.isConfigSupported({ codec: "mp3", sampleRate: 48000, numberOfChannels: 2 }).then(
    (support) => { mp3Decodes = Boolean(support.supported); },
    () => { mp3Decodes = false; },
  );
}

/** A track to play a file through `context`, and the node its sound comes out of: streamed by Web Audio where it can be, else a media element. */
export function makeTrack(context: AudioContext): { track: Track; output: AudioNode } {
  if (mp3Decodes) {
    const track = new StreamTrack(context);
    return { track, output: track.output };
  }
  const element = new Audio();
  return { track: element, output: context.createMediaElementSource(element) };
}

/** How many frames before where playing starts are decoded and thrown away: what the first one heard draws on (MP3's bit reservoir). */
const PREROLL_FRAMES = 4;
/** How far ahead of where it plays the file is decoded, seconds. */
const AHEAD_S = 3;
/** How long each buffer played is, seconds, at least: fewer nodes than one a frame. */
const CHUNK_S = 0.5;
/** How far ahead of the context's clock the first buffer starts, seconds. */
const LEAD_S = 0.05;
/** How often a playing track looks whether to decode more, ms. */
const PUMP_MS = 150;
/** The most frames handed to the decoder at once. */
const FEED_MOST = 240;

/** One run of playing, from where `play()` (or a seek) started it to a pause, a seek or the end. */
interface Session {
  decoder: AudioDecoder;
  /** The next frame to hand to the decoder. */
  nextFrame: number;
  /** Where in the file playing starts, seconds: what is decoded before it is thrown away. */
  from: number;
  /** When on the context's clock the next buffer starts; null before the first. */
  nextTime: number | null;
  /** When on the context's clock the file was at `from`, gaps for want of sound taken out; null before the first buffer. */
  startedAt: number | null;
  /** Decoded and not yet played, per channel, piece by piece. */
  pending: Float32Array[][];
  pendingFrames: number;
  pendingRate: number;
  sources: Set<AudioBufferSourceNode>;
  /** Whether the last frame has been handed over, and whether everything it decodes to is scheduled. */
  flushing: boolean;
  flushed: boolean;
}

/** An MPEG audio file played through Web Audio; see the header. */
export class StreamTrack extends EventTarget implements Track {
  /** Where the track's sound comes out. */
  readonly output: GainNode;
  playbackRate = 1;
  private readonly context: AudioContext;
  private url: string | null = null;
  private preloadValue = "auto";
  private failure: Error | null = null;

  /* The file, as far as it has come. */
  private bytes = new Uint8Array(0);
  private length = 0;
  private frames: Frame[] = [];
  private scanFrom: number | null = null;
  private header: FrameHeader | null = null;
  private totalFrames: number | null = null;
  private complete = false;
  private fetching: AbortController | null = null;

  /* Playing. */
  private playing = false;
  private finished = false;
  /** Where it is in the file while not playing, seconds. */
  private offset = 0;
  private session: Session | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(context: AudioContext) {
    super();
    this.context = context;
    this.output = context.createGain();
  }

  get src(): string {
    return this.url ?? "";
  }

  set src(url: string) {
    this.reset();
    this.url = url || null;
    if (this.url && this.preloadValue === "auto") this.fetch();
  }

  get preload(): string {
    return this.preloadValue;
  }

  set preload(value: string) {
    this.preloadValue = value;
    if (value === "auto") this.fetch();
  }

  get error(): Error | null {
    return this.failure;
  }

  get paused(): boolean {
    return !this.playing;
  }

  get ended(): boolean {
    return this.finished;
  }

  /** How long the file is, seconds: from its Xing frame, or once it has all come; NaN until then. */
  get duration(): number {
    if (!this.header || this.totalFrames === null) return NaN;
    return (this.totalFrames * this.header.samples) / this.header.sampleRate;
  }

  get currentTime(): number {
    const session = this.session;
    if (!this.playing || !session || session.startedAt === null) return this.offset;
    const at = session.from + Math.max(0, this.context.currentTime - session.startedAt) * this.playbackRate;
    const duration = this.duration;
    return Number.isFinite(duration) ? Math.min(at, duration) : at;
  }

  set currentTime(seconds: number) {
    this.offset = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    this.finished = false;
    if (!this.playing) return;
    this.stopSession();
    this.pump();
  }

  getAttribute(name: string): string | null {
    return name === "src" ? this.url : null;
  }

  removeAttribute(name: string): void {
    if (name === "src") this.reset();
  }

  /** As a media element's: stopped, back at the start, and fetching again where it is to. */
  load(): void {
    this.pause();
    this.offset = 0;
    this.finished = false;
    if (this.url && this.preloadValue !== "none") this.fetch();
  }

  play(): Promise<void> {
    if (!this.url) return Promise.reject(new DOMException("No file to play", "NotSupportedError"));
    if (this.playing) return Promise.resolve();
    if (this.finished) this.offset = 0;
    this.finished = false;
    this.playing = true;
    // A moment later, so that a play() taken back at once (a click letting an element play, soundtrack.ts) fetches nothing.
    setTimeout(() => {
      if (!this.playing) return;
      this.fetch();
      this.pump();
    }, 0);
    this.timer ??= setInterval(() => this.pump(), PUMP_MS);
    return Promise.resolve();
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.currentTime;
    this.playing = false;
    this.stopSession();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Nothing in hand, nothing playing: as an element with no file. */
  private reset(): void {
    this.pause();
    this.fetching?.abort();
    this.fetching = null;
    this.url = null;
    this.failure = null;
    this.bytes = new Uint8Array(0);
    this.length = 0;
    this.frames = [];
    this.scanFrom = null;
    this.header = null;
    this.totalFrames = null;
    this.complete = false;
    this.offset = 0;
    this.finished = false;
  }

  private fail(error: unknown): void {
    if (this.failure) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.pause();
    this.dispatchEvent(new Event("error"));
  }

  /* ---- the file ---- */

  /** Fetch the file, as it comes, unless it is coming or here already. */
  private fetch(): void {
    if (!this.url || this.fetching || this.complete || this.failure) return;
    const abort = new AbortController();
    this.fetching = abort;
    const url = this.url;
    void (async () => {
      try {
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        const size = Number(response.headers.get("content-length")) || 0;
        if (size > 0) this.bytes = new Uint8Array(size);
        if (!response.body) {
          this.append(new Uint8Array(await response.arrayBuffer()));
        } else {
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (abort.signal.aborted) return;
            this.append(value);
            this.scan(false);
            this.pump();
          }
        }
        if (abort.signal.aborted) return;
        this.complete = true;
        this.scan(true);
        if (!this.frames.length) throw new Error(`No MPEG audio in ${url}`);
        this.totalFrames = this.frames.length;
        this.pump();
      } catch (error) {
        if (!abort.signal.aborted) this.fail(error);
      } finally {
        if (this.fetching === abort) this.fetching = null;
      }
    })();
  }

  private append(chunk: Uint8Array): void {
    if (this.length + chunk.length > this.bytes.length) {
      const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.length + chunk.length, 1 << 16));
      grown.set(this.bytes.subarray(0, this.length));
      this.bytes = grown;
    }
    this.bytes.set(chunk, this.length);
    this.length += chunk.length;
  }

  /** The frames in what has come so far; the file's format and length from the first. */
  private scan(final: boolean): void {
    const bytes = this.bytes.subarray(0, this.length);
    if (this.scanFrom === null) {
      this.scanFrom = audioStart(bytes);
      if (this.scanFrom === null) return;
    }
    const { frames, next } = scanFrames(bytes, this.scanFrom, final);
    this.scanFrom = next;
    if (!frames.length) return;
    if (!this.header) {
      this.header = readHeader(bytes, frames[0].offset);
      const said = xingFrames(bytes, frames[0]);
      // The Xing frame counts the frames after it; it is one itself, of silence.
      if (said !== null) this.totalFrames = said + 1;
    }
    for (const frame of frames) this.frames.push(frame);
  }

  /* ---- playing ---- */

  /** Decode what is wanted next, and look whether the file has played to its end. */
  private pump(): void {
    if (!this.playing || this.failure) return;
    const header = this.header;
    if (!header) return;
    let session = this.session;
    if (!session) {
      session = this.startSession(header);
      if (!session) return;
    }
    const perFrame = header.samples / header.sampleRate;
    const at = this.currentTime;
    let fed = 0;
    while (
      session.nextFrame < this.frames.length
      && session.nextFrame * perFrame - at < AHEAD_S
      && fed < FEED_MOST
      && session.decoder.state === "configured"
    ) {
      const frame = this.frames[session.nextFrame];
      session.decoder.decode(new EncodedAudioChunk({
        type: "key",
        timestamp: Math.round(session.nextFrame * perFrame * 1e6),
        duration: Math.round(perFrame * 1e6),
        data: this.bytes.subarray(frame.offset, frame.offset + frame.size),
      }));
      session.nextFrame += 1;
      fed += 1;
    }
    if (this.complete && session.nextFrame >= this.frames.length && !session.flushing && session.decoder.state === "configured") {
      session.flushing = true;
      const flushing = session;
      session.decoder.flush().then(() => {
        if (this.session !== flushing) return;
        this.emit(flushing);
        flushing.flushed = true;
        this.checkEnd(flushing);
      }, () => undefined);
    }
  }

  private startSession(header: FrameHeader): Session | null {
    const from = this.offset;
    let decoder: AudioDecoder;
    const session: Session = {
      decoder: null as unknown as AudioDecoder,
      nextFrame: Math.max(0, Math.floor((from * header.sampleRate) / header.samples) - PREROLL_FRAMES),
      from,
      nextTime: null,
      startedAt: null,
      pending: [],
      pendingFrames: 0,
      pendingRate: header.sampleRate,
      sources: new Set(),
      flushing: false,
      flushed: false,
    };
    try {
      decoder = new AudioDecoder({
        output: (data) => this.decoded(session, data),
        error: (error) => {
          if (this.session === session) this.fail(error);
        },
      });
      decoder.configure({ codec: "mp3", sampleRate: header.sampleRate, numberOfChannels: header.channels });
    } catch (error) {
      this.fail(error);
      return null;
    }
    session.decoder = decoder;
    this.session = session;
    return session;
  }

  private stopSession(): void {
    const session = this.session;
    if (!session) return;
    this.session = null;
    for (const source of session.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Not started, or over already.
      }
      source.disconnect();
    }
    session.sources.clear();
    if (session.decoder.state !== "closed") session.decoder.close();
  }

  /** What the decoder gives back: what is before where playing starts thrown away, the rest gathered into buffers. */
  private decoded(session: Session, data: AudioData): void {
    if (this.session !== session) {
      data.close();
      return;
    }
    const rate = data.sampleRate;
    const count = data.numberOfFrames;
    const start = data.timestamp / 1e6;
    const skip = start < session.from ? Math.min(count, Math.round((session.from - start) * rate)) : 0;
    const planes = skip < count ? copyPlanes(data) : null;
    data.close();
    if (!planes) return;
    if (session.pendingFrames > 0 && rate !== session.pendingRate) this.emit(session);
    session.pendingRate = rate;
    session.pending.push(skip ? planes.map((plane) => plane.subarray(skip)) : planes);
    session.pendingFrames += count - skip;
    if (session.pendingFrames >= CHUNK_S * rate) this.emit(session);
  }

  /** What has been decoded, as one buffer, played right after the one before. */
  private emit(session: Session): void {
    if (!session.pendingFrames) return;
    const channels = session.pending[0].length;
    const buffer = this.context.createBuffer(channels, session.pendingFrames, session.pendingRate);
    for (let channel = 0; channel < channels; channel += 1) {
      const out = buffer.getChannelData(channel);
      let at = 0;
      for (const piece of session.pending) {
        const plane = piece[channel] ?? piece[0];
        out.set(plane, at);
        at += plane.length;
      }
    }
    session.pending = [];
    session.pendingFrames = 0;

    const now = this.context.currentTime;
    if (session.nextTime === null || session.nextTime < now + 0.01) {
      // The first buffer; or the decoding fell behind and the sound ran out: on from a moment ahead, the gap not counted as played.
      const at = Math.ceil((now + LEAD_S) * this.context.sampleRate) / this.context.sampleRate;
      if (session.nextTime !== null && session.startedAt !== null) session.startedAt += at - session.nextTime;
      session.nextTime = at;
      session.startedAt ??= at;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.playbackRate;
    source.connect(this.output);
    source.start(session.nextTime);
    // The next buffer right where this one ends: without it each would start on top of the last.
    session.nextTime += buffer.duration / this.playbackRate;
    session.sources.add(source);
    source.onended = () => {
      session.sources.delete(source);
      source.disconnect();
      this.checkEnd(session);
    };
  }

  /** Played to its end: stopped there, and the `ended` event, as a media element does. */
  private checkEnd(session: Session): void {
    if (this.session !== session || !session.flushed || session.sources.size > 0 || session.pendingFrames > 0) return;
    const duration = this.duration;
    this.stopSession();
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.offset = Number.isFinite(duration) ? duration : this.offset;
    this.finished = true;
    this.dispatchEvent(new Event("ended"));
  }
}

/** A decoded frame's samples, a Float32Array per channel, whatever layout the decoder gave them in. */
function copyPlanes(data: AudioData): Float32Array[] {
  const count = data.numberOfFrames;
  const channels = data.numberOfChannels;
  try {
    return Array.from({ length: channels }, (_, channel) => {
      const plane = new Float32Array(count);
      data.copyTo(plane, { planeIndex: channel, format: "f32-planar" });
      return plane;
    });
  } catch {
    // A decoder that only copies out in its own layout.
  }
  const format = data.format;
  const planes = Array.from({ length: channels }, () => new Float32Array(count));
  if (format === "f32-planar" || format === "s16-planar" || format === "s32-planar" || format === "u8-planar") {
    for (let channel = 0; channel < channels; channel += 1) {
      const raw = planeOf(format, count);
      data.copyTo(raw, { planeIndex: channel });
      toFloat(raw, format, planes[channel], 1, 0);
    }
  } else if (format) {
    const raw = planeOf(format, count * channels);
    data.copyTo(raw, { planeIndex: 0 });
    for (let channel = 0; channel < channels; channel += 1) toFloat(raw, format, planes[channel], channels, channel);
  }
  return planes;
}

function planeOf(format: AudioSampleFormat, length: number): Float32Array | Int16Array | Int32Array | Uint8Array {
  if (format.startsWith("f32")) return new Float32Array(length);
  if (format.startsWith("s16")) return new Int16Array(length);
  if (format.startsWith("s32")) return new Int32Array(length);
  return new Uint8Array(length);
}

/** Samples of any of WebCodecs' layouts as floats: every `step`th from `first`. */
function toFloat(raw: ArrayLike<number>, format: AudioSampleFormat, out: Float32Array, step: number, first: number): void {
  const scale = format.startsWith("s16") ? 1 / 32768 : format.startsWith("s32") ? 1 / 2147483648 : 1;
  const unsigned = format.startsWith("u8");
  for (let index = 0; index < out.length; index += 1) {
    const value = raw[index * step + first];
    out[index] = unsigned ? (value - 128) / 128 : value * scale;
  }
}
