# Frontend Modernization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Modernize dependencies and UI, remove Shoelace, and simplify the codebase while preserving existing behavior and layout across web/iOS/Android wrappers.

**Architecture:** Replace Shoelace web components with lightweight native/Svelte equivalents and a small CSS token layer, trim unused dependencies and preprocessors, and update build tooling to current versions. Preserve the current multi-entry Vite setup and capability architecture.

**Tech Stack:** Svelte 5, Vite, OpenLayers, Chart.js, XState, Socket.IO, Cloudflare Workers, Workbox PWA.

---

### Task 1: Inventory usage + validate scope

**Files:**
- Modify: `package.json`
- Modify: `vite.config.mjs`
- Modify: `src/App.svelte`
- Modify: `src/layers/ui.js`
- Modify: `src/components/*.svelte`
- Modify: `src/lib/Toast.js`

**Step 1: Write the failing test**
- Not applicable (no existing test harness). Document manual checks for UI parity and build success.

**Step 2: Run test to verify it fails**
- Not applicable.

**Step 3: Write minimal implementation**
- Confirm all `sl-*` usage and `@shoelace-style/shoelace` imports.
- Confirm unused deps: `@vitejs/plugin-react`, `ol-mapbox-style`, `less`, `svelte-preprocess`, `@babel/*`, `playwright`, `serve`, `javascript-state-machine`.

**Step 4: Run test to verify it passes**
- Not applicable.

**Step 5: Commit**
- Defer until multiple tasks complete to minimize churn.

---

### Task 2: Verify latest package versions + breaking changes (2026-01-07)

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Write the failing test**
- Not applicable.

**Step 2: Run test to verify it fails**
- Not applicable.

**Step 3: Write minimal implementation**
- Use web sources (npm registry + official release notes) to identify latest versions and breaking changes.
- Update dependency versions and remove unused packages.
- Resolve any breaking changes directly in code.

**Step 4: Run test to verify it passes**
- Run `npm run lint` and `npm run typecheck` after upgrades.

**Step 5: Commit**
- `git add package.json package-lock.json`
- `git commit -m "chore(deps): update dependencies and remove unused"`

---

### Task 3: Remove Shoelace and add lightweight UI tokens

**Files:**
- Create: `src/html/ui-tokens.css`
- Modify: `src/App.svelte`
- Modify: `src/layers/ui.js`

**Step 1: Write the failing test**
- Not applicable.

**Step 2: Run test to verify it fails**
- Not applicable.

**Step 3: Write minimal implementation**
- Define `--sl-*` CSS tokens in `ui-tokens.css` for existing styles.
- Remove Shoelace theme import in `src/App.svelte` and import tokens instead.
- Remove Shoelace component registrations and base-path logic from `src/layers/ui.js`.
- Update matchMedia listener to `addEventListener('change', ...)`.

**Step 4: Run test to verify it passes**
- `npm run build` and visually validate layout alignment for top-left logo, layer switcher, and toolbars.

**Step 5: Commit**
- `git add src/html/ui-tokens.css src/App.svelte src/layers/ui.js`
- `git commit -m "refactor(ui): replace shoelace tokens and init"`

---

### Task 4: Replace Shoelace components with native/Svelte equivalents

**Files:**
- Modify: `src/components/About.svelte`
- Modify: `src/components/LastUpdated.svelte`
- Modify: `src/components/LiveIndicator.svelte`
- Modify: `src/components/DevStatus.svelte`
- Modify: `src/components/BottomToolbar.svelte`
- Modify: `src/components/NowcastPlayback.svelte`
- Modify: `src/lib/Toast.js`

**Step 1: Write the failing test**
- Not applicable.

**Step 2: Run test to verify it fails**
- Not applicable.

**Step 3: Write minimal implementation**
- Replace `sl-dialog` + footer button with a custom modal overlay and `button`.
- Replace `sl-spinner` + `sl-progress-ring` with CSS/SVG equivalents.
- Replace `sl-tag` with styled `div`/`span` tags.
- Replace `sl-checkbox` with `<input type="checkbox">` and native events.
- Replace `sl-range` with `<input type="range">` and native events.
- Replace `sl-button` + `sl-button-group` with `button` + wrapper classes.
- Replace `sl-alert` + `sl-icon` toast with minimal DOM toast element.

**Step 4: Run test to verify it passes**
- `npm run build` and manual UI check: About modal, bottom toolbar checkbox behavior, playback controls, lightning chart, and toast behavior.

**Step 5: Commit**
- `git add src/components/*.svelte src/lib/Toast.js`
- `git commit -m "refactor(ui): replace shoelace components"`

---

### Task 5: Remove preprocessors and unused tooling

**Files:**
- Modify: `src/components/scales/ScaleLine.svelte`
- Modify: `vite.config.mjs`
- Modify: `package.json`

**Step 1: Write the failing test**
- Not applicable.

**Step 2: Run test to verify it fails**
- Not applicable.

**Step 3: Write minimal implementation**
- Remove `lang="less"` and convert any Less syntax (none) to plain CSS.
- Remove `svelte-preprocess` usage from Vite config.
- Remove `less` and `svelte-preprocess` dependencies.

**Step 4: Run test to verify it passes**
- `npm run build` and `npm run lint`.

**Step 5: Commit**
- `git add src/components/scales/ScaleLine.svelte vite.config.mjs package.json package-lock.json`
- `git commit -m "chore(build): remove less preprocess"`

---

### Task 6: Clean up runtime logic + minor fixes

**Files:**
- Modify: `src/App.svelte`
- Modify: `src/components/Map.svelte`
- Modify: `src/lib/LayerManager.ts`
- Modify: `README.md`

**Step 1: Write the failing test**
- Not applicable.

**Step 2: Run test to verify it fails**
- Not applicable.

**Step 3: Write minimal implementation**
- Remove duplicate `tileURL` config in `PrecipitationTypesCapability` options.
- Fix lightning/mesocyclone settings assignment typo if present.
- Add cleanup for `bottomToolbarMode` subscription in `Map.svelte`.
- Update README to reflect Vite-based build and remove Babel/Webpack references.

**Step 4: Run test to verify it passes**
- `npm run typecheck` and `npm run build`.

**Step 5: Commit**
- `git add src/App.svelte src/components/Map.svelte src/lib/LayerManager.ts README.md`
- `git commit -m "fix: cleanup settings + docs"`

---

### Task 7: Final verification sweep

**Files:**
- None (verification only)

**Step 1: Write the failing test**
- Not applicable.

**Step 2: Run test to verify it fails**
- Not applicable.

**Step 3: Write minimal implementation**
- Run: `npm run lint`, `npm run typecheck`, `npm run build`.
- Manual smoke check in dev: open web entrypoint, open About modal, toggle checkboxes, open playback controls, ensure no console errors.

**Step 4: Run test to verify it passes**
- Confirm all commands succeed.

**Step 5: Commit**
- If no further changes, no commit.
