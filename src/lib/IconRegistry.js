/**
 * Centralized Lucide icon registry for meteocool
 * This centralizes all Lucide icon imports for better tree-shaking
 * and bundle optimization. Replaces FontAwesome with modern Lucide icons.
 */

import { Play, Pause, ChevronsDown, ChevronsUp, History, Repeat, Layers, Circle, Github } from '@lucide/svelte/icons'

// Lucide icons - direct component exports maintaining FontAwesome-compatible names
export {
  Play as FaPlay,
  Pause as FaPause,
  ChevronsDown as FaAngleDoubleDown,
  ChevronsUp as FaAngleDoubleUp,
  History as FaHistory,
  Repeat as FaRetweet,
  Layers as FaLayerGroup,
  Circle as FaCircle,
  Github as FaGithub,
}

// Keep old names for backward compatibility but with proper naming
export {
  Play as faPlay,
  Pause as faPause,
  ChevronsDown as faAngleDoubleDown,
  ChevronsUp as faAngleDoubleUp,
  History as faHistory,
  Repeat as faRetweet,
  Layers as faLayerGroup,
  Circle as faCircle,
  Github as faGithub,
}

// For backwards compatibility, also export individual icons with their Lucide names
export { Play, Pause, ChevronsDown, ChevronsUp, History, Repeat, Layers, Circle, Github }

// Note: Lucide icons are used directly as components, no wrapper Icon component needed
