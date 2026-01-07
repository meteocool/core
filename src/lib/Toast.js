import { logger } from './logger.js'

export function reportError(message, _type = 'warning', _icon = 'exclamation-triangle') {
  logger.log(message)
}

export function reportToast(message, type = 'primary', icon = 'info-circle') {
  const toastStack = getToastStack()
  const toast = buildToast(message, type, icon)
  toastStack.append(toast)

  requestAnimationFrame(() => {
    toast.classList.add('toast--show')
  })

  const duration = toast.dataset.duration ? Number.parseInt(toast.dataset.duration, 10) : 15000
  const timeout = window.setTimeout(
    () => {
      removeToast(toast)
    },
    Number.isFinite(duration) ? duration : 15000,
  )

  toast.querySelector('.toast__close')?.addEventListener('click', () => {
    window.clearTimeout(timeout)
    removeToast(toast)
  })

  return toast
}

function getToastStack() {
  const existing = document.querySelector('.toast-stack')
  if (existing) return existing
  const stack = document.createElement('div')
  stack.className = 'toast-stack'
  stack.setAttribute('role', 'region')
  stack.setAttribute('aria-live', 'polite')
  document.body.append(stack)
  return stack
}

function buildToast(message, type, icon) {
  const toast = document.createElement('div')
  toast.className = `toast toast--${type}`
  toast.setAttribute('role', 'status')
  toast.dataset.duration = '15000'

  const iconSpan = document.createElement('span')
  iconSpan.className = 'toast__icon'
  iconSpan.setAttribute('aria-hidden', 'true')
  iconSpan.textContent = resolveIcon(icon)

  const text = document.createElement('span')
  text.className = 'toast__message'
  text.textContent = message

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'toast__close'
  close.setAttribute('aria-label', 'Dismiss')
  close.textContent = '×'

  toast.append(iconSpan, text, close)
  return toast
}

function removeToast(toast) {
  if (!toast || toast.classList.contains('toast--hide')) return
  toast.classList.add('toast--hide')
  toast.addEventListener(
    'transitionend',
    () => {
      toast.remove()
    },
    { once: true },
  )
  window.setTimeout(() => {
    if (toast.isConnected) toast.remove()
  }, 400)
}

function resolveIcon(name) {
  switch (name) {
    case 'exclamation-triangle':
      return '⚠️'
    case 'check-circle':
      return '✓'
    case 'info-circle':
    default:
      return 'ℹ️'
  }
}
