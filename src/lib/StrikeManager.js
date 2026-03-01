import Point from 'ol/geom/Point'
import { Feature } from 'ol'
import { fromLonLat } from 'ol/proj'
import { logger } from './logger.js'

export default class StrikeManager {
  constructor(maxStrikes, vectorSource) {
    this.maxStrikes = maxStrikes
    this.vs = vectorSource
    this.strikes = []
    this.enabled = true
  }

  addStrike(lon, lat, addCb = null) {
    return this.addStrikeWithTime(lon, lat, new Date().getTime(), addCb)
  }

  removeOne(id, idx) {
    const remove = this.vs.getFeatureById(id)
    if (remove) {
      this.vs.removeFeature(remove)
    }
    if (idx !== -1) {
      this.strikes.splice(idx, 1)
    }
  }

  addStrikeWithTime(lon, lat, time, addCb = null) {
    if (!this.enabled) return false
    const lightning = new Feature(new Point(fromLonLat([lon, lat])))
    lightning.setId(time)
    this.strikes.push(lightning.getId())
    if (this.strikes.length > this.maxStrikes) {
      const toRemove = this.strikes.shift()
      this.removeOne(toRemove, -1)
    }
    if (addCb) {
      addCb(lightning)
    }
    return this.vs.addFeature(lightning)
  }

  // purge old strikes
  fadeStrikes() {
    const now = new Date().getTime()
    const MINS = 60 * 1000
    for (let idx = this.strikes.length - 1; idx >= 0; idx--) {
      const id = this.strikes[idx]
      if (id < now - 30 * MINS) {
        this.removeOne(id, idx)
      }
    }
    this.vs.refresh()
  }

  clearAll() {
    this.strikes = []
    this.vs.clear()
  }

  debug() {
    logger.log(this.strikes)
    logger.log(this.vs.getFeatures())
  }

  enable(state) {
    if (!state) this.clearAll()
    this.enabled = state
  }
}
