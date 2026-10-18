/*
 * Drives the map through a scenario and reports what it holds, once a second.
 *
 * Runs in the page under test when its URL has `memlab=<scenario>` (run.mjs
 * opens it so). Uses only what the apps use from outside: `window.lm`,
 * `window.settings` and the player's buttons. Each sample is posted to the
 * harness, which pairs it with the web content process's footprint.
 */
const params = new URLSearchParams(location.search);
const handed = window.__memlabRun ?? {};
const scenario = params.get("memlab") ?? handed.scenario;
const cycles = Number(params.get("cycles") ?? handed.cycles ?? 2);
const run = params.get("run") ?? handed.run ?? "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let phase = "load";
const t0 = performance.now();
const page = Math.random().toString(36).slice(2, 8);

function post(kind, body) {
  return fetch("/__memlab/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, run, page, phase, t: Math.round(performance.now() - t0), at: Date.now(), ...body }),
    keepalive: true,
  }).catch(() => {});
}

function sample() {
  const probe = window.__memlab?.snapshot();
  const map = window.lm?.getCurrentMap?.();
  const view = map?.getView?.();
  let tiles = 0;
  let renderers = 0;
  let glLayers = 0;
  let glTargets = 0;
  try {
    window.lm?.forEachMap((m) => m.getAllLayers().forEach((layer) => {
      if (!layer.hasRenderer?.()) return;
      renderers += 1;
      const renderer = layer.getRenderer();
      if (renderer.tileRepresentationCache) {
        glLayers += 1;
        if (renderer.helper?.postProcessPasses_?.some((pass) => pass.renderTargetTextureSize_)) glTargets += 1;
      }
      tiles += renderer?.tileRepresentationCache?.getCount?.() ?? renderer?.tileCache_?.getCount?.() ?? 0;
    }));
  } catch { /* not every renderer has a cache */ }
  // Radar tiles asked for so far, cumulative: a cache too small for playback asks for the same ones again.
  const tileFetches = performance.getEntriesByType("resource").filter((entry) => /\/meteo(radar|nowcast)\/.*\.png/.test(entry.name)).length;
  post("sample", { probe, zoom: view?.getZoom?.(), cap: window.lm?.currentCap, olTiles: tiles, renderers, glLayers, glTargets, tileFetches });
}

async function until(test, timeout = 60_000, what = "condition") {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    try { if (test()) return; } catch { /* not there yet */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function step(name) {
  phase = name;
  post("phase", {});
}

const flatMap = () => window.lm.getCapability("radar").getMap();
const playButton = () => document.querySelector("button.controlButton.play");
const playing = () => Boolean(document.querySelector("button.controlButton.play.playing"));

/** Fly the flat map, the way a pinch does it: through every zoom on the way. */
function fly(center, zoom, duration = 1500) {
  const view = flatMap().getView();
  const x = (center[1] * Math.PI * 6378137) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + (center[0] * Math.PI) / 360)) * 6378137;
  return new Promise((resolve) => view.animate({ center: [x, y], zoom, duration }, resolve));
}

/** A pinch of steps: many small zooms in a row, each rendering in between. */
async function pinch(from, to, ms = 2000) {
  const view = flatMap().getView();
  const steps = Math.max(1, Math.round(ms / 50));
  for (let i = 1; i <= steps; i += 1) {
    view.setZoom(from + ((to - from) * i) / steps);
    await sleep(50);
  }
}

async function setPlaying(on) {
  if (playing() === on) return;
  playButton()?.click();
  await sleep(500);
}

/** Wait, pressing play again whenever playback has stopped. */
async function keepPlaying(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (!playing()) {
      post("note", { note: "playback had stopped; play again" });
      await setPlaying(true);
    }
    await sleep(1000);
  }
}

const PRODUCTS = ["hx", "merged", "colmax", "dmax"];
let product = 0;
function nextProduct() {
  product = (product + 1) % PRODUCTS.length;
  window.settings.set("radarProduct", PRODUCTS[product]);
  post("note", { note: `product ${PRODUCTS[product]}` });
}

/** Stops over Germany and its neighbours, at the zooms people look at radar. */
const STOPS = [
  [[50.5, 9.5], 6], [[48.1, 11.6], 9], [[48.1, 11.6], 11], [[51.0, 10.0], 5],
  [[53.5, 10.0], 8], [[52.5, 13.4], 10], [[50.0, 8.0], 7], [[47.5, 9.5], 12],
  [[49.0, 12.0], 4], [[51.5, 7.0], 9],
];

async function zoomTourWhilePlaying(cycle) {
  step(`play+zoom ${cycle}`);
  await setPlaying(true);
  for (const [i, [center, zoom]] of STOPS.entries()) {
    await fly(center, zoom);
    if (i % 3 === 2) nextProduct();
    await keepPlaying(6000);
    if (i % 4 === 3) {
      const z = flatMap().getView().getZoom();
      await pinch(z, Math.max(3, z - 3));
      await pinch(Math.max(3, z - 3), z + 1);
      await keepPlaying(4000);
    }
  }
}

async function scrub(cycle) {
  step(`scrub ${cycle}`);
  await setPlaying(false);
  const slider = document.querySelector("[role='slider']");
  slider?.focus();
  for (let i = 0; i < 48; i += 1) {
    slider?.dispatchEvent(new KeyboardEvent("keydown", { key: i < 24 ? "ArrowLeft" : "ArrowRight", bubbles: true }));
    await sleep(250);
  }
}

async function to3d(cycle) {
  if (!window.lm.getCapability("cells3d")) return;
  step(`3d ${cycle}`);
  await setPlaying(false);
  window.lm.setTarget("cells3d", "map");
  await sleep(20_000);
  step(`back to 2d ${cycle}`);
  window.lm.setTarget("radar", "map");
  await sleep(8000);
}

const SCENARIOS = {
  async mixed() {
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      await zoomTourWhilePlaying(cycle);
      await scrub(cycle);
      await to3d(cycle);
    }
  },
  async playzoom() {
    for (let cycle = 1; cycle <= cycles; cycle += 1) await zoomTourWhilePlaying(cycle);
  },
  async threed() {
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      await fly([48.1, 11.6], 8);
      await setPlaying(true);
      await keepPlaying(15_000);
      await to3d(cycle);
    }
  },
};

async function main() {
  performance.setResourceTimingBufferSize(1_000_000);
  const ticker = setInterval(sample, 1000);
  post("start", { scenario, cycles, ua: navigator.userAgent, dpr: devicePixelRatio, w: innerWidth, h: innerHeight, href: location.href, visible: document.visibilityState });
  try {
    await until(() => window.lm?.getCapability("radar") && playButton(), 60_000, "the radar map");
    step("settle");
    await sleep(10_000);
    await SCENARIOS[scenario]();
    step("idle");
    await setPlaying(false);
    await sleep(15_000);
    post("done", {});
  } catch (error) {
    post("error", { message: String(error?.stack ?? error) });
  } finally {
    clearInterval(ticker);
  }
}

window.addEventListener("error", (event) => post("error", { message: String(event.error?.stack ?? event.message) }));
if (scenario && SCENARIOS[scenario]) main();
