# Regression Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove regressions introduced in the modernization pass (overlay masking controls, cache routing mismatch, stale status logic, and tile event handling) while preserving performance improvements.

**Architecture:** Keep the lightweight network/overlay improvements, but adjust their placement and signal handling; update SW tile routing to cover both map and overlay domains; ensure tile load hooks do not override OpenLayers internals.

**Tech Stack:** Svelte 5, OpenLayers, Workbox

---

### Task 1: Fix overlay placement + update cadence

**Files:**
- Modify: `src/components/MapStatusOverlay.svelte`

**Step 1: Write the failing test**

Not applicable (no unit test harness). Validate via manual UI behavior and lint/typecheck.

**Step 2: Run test to verify it fails**

Not applicable.

**Step 3: Write minimal implementation**

- Move overlay to top-center (or top-right) so it doesn’t cover bottom toolbar controls.
- Use `addEventListener` with `{ once: true }` for tile events (to avoid clobbering OL).
- Add a lightweight timer to refresh the “last success” text while visible.

**Step 4: Run test to verify it passes**

Not applicable.

**Step 5: Commit**

Defer commit until Task 4 completes.

---

### Task 2: Fix tile load event handling + stale state

**Files:**
- Modify: `src/lib/tileFetch.js`

**Step 1: Write the failing test**

Not applicable.

**Step 2: Run test to verify it fails**

Not applicable.

**Step 3: Write minimal implementation**

- Replace direct `image.onload/onerror` assignments with `addEventListener`.
- Mark `tileStatus.stale = true` when offline and an image error occurs so the UI can show cached state.

**Step 4: Run test to verify it passes**

Not applicable.

**Step 5: Commit**

Defer commit until Task 4 completes.

---

### Task 3: Fix SW tile cache routing + preconnect domains

**Files:**
- Modify: `src/sw.js`
- Modify: `index.html`
- Modify: `ios.html`
- Modify: `android.html`

**Step 1: Write the failing test**

Not applicable.

**Step 2: Run test to verify it fails**

Not applicable.

**Step 3: Write minimal implementation**

- Expand Workbox route to include both `map.meteocool.com` (base map) and `tiles-a.meteocool.com` (overlay tiles).
- Add preconnect/dns-prefetch for `map.meteocool.com` in all entrypoints.

**Step 4: Run test to verify it passes**

Not applicable.

**Step 5: Commit**

Defer commit until Task 4 completes.

---

### Task 4: Verification + amend commit

**Files:**
- Verify: `src/**/*`, `index.html`, `ios.html`, `android.html`, `src/sw.js`

**Step 1: Write the failing test**

Not applicable.

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
git add src index.html ios.html android.html src/sw.js

git commit --amend --no-edit
```
