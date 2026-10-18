import assert from "node:assert/strict";
import test from "node:test";
import { deletePasses, type PassResources } from "../../src/lib/webglRelease.ts";

/** A context that records what is deleted. */
function fakeGl(lost = false) {
  const deleted: string[] = [];
  const record = (kind: string) => (object: unknown) => { deleted.push(`${kind}:${String(object)}`); };
  return {
    deleted,
    gl: {
      deleteTexture: record("texture"),
      deleteFramebuffer: record("framebuffer"),
      deleteRenderbuffer: record("renderbuffer"),
      deleteProgram: record("program"),
      deleteBuffer: record("buffer"),
      isContextLost: () => lost,
    },
  };
}

const pass = (): PassResources => ({
  renderTargetTexture_: "target" as unknown as WebGLTexture,
  frameBuffer_: "fb" as unknown as WebGLFramebuffer,
  depthBuffer_: "depth" as unknown as WebGLRenderbuffer,
  renderTargetProgram_: "program" as unknown as WebGLProgram,
  renderTargetVerticesBuffer_: "quad" as unknown as WebGLBuffer,
});

test("a disposed layer's pass gives back its target, depth buffer and what draws it", () => {
  const { gl, deleted } = fakeGl();
  deletePasses(gl, [pass()]);
  assert.deepEqual(deleted, ["texture:target", "framebuffer:fb", "renderbuffer:depth", "program:program", "buffer:quad"]);
});

test("a pass is deleted once, however often its helper is disposed", () => {
  const { gl, deleted } = fakeGl();
  const passes = [pass()];
  deletePasses(gl, passes);
  deletePasses(gl, passes);
  assert.equal(deleted.length, 5);
});

test("nothing is deleted on a lost context, which took it all already", () => {
  const { gl, deleted } = fakeGl(true);
  deletePasses(gl, [pass()]);
  assert.deepEqual(deleted, []);
});
