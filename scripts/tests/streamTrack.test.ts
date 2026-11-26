import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* A decoder that hands back each frame it is given at once, as silence of a frame's length. */
class FakeDecoder {
  static isConfigSupported(): Promise<{ supported: boolean }> {
    return Promise.resolve({ supported: true });
  }
  state = "unconfigured";
  private readonly output: (data: unknown) => void;
  private rate = 44100;
  private channels = 2;
  constructor(init: { output: (data: unknown) => void }) {
    this.output = init.output;
  }
  configure(config: { sampleRate: number; numberOfChannels: number }): void {
    this.state = "configured";
    this.rate = config.sampleRate;
    this.channels = config.numberOfChannels;
  }
  decode(chunk: { timestamp: number; duration: number }): void {
    const count = Math.round((chunk.duration / 1e6) * this.rate);
    this.output({
      sampleRate: this.rate, numberOfFrames: count, numberOfChannels: this.channels, timestamp: chunk.timestamp, format: "f32-planar",
      copyTo: () => undefined, close: () => undefined,
    });
  }
  flush(): Promise<void> {
    return Promise.resolve();
  }
  close(): void {
    this.state = "closed";
  }
}
class FakeChunk {
  constructor(init: object) {
    Object.assign(this, init);
  }
}
Object.assign(globalThis, { AudioDecoder: FakeDecoder, EncodedAudioChunk: FakeChunk });

const { StreamTrack } = await import("../../src/lib/studio/flight/streamTrack");

/** What a context was asked to play: each buffer's start on its clock and its length, seconds. */
function fakeContext() {
  const started: Array<{ at: number; duration: number }> = [];
  const context = {
    currentTime: 0,
    sampleRate: 48000,
    createGain: () => ({ connect: () => undefined }),
    createBuffer: (channels: number, length: number, rate: number) => ({
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      const source = {
        buffer: null as { duration: number } | null,
        playbackRate: { value: 1 },
        onended: null,
        connect: () => undefined,
        disconnect: () => undefined,
        stop: () => undefined,
        start: (at: number) => started.push({ at, duration: source.buffer!.duration }),
      };
      return source;
    },
  };
  return { context, started };
}

test("a streamed file's buffers play one after another, without overlapping or gaps", async () => {
  const bytes = readFileSync(new URL("../../public/audio/thunder-near.mp3", import.meta.url));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(bytes)) as typeof fetch;
  try {
    const { context, started } = fakeContext();
    const track = new StreamTrack(context as unknown as AudioContext);
    track.src = "/audio/thunder-near.mp3";
    await track.play();
    // The file comes, and the first few seconds are decoded and scheduled.
    for (let tries = 0; tries < 50 && started.length < 4; tries += 1) await new Promise((done) => setTimeout(done, 10));
    track.pause();
    assert.ok(started.length >= 4, `${started.length} buffers scheduled`);
    for (let index = 1; index < started.length; index += 1) {
      const before = started[index - 1];
      assert.ok(Math.abs(started[index].at - (before.at + before.duration)) < 1e-6,
        `buffer ${index} starts at ${started[index].at}, where the one before ends (${before.at + before.duration})`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
