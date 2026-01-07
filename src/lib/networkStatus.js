import { networkStatus } from '../stores'

let cleanupFns = []

const readConnection = () => {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  const effectiveType = connection?.effectiveType || null
  const downlink = typeof connection?.downlink === 'number' ? connection.downlink : null
  const isSlow = Boolean(
    effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g' || (downlink !== null && downlink < 1.5),
  )
  return { effectiveType, isSlow }
}

const updateStatus = () => {
  if (typeof navigator === 'undefined') return
  const { effectiveType, isSlow } = readConnection()
  networkStatus.set({
    online: typeof navigator.onLine === 'boolean' ? navigator.onLine : true,
    effectiveType,
    isSlow,
  })
}

export const initNetworkStatus = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return
  cleanupNetworkStatus()
  updateStatus()

  const handleOnline = () => updateStatus()
  const handleOffline = () => updateStatus()
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  cleanupFns.push(() => window.removeEventListener('online', handleOnline))
  cleanupFns.push(() => window.removeEventListener('offline', handleOffline))

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  if (connection && connection.addEventListener) {
    const handleConnection = () => updateStatus()
    connection.addEventListener('change', handleConnection)
    cleanupFns.push(() => connection.removeEventListener('change', handleConnection))
  }
}

export const cleanupNetworkStatus = () => {
  cleanupFns.forEach((fn) => fn())
  cleanupFns = []
}

export const refreshNetworkStatus = () => updateStatus()
