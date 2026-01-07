import { Map } from 'ol'
import BaseLayer from 'ol/layer/Base'
import { Observable } from '../lib/util'
import { sharedCmap } from '../stores'

// Type definitions
export type ColorMap = string

export type TargetCallback = (_target: string | HTMLElement) => void

/**
 * A Capability implements map-related functionality (controller) on an OpenLayers map (view).
 * It has a 1-to-1 relationship to an @OL.Map Object, which must be valid during the entire lifetime
 * of the Capability.
 *
 */
export default class Capability extends Observable {
  map: Map

  name: string

  cmap: ColorMap | null

  targetCb: TargetCallback | null

  constructor(map: Map, name: string, targetCb: TargetCallback | null, additionalLayers: BaseLayer[]) {
    super()
    this.map = map
    this.targetCb = targetCb
    this.cmap = null
    this.name = name

    additionalLayers.forEach((layer) => map.addLayer(layer))
  }

  setTarget(target: string | HTMLElement) {
    if (!this.map) return
    this.map.setTarget(target)
    if (this.targetCb && target) this.targetCb(target)
    if (this.cmap) sharedCmap.set(this.cmap)
  }

  setCmap(cmap: ColorMap) {
    this.cmap = cmap
    sharedCmap.set(cmap)
  }

  getMap() {
    return this.map
  }

  getName() {
    return this.name
  }

  willLoseFocus() {
    super.notify('loseFocus', null)
  }

  destroy?(): void
}
