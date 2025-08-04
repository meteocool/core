/**
 * Svelte 5 XState integration utility
 * Custom implementation since @xstate/svelte doesn't support Svelte 5 yet
 */

import { createActor } from 'xstate'
import { onDestroy } from 'svelte'

/**
 * Create a reactive XState actor that works with Svelte 5 runes
 * @param {import('xstate').AnyStateMachine} machine - XState machine
 * @param {Object} options - Actor options
 * @returns {Object} - Actor with reactive state
 */
export function useActor(machine, options = {}) {
  const actor = createActor(machine, options)
  
  // Create reactive state using Svelte 5 runes
  let state = $state(actor.getSnapshot())
  
  // Start the actor
  actor.start()
  
  // Subscribe to state changes
  const subscription = actor.subscribe((snapshot) => {
    state = snapshot
  })
  
  // Cleanup on component destroy
  onDestroy(() => {
    subscription.unsubscribe()
    actor.stop()
  })
  
  return {
    get state() {
      return state
    },
    send: actor.send.bind(actor),
    actor
  }
}

/**
 * Create a reactive state machine service
 * @param {import('xstate').AnyStateMachine} machine - XState machine
 * @param {Object} options - Service options  
 * @returns {Object} - Service with reactive state and send function
 */
export function useMachine(machine, options = {}) {
  return useActor(machine, options)
}