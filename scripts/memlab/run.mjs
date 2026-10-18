#!/usr/bin/env node
/*
 * Memory lab: runs the iOS page in an iOS simulator's Safari through a
 * scenario, and records what its web content process holds.
 *
 *   node scripts/memlab/run.mjs [--scenario mixed|playzoom|threed] [--cycles 2]
 *     [--backend staging|demo] [--device <udid>] [--port 8131] [--label name]
 *     [--app path/to/meteocool.app]
 *
 * With `--app`, a Debug simulator build of the iOS app is installed and runs
 * the scenario in its own web view instead of Safari.
 *
 * Every second it samples the footprint (what jetsam counts on a phone) of the
 * simulator's WebKit processes from the Mac, and the page's own count of GPU
 * memory (probe.js), which the simulator's footprint leaves out. The scenario
 * runs in the page (driver.js). Results go to scripts/memlab/out/<label>.json
 * and a summary per phase is printed.
 */
import { execFile as execFileCb } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const execFile = promisify(execFileCb);
const here = (file) => fileURLToPath(new URL(file, import.meta.url));

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "1" : all[i + 1]]);
  return pairs;
}, []));
const scenario = args.scenario ?? "mixed";
const cycles = Number(args.cycles ?? 2);
const backend = args.backend ?? "staging";
const port = Number(args.port ?? 8131);
const label = args.label ?? `${scenario}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const DEVICE_NAME = "memlab iPhone";

const BACKENDS = {
  staging: {},
  demo: { MC_API: "https://api-demo.meteocool.com", MC_DATA: "https://data-demo.meteocool.com", MC_TILES: "https://assets-demo.meteocool.com" },
};
Object.assign(process.env, BACKENDS[backend]);

const sh = async (cmd, ...rest) => (await execFile(cmd, rest, { maxBuffer: 64 * 1024 * 1024 })).stdout;

/** The memlab simulator: the one named, or ours, created on first use. */
async function device() {
  if (args.device) return args.device;
  const { devices } = JSON.parse(await sh("xcrun", "simctl", "list", "devices", "available", "-j"));
  const all = Object.entries(devices).flatMap(([runtime, list]) => list.map((d) => ({ ...d, runtime })));
  const ours = all.find((d) => d.name.startsWith(DEVICE_NAME));
  if (ours) return ours.udid;
  const { runtimes } = JSON.parse(await sh("xcrun", "simctl", "list", "runtimes", "-j"));
  const ios = runtimes.filter((r) => r.platform === "iOS" && r.isAvailable).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  const type = ios.supportedDeviceTypes.filter((t) => / Pro$/.test(t.name)).at(-1);
  return (await sh("xcrun", "simctl", "create", `${DEVICE_NAME} ${type.name.replace("iPhone ", "")}`, type.identifier, ios.identifier)).trim();
}

async function boot(udid) {
  await execFile("xcrun", ["simctl", "boot", udid]).catch(() => {});
  await sh("xcrun", "simctl", "bootstatus", udid, "-b");
  await execFile("xcrun", ["simctl", "location", udid, "set", "48.14,11.58"]).catch(() => {});
}

/** The WebKit processes of the simulator: pid → name. */
async function webkitProcesses(udid) {
  const launchd = (await sh("pgrep", "-f", `launchd_sim.*${udid}`)).trim().split("\n")[0];
  const out = await sh("ps", "-axo", "pid=,ppid=,comm=");
  const procs = new Map();
  for (const line of out.split("\n")) {
    const [pid, ppid, ...comm] = line.trim().split(/\s+/);
    const name = comm.join(" ").split("/").at(-1);
    if (ppid === launchd && /WebContent|WebKit\.GPU|WebKit\.Networking/.test(name)) procs.set(Number(pid), name.replace("com.apple.WebKit.", ""));
  }
  return procs;
}

/** Footprint in MB of each pid, as `footprint` counts it. */
async function footprints(pids) {
  if (!pids.length) return new Map();
  const out = await sh("footprint", ...pids.flatMap((pid) => ["-p", String(pid)])).catch((error) => error.stdout ?? "");
  const result = new Map();
  for (const match of out.matchAll(/\[(\d+)\]: 64-bit\s+Footprint: ([\d.]+) (KB|MB|GB)/g)) {
    const scale = { KB: 1 / 1024, MB: 1, GB: 1024 }[match[3]];
    result.set(Number(match[1]), Math.round(Number(match[2]) * scale));
  }
  return result;
}

const events = [];
let done = false;
let pageStarts = 0;

function memlabPlugin() {
  return {
    name: "memlab",
    transformIndexHtml(html, ctx) {
      if (!/^\/ios\.html$/.test(ctx.path)) return html;
      return [
        // The app opens ios.html with nothing in its query, so the scenario is handed over here.
        { tag: "script", children: `window.__memlabRun = ${JSON.stringify({ scenario, cycles, run: label })};`, injectTo: "head-prepend" },
        { tag: "script", attrs: { src: "/scripts/memlab/probe.js" }, injectTo: "head-prepend" },
        { tag: "script", attrs: { type: "module", src: "/scripts/memlab/driver.js" }, injectTo: "body" },
      ];
    },
    configureServer(server) {
      server.middlewares.use("/__memlab/event", (req, res) => {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          res.end("ok");
          try {
            const event = JSON.parse(body);
            event.host = Date.now();
            events.push(event);
            if (event.kind === "start") {
              pageStarts += 1;
              console.log(`  page ${event.page} started: ${event.href} (${event.visible}, ${event.w}x${event.h}@${event.dpr})`);
            }
            if (event.kind === "done") done = true;
            if (event.kind === "phase") console.log(`  · ${event.phase}`);
            if (event.kind === "note") console.log(`    ${event.note}`);
            if (event.kind === "error") console.log(`  ! ${event.message.split("\n")[0]}`);
          } catch { /* a torn beacon */ }
        });
      });
    },
  };
}

/**
 * Install the app, past its onboarding, and start it on this server's map
 * (its Debug simulator builds read MC_TEST_MAP and MC_TEST_API_URL).
 */
async function launchApp(udid) {
  const app = args.app;
  // A Safari tab left on a memlab page reconnects to the new server and runs the scenario too.
  await execFile("xcrun", ["simctl", "terminate", udid, "com.apple.mobilesafari"]).catch(() => {});
  const bundle = (await sh("plutil", "-extract", "CFBundleIdentifier", "raw", `${app}/Info.plist`)).trim();
  await execFile("xcrun", ["simctl", "terminate", udid, bundle]).catch(() => {});
  await sh("xcrun", "simctl", "install", udid, app);
  await execFile("xcrun", ["simctl", "privacy", udid, "grant", "location", bundle]).catch(() => {});
  const groups = await sh("xcrun", "simctl", "get_app_container", udid, bundle, "groups");
  for (const line of groups.split("\n")) {
    const [group, path] = line.trim().split(/\s+/);
    if (!group?.startsWith("group.") || !path) continue;
    // Through the simulator's own preferences daemon, which would not see a file written behind it.
    await sh("xcrun", "simctl", "spawn", udid, "defaults", "write", `${path}/Library/Preferences/${group}`, "onboardingDone", "-bool", "true");
  }
  await execFile("xcrun", ["simctl", "launch", udid, bundle], {
    env: { ...process.env, SIMCTL_CHILD_MC_TEST_MAP: "1", SIMCTL_CHILD_MC_TEST_API_URL: `http://127.0.0.1:${port}/` },
  });
}

async function main() {
  const udid = await device();
  console.log(`memlab: ${scenario} ×${cycles} on ${backend}, simulator ${udid}`);
  await boot(udid);

  const server = await createServer({
    configFile: here("../../vite.config.ts"),
    root: here("../.."),
    mode: "development",
    logLevel: "error",
    // Its own optimized dependencies: two runs side by side (or another dev
    // server) rewriting a shared cache leave the page on a 504 and blank.
    cacheDir: here(`../../node_modules/.vite-memlab-${port}`),
    // A checkout whose node_modules is a link to another's (to compare two at once) serves from both.
    server: { port, strictPort: true, host: "127.0.0.1", fs: { allow: [here("../.."), realpathSync(here("../../node_modules"))] } },
    plugins: [memlabPlugin()],
  });
  await server.listen();

  if (args.app) await launchApp(udid);
  else {
    // A fresh Safari each run: nothing left from the last one in its process.
    await execFile("xcrun", ["simctl", "terminate", udid, "com.apple.mobilesafari"]).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const url = `http://localhost:${port}/ios.html?memlab=${scenario}&cycles=${cycles}&run=${encodeURIComponent(label)}&latLonZ=50.5,9.5,6`;
    await sh("xcrun", "simctl", "openurl", udid, url);
  }

  const samples = [];
  const started = Date.now();
  const timeout = Number(args.timeout ?? 30 * 60) * 1000;
  let seenPages = new Set();
  while (!done && Date.now() - started < timeout) {
    const procs = await webkitProcesses(udid);
    const fp = await footprints([...procs.keys()]);
    const row = { host: Date.now(), procs: {} };
    let content = 0;
    for (const [pid, name] of procs) {
      const mb = fp.get(pid);
      if (mb === undefined) continue;
      row.procs[pid] = { name, mb };
      if (name === "WebContent" && mb > content) { content = mb; row.contentPid = pid; }
      if (name === "GPU") row.gpuProc = mb;
    }
    row.content = content;
    // What the content process's footprint is made of, now and then.
    if (row.contentPid && samples.length % 15 === 0) {
      const detail = await sh("footprint", "-p", String(row.contentPid)).catch(() => "");
      row.categories = Object.fromEntries([...detail.matchAll(/^\s*([\d.]+ [KMG]?B)\s+[\d.]+ [KMG]?B\s+[\d.]+ [KMG]?B\s+\d+\s+(.+)$/gm)]
        .slice(0, 8).map(([, dirty, name]) => [name.trim(), dirty]));
    }
    if (row.contentPid && content > 100) seenPages.add(row.contentPid);
    samples.push(row);
    const last = events.findLast((e) => e.kind === "sample");
    if (process.stdout.isTTY) process.stdout.write(`\r  t=${Math.round((Date.now() - started) / 1000)}s content=${content}MB gpuEst=${last?.probe?.gpuMB ?? "?"}MB phase=${last?.phase ?? "-"}      `);
    if (!pageStarts && Date.now() - started > 120_000) {
      console.log("!! the page never started the scenario: see it in the simulator");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (process.stdout.isTTY) process.stdout.write("\n");
  await server.close();

  // Pair each footprint with the page sample nearest in time.
  const pageSamples = events.filter((e) => e.kind === "sample");
  const rows = samples.map((row) => {
    let best = null;
    for (const e of pageSamples) if (!best || Math.abs(e.host - row.host) < Math.abs(best.host - row.host)) best = e;
    const near = best && Math.abs(best.host - row.host) < 3000 ? best : null;
    return { ...row, phase: near?.phase ?? "load", probe: near?.probe ?? null, zoom: near?.zoom, cap: near?.cap, olTiles: near?.olTiles, glLayers: near?.glLayers, glTargets: near?.glTargets, tileFetches: near?.tileFetches };
  });

  const phases = new Map();
  for (const row of rows) {
    const key = row.phase.replace(/ \d+$/, "") + (/\d+$/.test(row.phase) ? ` #${row.phase.match(/\d+$/)[0]}` : "");
    const p = phases.get(key) ?? {
      phase: key, contentPeak: 0, gpuEstPeak: 0, totalPeak: 0, texPeak: 0, contexts: 0, olTilesPeak: 0, glLayersPeak: 0, glTargetsPeak: 0, tileFetches: 0, seconds: 0,
    };
    const gpu = row.probe?.gpuMB ?? 0;
    p.contentPeak = Math.max(p.contentPeak, row.content);
    p.gpuEstPeak = Math.max(p.gpuEstPeak, Math.round(gpu));
    p.totalPeak = Math.max(p.totalPeak, Math.round(row.content + gpu));
    p.texPeak = Math.max(p.texPeak, Math.round(row.probe?.texMB ?? 0));
    p.contexts = Math.max(p.contexts, row.probe?.contexts ?? 0);
    p.olTilesPeak = Math.max(p.olTilesPeak, row.olTiles ?? 0);
    p.glLayersPeak = Math.max(p.glLayersPeak, row.glLayers ?? 0);
    p.glTargetsPeak = Math.max(p.glTargetsPeak, row.glTargets ?? 0);
    p.tileFetches = Math.max(p.tileFetches, row.tileFetches ?? 0);
    p.seconds += 1;
    phases.set(key, p);
  }
  const summary = {
    label, scenario, cycles, backend, udid,
    finished: done, pageStarts, contentProcesses: seenPages.size,
    peakContent: Math.max(...rows.map((r) => r.content)),
    peakGpuEst: Math.max(...rows.map((r) => r.probe?.gpuMB ?? 0)),
    peakTotal: Math.max(...rows.map((r) => r.content + (r.probe?.gpuMB ?? 0))),
    endTotal: rows.length ? Math.round(rows.at(-1).content + (rows.at(-1).probe?.gpuMB ?? 0)) : 0,
    errors: events.filter((e) => e.kind === "error").map((e) => e.message.split("\n")[0]),
  };

  mkdirSync(here("out"), { recursive: true });
  writeFileSync(here(`out/${label}.json`), JSON.stringify({ summary, phases: [...phases.values()], rows, events }, null, 1));
  console.table([...phases.values()]);
  console.log(JSON.stringify(summary, null, 1));
  if (pageStarts > 1 || seenPages.size > 1) console.log("!! the page was reloaded or its process replaced during the run: a crash");
  if (!done) console.log("!! the scenario did not finish");
}

if (args.compare) {
  // node run.mjs --compare a.json b.json: peaks side by side.
  const [a, b] = process.argv.slice(process.argv.indexOf("--compare") + 1).map((f) => JSON.parse(readFileSync(f, "utf8")));
  const keys = new Set([...a.phases, ...b.phases].map((p) => p.phase));
  console.table([...keys].map((phase) => {
    const pa = a.phases.find((p) => p.phase === phase); const pb = b.phases.find((p) => p.phase === phase);
    return { phase, [`${a.summary.label} total`]: pa?.totalPeak, [`${b.summary.label} total`]: pb?.totalPeak, "Δ": (pb?.totalPeak ?? 0) - (pa?.totalPeak ?? 0) };
  }));
} else {
  main().catch((error) => { console.error(error); process.exit(1); });
}
