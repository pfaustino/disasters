import * as THREE from 'three'
import type { QuakeEvent } from '../data/types.ts'
import {
  GLOBE_RADIUS,
  depthToColor,
  depthToOpacity,
  latLonToVector3,
  magToLifetime,
  magToRadius,
} from './geo.ts'

type RippleKind = 'blip' | 'deaths' | 'tsunami'

type Slot = {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  active: boolean
  age: number
  lifetime: number
  maxScale: number
  startOpacity: number
}

const POOL_BLIPS = 96
const POOL_RINGS = 48
const SURFACE_LIFT = 1.006

export class RipplePool {
  readonly group = new THREE.Group()
  private readonly blips: Slot[]
  private readonly rings: Slot[]
  private readonly tmpPos = new THREE.Vector3()
  private readonly tmpColor = new THREE.Color()
  private blipCursor = 0
  private ringCursor = 0

  constructor() {
    this.blips = this.makePool(POOL_BLIPS, new THREE.CircleGeometry(1, 32), 0)
    this.rings = this.makePool(
      POOL_RINGS,
      new THREE.RingGeometry(0.72, 1, 48),
      0.02,
    )
  }

  spawn(event: QuakeEvent): void {
    const mag = event.mag ?? 4
    this.spawnSlot(this.blips, 'blip', event, magToRadius(mag), magToLifetime(mag))
    if (event.deaths != null && event.deaths > 0) {
      this.spawnSlot(
        this.rings,
        'deaths',
        event,
        magToRadius(mag) * 1.45,
        magToLifetime(mag) * 1.7,
      )
    }
    if (event.tsunami) {
      this.spawnSlot(
        this.rings,
        'tsunami',
        event,
        magToRadius(mag) * 1.2,
        magToLifetime(mag) * 1.35,
      )
    }
  }

  update(dtSec: number): void {
    this.advance(this.blips, dtSec)
    this.advance(this.rings, dtSec)
  }

  clear(): void {
    for (const slot of this.blips) this.deactivate(slot)
    for (const slot of this.rings) this.deactivate(slot)
  }

  private makePool(count: number, geometry: THREE.BufferGeometry, renderOrder: number): Slot[] {
    const slots: Slot[] = []
    for (let i = 0; i < count; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.visible = false
      mesh.renderOrder = renderOrder
      mesh.frustumCulled = false
      this.group.add(mesh)
      slots.push({
        mesh,
        material,
        active: false,
        age: 0,
        lifetime: 1,
        maxScale: 0.05,
        startOpacity: 0.8,
      })
    }
    return slots
  }

  private spawnSlot(
    pool: Slot[],
    kind: RippleKind,
    event: QuakeEvent,
    maxScale: number,
    lifetime: number,
  ): void {
    const slot = this.nextSlot(pool, kind)
    latLonToVector3(event.lat, event.lon, GLOBE_RADIUS * SURFACE_LIFT, this.tmpPos)
    slot.mesh.position.copy(this.tmpPos)
    slot.mesh.lookAt(0, 0, 0)
    slot.mesh.scale.setScalar(0.004)
    slot.mesh.visible = true
    slot.active = true
    slot.age = 0
    slot.lifetime = lifetime
    slot.maxScale = maxScale

    if (kind === 'deaths') {
      slot.material.color.setHex(0xff3b3b)
      slot.startOpacity = 0.85
    } else if (kind === 'tsunami') {
      slot.material.color.setHex(0x5ec8ff)
      slot.startOpacity = 0.7
    } else {
      depthToColor(event.depthKm, this.tmpColor)
      slot.material.color.copy(this.tmpColor)
      slot.startOpacity = depthToOpacity(event.depthKm)
    }
    slot.material.opacity = slot.startOpacity
  }

  private nextSlot(pool: Slot[], kind: RippleKind): Slot {
    const cursor = kind === 'blip' ? this.blipCursor : this.ringCursor
    const slot = pool[cursor % pool.length]
    if (kind === 'blip') this.blipCursor = (cursor + 1) % pool.length
    else this.ringCursor = (cursor + 1) % pool.length
    return slot
  }

  private advance(pool: Slot[], dtSec: number): void {
    for (let i = 0; i < pool.length; i += 1) {
      const slot = pool[i]
      if (!slot.active) continue
      slot.age += dtSec
      const t = slot.age / slot.lifetime
      if (t >= 1) {
        this.deactivate(slot)
        continue
      }
      const eased = 1 - (1 - t) * (1 - t)
      slot.mesh.scale.setScalar(0.004 + slot.maxScale * eased)
      slot.material.opacity = slot.startOpacity * (1 - t)
    }
  }

  private deactivate(slot: Slot): void {
    slot.active = false
    slot.mesh.visible = false
    slot.material.opacity = 0
  }
}
