/**
 * Centralized FontAwesome icon registry for meteocool
 * This centralizes all FontAwesome icon imports for better tree-shaking
 * and bundle optimization.
 */

// Solid icons
export { faPlay } from "@fortawesome/free-solid-svg-icons/faPlay";
export { faPause } from "@fortawesome/free-solid-svg-icons/faPause";
export { faAngleDoubleDown } from "@fortawesome/free-solid-svg-icons/faAngleDoubleDown";
export { faAngleDoubleUp } from "@fortawesome/free-solid-svg-icons/faAngleDoubleUp";
export { faHistory } from "@fortawesome/free-solid-svg-icons/faHistory";
export { faRetweet } from "@fortawesome/free-solid-svg-icons/faRetweet";
export { faLayerGroup } from "@fortawesome/free-solid-svg-icons/faLayerGroup";
export { faCircle } from "@fortawesome/free-solid-svg-icons/faCircle";

// Brand icons
export { faGithub } from "@fortawesome/free-brands-svg-icons/faGithub";

// Re-export the Icon component for convenience
export { default as Icon } from "fa-svelte";