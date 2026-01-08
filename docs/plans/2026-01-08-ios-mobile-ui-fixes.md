# iOS Mobile UI Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix iOS Safari mobile UI overlaps and spacing by introducing a compact logo menu, resizing top controls, and optimizing bottom controls when playback is open.

**Architecture:** Keep changes localized to existing Svelte components with mobile-only CSS overrides and minimal local state. Avoid new dependencies and preserve desktop behavior.

**Tech Stack:** Svelte, CSS, existing stores (`bottomToolbarMode`).

---

### Task 1: Compact logo menu + LiveIndicator spacing

**Files:**
- Modify: `src/components/Logo.svelte`
- Modify: `src/components/LiveIndicator.svelte`

**Step 1: Reproduce the failure (manual test)**
- Load the app at iPhone viewport size (<= 620px).
- Confirm the “Latest” pill overlaps the logo and that the logo/links are oversized.

**Step 2: Implement minimal logo toggle + compact styles**
- Add a local `showMenu` state and toggle it on the icon.
- Render only the icon by default on small screens; expand the menu panel when `showMenu` is true.
- Add CSS for compact sizing and a fade/slide transition.

Example snippet (conceptual target):
```svelte
<div class="logo-wrapper" class:compact={isCompact} class:menu-open={showMenu}>
  <button class="logo-button" on:click={toggleMenu}>
    <img src={logo} alt="meteocool" class="logo" />
  </button>
  <div class="menu">
    <div class="name">{$_('url')}</div>
    <div class="claim"> ... </div>
  </div>
</div>
```

**Step 3: Adjust LiveIndicator for mobile**
- Reduce padding and font size on small screens.
- Lower top offset slightly to avoid collision with logo area.

**Step 4: Verify fix (manual test)**
- On mobile width, ensure the icon-only logo does not overlap the “Latest” pill.
- Toggle menu open/closed; links appear/disappear with a fade.

**Step 5: Commit**
```bash
git add src/components/Logo.svelte src/components/LiveIndicator.svelte
# commit after completion of all tasks or per task if preferred
```

---

### Task 2: Resize layer switcher + adjust OL control offset

**Files:**
- Modify: `src/components/McLayerSwitcher.svelte`
- Modify: `src/components/Map.svelte`

**Step 1: Reproduce the failure (manual test)**
- At mobile width, observe the layer switcher button is oversized.

**Step 2: Implement mobile sizing**
- Add a `@media (max-width: 620px)` override to reduce:
  - `.lsToggle` width/height
  - border thickness
  - icon size
  - top/right offsets

Example snippet (conceptual target):
```css
@media only screen and (max-width: 620px) {
  .lsToggle { width: 52px; height: 52px; border-width: 2px; top: 8px; right: 8px; }
  div :global(.lsIcon) { width: 26px !important; height: 26px !important; }
}
```

**Step 3: Update OL controls offset**
- In `src/components/Map.svelte`, adjust `--ol-controls-top` for small screens to match the smaller switcher.

**Step 4: Verify fix (manual test)**
- Zoom/geolocate buttons sit under the layer switcher with proper spacing.

**Step 5: Commit**
```bash
git add src/components/McLayerSwitcher.svelte src/components/Map.svelte
```

---

### Task 3: Improve bottom spacing when playback is open

**Files:**
- Modify: `src/components/BottomToolbar.svelte`
- Modify: `src/components/NowcastPlayback.svelte`

**Step 1: Reproduce the failure (manual test)**
- Open playback controls on mobile.
- Observe wasted vertical space and redundant bottom toolbar.

**Step 2: Hide bottom toolbar on mobile while player is open**
- Use `$bottomToolbarMode` to conditionally hide the bottom toolbar with a mobile-only class.

**Step 3: Reduce mobile spacing in playback UI**
- Lower `.timeslider` height on small screens.
- Reduce gaps/margins/padding in `.flexbox`, `.checkbox`, and `.range` for mobile.

Example snippet (conceptual target):
```css
@media only screen and (max-width: 620px) {
  .timeslider { height: 120px !important; }
  .flexbox { gap: 4px !important; }
}
```

**Step 4: Verify fix (manual test)**
- Playback controls occupy less vertical space.
- Bottom toolbar is hidden while the player is open.

**Step 5: Commit**
```bash
git add src/components/BottomToolbar.svelte src/components/NowcastPlayback.svelte
```

---

### Task 4: Final verification

**Files:**
- None

**Step 1: Run lint/typecheck (if available)**
Run:
```bash
npm run lint
npm run typecheck
```

**Step 2: Manual mobile QA**
- Verify logo toggle, live pill spacing, layer switcher size, and playback spacing at <= 620px.
- Verify desktop layout unchanged.

**Step 3: Final commit (if not already)**
```bash
git add src/components/Logo.svelte src/components/LiveIndicator.svelte src/components/McLayerSwitcher.svelte src/components/Map.svelte src/components/BottomToolbar.svelte src/components/NowcastPlayback.svelte
```
