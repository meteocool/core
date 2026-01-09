# iOS/Android Wrapper UI Adjustments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hide logo/layer switcher in app wrappers, keep map attributions visible above bottom controls, and only show the status banner for real connectivity issues.

**Architecture:** Set device/app defaults in `App.svelte` before first render, update attribution padding based on visible bottom controls, and simplify the map status overlay to use network status only. Extract a small helper for banner visibility so it can be unit-tested.

**Tech Stack:** Svelte 5, Svelte stores, plain JS module, Node (ESM) for a tiny unit test.

---

### Task 1: Network banner helper + unit test

**Files:**
- Create: `src/lib/networkBanner.js`
- Create: `scripts/tests/networkBanner.test.js`

**Step 1: Write the failing test**

```js
import assert from 'node:assert/strict'
import { shouldShowNetworkBanner } from '../../src/lib/networkBanner.js'

assert.equal(shouldShowNetworkBanner({ online: true, isSlow: false }), false)
assert.equal(shouldShowNetworkBanner({ online: false, isSlow: false }), true)
assert.equal(shouldShowNetworkBanner({ online: true, isSlow: true }), true)
```

**Step 2: Run test to verify it fails**

Run: `node scripts/tests/networkBanner.test.js`
Expected: FAIL with module not found or missing export.

**Step 3: Write minimal implementation**

```js
export const shouldShowNetworkBanner = (net) => {
  if (!net) return false
  return net.online === false || net.isSlow === true
}
```

**Step 4: Run test to verify it passes**

Run: `node scripts/tests/networkBanner.test.js`
Expected: PASS (no output, exit 0).

**Step 5: Commit**

```bash
git add src/lib/networkBanner.js scripts/tests/networkBanner.test.js
git commit -m "test(map-status): add network banner helper test"
```

---

### Task 2: Restrict MapStatusOverlay to real connectivity issues

**Files:**
- Modify: `src/components/MapStatusOverlay.svelte`

**Step 1: Update overlay logic to use helper**
- Import `shouldShowNetworkBanner`.
- Keep `tileStatus` subscription only for `lastSuccessAt` text.
- Set `showOverlay` to `shouldShowNetworkBanner(net)`.
- Set `statusLabel` to `offline` or `slow_connection` only.
- Set `showRetry` to `!net.online`.

**Step 2: Manual verification**
- Ensure banner no longer shows on transient tile errors.
- Banner shows for offline or slow connection only.

**Step 3: Commit**

```bash
git add src/components/MapStatusOverlay.svelte
git commit -m "fix(map-status): show banner only for offline/slow network"
```

---

### Task 3: App-only UI defaults + attribution padding

**Files:**
- Modify: `src/App.svelte`

**Step 1: Set device before first render**
- Move `dd.set(device)` to run immediately after props.
- Keep a reactive update if device prop ever changes.

**Step 2: Enforce app-only defaults**
- If `dd.isApp()` set `logoStyle` to `'none'` and `layerswitcherVisible` to `'no'`.
- Update settings callbacks for `logo` and `layerswitcher` to ignore values when `dd.isApp()`.

**Step 3: Update attribution padding based on visible controls**
- Add `onMount` + `onDestroy` to manage a resize listener.
- When `bottomToolbarMode` changes, measure `.bottomToolbar` height (prefer timeslider if present) and set `--attributions-bottom-padding` to `calc(env(safe-area-inset-bottom) + <height>px)`.
- Run once on mount and after mode transitions (e.g., `requestAnimationFrame` + `setTimeout`).

**Step 4: Manual verification**
- In app wrappers, no logo or layer switcher appears.
- Attributions sit above the bottom toolbar and the time slider.

**Step 5: Commit**

```bash
git add src/App.svelte
git commit -m "fix(app-ui): hide logo/layer switcher and pad attributions"
```

---

### Task 4: Final verification

**Step 1: Run quick checks**
Run: `node scripts/tests/networkBanner.test.js`
Expected: PASS.

**Step 2: (Optional) run linters**
Run: `npm run lint`
Expected: PASS.

**Step 3: Commit (if needed)**
- Only if verification required additional changes.
