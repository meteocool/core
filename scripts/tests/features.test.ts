import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadEnv } from "vite";

/**
 * Which features each deployment's build offers (src/features.ts), as Vite
 * reads them for its mode: production's build is `vite build` with no mode,
 * next's and demo's name theirs, and the dev server and the UI tests run in
 * development.
 */

const root = new URL("../../", import.meta.url).pathname;
const FLAGS = ["VITE_FEATURE_STORM_STYLES", "VITE_FEATURE_STUDIO", "VITE_FEATURE_METEOAIR"];

/** Each flag the module reads is one the env files set, and the other way about. */
test("src/features.ts reads every flag and no other", () => {
  const source = readFileSync(`${root}src/features.ts`, "utf8");
  const read = [...source.matchAll(/import\.meta\.env\.(VITE_FEATURE_\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(read, [...FLAGS].sort());
});

test("production offers none of them", () => {
  const env = loadEnv("production", root, "VITE_FEATURE_");
  for (const flag of FLAGS) assert.equal(env[flag], "0", flag);
});

for (const mode of ["next", "demo", "development"]) {
  test(`${mode} offers all of them`, () => {
    const env = loadEnv(mode, root, "VITE_FEATURE_");
    for (const flag of FLAGS) assert.equal(env[flag], "1", flag);
  });
}
