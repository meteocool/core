/**
 * XState machine for NowcastPlayback component
 * Replaces javascript-state-machine with modern XState implementation
 */

import { createMachine, assign } from 'xstate'

export const nowcastPlaybackMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QAoC2BDAxgCwJYDswBKAOlwGIB5AVQGUBRAYgG0AGAXUVAAOqsA7rAC2XEfhAAPRAFoAzAHYAjAA4AnCoC+ylWky4CRUhWp0mrdl0QBGAEwBWbToLsuPPgOEixE6fNRYeERkVAwcXDwCwmISUjJwSipqGloGxhbWdg5OLugiNJ7eGLoBgUGYIdEMTBxcvKLiklIySghxCeqJXjoGOhUqkzYO7Vm5eQVFfCWlrBXSNQq1-gHBofHjvLSdLaUGXfMZiwOD5YmDFVo5OgmTtosdyTOzXlA+gX8lhpVqMw4p5btYamM5kdLkcrrcyEQHk93h8vj9sP9-oBgqkBkwZsYoVNJs0FqsyJVVicUUi7oJcZ4fIcCsICgZDhSrPc8oc2ldUULmfyBWEYLMQs1gm0dvZFZzWmzOjySaDVmq5gMhvkknAHvQfhkqbE6Ql4LS4pSGUKnlNqKstnkbE47DrGfr6YSfMaWWkZsaVqD1u9zTJYEwbS6PZ67Zc8rb7Y6lJNg8YQxYxjJdPGzTrPKpHb6E1kRfSGWzM80Q1nYYHnbaYVJgA4YWJsLhiOOKfNpJqDUyG6IkgZRJXbCm8mmynFUxlMrCEsmcqOe0WrOWmgPBmNxgY5o4lJ4kpXPBWY7WdY26-qGKPqFNNq8S5dYCzHlO3adW7G4B5R0bO0hSfQCyAswtS4J4bw5CVHngvNyygMtnRZKDYNjEMpjAgMnTdMDBmHCh12eNqjPYMdnXfFbRAuYwI5bN30QmQYLZeNk1Azl5STCtuVTCwNFqSIZAqCMclEI8T3gX5kAAFWgFhqDLURcnZH5cPjRt2zTcYsKdKjvT+IwMgJCMyIyLIrzKKlKMvUMJOYxiVQybI7zJDdtP6MIr0grEtLqCwVNEgMKl0YJxgJMyGIrZ5hSPYI0j6W4rI4h8pI2GKjV0wx7AaJTZJa2jvNcuYdLY6IrxtVcNFUi96S0kQyhUJTHJEnlrKqqyqOC3yHSslUbL6eLYtHHYRu+0KdK3ZKb00kTHxE1Ij0qMqBzKKJgxqDJt20uy0vPXSjJMsrOo6sq7N3I8jyOl0tJGEYVo0ztbrEoNdNmybtJfW6-Ku2JhXi-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-aGGQhGH8BdR3hkQ4CQEB6WGCbxSSj8oSj-QQ7FlWENqQ7hy5SdqOF7gqCxTgjFEfjKElH2EYqOE8rOF5F37-aFGDKlF5LKGVZRy2gvQRZdj9hPylC0gPAUgChHBPhbSaRBZ7ykxgEfSGRRE3DL4WRvB-oPQ3a8wLHxwZG7ZFHNKhQM7JZRIWlZJc65zWjWQfx+IKQGjN7NHkyHZKG4CdrfYFGOYJLEKMlMnMloEWgQGYFwLZQXwCh0HMjejcrOGqHqGfCaFRwTwKppYVFJZlGGhSyiYG4yRvF4IRF-ElEMlslNFfFtG-RGF2T0EvQdwOGDqEKaT4lPQkkYmdFkmzKUmOykmMlJKskcnJLskMx0lMmNxPQskfEzGvGlZRKzQUjdjEGcHKqgYKpTEArX7bJTIVIiZUqnw8z0lMgchXTNjfT6jmWOElawAA */
    id: 'nowcastPlayback',

    initial: 'followLatest',

    context: {
      autoPlay: false,
      playTimeout: 0,
    },

    states: {
      followLatest: {
        on: {
          SHOW_SCROLLBAR: {
            target: 'manualScrolling',
            actions: ['onShowScrollbar'],
          },
          HIDE_SCROLLBAR: {
            target: 'followLatest',
            actions: ['onHideScrollbar'],
          },
        },
      },

      manualScrolling: {
        on: {
          PRESS_PLAY: {
            target: 'playing',
            actions: ['onPressPlay'],
          },
          HIDE_SCROLLBAR: {
            target: 'followLatest',
            actions: ['onHideScrollbar'],
          },
        },
      },

      playing: {
        on: {
          PRESS_PAUSE: {
            target: 'manualScrolling',
            actions: ['onPressPause'],
          },
          HIDE_SCROLLBAR: {
            target: 'followLatest',
            actions: ['onHideScrollbar'],
          },
        },
      },
    },
  },
  {
    actions: {
      onShowScrollbar: () => {
        // This will be implemented in the component
        // We'll pass callbacks from the component to handle these actions
      },

      onPressPlay: () => {
        // Implementation will be provided by component
      },

      onPressPause: assign({
        playTimeout: 0,
      }),

      onHideScrollbar: () => {
        // Implementation will be provided by component
      },
    },
  },
)

/**
 * Create the nowcast playback machine with component-specific actions
 * @param {Object} actions - Component-specific action implementations
 * @returns {Object} - Configured XState machine
 */
export function createNowcastPlaybackMachine(actions = {}) {
  return nowcastPlaybackMachine.provide({
    actions: {
      onShowScrollbar: actions.onShowScrollbar || (() => {}),
      onPressPlay: actions.onPressPlay || (() => {}),
      onPressPause: actions.onPressPause || (() => {}),
      onHideScrollbar: actions.onHideScrollbar || (() => {}),
    },
  })
}
