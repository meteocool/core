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
- Multiple base map providers (Carto, OSM, etc.)

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