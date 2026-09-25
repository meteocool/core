<script lang="ts">
/**
 * The diagnostics behind the status pill.
 *
 * Everything here is read from something the app already has -- stores,
 * PerformanceResourceTiming, the Storage and Cache APIs, the radar grid -- so
 * opening it costs no requests and cannot itself change what it is measuring.
 * Written for someone trying to work out why the map looks wrong: the point is
 * to make "slow connection" or "stale tiles" answerable without a debugger.
 */
import { onDestroy, onMount } from "svelte";
import GlassPanel from "./GlassPanel.svelte";
import { _ } from "svelte-i18n";
import {
  apiHealth, capLastUpdated, degradedStatus, latLon, mapBaseLayer, networkStatus,
  radarCadence, sharedActiveCap, tileStatus, zoomlevel,
  precacheForecast,
} from "../stores";
import { get } from "svelte/store";
import { dataUrl, tileBaseUrl, v3APIBaseUrl, websocketBaseUrl } from "../urls";
import { summariseRequests } from "../lib/requestTiming";
import { DEGRADED_CRITERIA, isApiDegraded } from "../lib/degraded";
import { LATENCY_WINDOW_MS, readDegradedSignals } from "../lib/degradedStatus";
import { MIN_INTERVALS, overdueBy } from "../lib/updateCadence";
import {
  BASEMAP_CACHE, BASEMAP_ROUTE, WEATHER_TILE_CACHE, WEATHER_TILE_ROUTE,
} from "../lib/tileCacheRoutes";
import type RadarCapability from "../caps/RadarCapability";

export let cap: RadarCapability;

/** Re-read while open: most of this goes stale within seconds. */
const REFRESH_MS = 2000;

/**
 * A reading, and how bad it is.
 *
 * "bad" is reserved for something that is actually stopping the map working
 * right now; "warn" is for a reading that explains a degraded experience
 * without being broken. Everything else is unmarked, which matters more than
 * the colours do: a panel where half the rows are amber is a panel nobody
 * reads. Thresholds are named below rather than inlined, so what counts as bad
 * is arguable in one place.
 */
type Severity = "bad" | "warn" | undefined;
type Row = [string, string, Severity?];
type Section = { title: string; rows: Row[] };

/** Past this the map feels broken; past WARN it feels slow. */
const LATENCY_BAD_MS = 2000;
const LATENCY_WARN_MS = 800;
/** Radar publishes every 5 minutes, so twice that is a missed cycle. */
const STALE_BAD_S = 900;
const STALE_WARN_S = 600;
/** A clock this far out makes every "x minutes ago" on this panel a lie. */
const SKEW_BAD_S = 120;
const SKEW_WARN_S = 30;

const worseOf = (ms: number | null, bad = LATENCY_BAD_MS, warn = LATENCY_WARN_MS): Severity => {
  if (ms == null) return undefined;
  if (ms >= bad) return "bad";
  return ms >= warn ? "warn" : undefined;
};

/** Age in seconds of a timestamp in epoch milliseconds. */
const ageS = (at: number | null | undefined) => (
  at == null ? null : Math.round((Date.now() - at) / 1000)
);

const stale = (at: number | null | undefined, bad = STALE_BAD_S, warn = STALE_WARN_S): Severity => {
  const age = ageS(at);
  if (age == null) return "bad";
  if (age >= bad) return "bad";
  return age >= warn ? "warn" : undefined;
};

let sections: Section[] = [];
let steps: Array<{ minutes: number; kind: string; title: string }> = [];
let storage: Row[] = [];
let tileCache: Row[] = [];
let services: ServiceRow[] = [];

const num = (v: unknown, digits = 0) => (typeof v === "number" && Number.isFinite(v)
  ? v.toFixed(digits) : "—");

function ago(at: number | null | undefined): string {
  if (at == null) return "never";
  const s = Math.round((Date.now() - at) / 1000);
  if (Math.abs(s) < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  return Math.abs(m) < 90 ? `${m}m ago` : `${(m / 60).toFixed(1)}h ago`;
}

/** A span in seconds, as "40s" / "2m10s" / "1h05m". Sign is the caller's. */
function duration(s: number): string {
  const abs = Math.abs(Math.round(s));
  if (abs < 90) return `${abs}s`;
  const m = Math.floor(abs / 60);
  if (m < 90) return `${m}m${String(abs % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

function bytes(b: number | undefined): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KiB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MiB`;
  return `${(b / 1024 ** 3).toFixed(2)} GiB`;
}

function quantile(sorted: number[], q: number): number | undefined {
  if (!sorted.length) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/** Timing summary over the rolling window kept by lib/requestTiming. */
/**
 * The services worth timing separately.
 *
 * Two lists of key/value rows could not answer "is it the API or the tiles",
 * let alone "is it this one endpoint": every request the page makes went into
 * one of two buckets. One row per service makes the slow one obvious by
 * sitting next to the others.
 *
 * Ordered roughly by how much a stall in each one hurts. The patterns are
 * matched against the full URL, so they work whether the build talks to the
 * dev proxy's relative paths or to an absolute origin.
 */
const SERVICES: Array<{ name: string; match: RegExp }> = [
  { name: "radar grid", match: /\/v3\/radar\/timeseries/ },
  { name: "api (other)", match: /\/v3\/(?!radar\/timeseries)/ },
  { name: "radar tiles", match: /(\/tiles\/|tiles-a\.meteocool|assets-staging\.meteocool).*\.png/ },
  { name: "basemap", match: /map\.meteocool\.com|\.mvt(\?|$)/ },
  { name: "lightning", match: /lightning_cache|\/lightning/ },
  { name: "mesocyclones", match: /mesocyclone/ },
  { name: "geocoder", match: /bigdatacloud|\/geocoding\/|geocoding-staging\.meteocool|geocoding\.meteocool/ },
  { name: "websocket poll", match: /socket\.io/ },
];

type ServiceRow = {
  name: string;
  count: number;
  median: string;
  medianSeverity: Severity;
  p95: string;
  p95Severity: Severity;
  slowest: string;
  slowestSeverity: Severity;
  last: string;
  lastSeverity: Severity;
  transferred: string;
  cached: string;
};

function serviceRows(): ServiceRow[] {
  return SERVICES.map(({ name, match }) => {
    const t = summariseRequests(match);
    return {
      name,
      count: t.count,
      median: t.count ? num(t.medianMs, 0) : "—",
      medianSeverity: worseOf(t.medianMs),
      p95: t.count ? num(t.p95Ms, 0) : "—",
      p95Severity: worseOf(t.p95Ms),
      slowest: t.count ? num(t.slowestMs, 0) : "—",
      slowestSeverity: worseOf(t.slowestMs),
      last: t.count ? num(t.lastMs, 0) : "—",
      lastSeverity: worseOf(t.lastMs),
      transferred: t.count ? bytes(t.transferredBytes) : "—",
      cached: t.count ? `${t.fromCache}` : "—",
    };
  });
}

/**
 * What the backend has refused to do.
 *
 * Separate from the timing rows because a request that 500s is fast: it lands
 * in the median like any other, and a panel that only reported latency would
 * show a perfectly healthy service that is answering nothing but errors.
 */
function errorRows(): Row[] {
  const health = $apiHealth;
  const broken = isApiDegraded(health);
  const out: Row[] = [
    // A call that failed and recovered is history; one failing now is the fault.
    ["failed calls", `${health.failures}`, health.failures ? "warn" : undefined],
    [
      "failing now",
      health.failing.length ? health.failing.join(", ") : "none",
      broken ? "bad" : undefined,
    ],
    [
      "last failure",
      health.lastFailureAt ? ago(health.lastFailureAt) : "never",
      broken ? "bad" : undefined,
    ],
  ];
  /* Unflagged, and above the failures rather than among them: an endpoint that
     has nothing published is not a fault and does not put the map in its
     degraded state, but "why is there no Swiss radar" still deserves an answer
     somewhere, and this is the panel that answers it. */
  if (health.absent.length) out.push(["nothing published", health.absent.join(", ")]);
  for (const [endpoint, count] of Object.entries(health.byEndpoint)) {
    out.push([endpoint, `${count} failed`, health.failing.includes(endpoint) ? "bad" : "warn"]);
  }
  if (health.lastMessage) {
    out.push(["last message", health.lastMessage.slice(0, 160), broken ? "bad" : undefined]);
  }
  return out;
}

/** Everything the page asked for, however it was routed. */
function allTraffic(): Row[] {
  const t = summariseRequests(/./);
  if (!t.count) return [["requests", "none observed"]];
  return [
    ["window", `${num((t.oldestAgeMs ?? 0) / 1000, 0)}s`],
    ["requests", `${t.count}`],
    ["median", `${num(t.medianMs, 0)} ms`, worseOf(t.medianMs)],
    ["p95", `${num(t.p95Ms, 0)} ms`, worseOf(t.p95Ms)],
    ["slowest", `${num(t.slowestMs, 0)} ms`, worseOf(t.slowestMs)],
    ["transferred", bytes(t.transferredBytes)],
    ["served from cache", `${t.fromCache}`],
  ];
}

/** The effectiveType buckets networkQuality.ts treats as degraded. */
const SLOW_EFFECTIVE_TYPES = ["slow-2g", "2g"];

function connectionRows(): Row[] {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  };
  const c = nav.connection;
  const net = $networkStatus;
  return [
    ["online", String(net.online), net.online ? undefined : "bad"],
    [
      "effective type",
      net.effectiveType ?? "unreported",
      net.effectiveType && SLOW_EFFECTIVE_TYPES.includes(net.effectiveType) ? "warn" : undefined,
    ],
    ["downlink", c?.downlink != null ? `${c.downlink} Mbit/s (estimate)` : "—"],
    // The estimate, not a measurement -- flagged only when it is bad enough to
    // explain something, never as the reason on its own.
    ["round trip", c?.rtt != null ? `${c.rtt} ms (estimate)` : "—", worseOf(c?.rtt ?? null)],
    ["save data", c?.saveData != null ? String(c.saveData) : "—", c?.saveData ? "warn" : undefined],
    ["reads as slow", String(net.isSlow), net.isSlow ? "warn" : undefined],
    ["NetworkInformation API", c ? "present" : "absent"],
  ];
}

function endpointRows(): Row[] {
  return [
    ["build mode", import.meta.env.MODE],
    ["commit", (typeof __GIT_COMMIT_HASH__ === "string" && __GIT_COMMIT_HASH__) || "unset"],
    ["api", v3APIBaseUrl || "(same origin)"],
    ["tiles", tileBaseUrl || "(same origin)"],
    ["data", dataUrl || "(same origin)"],
    ["websocket", websocketBaseUrl || "(same origin)"],
    [
      "poke channel",
      cap.socketConnected === null ? "—" : (cap.socketConnected ? "connected" : "disconnected"),
      // Without it the map only refreshes on its own timer, which is a real
      // degradation even though every request still works.
      cap.socketConnected === false ? "warn" : undefined,
    ],
  ];
}

function freshnessRows(): Row[] {
  const grid = cap.clientGrid ?? {};
  const processed = Object.values(grid)
    .map((f) => (f ? f.processed_time : null))
    .filter((t): t is number => typeof t === "number" && t > 0);
  const newest = processed.length ? Math.max(...processed) : null;
  const skew = cap.serverTime ? Math.round(Date.now() / 1000 - cap.serverTime) : null;
  const lastUpdate = $capLastUpdated ? $capLastUpdated.getTime() : null;
  return [
    ["radar processed", ago(lastUpdate), stale(lastUpdate)],
    ["newest frame built", ago(newest ? newest * 1000 : null), stale(newest ? newest * 1000 : null)],
    ["last tile arrived", ago($tileStatus.lastSuccessAt), stale($tileStatus.lastSuccessAt)],
    ...cadenceRows(),
    [
      "server clock vs ours",
      skew === null ? "—" : `${skew > 0 ? "+" : ""}${skew}s`,
      skew === null ? undefined : worseOf(Math.abs(skew), SKEW_BAD_S, SKEW_WARN_S),
    ],
    ["tracking mode", cap.trackingMode],
  ];
}

/**
 * When the next set of tiles is due, from the rhythm of the ones that arrived.
 *
 * Not "five minutes after the last one": that is the nominal cycle, and the
 * useful question is when a frame will actually land, which slips with the
 * pipeline's lag and is different again on staging. The period is the median
 * gap between the observations this session has seen published, so the answer
 * is about this backend on this day. lib/updateCadence.ts does the measuring;
 * RadarCapability keeps it current, so this reads rather than computes.
 *
 * Marked amber once it is a whole period late and red at two, which is the
 * point at which the map is showing something nobody would call current.
 */
function cadenceRows(): Row[] {
  const cadence = $radarCadence;
  if (cadence.periodS === null) {
    return [[
      "next update expected",
      cadence.samples
        ? `learning — ${cadence.samples} of ${MIN_INTERVALS} intervals seen`
        : "learning — no frames observed yet",
    ]];
  }
  const late = overdueBy(cadence, Date.now() / 1000) ?? 0;
  const severity: Severity = late >= cadence.periodS * 2
    ? "bad"
    : (late >= cadence.periodS ? "warn" : undefined);
  return [
    [
      "next update expected",
      late >= 0 ? `overdue by ${duration(late)}` : `in ${duration(late)}`,
      severity,
    ],
    [
      "observed cadence",
      `every ${duration(cadence.periodS)} (median of ${cadence.samples} intervals)`,
    ],
  ];
}

/**
 * Every criterion that can put the map in its degraded state, and whether it
 * is tripped right now.
 *
 * Read straight off lib/degraded.ts rather than restated here, so the panel
 * cannot end up describing a set of rules the pill no longer uses -- and so a
 * criterion that has cleared is visibly listed as clear, which is the question
 * someone watching a recovery actually has.
 */
function degradedRows(): Row[] {
  const now = Date.now();
  const signals = readDegradedSignals(now);
  const rows: Row[] = [[
    "state",
    $degradedStatus.degraded ? "degraded" : "ok",
    $degradedStatus.degraded ? "bad" : undefined,
  ]];
  for (const criterion of DEGRADED_CRITERIA) {
    const reason = criterion.reason(signals, now);
    rows.push([criterion.label, reason ?? "ok", reason ? "bad" : undefined]);
  }
  /* The measurement behind the latency criterion, whether or not it tripped:
     "response times ok" over two samples is a different claim from the same
     words over forty, and this is the row that says which. */
  const window = duration(LATENCY_WINDOW_MS / 1000);
  rows.push([
    "latency window",
    signals.recentSamples
      ? `p95 ${num(signals.recentP95Ms, 0)} ms over ${signals.recentSamples} api`
        + ` ${signals.recentSamples === 1 ? "response" : "responses"} in the last ${window}`
      : `no api responses in the last ${window}`,
  ]);
  return rows;
}

function gridRows(): Row[] {
  const grid = cap.clientGrid ?? {};
  const keys = Object.keys(grid).map(Number).sort((a, b) => a - b);
  const frames = keys.map((k) => grid[k]);
  const filled = frames.filter((f) => f && f.url);
  const obs = filled.filter((f) => f!.source === "observation").length;
  const withDbz = frames.filter((f) => f && f.dbz != null).length;
  const config = cap.clientGridConfig;
  const lastPlayable = cap.getLastPlayableStep();
  // How long after a frame's own timestamp it was produced: the pipeline's lag.
  const lags = keys
    .map((k) => (grid[k]?.processed_time ? grid[k]!.processed_time - k : null))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  return [
    ["steps", `${keys.length}`],
    ["filled", `${filled.length} (${obs} observation, ${filled.length - obs} forecast)`],
    ["with reflectivity", `${withDbz}${withDbz === 0 ? " — no position shared?" : ""}`],
    ["window", config ? `${(config.start - config.now) / 60}m … ${(config.end - config.now) / 60}m` : "—"],
    ["playable to", config ? `${(lastPlayable - config.now) / 60}m` : "—"],
    ["unpublished tail", config ? `${Math.max(0, (config.end - lastPlayable) / 60)}m` : "—"],
    ["pipeline lag", lags.length ? `${num(quantile(lags, 0.5), 0)}s median, ${num(lags[lags.length - 1], 0)}s worst` : "—"],
  ];
}

function contextRows(): Row[] {
  const pos = $latLon;
  return [
    ["capability", $sharedActiveCap || "—"],
    ["basemap", $mapBaseLayer],
    ["chrome scheme", document.documentElement.dataset.chrome ?? "—"],
    ["colour scheme", document.documentElement.dataset.theme ?? "—"],
    ["position", pos ? `${pos[0].toFixed(4)}, ${pos[1].toFixed(4)}` : "not shared"],
    ["zoom", num($zoomlevel, 1)],
    ["viewport", `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`],
  ];
}

/**
 * Whether the tiles on screen are actually being cached.
 *
 * Worth its own section because the answer is not obvious and is usually no:
 * the service worker only routes tiles-a.meteocool.com, so a staging build
 * (assets-staging) or a dev build (the vite proxy) requests tiles the worker
 * never sees, and nothing is cached however healthy the panel otherwise looks.
 * That is what "routed" reports -- against the worker's own patterns, imported
 * rather than restated, so this cannot go on claiming a route that moved.
 *
 * "frames warmed" then counts how many of the grid's tilesets have at least one
 * tile in the cache, which is the closest thing to "could this play offline".
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/* A plain record rather than a Set: this is a local tally inside one async
   read, never rendered from directly, and the reactive collections the lint
   rule is about would buy nothing here. */
type IdSet = Record<string, true>;

async function cachedTilesetIds(): Promise<{ entries: number; ids: IdSet } | null> {
  if (typeof caches === "undefined") return null;
  if (!(await caches.keys()).includes(WEATHER_TILE_CACHE)) return { entries: 0, ids: {} };
  const keys = await (await caches.open(WEATHER_TILE_CACHE)).keys();
  const ids: IdSet = {};
  for (const request of keys) {
    for (const match of request.url.matchAll(UUID)) ids[match[0]] = true;
  }
  return { entries: keys.length, ids };
}

async function readTileCache(): Promise<Row[]> {
  const out: Row[] = [];
  // A URL shaped like the ones the radar layer builds, to test the route with.
  const sample = `${tileBaseUrl}/bucket/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}/8/1/1.png`;
  const routed = WEATHER_TILE_ROUTE.test(sample);
  out.push(["tiles routed", routed ? "yes" : "no — not cached", routed ? undefined : "warn"]);
  if (!routed) out.push(["tile origin", tileBaseUrl || "(same origin)"]);
  out.push(["basemap routed", BASEMAP_ROUTE.test("https://map.meteocool.com/x/1/1/1.mvt") ? "yes" : "no"]);

  try {
    const cached = await cachedTilesetIds();
    if (cached) {
      out.push(["cached tiles", `${cached.entries}`]);
      out.push(["cached tilesets", `${Object.keys(cached.ids).length}`]);
      const wanted: IdSet = {};
      for (const frame of Object.values(cap.clientGrid ?? {})) {
        if (frame?.tile_id) wanted[frame.tile_id] = true;
      }
      const ids = Object.keys(wanted);
      const warmed = ids.filter((id) => cached.ids[id]).length;
      out.push([
        "frames warmed",
        ids.length ? `${warmed} of ${ids.length}` : "no tilesets yet",
        ids.length && warmed === 0 ? "warn" : undefined,
      ]);
    }
    if (typeof caches !== "undefined" && (await caches.keys()).includes(BASEMAP_CACHE)) {
      out.push(["basemap tiles", `${(await (await caches.open(BASEMAP_CACHE)).keys()).length}`]);
    }
  } catch { /* cross-origin, disabled, or private mode */ }

  /* The "preload forecast" setting drives RadarCapability.prefetchFrames,
     which asks for the next frames' tiles ahead of playback through the HTTP
     cache. MeteoTileCache, the IndexedDB precache it used to name, is still
     inert -- every call site is commented out -- and reported as such
     because "why is nothing precached" is exactly the sort of question this
     panel exists to answer. */
  out.push(["forecast preload", get(precacheForecast) ? "on — next frames fetched ahead of playback" : "off"]);
  try {
    const dbs = await indexedDB.databases?.();
    const present = dbs?.some((db) => db.name === "tiles2");
    out.push(["idb tiles2", present ? "present" : "absent"]);
  } catch { /* databases() is not everywhere */ }
  return out;
}

/**
 * A cache name with the page's own origin taken back off it.
 *
 * Workbox names its precache after the page it belongs to and writes the whole
 * origin into it: `workbox-precache-v2-https://web.staging.meteocool.com/` is
 * fifty-two characters, of which the useful part is the first twenty and the
 * rest says where we already are. Only our own origin is stripped -- a cache
 * belonging to somewhere else keeps its suffix, because there the origin is
 * the whole point.
 */
function cacheLabel(name: string): string {
  const own = `-${window.location.origin}`;
  const trimmed = name.endsWith("/") ? name.slice(0, -1) : name;
  return trimmed.endsWith(own) ? trimmed.slice(0, -own.length) : name;
}

/** Storage is async, so it lands separately from the synchronous rows. */
async function readStorage(): Promise<Row[]> {
  const out: Row[] = [];
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      out.push(["used", bytes(est.usage)]);
      out.push(["quota", bytes(est.quota)]);
      if (est.usage != null && est.quota) {
        out.push(["of quota", `${((est.usage / est.quota) * 100).toFixed(1)}%`]);
      }
    }
  } catch { /* storage estimate is best effort */ }
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      for (const name of names) {
        const keys = await (await caches.open(name)).keys();
        out.push([cacheLabel(name), `${keys.length} entries`]);
      }
      if (!names.length) out.push(["cache storage", "empty"]);
    }
  } catch { /* cross-origin or disabled */ }
  const sw = navigator.serviceWorker?.controller;
  out.push(["service worker", sw ? sw.state : "not controlling"]);
  return out;
}

function refresh() {
  sections = [
    { title: "Connection", rows: connectionRows() },
    { title: "Freshness", rows: freshnessRows() },
    { title: "Forecast grid", rows: gridRows() },
    { title: "All traffic", rows: allTraffic() },
    { title: "Degraded state", rows: degradedRows() },
    { title: "API errors", rows: errorRows() },
    { title: "Endpoints", rows: endpointRows() },
    { title: "Context", rows: contextRows() },
  ];
  services = serviceRows();

  const grid = cap.clientGrid ?? {};
  const now = cap.clientGridConfig?.now ?? 0;
  steps = Object.keys(grid).map(Number).sort((a, b) => a - b).map((k) => {
    const f = grid[k];
    const minutes = now ? Math.round((k - now) / 60) : 0;
    const kind = !f || !f.url ? "missing" : (f.source === "observation" ? "observation" : "forecast");
    const built = f?.processed_time ? ago(f.processed_time * 1000) : "not built";
    const dbz = f?.dbz != null ? `${f.dbz.toFixed(1)} dBZ` : "no sample";
    return { minutes, kind, title: `${minutes >= 0 ? "+" : ""}${minutes}m · ${kind} · ${dbz} · built ${built}` };
  });
}

let timer: ReturnType<typeof setInterval> | null = null;

function refreshAsync() {
  readStorage().then((rows) => { storage = rows; });
  readTileCache().then((rows) => { tileCache = rows; });
}

onMount(() => {
  refresh();
  refreshAsync();
  timer = setInterval(() => {
    refresh();
    refreshAsync();
  }, REFRESH_MS);
});

onDestroy(() => {
  if (timer) clearInterval(timer);
});
</script>

<style>
  /* The panel -- material, header, scrolling -- is GlassPanel's, shared with
     About and Settings. The readings inside are laid out as a grid: */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    gap: 4px 20px;
    align-content: start;
  }

  /* Sections are grid cells, so a wide screen reads several side by side
     instead of one tall column with the rest below the fold. */
  .section {
    break-inside: avoid;
    padding-bottom: 6px;
  }
  .section.wide {
    grid-column: 1 / -1;
  }

  h3 {
    margin: 10px 0 3px;
    font: 600 10px/1.2 var(--mc-font);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--mc-text-3);
  }

  dl {
    display: grid;
    /*
     * The label column is sized to its content, and the cap is on the label
     * rather than on the track.
     *
     * `auto` is max-content, and a track sized to max-content does not care
     * that the label in it is set to ellipsize: it grows to whatever the
     * longest one wants and the `1fr` beside it takes what is left. One
     * fifty-two character cache name -- `workbox-precache-v2-` with the page's
     * own origin glued onto it -- was enough to leave the values four
     * characters wide, where `overflow-wrap: anywhere` then chopped them
     * mid-number: a quota of 10.00 GiB read as three lines saying "10.0", "0"
     * and "GiB".
     *
     * `fit-content(12em)` is the obvious way to cap a track and does nothing
     * here -- measured in the panel itself, the limit is ignored and the track
     * still comes out at the full width of the longest label. A `max-width` on
     * the label does work, because what an `auto` track measures is the item's
     * max-content contribution and that honours the item's own maximum. Every
     * section is still only as wide as it needs to be: the longest label in
     * Connection lands at 11.6em and is left alone.
     */
    grid-template-columns: minmax(6.5em, auto) minmax(0, 1fr);
    gap: 0 10px;
    margin: 0;
    font: 500 11px/1.4 var(--mc-font);
  }
  dt {
    /* Where the label column stops growing; see the note on `dl` above. Past
       this the label ellipsizes and its `title` carries the rest. */
    max-width: 12em;
    color: var(--mc-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  /* Severity, on the reading and its label together so the pair reads as one
     flagged row. Ink only -- a filled chip per bad row would turn a dense panel
     into a traffic light, and these are numbers to be read, not alerts to be
     acknowledged. The label stays lighter than the value, as it does unflagged. */
  dd.bad, td.bad { color: var(--mc-red); font-weight: 600; }
  dd.warn, td.warn { color: var(--mc-orange); font-weight: 600; }
  dt.bad { color: var(--mc-red); }
  dt.warn { color: var(--mc-orange); }

  /* Milliseconds in columns rather than a list per service: the point is to
     see which row is the outlier, and that only works if they line up. */
  .table-scroll {
    /* Eight numeric columns do not fit a phone in portrait. Rather than wrap
       them into something unreadable, the table keeps its shape and scrolls
       sideways inside the section. */
    overflow-x: auto;
    overscroll-behavior-x: contain;
    margin-top: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font: 500 11px/1.4 var(--mc-font);
    font-variant-numeric: tabular-nums;
  }
  th {
    padding: 0 0 2px;
    text-align: right;
    font: 600 10px/1.2 var(--mc-font);
    letter-spacing: 0.04em;
    color: var(--mc-text-3);
    white-space: nowrap;
  }
  td {
    padding: 1px 0;
    text-align: right;
    white-space: nowrap;
  }
  th + th, td + td { padding-left: 12px; }
  th.name, td.name {
    text-align: left;
    padding-left: 0;
    color: var(--mc-text-2);
  }
  td.name { color: var(--mc-text); }
  tbody tr + tr td { border-top: 1px solid var(--mc-hairline); }
  /* A service nothing has called yet is context, not a reading. */
  tr.quiet td { color: var(--mc-text-3); }

  /* One cell per timestep, oldest first: the shape of the grid at a glance. */
  .steps {
    display: flex;
    gap: 2px;
    margin-top: 4px;
  }
  .step {
    flex: 1 1 0;
    height: 16px;
    border-radius: 2px;
    background: var(--mc-tint);
  }
  .step.observation { background: var(--mc-accent); }
  .step.forecast { background: var(--mc-accent-tint); }
  .step.missing { background: var(--mc-red-tint); }

  .legend {
    display: flex;
    gap: 12px;
    margin-top: 4px;
    font: 500 10px/1.2 var(--mc-font);
    color: var(--mc-text-2);
  }
  .swatch {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 2px;
    vertical-align: 0;
  }

  /* A phone on its side: less air above each section. */
  @media (max-height: 480px) {
    h3 {
      margin-top: 7px;
    }
  }
</style>

<GlassPanel title={$_("connection_details")} wide on:close>
    <div class="grid">
      <div class="section wide">
        <h3>Timesteps</h3>
        <div class="steps">
          {#each steps as step, i (i)}
            <div class="step {step.kind}" title={step.title}></div>
          {/each}
        </div>
        <div class="legend">
          <span><i class="swatch" style="background: var(--mc-accent)"></i>Observation</span>
          <span><i class="swatch" style="background: var(--mc-accent-tint)"></i>Forecast</span>
          <span><i class="swatch" style="background: var(--mc-red-tint)"></i>Missing</span>
        </div>
      </div>

      <div class="section wide">
        <h3>Latency by service</h3>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th class="name">Service</th>
                <th>n</th>
                <th>Median</th>
                <th>p95</th>
                <th>Slowest</th>
                <th>Last</th>
                <th>Bytes</th>
                <th>Cached</th>
              </tr>
            </thead>
            <tbody>
              {#each services as row (row.name)}
                <tr class:quiet={!row.count}>
                  <td class="name">{row.name}</td>
                  <td>{row.count || "—"}</td>
                  <td class={row.medianSeverity ?? ""}>{row.median}</td>
                  <td class={row.p95Severity ?? ""}>{row.p95}</td>
                  <td class={row.slowestSeverity ?? ""}>{row.slowest}</td>
                  <td class={row.lastSeverity ?? ""}>{row.last}</td>
                  <td>{row.transferred}</td>
                  <td>{row.cached}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      {#each sections as section (section.title)}
        <div class="section">
          <h3>{section.title}</h3>
          <dl>
            {#each section.rows as [key, value, severity] (key)}
              <dt title={key} class={severity ?? ""}>{key}</dt>
              <dd class={severity ?? ""}>{value}</dd>
            {/each}
          </dl>
        </div>
      {/each}

      <div class="section">
        <h3>Tile cache</h3>
        <dl>
          {#each tileCache as [key, value, severity] (key)}
            <dt title={key} class={severity ?? ""}>{key}</dt>
            <dd class={severity ?? ""}>{value}</dd>
          {/each}
        </dl>
      </div>

      <div class="section">
        <h3>Storage</h3>
        <dl>
          {#each storage as [key, value] (key)}
            <dt title={key}>{key}</dt>
            <dd>{value}</dd>
          {/each}
        </dl>
      </div>
    </div>
</GlassPanel>
