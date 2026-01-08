# iOS Mobile UI Fixes Design

## Goal
Improve iOS Safari mobile usability by preventing top-left overlaps, reducing oversized controls, adding a compact logo menu toggle, and reclaiming bottom space when playback controls are open.

## Context & Constraints
- Preserve desktop layout and existing functionality.
- Target small screens (<= 620px) and iOS Safari quirks.
- Do not add new dependencies.
- Maintain current component responsibilities where possible.

## Proposed UX Changes
### Compact logo menu (mobile)
- Default state on small screens: show only the meteocool icon in the top-left.
- Tapping the icon toggles a small panel containing the URL, About, and Discord links.
- Tapping again hides the panel with a fade/slide transition.
- About modal remains accessible via the panel and keeps current behavior.

### Latest pill placement
- Reduce the LiveIndicator pill size and top offset on small screens.
- Ensure it stays centered and no longer overlaps the compact logo.

### Layer switcher sizing
- Shrink the top-right layer switcher button (diameter, border thickness, icon size) on small screens.
- Update OpenLayers control offset so zoom/geolocate stack below the smaller switcher.

### Bottom space efficiency
- When playback controls are open on mobile, hide the bottom toolbar to avoid redundant “Last updated” bar.
- Reduce vertical padding, gaps, and overall height in the playback controls on small screens.

## Data Flow & State
- Local state in `Logo.svelte` controls the mobile menu toggle (`showMenu`).
- No new global stores; About overlay uses existing `showAbout` state.
- Bottom toolbar visibility continues to use `bottomToolbarMode`.

## Error Handling & Accessibility
- Preserve existing keyboard handlers for toggleable elements.
- Keep role and aria attributes intact.

## Testing & Verification
- Manual checks on iOS Safari width <= 620px:
  - Logo panel toggles open/closed and does not overlap LiveIndicator.
  - Layer switcher size is smaller and controls remain reachable.
  - Playback controls open with better vertical spacing; bottom toolbar is hidden.
- Desktop widths remain unchanged.

## Files Expected to Change
- `src/components/Logo.svelte`
- `src/components/LiveIndicator.svelte`
- `src/components/McLayerSwitcher.svelte`
- `src/components/Map.svelte`
- `src/components/BottomToolbar.svelte`
- `src/components/NowcastPlayback.svelte`
