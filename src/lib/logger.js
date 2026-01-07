/**
 * Production-safe logging utility
 * Only logs in development mode
 */

const isDev = import.meta.env.DEV

/* eslint-disable no-console */
export const logger = {
  log: (...args) => {
    if (isDev) console.log(...args)
  },

  warn: (...args) => {
    console.warn(...args)
  },

  error: (...args) => {
    // Always log errors, even in production
    console.error(...args)
  },

  debug: (...args) => {
    if (isDev) console.debug(...args)
  },

  info: (...args) => {
    if (isDev) console.info(...args)
  },
}

export default logger
