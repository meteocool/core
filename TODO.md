# Meteocool Frontend TODO

This document outlines a prioritized list of tasks for improving the Meteocool frontend application, based on a code review conducted on July 28, 2025.

### P1: Critical (Potential for crashes or major bugs)

1.  **Unhandled HTTP Errors in `RadarCapability.js`**:
    - **Problem**: The `fetch` calls in `downloadCurrentRadar` and `downloadSnowOverlay` in `src/caps/RadarCapability.js` do not check if the HTTP response was successful (e.g., by checking `response.ok`). If the server returns an error (like a 500 or 404), the subsequent `.json()` call will fail, which could crash the radar functionality.
    - **Suggestion**: Implement a check for `response.ok` after each `fetch` call. If the response is not ok, throw an error to be caught by the `.catch()` block. This will ensure that network errors are handled gracefully.
    - **File to address**: `src/caps/RadarCapability.js`

2.  **Event Listener Memory Leaks**:
    - **Problem**: There are event listeners being added that are not being cleaned up, which will lead to memory leaks over time.
      - In `src/lib/LayerManager.ts`, a `popstate` event listener is added to `window` but is not removed in the `destroy` method.
      - In `src/App.svelte`, a `window.matchMedia` listener is created but never removed.
    - **Suggestion**:
      - In `LayerManager.ts`, update the `destroy` method to remove the `popstate` event listener.
      - In `App.svelte`, store the `matchMedia` listener function in a variable and call `removeEventListener` in the `onDestroy` lifecycle hook.
    - **Files to address**: `src/lib/LayerManager.ts`, `src/App.svelte`

### P2: High (Important for stability, performance, and security)

1.  **Outdated State Machine Library**:
    - **Problem**: The project uses `javascript-state-machine`, which is an old and less robust library for managing state. The `CLAUDE.md` file itself recommends replacing it with XState. The state transitions in `NowcastPlayback.svelte` are complex and a likely source of bugs.
    - **Suggestion**: Replace `javascript-state-machine` with a modern state management library like XState. This will make the playback logic in `NowcastPlayback.svelte` more predictable, easier to debug, and less error-prone.
    - **Files to address**: `src/components/NowcastPlayback.svelte`, `package.json`

2.  **Remaining `console.log` Statements**:
    - **Problem**: Several `console.log` statements remain in the codebase. These can expose debugging information in a production environment and create unnecessary console noise.
    - **Suggestion**: Systematically replace all remaining instances of `console.log` with the project's `logger.log` utility. This ensures that logs are only output in the development environment.
    - **Files to address**: `src/lib/TileCache.js`, `src/lib/util.js`, `src/layers/lightning.js`, `src/caps/RadarCapability.js`, `src/components/NowcastPlayback.svelte`

### P3: Medium (Code quality and maintainability)

1.  **Overly Complex `NowcastPlayback.svelte` Component**:
    - **Problem**: The `NowcastPlayback.svelte` component is very large (over 650 lines) and handles too many responsibilities, including state management, Chart.js rendering, and complex user interaction logic. This makes the component difficult to understand, maintain, and debug.
    - **Suggestion**: Refactor `NowcastPlayback.svelte` by breaking it down into smaller, more focused components. For example, the chart, the playback controls, and the timeline slider could each be their own component.
    - **File to address**: `src/components/NowcastPlayback.svelte`

2.  **Inconsistent TypeScript Typing**:
    - **Problem**: The use of `any` in several key places, such as the `options` parameter in the `LayerManager` constructor, undermines the benefits of using TypeScript.
    - **Suggestion**: Create specific `interface` definitions for complex objects like the `LayerManager` options. Strive to replace `any` with more specific types throughout the codebase to improve type safety and developer experience.
    - **File to address**: `src/lib/LayerManager.ts` (and others)

### P4: Low (Minor improvements)

1.  **Svelte Version Discrepancy**:
    - **Problem**: `package.json` specifies Svelte 5, but the code is written in Svelte 4 syntax. This is confusing and could lead to unexpected behavior or build failures. The `CLAUDE.md` file also notes that a Svelte 5 migration is not yet recommended.
    - **Suggestion**: Align the `svelte` version in `package.json` with the version actually being used (the latest stable Svelte 4 release).
    - **File to address**: `package.json`

2.  **Accessibility Issues**:
    - **Problem**: The `CLAUDE.md` file mentions that there are 31 accessibility warnings from the Svelte compiler.
    - **Suggestion**: Run the `npm run lint` command (which should include the svelte-check accessibility warnings) and address the reported issues to make the application more usable for everyone.
