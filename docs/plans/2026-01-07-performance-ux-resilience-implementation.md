# Performance/UX/Mobile Resilience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce map/tile loading lag, add clear connection/error states, and harden iOS/Android wrapper resilience while preserving functionality.

**Architecture:** Add a shared tile fetch manager (dedupe + abort + timeout), connect it to OpenLayers `tileLoadFunction` for raster sources, and expose network/tile status via Svelte stores. Add a lightweight overlay to display loading/offline/error states without layout changes. Add preconnect hints and wrapper lifecycle guards.

**Tech Stack:** Svelte 5, OpenLayers, Workbox, Svelte stores

---

### Task 1: Add network + tile status stores

**Files:**
- Modify: `src/stores.js`
- Create: `src/lib/networkStatus.js`

**Step 1: Write the failing test**

Not applicable (no unit test harness). We will validate via manual checks and lint/typecheck.

**Step 2: Run test to verify it fails**

Not applicable (see Step 1).

**Step 3: Write minimal implementation**

- Add new stores to `src/stores.js`:
  - `networkStatus` (online/offline + effectiveType + isSlow)
  - `tileStatus` (inFlight, lastSuccessAt, lastErrorAt, lastErrorMessage)
- Create `src/lib/networkStatus.js` that:
  - Initializes store state from `navigator.onLine` and `navigator.connection`.
  - Attaches `online`/`offline` and `connection` change listeners.
  - Exposes `initNetworkStatus()` and `cleanupNetworkStatus()`.

**Step 4: Run test to verify it passes**

Not applicable (see Step 1).

**Step 5: Commit**

Defer commit until Task 6 completes.

---

### Task 2: Build tile fetch manager + integrate with OpenLayers raster sources

**Files:**
- Create: `src/lib/tileFetch.js`
- Modify: `src/layers/dwd.js`
- Modify: `src/layers/weather.js`
- Modify: `src/layers/satellite.js`
- Modify: `src/layers/noaa.js`
- Modify: `src/layers/dwd.js` (also dwdPrecipTypes)

**Step 1: Write the failing test**

Not applicable (no unit test harness). We will validate via manual checks and lint/typecheck.

**Step 2: Run test to verify it fails**

Not applicable (see Step 1).

**Step 3: Write minimal implementation**

- Implement `createTileLoadFunction()` in `src/lib/tileFetch.js`:
  - Dedupe in-flight requests by URL.
  - Abort all in-flight requests on viewport change via a global `abortAll()`.
  - Apply a timeout (e.g., 10s) with `AbortController`.
  - On success: set tile image from blob; update `tileStatus`.
  - On failure: update `tileStatus` error; let tile render fail gracefully.
- Expose `abortAllTileRequests()` for move events.
- Update raster XYZ sources to pass `tileLoadFunction: createTileLoadFunction()`.

**Step 4: Run test to verify it passes**

Not applicable (see Step 1).

**Step 5: Commit**

Defer commit until Task 6 completes.

---

### Task 3: Fresh-first cache + Workbox strategy update

**Files:**
- Modify: `src/lib/TileCache.js`
- Modify: `src/sw.js`

**Step 1: Write the failing test**

Not applicable (no unit test harness). We will validate via manual checks and lint/typecheck.

**Step 2: Run test to verify it fails**

Not applicable (see Step 1).

**Step 3: Write minimal implementation**

- Update `MeteoTileCache.fetchAndCache` to prefer network when online; fall back to cached blob only when offline or when network request fails; mark stale usage in `tileStatus`.
- Add short TTL (e.g., 5–10 minutes) and clear expired entries.
- Switch Workbox strategy for tiles to `NetworkFirst` with a short `maxAgeSeconds` (e.g., 1–6 hours) so fresh data is prioritized with cache fallback.

**Step 4: Run test to verify it passes**

Not applicable (see Step 1).

**Step 5: Commit**

Defer commit until Task 6 completes.

---

### Task 4: Map status overlay + UX states

**Files:**
- Create: `src/components/MapStatusOverlay.svelte`
- Modify: `src/App.svelte`
- Modify: `src/html/global.css` (or new component styles)

**Step 1: Write the failing test**

Not applicable (no unit test harness). We will validate via manual checks and lint/typecheck.

**Step 2: Run test to verify it fails**

Not applicable (see Step 1).

**Step 3: Write minimal implementation**

- Add overlay component subscribing to `networkStatus` + `tileStatus`:
  - Shows “Loading latest data…” when in-flight tiles exist.
  - Shows “Connection issue / slow connection” when offline or slow.
  - Displays last success timestamp if available.
  - Includes a retry button that triggers a tile refresh signal (store) without layout shift.
- Mount overlay in `App.svelte` above the map so it overlays the canvas.

**Step 4: Run test to verify it passes**

Not applicable (see Step 1).

**Step 5: Commit**

Defer commit until Task 6 completes.

---

### Task 5: Wrapper lifecycle guards + preconnect hints

**Files:**
- Modify: `src/entrypoints/main.js`
- Modify: `src/entrypoints/ios.js`
- Modify: `src/entrypoints/android.js`
- Modify: `index.html`
- Modify: `ios.html`
- Modify: `android.html`

**Step 1: Write the failing test**

Not applicable (no unit test harness). We will validate via manual checks and lint/typecheck.

**Step 2: Run test to verify it fails**

Not applicable (see Step 1).

**Step 3: Write minimal implementation**

- Initialize `initNetworkStatus()` on app startup and cleanup on unload.
- Add `visibilitychange` handling to pause/resume heavy work if needed (no behavior change aside from refresh).
- Guard iOS/Android bridge calls so missing handlers don’t throw.
- Add `<link rel="preconnect">` and `<link rel="dns-prefetch">` for tile/api/websocket domains.

**Step 4: Run test to verify it passes**

Not applicable (see Step 1).

**Step 5: Commit**

Defer commit until Task 6 completes.

---

### Task 6: Verification + commit

**Files:**
- Verify: `src/**/*`, `index.html`, `ios.html`, `android.html`, `src/sw.js`

**Step 1: Write the failing test**

Not applicable (no unit test harness). We will validate via lint/typecheck + manual smoke steps.

**Step 2: Run test to verify it fails**

Run:
- `npm run lint`
- `npm run typecheck`

Expected: PASS.

**Step 3: Write minimal implementation**

If failures occur, fix them with minimal changes.

**Step 4: Run test to verify it passes**

Re-run:
- `npm run lint`
- `npm run typecheck`

Expected: PASS.

**Step 5: Commit**

```
git add src index.html ios.html android.html src/sw.js docs/plans/2026-01-07-performance-ux-resilience-implementation.md

git commit -m "feat: improve tile loading, UX states, and wrapper resilience"
```
