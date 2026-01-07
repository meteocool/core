# Frontend Modernization Design

## Summary

This modernization keeps the existing Svelte + Vite multi-entry architecture and the current capability-driven map stack while replacing Shoelace web components with minimal native/Svelte equivalents. The goal is to preserve layout and runtime behavior for web, iOS, and Android wrappers while removing obsolete dependencies and reducing UI overhead. Browser targets are limited to the latest two major desktop versions and iOS 18/26 + Android 15/16 to allow modern output (ES2022).

## Architecture & Components

`App.svelte` continues to initialize Settings, the LayerManager, and capability modules, then mounts `Map`, `BottomToolbar`, and `NowcastPlayback`. State flows through Svelte stores (e.g., toolbar modes, active capability, layer visibility) and drives UI. Shoelace tokens are replaced by a small CSS token sheet so color and spacing remain consistent, while lightweight native elements (buttons, inputs, modal overlay, and custom toasts) replace Shoelace components. `NowcastPlayback` uses XState for deterministic playback state, and Chart.js remains lazy-loaded to reduce initial payload. The multi-entry Vite config (web/iOS/Android/privacy/imprint) remains intact to avoid breaking wrapper entrypoints.

## Data Flow & Error Handling

Capabilities continue to request data from the existing APIs and push updates into stores. UI components subscribe to stores and reactively render. Error handling stays log-first; toast notifications are lightweight and optional, with dismiss controls and timeouts. The UI constants system continues to provide runtime-tunable CSS variables for safe-area adjustments.

## Testing & Verification

There is no existing automated test harness. Verification relies on `npm run lint`, `npm run typecheck`, and `npm run build`, followed by manual smoke checks: open About modal, verify toolbar controls, check playback slider/loop/history toggles, and validate map/controls layout across entrypoints.
