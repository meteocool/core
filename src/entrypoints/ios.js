import * as Sentry from '@sentry/browser'
import SENTRY_ARGS from '../lib/sentry.js'
import { initNetworkStatus, cleanupNetworkStatus } from '../lib/networkStatus'

Sentry.init(SENTRY_ARGS)

import { Workbox } from 'workbox-window'
import App from '../App.svelte'
import { DeviceDetect as dd } from '../lib/DeviceDetect'
import { mount } from 'svelte'
import { logger } from '../lib/logger.js'

initNetworkStatus()

// Register service worker
if ('serviceWorker' in navigator) {
  const wb = new Workbox('sw.js')
  wb.addEventListener('controlling', (evt) => {
    if (evt.isUpdate) {
      logger.log('Reloading page for latest content')
      window.location.reload()
    }
  })
  wb.register()
}

const handleVisibility = () => {
  if (document.visibilityState === 'visible' && window.enterForeground) {
    window.enterForeground()
  }
}
document.addEventListener('visibilitychange', handleVisibility)
window.addEventListener('pagehide', cleanupNetworkStatus)
window.addEventListener('beforeunload', cleanupNetworkStatus)

const app = mount(App, {
  target: document.body,
  props: {
    device: 'ios',
    postInitCb() {
      if (dd.isIos()) {
        const handler = window.webkit?.messageHandlers?.scriptHandler
        if (handler?.postMessage) {
          handler.postMessage('requestSettings')
        }
      }
    },
  },
})

export default app
