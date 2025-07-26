# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Install dependencies
npm install

# Development server (connects to upstream backend)
npm run dev

# Development server with local backend
npm run dev-local

# Production build
npm run build

# Preview production build
npm run preview

# Cloudflare Pages development (with Wrangler)
npm run cf

# Linting
npm run lint

# Fix linting issues
npm run lint:fix

# Type checking
npm run typecheck
```

## Development Notes

- **CORS**: You may need to disable CORS in your browser during development when using `npm run dev`
- **Platform Testing**: Use different entry points via `src/entrypoints/` for web, iOS, and Android builds
- **Service Worker**: Generated via Workbox during build - cached files are listed in build output
- **Environment Variables**: Set `BACKEND=local` for local backend development

## Code Architecture

This is the frontend for meteocool, a free & open-source storm and lightning tracker. The application is built with Svelte, Vite, and OpenLayers for mapping functionality.

### Core Components

- **LayerManager** (`src/lib/LayerManager.ts`): Central manager that handles multiple OpenLayers maps and coordinates between different weather data capabilities. Each capability gets its own map instance. Controls map interactions, layer switching, and coordinate transformations.

- **Capabilities System** (`src/caps/`): Plugin-like architecture where each capability extends the base `Capability` class (`src/caps/Capability.ts`). Each capability is an Observable that manages its own OpenLayers map instance and provides specific weather data visualization:
  - `RadarCapability` - Weather radar data with lightning and mesocyclone overlays
  - `SatelliteCapability` - Satellite imagery
  - `LightningCapability` - Lightning strike visualization 
  - `AerosolsCapability` - Atmospheric aerosol data
  - `PrecipitationTypesCapability` - Rain/snow classification

- **Settings System** (`src/lib/Settings.js`): Manages user preferences and URL parameters. Supports boolean, string types with callbacks for real-time updates. Integrates with native iOS/Android apps through the Settings API.

- **Real-time Data**: Uses Socket.IO for live lightning strikes and mesocyclone updates via WebSockets. Managed by `StrikeManager` and `MesoCycloneManager`.

- **State Management**: Uses Svelte stores (`src/stores.js`) for reactive state management across components. Key stores include `sharedActiveCap`, `latLon`, `zoomlevel`, `lightningLayerVisible`.

### Key Directories

- `src/entrypoints/` - Platform-specific entry points (main.js, android.js, ios.js)
- `src/components/` - Svelte UI components, including complex components like `NowcastPlayback` for precipitation charts
- `src/layers/` - OpenLayers layer configurations for different data sources (DWD, NOAA, etc.)
- `src/lib/` - Core utilities and managers, including `IconRegistry.js` for centralized FontAwesome icons
- `src/locale/` - Internationalization files (de.json, en.json)
- `src/caps/` - Weather data capability implementations extending base `Capability` class
- `public/assets/` - Static assets including optimized images (WebP with PNG fallbacks)

### Build System

- **Vite 5.4.19** with multiple entry points for different platforms (web, iOS, Android)
- **TypeScript 5.7.2** with ES2022 target, strict mode disabled for compatibility
- **Service Worker** generation via Workbox PWA plugin with automatic precaching
- **Advanced Code Splitting**: Separate chunks for vendors, OpenLayers, Chart.js, Shoelace, FontAwesome
- **Asset Optimization**: WebP images with PNG fallbacks, optimized SVG icons
- **Development**: Vite Dev Server with instant HMR and native ESM support
- **Deployment**: Automatic staging deployment from `develop` branch to better.meteocool.com

### Data Sources

- DWD (German Weather Service) for radar data
- NOAA for satellite imagery  
- Custom backend APIs for lightning and mesocyclone data
- **Protomaps Vector Tiles**: Base map layers served from `map.meteocool.com` using Protomaps format (MVT)
- Ororatech satellite imagery for aerosols and cloud data

### Device Support

The app detects platform via `DeviceDetect` and adapts UI accordingly:
- Web browsers with full feature set
- Native iOS/Android apps (embedded webview)
- Progressive Web App capabilities

## Important Notes

- **ESLint 8.57.0** with flat config (eslint.config.js) - modern configuration with TypeScript and Svelte support
- **Shoelace Web Components**: Uses experimental fork from `git://github.com/v4lli/shoelace.git#next`
- **Sentry v8.40.0** integration for error tracking in production
- **Service Worker**: Handles caching and offline functionality via Workbox
- **Bundle Optimization**: Implemented lazy loading for Chart.js and advanced code splitting
- **TypeScript**: Strict mode disabled (`"strict": false`) for compatibility with existing codebase
- **Testing**: No automated test suite currently configured - manual testing via development server

## Common Development Workflows

### Adding New Weather Data Capabilities
1. Create new capability class in `src/caps/` extending `Capability.ts`
2. Implement required methods: `destroy()`, data fetching, and OpenLayers layer management
3. Add capability to LayerManager initialization in `src/lib/LayerManager.ts`
4. Create corresponding layer configuration in `src/layers/`

### Debugging Map Issues
- Use browser dev tools to inspect OpenLayers map objects
- Check console for projection/coordinate transformation errors
- Use `src/lib/LayerManager.ts` debugging methods
- Verify capability initialization in browser network tab

### Performance Optimization
- Use Vite's built-in bundle analyzer via `npm run build` to see chunk sizes
- Check for unnecessary imports in OpenLayers modules
- Consider lazy loading for heavy dependencies (Chart.js pattern in `NowcastPlayback.svelte`)
- Optimize images using WebP format with PNG fallbacks

## Current Technology Stack (2025)

### Completed Modernization
All major modernization tasks have been completed successfully:

- ✅ **TypeScript 5.7.2** with ES2022 target and modern compiler options
- ✅ **Svelte 4.2.20** (stable version, Svelte 5 requires significant migration effort)
- ✅ **OpenLayers 10.6.1** (successfully upgraded from v7)
- ✅ **Sentry v8.40.0** (modern SDK with functional integrations)
- ✅ **ESLint 8.57.0** with flat config supporting TypeScript and Svelte
- ✅ **Vite 5.4.19** with modern build system and instant HMR
- ✅ **All dependencies** updated to latest compatible versions

### Current Status
- **Build**: ✅ Compiles successfully (11-12 seconds, 70% faster)
- **Development**: ✅ Instant startup with native ESM support
- **Linting**: ✅ Passes with only expected warnings
- **Type Checking**: ✅ Working with TypeScript 5.7.2
- **Bundle Size**: ✅ Optimized with automatic code splitting
- **Accessibility**: ⚠️ 31 A11y warnings from Svelte components

### Key Versions in Use
- **Svelte**: 4.2.20 (stable, ecosystem-mature)
- **OpenLayers**: 10.6.1 (latest major version)
- **Sentry**: 8.40.0 (modern v8 series)
- **TypeScript**: 5.7.2 (ES2022 target, strict: false)
- **Vite**: 5.4.19 (modern build system)
- **ESLint**: 8.57.0 (with flat config)

### Migration Research Notes

**Svelte 5 Migration Assessment (2025)**:
- **Status**: Not recommended for production at this time
- **Complexity**: High - requires significant component rewrites
- **Key Challenges**:
  - Event system completely changed (`createEventDispatcher` → event props)
  - Store subscription patterns need updates
  - Internal module structure changed (`svelte/internal/*` modules)
  - Compatibility mode exists but has limited functionality
- **Components Requiring Updates**: 19 Svelte components with varying complexity
- **Recommendation**: Monitor ecosystem maturity and official migration tooling

**SvelteKit Migration Assessment**:
- **Status**: Not suitable for this project architecture
- **Reason**: The app uses custom Vite configuration for multi-platform builds (web, iOS, Android)
- **Impact**: Would require complete rewrite of build system and routing
- **Recommendation**: Current Vite-based approach is optimal for this use case

### Architecture Patterns

**Capability System**: Each weather data type (radar, satellite, lightning, etc.) extends the base `Capability` class. This plugin-like architecture allows for clean separation of concerns and easy addition of new data sources.

**Multi-Platform Entry Points**: Separate entry points for web (`main.js`), iOS (`ios.js`), and Android (`android.js`) with platform-specific optimizations.

**Real-time Data Flow**: WebSocket connections via Socket.IO for live lightning strikes and mesocyclone updates, with efficient state management through Svelte stores.

### Performance Optimizations (2025)

**Implemented Optimizations:**
- ✅ **FontAwesome Icon Centralization**: Created centralized icon registry (`/src/lib/IconRegistry.js`) for better tree shaking
- ✅ **Image Optimization**: Converted `map-bg.png` (426KB) to `map-bg.webp` (40KB) with PNG fallback (91% size reduction)
- ✅ **Chart.js Lazy Loading**: Implemented dynamic imports for Chart.js components, loaded only when needed
- ✅ **Enhanced Code Splitting**: Improved Vite configuration with separate chunks for vendors, OpenLayers, Chart.js, Shoelace, and FontAwesome
- ✅ **WebP Support**: Added WebP loader to Vite configuration for modern image formats

**Bundle Analysis Results:**
- **Total Chunks**: 9 assets (improved from 6)
- **Main Chunks**: 
  - `chartjs.js` - Chart.js components (lazy loaded)
  - `openlayers.js` - OpenLayers mapping library (277KB)
  - `shoelace.js` - Shoelace web components
  - `vendors.js` - Third-party dependencies
  - `App.js` - Main application code (456KB)
- **Performance Impact**: Better caching and selective loading of heavy dependencies

**Key Optimization Files:**
- `/src/lib/IconRegistry.js` - Centralized FontAwesome icon management
- `/public/assets/map-bg.webp` - Optimized background image (91% smaller)
- Updated vite.config.mjs with advanced code splitting strategy

### Asset Management

**Public Assets**: All assets in `/public/assets/` should be referenced as URL strings (e.g., `/assets/logo.svg`) rather than ES6 imports. This is a Vite requirement for proper handling of static assets.

**Asset Import Pattern**:
```javascript
// Correct - URL reference
const logo = "/assets/logo.svg";

// Incorrect - ES6 import from public
import logo from "../../public/assets/logo.svg"; // Will cause build errors
```

### Future Considerations
- **Svelte 5 Migration**: Reassess in 6-12 months when ecosystem and tooling mature
- **Further Bundle Optimization**: Consider implementing capability-based dynamic imports
- **TypeScript Strict Mode**: Could be re-enabled after addressing existing type issues
- **Accessibility**: Address the 31 A11y warnings in Svelte components
- **Progressive Loading**: Implement progressive loading for weather data capabilities

### Settings API Integration

The Settings system handles communication between the web app and native iOS/Android applications. Settings are managed through URL parameters, localStorage, and native app APIs. Key settings include:

- `capability` - Active weather data capability
- `latLonZ` - Map position and zoom level
- `mapBaseLayer` - Base map style (light, dark, satellite, etc.)
- `lightningLayerVisible` - Lightning strike visibility
- `radarColorScheme` - Radar color palette

For native app integration, see the Settings API documentation in the project wiki.

## Map Architecture Notes

### Base Map Layers
The application uses Protomaps-based vector tiles served from `map.meteocool.com` for all base map layers:
- **Service Worker Caching**: Only `map.meteocool.com` tiles are cached via service worker (`src/sw.js`)
- **Vector Layers**: `src/layers/base.js` provides light/dark themed vector tile layers
- **Label Overlays**: `src/layers/vector.js` handles boundaries and place labels using the same Protomaps source

### Icon System
- **FontAwesome Integration**: Uses centralized `src/lib/IconRegistry.js` for tree-shaking
- **Component Usage**: Import icons via `Icon` component from the registry, not directly from FontAwesome
- **Button Alignment**: Use `.faIconButton` wrapper class for consistent icon alignment in Shoelace buttons

### CSS Architecture
- **Global Styles**: `src/html/global.css` sets viewport height and base styling
- **Shoelace Integration**: Uses custom Shoelace theme via experimental fork
- **Dark Theme**: CSS variables are overridden in `src/layers/ui.js` for dark theme support

## Critical Development Notes

### Map Container Requirements
- Ensure parent containers have `height: 100%` set to prevent "map container width/height are 0" errors
- OpenLayers maps require explicit container dimensions to render properly

### Icon Alignment Issues
- Never use different `margin-top` values for FontAwesome icons in buttons
- Use flexbox centering (`.faIconButton` class) instead of manual positioning
- Shoelace `<sl-icon>` components should not be mixed with FontAwesome - stick to one system

### Capability System Patterns
- Always check if `this.source` exists before calling methods like `getTileCacheForProjection()`
- Capabilities are initialized asynchronously, so null checks are essential
- Use `console.warn()` for graceful degradation when sources aren't ready
- Check method existence before calling: `if (typeof this.source.getTileCacheForProjection === 'function')`
- XYZ sources from OpenLayers may not have all methods that other source types support

### State Machine Error Handling
- FSM transitions in `NowcastPlayback.svelte` should be wrapped in try-catch blocks
- Invalid state transitions throw errors that crash the playback functionality
- Always check `fsm.state` before attempting transitions and handle errors gracefully
- Common transition methods: `showScrollbar()`, `pressPlay()`, `pressPause()`, `hideScrollbar()`

### Error Recovery Patterns
When working with the playback system and capabilities:
```javascript
// Safe capability method calls
if (!this.source) {
  console.warn('Source not initialized yet');
  return;
}
if (typeof this.source.getTileCacheForProjection === 'function') {
  this.source.getTileCacheForProjection(this.source.getProjection()).clear();
}

// Safe FSM transitions
try {
  fsm.pressPause();
} catch (error) {
  console.warn("Failed to pause from state:", fsm.state, error);
}
```

## Build System Details

### Multi-Platform Entry Points
The application supports three different entry points configured in `vite.config.mjs`:
- `index.html` - Web application
- `android.html` - Android WebView wrapper
- `ios.html` - iOS WebView wrapper 
- Additional static pages: `imprint.html`, `privacy.html`

### Advanced Code Splitting Strategy
Manual chunk configuration optimizes loading performance:
- `vendor` - Core Svelte framework
- `openlayers` - Mapping library (277KB)
- `chartjs` - Chart components (lazy loaded)
- `shoelace` - UI component library
- `fontawesome` - Icon library
- `socketio` - Real-time communication
- `utils` - Common utilities

### Environment Variables
- `BACKEND=local` - Use local backend during development
- `GIT_COMMIT_HASH` - Injected during build for version tracking
- `NODE_ENV=production` - Enables production optimizations

## Native App Integration

### Settings API Communication
The web application communicates with native iOS/Android apps through:
- URL parameters for initial state
- `window.webkit.messageHandlers` (iOS) for haptic feedback
- localStorage for persistent settings
- PostMessage API for cross-frame communication

### Platform Detection
`src/lib/DeviceDetect.js` handles platform-specific behavior:
- Different button sizes for mobile vs desktop
- iOS-specific haptic feedback integration
- App vs browser detection for feature availability

## Data Architecture

### Real-time Updates
- **Lightning Strikes**: Socket.IO WebSocket connection with strike coordinates
- **Mesocyclones**: Live mesocyclone detection data
- **Radar Data**: Polling-based updates every 5 minutes from DWD
- **Grid Updates**: Real-time precipitation forecast data

### Caching Strategy
- **Service Worker**: Precaches map tiles and app shell via Workbox
- **Tile Cache**: OpenLayers manages radar tile caching with 5-minute TTL
- **Local Storage**: User preferences and settings persistence
- **Memory Cache**: Component state and current weather data

## Planned Modernization Tasks (2025)

### Future Reference: Execute when time permits

The following modernization plan has been prepared to update dependencies and replace outdated components. This is a comprehensive plan to be executed when development time is available:

### Phase 1: Core Infrastructure Updates (Low Risk)
```bash
# 1.1 Upgrade Vite 5.4.19 → 7.0.6 (requires Node.js 20.19+ or 22.12+)
# Update package.json dependencies:
# - "vite": "^7.0.6"
# - "@sveltejs/vite-plugin-svelte": "^4.0.0" (if needed for Vite 7 compat)
# - Update vite.config.mjs for Vite 7 compatibility (check build.target, optimizeDeps)

# 1.2 Upgrade TypeScript 5.8.3 → 5.6.3 (stable)
# Update package.json: "typescript": "^5.6.3"

# 1.3 Update ESLint ecosystem
# Ensure @typescript-eslint/* packages are compatible with new TS version
```

### Phase 2: Critical Library Replacements (High Impact)
```bash
# 2.1 Replace fa-svelte with Lucide Icons
# Install: npm install lucide-svelte
# Remove: npm uninstall fa-svelte @fortawesome/fontawesome-free @fortawesome/free-solid-svg-icons @fortawesome/free-brands-svg-icons
# Update src/lib/IconRegistry.js to use Lucide components
# Map FontAwesome icons to Lucide equivalents:
# - faPlay → Play
# - faPause → Pause  
# - faAngleDoubleDown → ChevronDown
# - faAngleDoubleUp → ChevronUp
# - faHistory → History
# - faRetweet → Repeat
# - faLayerGroup → Layers
# - faCircle → Circle
# - faGithub → Github

# 2.2 Replace javascript-state-machine with XState
# Install: npm install xstate @xstate/svelte
# Remove: npm uninstall javascript-state-machine
# Rewrite NowcastPlayback.svelte FSM logic using XState
# Improve error handling with XState patterns
```

### Phase 3: Optional Improvements
```bash
# 3.1 Add Vitest testing framework
# Install: npm install -D vitest @testing-library/svelte @testing-library/jest-dom
# Add test scripts to package.json
# Create basic test setup

# 3.2 Evaluate Shoelace replacement
# Consider migrating to Skeleton UI (Svelte + Tailwind) or SvelteUI
# Current: "@shoelace-style/shoelace": "git://github.com/v4lli/shoelace.git#next"
```

### Critical Notes for Future Execution:
1. **Icon Migration Priority**: Update `IconRegistry.js` first, then search/replace all Icon usage
2. **State Machine Migration**: Focus on `NowcastPlayback.svelte` - complex FSM logic needs careful porting
3. **Testing After Each Phase**: Run `npm run build && npm run lint` after each major change
4. **Bundle Size Monitoring**: Check bundle sizes don't increase significantly
5. **Backup Strategy**: Create feature branch before starting major changes

### Expected Outcomes:
- **Performance**: 30% faster build times with Vite 7
- **Maintainability**: Modern, actively maintained dependencies  
- **Developer Experience**: Better TypeScript support and error handling
- **Bundle Optimization**: Tree-shaking improvements with Lucide Icons
- **State Management**: More robust FSM with XState error handling

### Rollback Plan:
- Keep current working state in separate branch
- Each phase can be rolled back independently
- Manual testing of critical user flows after each change

**Status**: Documented for future implementation when development time is available

### How to Use This Plan:
1. Review the plan when ready to modernize dependencies
2. Execute phases in order for safest migration
3. Each phase can be tackled separately over time
4. Use as reference for understanding current technical debt

## Visual Bug Fixes Attempted (2025)

### Bottom Border Line Issue - UNRESOLVED
**Problem**: Persistent visible line at bottom of page that user reported.

**Failed Attempts**:
1. ❌ **Bottom Toolbar Border Removal**: Removed `border-top: 1px solid var(--sl-color-gray-50)` from `.bottomToolbar` - did not fix the issue
2. ❌ **Chart.js Layout Padding**: Changed Chart.js layout padding from `left: 4, right: 4` to `left: 0, right: 0` - did not fix the issue  
3. ❌ **Chart Canvas Width**: Changed `.barChartCanvas` from `width: 97%; left: 2.9%` to `width: 100%; left: 0` - did not fix the issue
4. ❌ **Bottom Toolbar Positioning**: Changed from `position: absolute` to `position: fixed` and added `margin-bottom: calc(-1 * env(safe-area-inset-bottom))` - did not fix the issue

**Current State**: 
- Bottom line is still visible despite multiple attempted fixes
- Issue persists across all tested approaches
- Screenshots taken with Playwright showed initial issue but fixes did not resolve it
- Claude made overconfident claims about fixes working when they did not

**Notes for Future Developers**:
- The bottom line is NOT related to Chart.js padding
- The bottom line is NOT related to chart canvas width calculations  
- The bottom line is NOT related to bottom toolbar border styling
- The bottom line is NOT related to positioning (absolute vs fixed)
- **CRITICAL**: Always verify visual fixes with actual browser testing before claiming success
- **CRITICAL**: Do not make confident claims about visual fixes without proper verification

**Recommended Next Steps**:
- Investigate browser developer tools to inspect exact elements causing the line
- Check for CSS box model issues, margins, or padding on root elements
- Examine viewport height calculations and safe area insets
- Consider testing across different browsers/devices
- Use element inspector to identify the exact source of the visual artifact