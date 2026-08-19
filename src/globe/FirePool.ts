import * as THREE from 'three'
import type { WeatherEvent } from '../data/types.ts'
import { GLOBE_RADIUS, latLonToVector3 } from './geo.ts'
import { StormLabelPool, weatherGlobeLabel } from './StormLabels.ts'
import { sampleTrack } from './TornadoPool.ts'

type Slot = {
  group: THREE.Group
  glow: THREE.Mesh
  ember: THREE.Mesh
  smokes: THREE.Mesh[]
  glowMat: THREE.MeshBasicMaterial
  emberMat: THREE.MeshBasicMaterial
  smokeMat: THREE.MeshBasicMaterial
  active: boolean
  age: number
  lifetime: number
  scale: number
  phase: number
  track: WeatherEvent['track']
  labelId: number
}

const POOL = 40
const SURFACE_LIFT = 1.006
const SMOKE = 3
const WORLD_Y = new THREE.Vector3(0, 1, 0)

export class FirePool {
  readonly group = new THREE.Group()
  enabled = true
  private readonly slots: Slot[]
  private readonly tmpPos = new THREE.Vector3()
  private readonly tmpUp = new THREE.Vector3()
  private readonly labels: StormLabelPool
  private cursor = 0

  constructor(labels: StormLabelPool) {
    const disc = new THREE.CircleGeometry(1, 32)
    disc.rotateX(-Math.PI / 2)
    const glowTex = makeRadialTexture(255, 150, 40, 1)
    const smokeTex = makeRadialTexture(90, 86, 80, 0.55)
    this.labels = labels

    this.slots = []
    for (let i = 0; i < POOL; i += 1) {
      const glowMat = new THREE.MeshBasicMaterial({
        map: glowTex,
        color: 0xff9a3c,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const emberMat = new THREE.MeshBasicMaterial({
        map: glowTex,
        color: 0xffe08a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const smokeMat = new THREE.MeshBasicMaterial({
        map: smokeTex,
        color: 0xb0aaa4,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })

      const glow = new THREE.Mesh(disc, glowMat)
      const ember = new THREE.Mesh(disc, emberMat)
      ember.position.y = 0.012
      ember.scale.setScalar(0.38)

      const smokes: THREE.Mesh[] = []
      for (let s = 0; s < SMOKE; s += 1) {
        const puff = new THREE.Mesh(disc, smokeMat)
        puff.position.y = 0.22 + s * 0.28
        puff.scale.setScalar(0.55 + s * 0.28)
        smokes.push(puff)
      }

      const group = new THREE.Group()
      group.add(glow)
      group.add(ember)
      for (let s = 0; s < smokes.length; s += 1) group.add(smokes[s])
      group.visible = false
      group.renderOrder = 3
      this.group.add(group)
      this.slots.push({
        group,
        glow,
        ember,
        smokes,
        glowMat,
        emberMat,
        smokeMat,
        active: false,
        age: 0,
        lifetime: 4,
        scale: 0.02,
        phase: 0,
        track: null,
        labelId: -1,
      })
    }
  }

  spawn(event: WeatherEvent): void {
    if (!this.enabled || event.kind !== 'fire') return
    const slot = this.slots[this.cursor % POOL]
    this.cursor = (this.cursor + 1) % POOL
    const acres = Math.max(10, event.acres ?? 800)
    const size = Math.log10(acres)
    slot.active = true
    slot.age = 0
    slot.lifetime = 3.1 + Math.min(3.4, size * 0.55)
    slot.scale = 0.014 + Math.min(0.038, size * 0.007)
    slot.phase = (this.cursor * 1.7) % (Math.PI * 2)
    slot.track = event.track
    slot.group.visible = true
    slot.group.scale.setScalar(slot.scale)
    const text = weatherGlobeLabel(event)
    slot.labelId = text != null ? this.labels.spawn('fire', text, event.lat, event.lon, slot.lifetime) : -1
    this.place(slot, event.lat, event.lon)
    this.setOpacity(slot, 0)
  }

  update(dtSec: number): void {
    for (let i = 0; i < this.slots.length; i += 1) {
      const slot = this.slots[i]
      if (!slot.active) continue
      slot.age += dtSec
      const t = slot.age / slot.lifetime
      if (t >= 1) {
        this.deactivate(slot)
        continue
      }
      const appear = Math.min(1, slot.age / 0.2)
      const fade = t > 0.7 ? (1 - t) / 0.3 : 1
      const flicker = 0.72 + 0.28 * Math.abs(Math.sin(slot.age * 17 + slot.phase))
      this.setOpacity(slot, appear * fade * flicker)
      slot.ember.scale.setScalar(0.32 + 0.12 * flicker)
      slot.group.scale.setScalar(slot.scale * (0.94 + 0.08 * flicker))
      for (let s = 0; s < slot.smokes.length; s += 1) {
        const puff = slot.smokes[s]
        const drift = (slot.age * (0.18 + s * 0.05) + s * 0.4) % 0.85
        puff.position.y = 0.18 + s * 0.22 + drift
        puff.rotation.y = slot.age * (0.15 + s * 0.04)
      }
      if (slot.track && slot.track.length >= 2) {
        const pos = sampleTrack(slot.track, Math.min(1, t))
        this.place(slot, pos.lat, pos.lon)
      }
    }
  }

  clear(): void {
    for (const slot of this.slots) this.deactivate(slot)
    this.labels.clearKind('fire')
  }

  private place(slot: Slot, lat: number, lon: number): void {
    latLonToVector3(lat, lon, GLOBE_RADIUS * SURFACE_LIFT, this.tmpPos)
    slot.group.position.copy(this.tmpPos)
    this.tmpUp.copy(this.tmpPos).normalize()
    slot.group.quaternion.setFromUnitVectors(WORLD_Y, this.tmpUp)
    this.labels.move(slot.labelId, lat, lon)
  }

  private setOpacity(slot: Slot, opacity: number): void {
    slot.glowMat.opacity = opacity * 0.95
    slot.emberMat.opacity = Math.min(1, opacity * 1.15)
    slot.smokeMat.opacity = opacity * 0.38
  }

  private deactivate(slot: Slot): void {
    slot.active = false
    slot.labelId = -1
    slot.group.visible = false
    this.setOpacity(slot, 0)
  }
}

function makeRadialTexture(r: number, g: number, b: number, inner: number): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create fire texture canvas')
  const cx = size / 2
  const cy = size / 2
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx)
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${inner})`)
  gradient.addColorStop(0.35, `rgba(${r}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 20)}, ${inner * 0.45})`)
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
