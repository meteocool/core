## 2026-03-01

Session summary: stabilized toolbar-transition-driven layout updates and captured durable Svelte/transition guardrails.

### Code/File Changes

- Updated `src/components/Map.svelte`, `src/components/BottomToolbar.svelte`, and `src/components/NowcastPlayback.svelte` to emit/listen for toolbar transition lifecycle events and run bounded frame-based recomputation during active transitions.
- Updated `TODO.md` to mark transition staleness items complete with implementation status notes.

### Conventions/Flow

- Updated `AGENTS.md` guardrails to require consistent Svelte 5 event syntax per file (no mixing `on:` and `on*` handlers).
- Added guidance that transform-based transitions need transition-boundary recomputation for geometry-sensitive layout code.
