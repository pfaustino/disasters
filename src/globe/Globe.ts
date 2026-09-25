import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { QuakeEvent, WeatherEvent } from '../data/types.ts'
import {
  CAMERA_DISTANCE,
  GLOBE_RADIUS,
  PACIFIC_LAT,
  PACIFIC_LON,
  PLACE_CAMERA_DISTANCE,
  latLonToVector3,
} from './geo.ts'
import { FirePool } from './FirePool.ts'
import { HurricanePool } from './HurricanePool.ts'
import { MagLabelPool } from './MagLabels.ts'
import { RipplePool } from './RipplePool.ts'
import { StormLabelPool } from './StormLabels.ts'
import { TornadoPool } from './TornadoPool.ts'

export class Globe {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  readonly ripples: RipplePool
  readonly labels: MagLabelPool
  readonly tornadoes: TornadoPool
  readonly hurricanes: HurricanePool
  readonly fires: FirePool
  readonly stormLabels: StormLabelPool
  private readonly scene = new THREE.Scene()
  private readonly pacificPos = new THREE.Vector3()
  private readonly container: HTMLElement

  private pinchStart = 0
  private pinching = false

  constructor(container: HTMLElement) {
    this.container = container
    this.scene.background = new THREE.Color(0x05070a)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.domElement.style.touchAction = 'none'
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      40,
    )
    latLonToVector3(PACIFIC_LAT, PACIFIC_LON, CAMERA_DISTANCE, this.pacificPos)
    this.camera.position.copy(this.pacificPos)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.enableZoom = true
    this.controls.minDistance = 1.35
    this.controls.maxDistance = 6.5
    this.controls.target.set(0, 0, 0)
    this.controls.touches.ONE = THREE.TOUCH.ROTATE
    this.controls.touches.TWO = THREE.TOUCH.PAN
    this.controls.update()

    this.scene.add(this.makeEarth())
    this.scene.add(this.makeAtmosphere())

    this.ripples = new RipplePool()
    this.scene.add(this.ripples.group)
    this.labels = new MagLabelPool()
    this.scene.add(this.labels.group)
    this.stormLabels = new StormLabelPool()
    this.tornadoes = new TornadoPool(this.stormLabels)
    this.scene.add(this.tornadoes.group)
    this.hurricanes = new HurricanePool(this.stormLabels)
    this.scene.add(this.hurricanes.group)
    this.fires = new FirePool(this.stormLabels)
    this.scene.add(this.fires.group)
    this.scene.add(this.stormLabels.group)

    this.bindPinchZoom()
    window.addEventListener('resize', this.onResize)
  }

  spawn(event: QuakeEvent): void {
    if (!this.ripples.enabled) return
    this.ripples.spawn(event)
    this.labels.spawn(event)
  }

  spawnWeather(event: WeatherEvent): void {
    if (event.kind === 'tornado') this.tornadoes.spawn(event)
    else if (event.kind === 'hurricane') this.hurricanes.spawn(event)
    else this.fires.spawn(event)
  }

  syncLiveHurricanes(events: WeatherEvent[]): void {
    this.hurricanes.sync(events)
  }

  setShowEarthquakes(show: boolean): void {
    this.ripples.enabled = show
    if (!show) {
      this.ripples.clear()
      this.labels.clear()
    }
  }

  setShowMagLabels(show: boolean): void {
    this.labels.enabled = show
    if (!show) this.labels.clear()
  }

  setShowTornadoes(show: boolean): void {
    this.tornadoes.enabled = show
    if (!show) this.tornadoes.clear()
  }

  setShowTornadoLabels(show: boolean): void {
    this.stormLabels.setShow('tornado', show)
  }

  setShowHurricanes(show: boolean): void {
    this.hurricanes.enabled = show
    if (!show) this.hurricanes.clear()
  }

  setShowHurricaneLabels(show: boolean): void {
    this.stormLabels.setShow('hurricane', show)
  }

  setShowFires(show: boolean): void {
    this.fires.enabled = show
    if (!show) this.fires.clear()
  }

  setShowFireLabels(show: boolean): void {
    this.stormLabels.setShow('fire', show)
  }

  clearMarks(): void {
    this.ripples.clear()
    this.labels.clear()
    this.tornadoes.clear()
    this.hurricanes.clear()
    this.fires.clear()
    this.stormLabels.clear()
  }

  resetToPacific(): void {
    this.camera.position.copy(this.pacificPos)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  lookAtLatLon(lat: number, lon: number): void {
    latLonToVector3(lat, lon, PLACE_CAMERA_DISTANCE, this.camera.position)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  update(dtSec: number): void {
    this.ripples.update(dtSec)
    this.labels.update(dtSec)
    this.tornadoes.update(dtSec)
    this.hurricanes.update(dtSec)
    this.fires.update(dtSec)
    this.stormLabels.update(dtSec)
    this.controls.update()
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize)
    this.unbindPinchZoom()
    this.controls.dispose()
    this.renderer.dispose()
  }

  private makeEarth(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(GLOBE_RADIUS, 96, 64)
    const material = new THREE.MeshBasicMaterial({ color: 0x1a3d5c })
    const earth = new THREE.Mesh(geometry, material)

    const loader = new THREE.TextureLoader()
    const url = `${import.meta.env.BASE_URL}textures/earth.jpg`
    loader.load(url, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      material.map = texture
      material.color.setHex(0xffffff)
      material.needsUpdate = true
    })

    return earth
  }

  private makeAtmosphere(): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * 1.045, 64, 48),
      new THREE.MeshBasicMaterial({
        color: 0x4d7ea8,
        transparent: true,
        opacity: 0.16,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    )
  }

  private bindPinchZoom(): void {
    window.addEventListener('touchstart', this.onPinchStart, { passive: true })
    window.addEventListener('touchmove', this.onPinchMove, { passive: false })
    window.addEventListener('touchend', this.onPinchEnd, { passive: true })
    window.addEventListener('touchcancel', this.onPinchEnd, { passive: true })
  }

  private unbindPinchZoom(): void {
    window.removeEventListener('touchstart', this.onPinchStart)
    window.removeEventListener('touchmove', this.onPinchMove)
    window.removeEventListener('touchend', this.onPinchEnd)
    window.removeEventListener('touchcancel', this.onPinchEnd)
  }

  private onPinchStart = (event: TouchEvent): void => {
    if (event.touches.length !== 2 || touchesOnRange(event)) {
      this.pinching = false
      this.controls.enableRotate = true
      return
    }
    this.pinching = true
    this.pinchStart = touchDistance(event.touches[0], event.touches[1])
    this.controls.enableRotate = false
  }

  private onPinchMove = (event: TouchEvent): void => {
    if (!this.pinching || event.touches.length !== 2) return
    event.preventDefault()
    const distance = touchDistance(event.touches[0], event.touches[1])
    if (this.pinchStart <= 0 || distance <= 0) return
    const ratio = distance / this.pinchStart
    this.pinchStart = distance
    this.controls.dollyOut(Math.pow(ratio, this.controls.zoomSpeed))
    this.controls.update()
  }

  private onPinchEnd = (event: TouchEvent): void => {
    if (event.touches.length >= 2) return
    this.pinching = false
    this.controls.enableRotate = true
  }

  private onResize = (): void => {
    const width = this.container.clientWidth
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }
}

function touchDistance(a: Touch, b: Touch): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function touchesOnRange(event: TouchEvent): boolean {
  for (let i = 0; i < event.touches.length; i += 1) {
    const target = event.touches[i].target
    if (target instanceof HTMLInputElement && target.type === 'range') return true
  }
  return false
}
