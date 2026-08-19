import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { QuakeEvent } from '../data/types.ts'
import {
  CAMERA_DISTANCE,
  GLOBE_RADIUS,
  PACIFIC_LAT,
  PACIFIC_LON,
  latLonToVector3,
} from './geo.ts'
import { RipplePool } from './RipplePool.ts'

export class Globe {
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  readonly ripples: RipplePool
  private readonly scene = new THREE.Scene()
  private readonly pacificPos = new THREE.Vector3()
  private readonly container: HTMLElement

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
    this.controls.minDistance = 1.35
    this.controls.maxDistance = 5
    this.controls.target.set(0, 0, 0)
    this.controls.update()

    this.scene.add(this.makeEarth())
    this.scene.add(this.makeAtmosphere())

    this.ripples = new RipplePool()
    this.scene.add(this.ripples.group)

    window.addEventListener('resize', this.onResize)
  }

  spawn(event: QuakeEvent): void {
    this.ripples.spawn(event)
  }

  resetToPacific(): void {
    this.camera.position.copy(this.pacificPos)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  update(dtSec: number): void {
    this.ripples.update(dtSec)
    this.controls.update()
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize)
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

  private onResize = (): void => {
    const width = this.container.clientWidth
    const height = Math.max(1, this.container.clientHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }
}
