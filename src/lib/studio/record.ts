/**
 * A scene, recorded to a video file.
 *
 * The map's canvas alone is not a picture anyone should pass on: it has no
 * time on it, and none of the credits the data is published under, both of
 * which are page elements over the canvas. So each frame is drawn again onto
 * a canvas of the recording's own (the part of the map the chosen shape
 * frames, then the time, the name and the credits over it), and that canvas
 * is what is recorded.
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

export interface Recording {
  /** Stop, and hand over what was recorded. */
  finish(): Promise<{ blob: Blob; extension: string }>;
  /** Stop, and throw it away. */
  cancel(): void;
}

/**
 * Start recording `source`, cropped to `aspect`, with `caption` and
 * `credits` drawn over every frame. `eachFrame` is how the caller is told a
 * frame has been drawn onto the source, and returns how to stop being told.
 */
export function startRecording(options: {
  source: HTMLCanvasElement;
  aspect: Aspect;
  eachFrame(listener: () => void): () => void;
  /** The time the frame on screen is of, as it should read; asked every frame. */
  caption(): string;
  credits: string;
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
    context.fillText(options.caption(), unit * 3, size.height - unit * 6.4);
    context.font = `600 ${unit * 2.2}px system-ui, sans-serif`;
    context.fillText("meteocool.com", unit * 3, size.height - unit * 3);
    context.textAlign = "right";
    context.font = `${unit * 1.5}px system-ui, sans-serif`;
    context.fillStyle = "rgba(255, 255, 255, 0.85)";
    context.fillText(options.credits, size.width - unit * 3, size.height - unit * 3, size.width * 0.62);
    context.shadowBlur = 0;
  };

  const type = TYPES.find(({ mime }) => MediaRecorder.isTypeSupported(mime))!;
  const stream = canvas.captureStream(RECORD_FPS);
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
    for (const track of stream.getTracks()) track.stop();
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
