import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

// Each deployed build's backend, by Vite mode: production's is the default
// mode, on the production cluster's own hostnames; next and demo are the two
// environments on the staging cluster.
for (const [mode, api, data, tiles, geocoding] of [
  ["production", "api", "data", "assets", "geocoding"],
  ["next", "api-next", "data-staging", "assets-staging", "geocoding-staging"],
  ["demo", "api-demo", "data-demo", "assets-demo", "geocoding-staging"],
]) {
  test(`${mode} build selects its own backend`, async () => {
    const result = await build({
      configFile: false,
      mode,
      logLevel: "silent",
      build: {
        write: false,
        lib: { entry: fileURLToPath(new URL("../../src/urls.ts", import.meta.url)), formats: ["es"] },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const chunk = outputs.flatMap((output) => ("output" in output ? output.output : []))
      .find((output) => output.type === "chunk");
    assert.ok(chunk && chunk.type === "chunk");
    const urls = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`);
    const origin = (host: string) => `https://${host}.meteocool.com`;
    assert.equal(urls.websocketBaseUrl, origin(api));
    assert.equal(urls.v3APIBaseUrl, `${origin(api)}/v3`);
    assert.equal(urls.dataUrl, origin(data));
    assert.equal(urls.tileBaseUrl, origin(tiles));
    assert.equal(urls.geocodingUrl, origin(geocoding));
  });
}
