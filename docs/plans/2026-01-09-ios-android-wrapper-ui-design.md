# iOS/Android Wrapper UI Adjustments Design

## Goal
Reduce UI clutter in the native wrappers, ensure map attributions are not obscured by bottom controls, and show the connection banner only for real connectivity issues.

## Architecture
The iOS/Android wrappers already pass a `device` prop into `App.svelte`. We will use that signal immediately (before first render) to set the app device type and to apply app-only UI defaults. This keeps web behavior unchanged and avoids URL or localStorage mutations. The attribution layout will continue to rely on the existing CSS variable `--attributions-bottom-padding`, but it will be updated based on `bottomToolbarMode` for app builds. The map status overlay will only use network status (offline/slow) to decide visibility.

## Components & Data Flow
- `App.svelte` sets `DeviceDetect` synchronously from props before render.
- If `dd.isApp()`, it immediately sets store defaults:
  - `logoStyle` -> `'none'`
  - `layerswitcherVisible` -> `'no'`
- `Map.svelte` reads `layerswitcherVisible` and will not render `McLayerSwitcher` in apps.
- `Logo.svelte` remains untouched; it will never render in apps because `logoStyle` is forced to `'none'`.
- A small app-only layout handler in `App.svelte` updates `--attributions-bottom-padding` when `bottomToolbarMode` changes, and on `resize` to handle orientation changes.
- `MapStatusOverlay.svelte` shows the banner only when `networkStatus.online === false` or `networkStatus.isSlow === true`.

## Error Handling
- Network banner relies solely on `networkStatus` to avoid false “connection issue” states caused by transient tile errors.
- Attribution padding update is wrapped in a guard so it only applies for apps.

## Testing
- Manual smoke check in iOS and Android wrappers:
  1. App starts without logo or layer switcher.
  2. Bottom attribution is visible above the toolbar and time slider.
  3. Connection banner appears only when offline or slow network is reported.
- If a minimal unit test can be added, verify a pure helper that maps network status to banner visibility.
