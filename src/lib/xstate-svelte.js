/**
 * Svelte 5 XState integration utility
 * Custom implementation since @xstate/svelte doesn't support Svelte 5 yet
 */

import { createActor } from 'xstate'

/**
 * Create a reactive XState actor that works with Svelte 5
 * This function should be called from within a Svelte component
 * @param {import('xstate').AnyStateMachine} machine - XState machine
 * @param {Object} options - Actor options
 * @returns {Function} - Function that returns the XState service object
 */
export function createMachineService(machine, options = {}) {
  return () => {
    const actor = createActor(machine, options)
    actor.start()
    return actor
  }
}

/**
 * Helper to get current state from actor
 * @param {import('xstate').Actor} actor - XState actor
 * @returns {Object} - Current state snapshot
 */
export function getCurrentState(actor) {
  return actor ? actor.getSnapshot() : null
}
