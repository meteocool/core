import Control from 'ol/control/Control'

type LocateHandler = () => void

export default class GeolocateControl extends Control {
  private button: HTMLButtonElement
  private locateHandler: LocateHandler

  constructor(options: { onLocate: LocateHandler; className?: string; title?: string }) {
    const className = options.className || 'ol-geolocate'
    const element = document.createElement('div')
    element.className = `ol-unselectable ol-control ${className}`

    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', options.title || 'Locate me')
    button.title = options.title || 'Locate me'
    // Use a simple crosshair symbol; styled by default OL control CSS
    button.innerHTML = '⌖'

    // Disable if geolocation not available
    if (!('geolocation' in navigator)) {
      button.disabled = true
    }

    element.appendChild(button)

    super({ element })

    this.button = button
    this.locateHandler = options.onLocate

    this.handleClick = this.handleClick.bind(this)
    this.button.addEventListener('click', this.handleClick)
    this.button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.handleClick()
      }
    })
  }

  private handleClick() {
    if (this.button.disabled) return
    this.locateHandler()
  }
}
