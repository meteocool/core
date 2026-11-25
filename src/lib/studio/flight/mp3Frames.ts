/**
 * MPEG audio (MP3) cut into its frames, for a decoder fed a frame at a time
 * (streamTrack.ts). Pure: no browser in here, so the tests run it in Node.
 *
 * A file is an optional ID3v2 tag and then frames, each a four-byte header
 * and what it carries; the header says how long the frame is. The first
 * frame of a file from an encoder such as LAME is often a Xing or Info frame
 * instead of sound: it says how many frames there are, which gives the
 * file's length before the rest of it has come in.
 */

/** What a frame's header says. */
export interface FrameHeader {
  /** Bytes in the whole frame, the header included. */
  size: number;
  sampleRate: number;
  channels: 1 | 2;
  /** Samples per channel the frame decodes to. */
  samples: number;
  /** MPEG-1 (1), MPEG-2 (2) or MPEG-2.5 (2.5). */
  version: 1 | 2 | 2.5;
  layer: 1 | 2 | 3;
}

/** One frame in the file: where it starts and how long it is, bytes. */
export interface Frame {
  offset: number;
  size: number;
}

const BITRATES_KBPS: Record<string, readonly number[]> = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<string, readonly number[]> = {
  "1": [44100, 48000, 32000],
  "2": [22050, 24000, 16000],
  "2.5": [11025, 12000, 8000],
};

/** The header at `at`, or null where there is not a valid one. */
export function readHeader(bytes: Uint8Array, at: number): FrameHeader | null {
  if (at + 4 > bytes.length) return null;
  const [b0, b1, b2, b3] = [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]];
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const versionBits = (b1 >> 3) & 0x3;
  const layerBits = (b1 >> 1) & 0x3;
  const bitrateIndex = (b2 >> 4) & 0xf;
  const rateIndex = (b2 >> 2) & 0x3;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = (4 - layerBits) as 1 | 2 | 3;
  const padding = (b2 >> 1) & 0x1;
  const channels = ((b3 >> 6) & 0x3) === 3 ? 1 : 2;
  const sampleRate = SAMPLE_RATES[String(version)][rateIndex];
  const bitrate = BITRATES_KBPS[`${version === 1 ? 1 : 2}-${layer}`][bitrateIndex] * 1000;
  let size: number;
  let samples: number;
  if (layer === 1) {
    size = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
    samples = 384;
  } else if (layer === 2 || version === 1) {
    size = Math.floor((144 * bitrate) / sampleRate) + padding;
    samples = 1152;
  } else {
    size = Math.floor((72 * bitrate) / sampleRate) + padding;
    samples = 576;
  }
  if (size < 4) return null;
  return { size, sampleRate, channels, samples, version, layer };
}

/** Where the sound starts: past an ID3v2 tag, if the file opens with one; null until enough of it is in to tell. */
export function audioStart(bytes: Uint8Array): number | null {
  if (bytes.length < 10) return null;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  // A syncsafe size: seven bits a byte. A footer adds ten more.
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  return 10 + size + ((bytes[5] & 0x10) ? 10 : 0);
}

/**
 * The frames from `from` on, as far as the bytes in hand reach: each one
 * whole, the next header right after it. Where a frame does not lead to
 * another (junk, or a tag at the end), the search goes on byte by byte for
 * the next header that does. `next` is where to go on from once more bytes
 * have come; with `final`, what is in hand is all there is.
 */
export function scanFrames(bytes: Uint8Array, from: number, final = false): { frames: Frame[]; next: number } {
  const frames: Frame[] = [];
  let at = from;
  while (at + 4 <= bytes.length) {
    const header = readHeader(bytes, at);
    if (!header) {
      at += 1;
      continue;
    }
    const end = at + header.size;
    if (end > bytes.length) {
      if (final) break;
      return { frames, next: at };
    }
    // A frame's length is believed when another header follows it, or the file ends with it.
    const followed = end + 4 > bytes.length ? final || end === bytes.length : readHeader(bytes, end) !== null;
    if (!followed && end + 4 <= bytes.length) {
      at += 1;
      continue;
    }
    if (!followed) return { frames, next: at };
    frames.push({ offset: at, size: header.size });
    at = end;
  }
  return { frames, next: at };
}

/**
 * How many frames the file says it has, from a Xing or Info frame (the
 * first one, from LAME and the like); null where it does not say.
 */
export function xingFrames(bytes: Uint8Array, frame: Frame): number | null {
  const header = readHeader(bytes, frame.offset);
  if (!header || header.layer !== 3) return null;
  // The tag follows the side information, whose length goes by version and channels.
  const side = header.version === 1 ? (header.channels === 1 ? 17 : 32) : (header.channels === 1 ? 9 : 17);
  const at = frame.offset + 4 + side;
  if (at + 12 > bytes.length) return null;
  const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag !== "Xing" && tag !== "Info") return null;
  const flags = (bytes[at + 4] << 24) | (bytes[at + 5] << 16) | (bytes[at + 6] << 8) | bytes[at + 7];
  if (!(flags & 1)) return null;
  return ((bytes[at + 8] << 24) | (bytes[at + 9] << 16) | (bytes[at + 10] << 8) | bytes[at + 11]) >>> 0;
}
