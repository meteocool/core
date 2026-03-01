# Code Review Findings & Roadmap

This document outlines performance improvements and web technology best practices identified during a code review. Each task is designed to be completed in streams with a focus on stability and performance.

## 🚀 Performance Optimization

- [ ] **Optimize Map Management in `LayerManager`**:
  - Current implementation creates a new OpenLayers `Map` for each capability. This is memory-intensive.
  - **Strategy**: Refactor to use a single `Map` instance and switch layers dynamically.
  - _Note_: Ensure that the state of each capability (view, layers, controls) is preserved during the transition.

- [x] **Refine PWA Cache Settings**:
  - `maximumFileSizeToCacheInBytes` is currently 50MB. This may impact lower-end devices.
  - **Strategy**: Analyze which assets truly need caching and reduce the limit if possible, or use more targeted `globPatterns`.

- [ ] **Improve Svelte 5 Migration**:
  - Mix of old stores and new runes can lead to memory leaks and complexity.
  - **Strategy**: Gradually move from `svelte/store` to `$state` and `$derived` where appropriate. Replace `onDestroy` with cleanup functions returned from `$effect`.

- [ ] **Eliminate Layout Thrashing**:
  - Direct style manipulation in `Map.svelte` and `NowcastPlayback.svelte` causes multiple layout recalculations.
  - **Strategy**: Use CSS variables and Svelte class bindings for layout management. Replace `getBoundingClientRect` with ResizeObserver or Svelte's `bind:clientWidth/Height`.
  - _Status_: Scheduling/race handling was improved (moved key layout paths to `requestAnimationFrame` + targeted `ResizeObserver`), but full `getBoundingClientRect` replacement is still pending.

- [x] **Optimize `StrikeManager`**:
  - Array manipulation in `removeOne` is $O(N)$.
  - **Strategy**: Use a more efficient data structure (like a Map or a Doubly Linked List) if the order of removal is frequent and critical, or simply use `splice` if the index is already known.

## 🛠 Web Best Practices

- [ ] **Decouple Components**:
  - `App.svelte` and `NowcastPlayback.svelte` are large and handle too many concerns.
  - **Strategy**: Split logic into smaller, focused modules or custom hooks (in Svelte 5, these are just functions returning state/actions).

- [ ] **Remove Global Window Dependencies**:
  - Heavy use of `window.lm`, `window.settings`, etc.
  - **Strategy**: Use Svelte's `context` API or pass props/services through the component tree to avoid global state pollution.
  - _Status_: Partial progress. `settings`/`lm`/`ll` are now dev-only debug globals in `App.svelte`; runtime `window.enterForeground` is still required by entrypoints.

- [x] **Improve Accessibility**:
  - Global `user-select: none` and `touch-action: manipulation` impact user experience.
  - **Strategy**: Only apply these properties to specific UI elements (like the map or buttons) rather than globally.

- [ ] **TypeScript Migration**:
  - Many files are still `.js`.
  - **Strategy**: Gradually rename `.js` to `.ts` and add proper type definitions to improve developer experience and catch bugs early.

## 🐛 Bug Fixes & Stability

- [x] **Fix Lightning Strike Coordinates**:
  - `StrikeManager.js` appears to miss the `fromLonLat` transformation for lightning strikes.
  - **Strategy**: Ensure all incoming coordinates from external APIs or WebSockets are transformed to the map's projection (usually `EPSG:3857`).

- [x] **Socket.io Listener Cleanup**:
  - `RadarCapability.js` and other capabilities don't explicitly clean up socket.io listeners.
  - **Strategy**: Add `off()` calls for all listeners in the `destroy()` method of the capability.

- [ ] **Refactor `setTimeout` Dependencies**:
  - Many layout and initialization steps rely on `setTimeout`.
  - **Strategy**: Identify the root cause of these race conditions and use more deterministic Svelte lifecycle hooks (`onMount`, `$effect`) or event-driven updates.
  - _Status_: Partially done. `Map.svelte` and `NowcastPlayback.svelte` layout/alignment scheduling moved off timeout-based races; remaining timeout usage should be audited case-by-case.

- [x] **Periodic Strike Fading**:
  - `StrikeManager.fadeStrikes()` is defined but not called.
  - **Strategy**: Implement a periodic cleanup (e.g., every 5 minutes) to remove old lightning strikes from memory and the map.

- [x] **Fix app toolbar transition measurement staleness**:
  - Map height can end up stale during toolbar fly transitions because transform-only motion may not trigger observers.
  - **Strategy**: Hook into transition lifecycle or add short-lived frame polling during open/close transitions to re-evaluate map height until stable.
  - _Status_: Implemented with explicit toolbar transition events plus bounded `requestAnimationFrame` tracking in `Map.svelte`.

- [x] **Fix playback button bar alignment staleness during transitions**:
  - Button-bar alignment can stay stale when transition movement occurs without element resize events.
  - **Strategy**: Trigger alignment recomputation on toolbar/player transition boundaries (enter/exit start/end), not only on resize/observer callbacks.
  - _Status_: Implemented with intro/outro transition hooks and bounded alignment polling in `NowcastPlayback.svelte`.
