import VectorTileLayer from 'ol/layer/VectorTile'
import VectorTileSource from 'ol/source/VectorTile'
import MVT from 'ol/format/MVT'
import { osmAttribution } from './attributions'
import { Style, Fill, Stroke, Text } from 'ol/style'

// Protomaps base URL from your Cloudflare Workers setup - version configured via environment
const mapEndpoint = `https://map.meteocool.com/${import.meta.env.VITE_MAP_VERSION}/`

// Dark theme styles
const darkStyles = {
  earth: new Style({
    fill: new Fill({ color: '#1a1a1a' }),
  }),
  water: new Style({
    fill: new Fill({ color: '#2d4f8e' }),
  }),
  landcover: new Style({
    fill: new Fill({ color: '#2d2d2d' }),
  }),
  landuse: new Style({
    fill: new Fill({ color: '#333333' }),
  }),
  buildings: new Style({
    fill: new Fill({ color: '#444444' }),
    stroke: new Stroke({ color: '#555555', width: 0.5 }),
  }),
  roads: new Style({
    stroke: new Stroke({ color: '#666666', width: 1 }),
  }),
  boundaries: new Style({
    stroke: new Stroke({ color: '#888888', width: 1, lineDash: [5, 5] }),
  }),
  places: new Style({
    text: new Text({
      font: '12px sans-serif',
      fill: new Fill({ color: '#ffffff' }),
      stroke: new Stroke({ color: '#000000', width: 2 }),
    }),
  }),
  pois: new Style({
    text: new Text({
      font: '10px sans-serif',
      fill: new Fill({ color: '#cccccc' }),
      stroke: new Stroke({ color: '#000000', width: 1 }),
    }),
  }),
}

// Light theme styles
const lightStyles = {
  earth: new Style({
    fill: new Fill({ color: '#f8f8f8' }),
  }),
  water: new Style({
    fill: new Fill({ color: '#aadaff' }),
  }),
  landcover: new Style({
    fill: new Fill({ color: '#e8f5e8' }),
  }),
  landuse: new Style({
    fill: new Fill({ color: '#f0f0f0' }),
  }),
  buildings: new Style({
    fill: new Fill({ color: '#e0e0e0' }),
    stroke: new Stroke({ color: '#cccccc', width: 0.5 }),
  }),
  roads: new Style({
    stroke: new Stroke({ color: '#ffffff', width: 1 }),
  }),
  boundaries: new Style({
    stroke: new Stroke({ color: '#999999', width: 1, lineDash: [5, 5] }),
  }),
  places: new Style({
    text: new Text({
      font: '12px sans-serif',
      fill: new Fill({ color: '#333333' }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
  }),
  pois: new Style({
    text: new Text({
      font: '10px sans-serif',
      fill: new Fill({ color: '#666666' }),
      stroke: new Stroke({ color: '#ffffff', width: 1 }),
    }),
  }),
}

// Style function for dark theme
const darkStyleFunction = (feature) => {
  const layer = feature.get('layer')
  const style = darkStyles[layer]
  if (!style) return null // Return null instead of empty style for unmapped layers

  // For text styles, set the text content or return null if no name
  if ((layer === 'places' || layer === 'pois') && style.getText()) {
    const name = feature.get('name')
    if (!name || name === undefined || name === null) {
      return null // Don't render features without names
    }
    // Clone the style to avoid modifying the shared instance
    const clonedStyle = style.clone()
    clonedStyle.getText().setText(name)
    return clonedStyle
  }

  return style
}

// Style function for light theme
const lightStyleFunction = (feature) => {
  const layer = feature.get('layer')
  const style = lightStyles[layer]
  if (!style) return null // Return null instead of empty style for unmapped layers

  // For text styles, set the text content or return null if no name
  if ((layer === 'places' || layer === 'pois') && style.getText()) {
    const name = feature.get('name')
    if (!name || name === undefined || name === null) {
      return null // Don't render features without names
    }
    // Clone the style to avoid modifying the shared instance
    const clonedStyle = style.clone()
    clonedStyle.getText().setText(name)
    return clonedStyle
  }

  return style
}

export const cartoDark = () =>
  new VectorTileLayer({
    source: new VectorTileSource({
      url: `${mapEndpoint}{z}/{x}/{y}.mvt`,
      format: new MVT(),
      attributions: [osmAttribution],
    }),
    style: darkStyleFunction,
    base: true,
    zIndex: 1,
  })

export const cartoLight = () =>
  new VectorTileLayer({
    source: new VectorTileSource({
      url: `${mapEndpoint}{z}/{x}/{y}.mvt`,
      format: new MVT(),
      attributions: [osmAttribution],
    }),
    style: lightStyleFunction,
    base: true,
    zIndex: 1,
  })

export const osm = () =>
  new VectorTileLayer({
    source: new VectorTileSource({
      url: `${mapEndpoint}{z}/{x}/{y}.mvt`,
      format: new MVT(),
      attributions: [osmAttribution],
    }),
    style: lightStyleFunction,
    base: true,
    zIndex: 1,
  })

export const cyclosm = () =>
  new VectorTileLayer({
    source: new VectorTileSource({
      url: `${mapEndpoint}{z}/{x}/{y}.mvt`,
      format: new MVT(),
      attributions: [osmAttribution],
    }),
    style: lightStyleFunction,
    base: true,
    zIndex: 1,
  })

export function supportsVectorLabels() {
  // All Protomaps layers now support vector labels since they're vector tiles
  return true
}
