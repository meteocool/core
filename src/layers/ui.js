import { colorSchemeDark } from '../stores'
import { logger } from '../lib/logger.js'

export const uiConstantsDefault = {
  'toast-stack-offset': '49px',
}

const darkmodeConstants = {
  'sl-color-white': '#3F3F3F',
  'sl-color-black': '#FFFFFF',
  'sl-color-gray-50': '#3F3F3F',
  'sl-color-gray-700': '#FFFFFF',
  'sl-color-gray-300': '#717171',
  'sl-color-gray-200': '#8b8b8b',
  'sl-color-info-100': '#3F3F3F',
  'sl-color-primary-text': '#ffffff',
  'sl-color-gray-600': '#d6d6d6',
  'sl-color-info-700': '#c2c2c2',
  'sl-color-primary-600': '#38BDF8',
  // CSS people be like https://codepen.io/sosuke/pen/Pjoqqp
  'svg-dark-to-light': 'invert(99%) sepia(0%) saturate(469%) hue-rotate(31deg) brightness(119%) contrast(100%)',
}

export const NOWCAST_OPACITY = 0.75

// Store media query reference for cleanup
let darkModeMediaQuery = null
let darkModeHandler = null

export function setUIConstant(name, suite = uiConstantsDefault) {
  const value = typeof suite === 'string' ? suite : suite[name]
  if (value !== undefined) {
    document.documentElement.style.setProperty(`--${name}`, value)
  }
}

export function unsetUIConstant(name) {
  document.documentElement.style.removeProperty(`--${name}`)
}

export function resetUIConstantByPrefix(prefix) {
  Object.keys(uiConstantsDefault)
    .map((key) => key.startsWith(prefix))
    .forEach((key) => setUIConstant(key))
}

export function initUIConstants() {
  Object.keys(uiConstantsDefault).forEach((key) => setUIConstant(key))

  if (window.matchMedia) {
    darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    colorSchemeDark.set(darkModeMediaQuery.matches)

    // Store handler reference for cleanup
    darkModeHandler = (e) => {
      logger.log(`changed to ${e.matches ? 'dark' : 'light'} mode`)
      colorSchemeDark.set(e.matches)
    }

    darkModeMediaQuery.addEventListener('change', darkModeHandler)
  }
}

export function cleanupUIConstants() {
  // Clean up media query listener to prevent memory leaks
  if (darkModeMediaQuery && darkModeHandler) {
    darkModeMediaQuery.removeEventListener('change', darkModeHandler)
    darkModeMediaQuery = null
    darkModeHandler = null
  }
}

// Dark and Light mode
colorSchemeDark.subscribe((isDark) => {
  if (isDark) Object.keys(darkmodeConstants).forEach((key) => setUIConstant(key, darkmodeConstants))
  else Object.keys(darkmodeConstants).forEach((key) => unsetUIConstant(key))
})
