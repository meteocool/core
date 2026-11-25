import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { audioStart, readHeader, scanFrames, xingFrames } from "../../src/lib/studio/flight/mp3Frames";

const file = (name: string) => new Uint8Array(readFileSync(new URL(`../../public/audio/${name}`, import.meta.url)));

test("reads an MPEG-1 Layer III header", () => {
  // 128 kbit/s, 48 kHz, stereo, no padding: 384 bytes, 1152 samples.
  const header = readHeader(new Uint8Array([0xff, 0xfb, 0x94, 0x00]), 0);
  assert.deepEqual(header, { size: 384, sampleRate: 48000, channels: 2, samples: 1152, version: 1, layer: 3 });
  assert.equal(readHeader(new Uint8Array([0xff, 0xfb, 0xf4, 0x00]), 0), null, "bitrate index 15 is invalid");
  assert.equal(readHeader(new Uint8Array([0x49, 0x44, 0x33, 0x04]), 0), null);
});

test("skips an ID3v2 tag", () => {
  const tagged = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x01, 0x00]);
  assert.equal(audioStart(tagged), 10 + 128);
  assert.equal(audioStart(new Uint8Array([0xff, 0xfb, 0x94, 0, 0, 0, 0, 0, 0, 0])), 0);
  assert.equal(audioStart(new Uint8Array([0x49, 0x44])), null);
});

for (const name of ["theme.mp3", "menu.mp3", "thunder-near.mp3"]) {
  test(`cuts ${name} into frames end to end, and its Xing frame agrees`, () => {
    const bytes = file(name);
    const start = audioStart(bytes) ?? 0;
    const { frames, next } = scanFrames(bytes, start, true);
    assert.ok(frames.length > 100);
    for (let index = 1; index < frames.length; index += 1) {
      assert.equal(frames[index].offset, frames[index - 1].offset + frames[index - 1].size, `frame ${index} follows the one before`);
    }
    assert.ok(bytes.length - next < 1024, "nothing much is left over");
    const said = xingFrames(bytes, frames[0]);
    if (said !== null) assert.ok(Math.abs(said + 1 - frames.length) <= 1, `Xing says ${said}, ${frames.length} found`);
  });
}

test("cut as it comes, the frames are the same as cut whole", () => {
  const bytes = file("thunder-near.mp3");
  const whole = scanFrames(bytes, 0, true).frames;
  const pieces: Array<{ offset: number; size: number }> = [];
  let from = 0;
  for (let end = 5000; ; end += 5000) {
    const final = end >= bytes.length;
    const { frames, next } = scanFrames(bytes.subarray(0, Math.min(end, bytes.length)), from, final);
    pieces.push(...frames);
    from = next;
    if (final) break;
  }
  assert.deepEqual(pieces, whole);
});
