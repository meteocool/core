# Shoelace Migration Plan

## Current Status
- Using experimental fork: `@shoelace-style/shoelace@github:v4lli/shoelace#next`
- This fork provides `base.css` theme
- UI works correctly with this version

## Issue with Official Shoelace
When migrating to official Shoelace 2.20.1, the following CSS/styling issues occur:
- Logo loses background styling
- Layer switcher button loses background
- Bottom toolbar alignment breaks
- Status indicators break

## Root Cause
The official Shoelace has a different CSS structure:
- No `base.css` - instead has `light.css` and `dark.css`
- Requires additional component registration
- Different CSS variable structure

## Proper Migration Steps

### 1. Research Phase
- Clone the experimental fork and compare with official version
- Identify all CSS differences
- Document which components need different initialization

### 2. CSS Migration
Instead of just importing the theme:
```javascript
// Current (working)
import '@shoelace-style/shoelace/dist/themes/base.css'

// Official version needs:
import '@shoelace-style/shoelace/dist/themes/light.css'
// Plus potentially:
import '@shoelace-style/shoelace/dist/shoelace.css'
```

### 3. Component Registration
The official version may require explicit component registration:
```javascript
import '@shoelace-style/shoelace/dist/components/button/button.js'
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js'
// etc...
```

### 4. CSS Variable Updates
Check if CSS variables have changed between versions:
- `--sl-color-primary-*`
- `--sl-spacing-*`
- Component-specific variables

### 5. Testing Strategy
1. Create a branch for migration
2. Update one component at a time
3. Test each component visually
4. Ensure dark mode still works
5. Test on all platforms (web, iOS, Android)

## Alternative Approach
If the official Shoelace requires too many changes, consider:
1. Forking the experimental version ourselves
2. Gradually updating to match official API
3. Or switching to a Svelte-native component library

## Current Recommendation
**Keep the experimental fork for now** until we can:
1. Properly analyze all CSS differences
2. Test migration thoroughly in a branch
3. Ensure no visual regressions

The experimental fork is working well and provides the styling we need. A rushed migration to the official version risks breaking the production UI.