/**
 * A scene, recorded to a video file.
 *
 * The map's canvas alone is not a picture anyone should pass on: it has no
 * time on it, and none of the credits the data is published under, both of
 * which are page elements over the canvas. So each frame is drawn again onto
 * a canvas of the recording's own (the part of the map the chosen shape
 * frames, then the time and the credits over it, and a badge saying whose
 * map this is), and that canvas is what is recorded.
 *
 * Recorded as it plays, by the browser's own recorder: a scene's scans are
 * loaded before it starts (director.ts), so playing it is only drawing.
 */
import type { Aspect } from "./store";

/** The longest side of a recording, in pixels: full HD. */
const LONG_SIDE = 1920;

/** Frames a second, and bits: enough that soft cloud does not turn to blocks. */
export const RECORD_FPS = 30;
const BITS_PER_SECOND = 16_000_000;

/** MP4 where the browser records it, since it plays everywhere; WebM otherwise. */
const TYPES = [
  { mime: "video/mp4;codecs=avc1.640028", extension: "mp4" },
  { mime: "video/mp4", extension: "mp4" },
  { mime: "video/webm;codecs=vp9", extension: "webm" },
  { mime: "video/webm", extension: "webm" },
];

const RATIOS: Record<Exclude<Aspect, "window">, number> = { "16:9": 16 / 9, "1:1": 1, "9:16": 9 / 16 };

/**
 * The part of a `width` by `height` picture a shape frames: the largest
 * rectangle of that shape that fits, centred. All of it for "window".
 */
export function cropOf(width: number, height: number, aspect: Aspect): { x: number; y: number; width: number; height: number } {
  if (aspect === "window") return { x: 0, y: 0, width, height };
  const ratio = RATIOS[aspect];
  const cropWidth = Math.min(width, height * ratio);
  const cropHeight = cropWidth / ratio;
  return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
}

/** A recording's size for a crop: no longer than `LONG_SIDE`, never larger than the crop, and even, as encoders want. */
export function outputSize(crop: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(1, LONG_SIDE / Math.max(crop.width, crop.height));
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(crop.width), height: even(crop.height) };
}

/** Whether this browser can record a canvas at all. */
export function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined"
    && "captureStream" in HTMLCanvasElement.prototype && TYPES.some(({ mime }) => MediaRecorder.isTypeSupported(mime));
}

/** Whose picture a recording is: the logo and a few words, drawn in its top left corner. */
export interface Badge {
  /** The logo, loaded; null where it would not load, and the badge is words alone. */
  logo: CanvasImageSource | null;
  /** The name, then what is said under it: a line that sells, and a line that says what it is. */
  name: string;
  tagline: string;
  pitch: string;
}

/** An image for a canvas to draw, or null if it will not load: a recording is not held up for a logo. */
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/**
 * The badge, as a plate of dark glass with the logo and the words on it.
 * `unit` is a hundredth of the picture's short side, which everything on a
 * recording is sized by.
 */
export function drawBadge(context: CanvasRenderingContext2D, badge: Badge, unit: number): void {
  const pad = unit * 1.5;
  const mark = badge.logo ? unit * 7.4 : 0;
  const fonts = [
    `700 ${unit * 2.7}px system-ui, sans-serif`,
    `600 ${unit * 1.9}px system-ui, sans-serif`,
    `400 ${unit * 1.6}px system-ui, sans-serif`,
  ];
  const lines = [badge.name, badge.tagline, badge.pitch];
  const widths = lines.map((line, i) => {
    context.font = fonts[i];
    return context.measureText(line).width;
  });
  const left = unit * 3;
  const top = unit * 3;
  const height = unit * 7.4 + pad * 2;
  const width = pad + mark + (mark ? pad : 0) + Math.max(...widths) + pad * 1.4;

  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.35)";
  context.shadowBlur = unit * 1.2;
  context.fillStyle = "rgba(22, 22, 26, 0.62)";
  context.beginPath();
  context.roundRect(left, top, width, height, unit * 2.4);
  context.fill();
  context.shadowBlur = 0;
  if (badge.logo) context.drawImage(badge.logo, left + pad, top + pad, mark, mark);

  const textLeft = left + pad + mark + (mark ? pad : 0);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  const baselines = [top + pad + unit * 2.5, top + pad + unit * 5.1, top + pad + unit * 7.2];
  const inks = ["#fff", "#fff", "rgba(255, 255, 255, 0.82)"];
  lines.forEach((line, i) => {
    context.font = fonts[i];
    context.fillStyle = inks[i];
    context.fillText(line, textLeft, baselines[i]);
  });
  context.restore();
}

export interface Recording {
  /** Stop, and hand over what was recorded. */
  finish(): Promise<{ blob: Blob; extension: string }>;
  /** Stop, and throw it away. */
  cancel(): void;
}

/**
 * Start recording `source`, cropped to `aspect`, with `caption`, `credits`
 * and the `badge` drawn over every frame. `eachFrame` is how the caller is told a
 * frame has been drawn onto the source, and returns how to stop being told.
 */
export function startRecording(options: {
  source: HTMLCanvasElement;
  aspect: Aspect;
  eachFrame(listener: () => void): () => void;
  /** The time the frame on screen is of, as it should read; asked every frame. */
  caption(): string;
  credits: string;
  badge: Badge;
  /** What the picture sounds like, to go into the video with it; none for a silent one. */
  audio?: MediaStream | null;
}): Recording {
  const { source, aspect } = options;
  const crop = cropOf(source.width, source.height, aspect);
  const size = outputSize(crop);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { alpha: false })!;
  // Text sized to the picture, so it reads the same on a square as on a wide one.
  const unit = Math.min(size.width, size.height) / 100;

  const draw = () => {
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
    context.textBaseline = "alphabetic";
    context.shadowColor = "rgba(0, 0, 0, 0.75)";
    context.shadowBlur = unit * 0.8;
    context.fillStyle = "#fff";
    context.textAlign = "left";
    context.font = `600 ${unit * 3.4}px system-ui, sans-serif`;
    context.fillText(options.caption(), unit * 3, size.height - unit * 3);
    context.textAlign = "right";
    context.font = `${unit * 1.5}px system-ui, sans-serif`;
    context.fillStyle = "rgba(255, 255, 255, 0.85)";
    context.fillText(options.credits, size.width - unit * 3, size.height - unit * 3, size.width * 0.62);
    context.shadowBlur = 0;
    drawBadge(context, options.badge, unit);
  };

  const type = TYPES.find(({ mime }) => MediaRecorder.isTypeSupported(mime))!;
  const stream = canvas.captureStream(RECORD_FPS);
  // The sound is its maker's, lent: it is recorded here, and left running when the recording stops.
  for (const track of options.audio?.getAudioTracks() ?? []) stream.addTrack(track);
  const recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: BITS_PER_SECOND });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
  // Started by the first frame drawn, not before it: the map's canvas holds
  // a frame only while it is being drawn, and a recording begun between two
  // would open on black.
  const unlisten = options.eachFrame(() => {
    draw();
    if (recorder.state === "inactive" && !chunks.length) recorder.start();
  });

  const stop = () => {
    unlisten();
    if (recorder.state !== "inactive") recorder.stop();
    for (const track of stream.getVideoTracks()) track.stop();
  };
  return {
    async finish() {
      stop();
      await stopped;
      return { blob: new Blob(chunks, { type: type.mime.split(";")[0] }), extension: type.extension };
    },
    cancel: stop,
  };
}

/** Hand a recording to the reader as a download. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // After the browser has taken it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
