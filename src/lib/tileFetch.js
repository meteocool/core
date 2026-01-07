import { tileStatus } from '../stores'

let inFlightCount = 0

const updateTileStatus = (patch) => {
  tileStatus.update((prev) => ({
    ...prev,
    ...patch,
  }))
}

const setInFlightCount = (count) => {
  inFlightCount = Math.max(0, count)
  updateTileStatus({ inFlight: inFlightCount })
}

export const createTileLoadFunction = () => {
  return (tile, src) => {
    if (!src) return

    const image = tile.getImage()
    let done = false

    const finalize = (success, errorMessage = '', errorType = '') => {
      if (done) return
      done = true
      setInFlightCount(inFlightCount - 1)
      if (success) {
        updateTileStatus({
          lastSuccessAt: new Date(),
          lastErrorAt: null,
          lastErrorMessage: '',
          lastErrorType: '',
          stale: false,
        })
      } else {
        updateTileStatus({
          lastErrorAt: new Date(),
          lastErrorMessage: errorMessage || 'Tile request failed',
          lastErrorType: errorType || 'network',
        })
      }
    }

    setInFlightCount(inFlightCount + 1)

    const handleLoad = () => finalize(true)
    const handleError = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        finalize(false, 'Offline', 'offline')
      } else {
        finalize(false)
      }
    }
    image.addEventListener('load', handleLoad, { once: true })
    image.addEventListener('error', handleError, { once: true })

    // Let the browser handle streaming/priority for tile images.
    image.decoding = 'async'
    image.src = src
  }
}

export const abortAllTileRequests = () => {}
