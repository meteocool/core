# Meteocool Improvement Spec (Performance, UX, Mobile Resilience)

## Proposed Improvements

### Performance (map/tile loading lag + startup)
- **Fresh-first tile loading with request coalescing:** add an in-flight request registry per tileset so rapid pans/zooms don’t spam the network; reuse the same promise for identical tile URLs and cancel obsolete ones with `AbortController` when the viewport changes.
- **OpenLayers tile load integration:** implement a single `tileLoadFunction` for raster layers that routes through a small fetch wrapper (dedupe + abort + timeout) and emits timing markers. Keep actual rendering unchanged.
- **Network warm-up:** add `preconnect`/`dns-prefetch` to tile, API, and websocket domains in HTML entrypoints to reduce connection latency before first tile draw.
- **Tile cache behavior tuned to “fresh”:** store tiles only short-term; serve cached tiles only when offline/poor connection and always label them as stale with last-update time. Avoid long-lived caching that can mask freshness.
- **Layer churn minimization:** avoid replacing entire layers where a source update suffices; keep vector tile sources hot across updates to reduce redraw cost.
- **Work scheduling:** move non-critical work (stats, cache maintenance) to idle periods; avoid blocking user interactions during pan/zoom.

### UX (gesture-first, simple, reliable)
- **Clear loading states:** unified “loading tiles / waiting for data” indicators on the map viewport and a concise status line in controls.
- **Poor connection messaging:** show “slow/unstable connection” state with last successful update time; controls remain usable but read-only actions are disabled when data can’t refresh.
- **Error state consistency:** per-layer error UI with retry affordance and actionable messaging (e.g., “Radar feed unavailable — retry”).
- **Accessibility basics:** focus-visible styles, ARIA labels on primary controls, sufficient contrast, and reduced-motion compliance.
- **Modernization without layout breakage:** keep interaction model but simplify copy, spacing, and icon usage for clarity on small screens.

### Mobile resilience (iOS/Android wrappers)
- **Lifecycle handling:** on `visibilitychange`/`pagehide` pause heavy work (tile prefetch, timers); on resume, refresh tileset metadata and update state.
- **Connectivity awareness:** use `online/offline` events (and `navigator.connection` where available) to switch UI states and avoid infinite spinners.
- **Wrapper safety:** guard iOS/Android bridge calls so the app doesn’t throw if handlers are unavailable; retry settings fetch when wrapper signals readiness.
- **Memory pressure guardrails:** cap any client cache usage; clear tile cache on background; avoid retaining stale layers.

## Implementation Plan

### Phase 1 — Baseline + instrumentation (no behavior changes)
- Audit current tile flow in `src/caps/*` and `src/layers/*` to identify redundant fetches and layer churn.
- Add minimal timing hooks around tile load completion and first meaningful map render; store in memory and pass to Sentry (existing integration).
- Add `preconnect`/`dns-prefetch` tags to `index.html`, `ios.html`, `android.html` for `tileBaseUrl`, `apiBaseUrl`, `websocketBaseUrl`.

### Phase 2 — Tile/network pipeline (primary performance target)
- Implement a shared `fetchTile` helper (dedupe + abort + timeout) and connect it to OpenLayers `tileLoadFunction` for raster sources.
- Rework `MeteoTileCache` to “fresh-first”: short TTL, offline-only fallback with explicit stale UI, and background cache pruning.
- Ensure rapid pan/zoom cancels obsolete tile requests; avoid redundant layer re-instantiation where source update is enough.

### Phase 3 — UX + resilience polish
- Add a single map overlay component for “loading / offline / slow connection / error” states.
- Add last-updated timestamps for each data layer (radar, lightning, etc.) and propagate into the UI.
- Add lifecycle hooks for wrapper resume/visibility change and ensure settings refresh and layer reload happen safely.
- Accessibility pass: focus order, ARIA on key controls, reduced motion checks.

## Validation & Metrics

### Performance
- **Map first render time:** measure time from app mount to first tile rendered; record as a Sentry span (existing Sentry).
- **Tile throughput:** measure average tile fetch time and in-flight request count during pan/zoom; ensure reduced request volume after dedupe.
- **Interaction smoothness:** verify pan/zoom remains responsive on iOS 18/26 and latest 2 Android versions under throttled network.

### UX & Reliability
- **Offline/poor connection state:** simulate offline / slow 3G and confirm: (a) clear message, (b) controls stay responsive, (c) map displays stale tiles only with explicit label.
- **Layer error handling:** simulate failed tile URL and confirm retry UI and non-crashing behavior.
- **Wrapper lifecycle:** background/foreground transitions trigger refresh without UI flicker or crashes.

### Regression checks
- Desktop: latest 2 major versions of Chrome, Firefox, Safari, Edge.
- Mobile: iOS 18 + iOS 26 WKWebView, Android latest 2 WebView/Chromium.
- PWA: ensure service worker still updates and reloads on new builds.
