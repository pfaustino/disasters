import * as THREE from 'three'
import type { WeatherEvent, WeatherTrackPoint } from '../data/types.ts'
import { GLOBE_RADIUS, latLonToVector3, lerpLongitude } from './geo.ts'
import { StormLabelPool, weatherGlobeLabel } from './StormLabels.ts'

type Slot = {
  group: THREE.Group
  spin: THREE.Group
  funnelMat: THREE.MeshBasicMaterial
  spiralMat: THREE.LineBasicMaterial
  debrisMat: THREE.MeshBasicMaterial
  active: boolean
  age: number
  lifetime: number
  spinSpeed: number
  lat: number
  lon: number
  track: WeatherTrackPoint[] | null
  labelId: number
}

const POOL = 48
const SURFACE_LIFT = 1.004
const DEBRIS = 6
const WORLD_Y = new THREE.Vector3(0, 1, 0)

export class TornadoPool {
  readonly group = new THREE.Group()
  enabled = true
  private readonly slots: Slot[]
  private readonly tmpPos = new THREE.Vector3()
  private readonly tmpUp = new THREE.Vector3()
  private readonly labels: StormLabelPool
  private cursor = 0

  constructor(labels: StormLabelPool) {
    const funnelGeom = new THREE.ConeGeometry(0.42, 2, 10, 1, true)
    const spiralGeom = makeSpiralGeometry()
    const debrisGeom = new THREE.BoxGeometry(0.07, 0.07, 0.07)
    this.labels = labels

    this.slots = []
    for (let i = 0; i < POOL; i += 1) {
      const funnelMat = new THREE.MeshBasicMaterial({
        color: 0xc4a06a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
      const spiralMat = new THREE.LineBasicMaterial({
        color: 0xe8d5b0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
      const debrisMat = new THREE.MeshBasicMaterial({
        color: 0x8a6a48,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })

      const spin = new THREE.Group()
      const funnel = new THREE.Mesh(funnelGeom, funnelMat)
      funnel.rotation.x = Math.PI
      funnel.position.y = 1
      spin.add(funnel)
      const spiral = new THREE.Line(spiralGeom, spiralMat)
      spin.add(spiral)
      for (let d = 0; d < DEBRIS; d += 1) {
        const chunk = new THREE.Mesh(debrisGeom, debrisMat)
        const t = (d + 0.5) / DEBRIS
        const angle = d * 1.7
        const radius = 0.12 + t * 0.38
        chunk.position.set(Math.cos(angle) * radius, t * 2, Math.sin(angle) * radius)
        spin.add(chunk)
      }

      const group = new THREE.Group()
      group.add(spin)
      group.visible = false
      group.scale.setScalar(0.018)
      this.group.add(group)
      this.slots.push({
        group,
        spin,
        funnelMat,
        spiralMat,
        debrisMat,
        active: false,
        age: 0,
        lifetime: 2,
        spinSpeed: 12,
        lat: 0,
        lon: 0,
        track: null,
        labelId: -1,
      })
    }
  }

  spawn(event: WeatherEvent): void {
    if (!this.enabled || event.kind !== 'tornado') return
    const slot = this.slots[this.cursor % POOL]
    this.cursor = (this.cursor + 1) % POOL
    const ef = event.efRating ?? 2
    slot.lat = event.lat
    slot.lon = event.lon
    slot.track = event.track
    slot.active = true
    slot.age = 0
    slot.lifetime = 1.8 + ef * 0.28
    slot.spinSpeed = 11 + ef * 1.4
    slot.group.scale.setScalar(0.014 + ef * 0.0035)
    slot.group.visible = true
    const text = weatherGlobeLabel(event)
    slot.labelId = text != null ? this.labels.spawn('tornado', text, event.lat, event.lon, slot.lifetime) : -1
    this.place(slot, event.lat, event.lon)
    this.setOpacity(slot, 0.9)
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
      slot.spin.rotation.y += slot.spinSpeed * dtSec
      const appear = Math.min(1, slot.age / 0.12)
      const fade = t > 0.62 ? (1 - t) / 0.38 : 1
      this.setOpacity(slot, 0.92 * appear * fade)
      if (slot.track && slot.track.length >= 2) {
        const pos = sampleTrack(slot.track, Math.min(1, t))
        this.place(slot, pos.lat, pos.lon)
      }
    }
  }

  clear(): void {
    for (const slot of this.slots) this.deactivate(slot)
    this.labels.clearKind('tornado')
  }

  private place(slot: Slot, lat: number, lon: number): void {
    latLonToVector3(lat, lon, GLOBE_RADIUS * SURFACE_LIFT, this.tmpPos)
    slot.group.position.copy(this.tmpPos)
    this.tmpUp.copy(this.tmpPos).normalize()
    slot.group.quaternion.setFromUnitVectors(WORLD_Y, this.tmpUp)
    this.labels.move(slot.labelId, lat, lon)
  }

  private setOpacity(slot: Slot, opacity: number): void {
    slot.funnelMat.opacity = opacity
    slot.spiralMat.opacity = opacity * 0.85
    slot.debrisMat.opacity = opacity * 0.7
  }

  private deactivate(slot: Slot): void {
    slot.active = false
    slot.labelId = -1
    slot.group.visible = false
    this.setOpacity(slot, 0)
  }
}

function makeSpiralGeometry(): THREE.BufferGeometry {
  const points: THREE.Vector3[] = []
  const segments = 64
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments
    const angle = t * 5 * Math.PI * 2
    const radius = 0.06 + t * 0.36
    points.push(new THREE.Vector3(Math.cos(angle) * radius, t * 2, Math.sin(angle) * radius))
  }
  return new THREE.BufferGeometry().setFromPoints(points)
}

export function sampleTrack(
  track: WeatherTrackPoint[],
  t01: number,
): { lat: number; lon: number; windKt: number | null } {
  if (track.length === 1) return { lat: track[0].lat, lon: track[0].lon, windKt: track[0].windKt }
  const t = Math.min(1, Math.max(0, t01))
  const start = track[0].time
  const end = track[track.length - 1].time
  const at = start + t * Math.max(1, end - start)
  let lo = 0
  let hi = track.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (track[mid].time < at) lo = mid + 1
    else hi = mid
  }
  const i1 = Math.max(1, lo)
  const i0 = i1 - 1
  const a = track[i0]
  const b = track[i1]
  const span = Math.max(1, b.time - a.time)
  const u = Math.min(1, Math.max(0, (at - a.time) / span))
  return {
    lat: a.lat + (b.lat - a.lat) * u,
    lon: lerpLongitude(a.lon, b.lon, u),
    windKt: b.windKt ?? a.windKt,
  }
}
