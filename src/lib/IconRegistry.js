/**
 * Centralized Lucide icon registry for meteocool
 * This centralizes all Lucide icon imports for better tree-shaking
 * and bundle optimization.
 */

// Lucide icons - direct component exports with proper capitalization for Svelte
export { 
  Play as FaPlay,
  Pause as FaPause,
  ChevronsDown as FaAngleDoubleDown,
  ChevronsUp as FaAngleDoubleUp,
  History as FaHistory,
  Repeat as FaRetweet,
  Layers as FaLayerGroup,
  Circle as FaCircle,
  Github as FaGithub
} from "lucide-svelte";

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
  Github as faGithub
} from "lucide-svelte";

// For backwards compatibility, also export individual icons with their Lucide names
export { 
  Play,
  Pause,
  ChevronsDown,
  ChevronsUp,
  History,
  Repeat,
  Layers,
  Circle,
  Github
} from "lucide-svelte";

// Note: Lucide icons are used directly as components, no wrapper Icon component needed