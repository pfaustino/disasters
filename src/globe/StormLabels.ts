import * as THREE from 'three'
import type { WeatherEvent } from '../data/types.ts'
import { GLOBE_RADIUS, latLonToVector3 } from './geo.ts'

type Kind = 'tornado' | 'hurricane' | 'fire'

type Slot = {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  texture: THREE.CanvasTexture
  active: boolean
  age: number
  lifetime: number
  kind: Kind | null
  persistent: boolean
}

const POOL = 48
const MIN_LIFE_SEC = 1.5
const CANVAS_W = 384
const CANVAS_H = 128
const LABEL_LIFT = 1.052

export class StormLabelPool {
  readonly group = new THREE.Group()
  private readonly show: Record<Kind, boolean> = { tornado: true, hurricane: true, fire: true }
  private readonly slots: Slot[]
  private readonly tmpPos = new THREE.Vector3()
  private cursor = 0

  constructor() {
    this.slots = []
    for (let i = 0; i < POOL; i += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = CANVAS_W
      canvas.height = CANVAS_H
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not create storm label canvas')
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      })
      const sprite = new THREE.Sprite(material)
      sprite.visible = false
      sprite.scale.set(0.46, 0.155, 1)
      sprite.renderOrder = 5
      this.group.add(sprite)
      this.slots.push({
        sprite,
        material,
        canvas,
        ctx,
        texture,
        active: false,
        age: 0,
        lifetime: MIN_LIFE_SEC,
        kind: null,
        persistent: false,
      })
    }
  }

  spawn(kind: Kind, text: string, lat: number, lon: number, visualLifetime: number): number {
    if (!this.show[kind]) return -1
    const index = this.nextSlot()
    if (index < 0) return -1
    this.cursor = (index + 1) % POOL
    const slot = this.slots[index]
    this.place(slot, lat, lon)
    drawName(slot.ctx, text)
    slot.texture.needsUpdate = true
    slot.active = true
    slot.age = 0
    slot.lifetime = Math.max(MIN_LIFE_SEC, visualLifetime + 0.45)
    slot.kind = kind
    slot.persistent = false
    slot.material.opacity = 1
    slot.sprite.visible = true
    return index
  }

  private nextSlot(): number {
    for (let n = 0; n < POOL; n += 1) {
      const index = (this.cursor + n) % POOL
      if (!this.slots[index].persistent) return index
    }
    return -1
  }

  setPersistent(index: number, persistent: boolean): void {
    if (index < 0 || index >= this.slots.length) return
    const slot = this.slots[index]
    if (!slot.active) return
    slot.persistent = persistent
    if (persistent) {
      slot.age = 0
      slot.material.opacity = 1
    }
  }

  isActiveKind(index: number, kind: Kind): boolean {
    if (index < 0 || index >= this.slots.length) return false
    const slot = this.slots[index]
    return slot.active && slot.kind === kind
  }

  release(index: number): void {
    if (index < 0 || index >= this.slots.length) return
    this.deactivate(this.slots[index])
  }

  move(index: number, lat: number, lon: number): void {
    if (index < 0 || index >= this.slots.length) return
    const slot = this.slots[index]
    if (!slot.active) return
    this.place(slot, lat, lon)
  }

  update(dtSec: number): void {
    for (let i = 0; i < this.slots.length; i += 1) {
      const slot = this.slots[i]
      if (!slot.active) continue
      if (slot.persistent) {
        slot.material.opacity = 1
        continue
      }
      slot.age += dtSec
      const t = slot.age / slot.lifetime
      if (t >= 1) {
        this.deactivate(slot)
        continue
      }
      const fade = t > 0.7 ? (1 - t) / 0.3 : 1
      slot.material.opacity = fade
    }
  }

  clearKind(kind: Kind): void {
    for (const slot of this.slots) {
      if (slot.kind === kind) this.deactivate(slot)
    }
  }

  setShow(kind: Kind, show: boolean): void {
    this.show[kind] = show
    if (!show) this.clearKind(kind)
  }

  clear(): void {
    for (const slot of this.slots) this.deactivate(slot)
  }

  private place(slot: Slot, lat: number, lon: number): void {
    latLonToVector3(lat, lon, GLOBE_RADIUS * LABEL_LIFT, this.tmpPos)
    slot.sprite.position.copy(this.tmpPos)
  }

  private deactivate(slot: Slot): void {
    slot.active = false
    slot.kind = null
    slot.persistent = false
    slot.sprite.visible = false
    slot.material.opacity = 0
  }
}

export function weatherGlobeLabel(event: WeatherEvent): string | null {
  const named = realStormName(event.name)
  if (event.kind === 'tornado' || event.kind === 'fire') return named
  if (named) return named
  if (event.category != null && event.category >= 1) return `Cat ${event.category}`
  if ((event.windKt ?? 0) >= 34) return 'TS'
  return 'TD'
}

function realStormName(name: string | null): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  const upper = trimmed.toUpperCase()
  if (upper === 'UNNAMED' || upper === 'UNKNOWN' || upper === 'TROPICAL CYCLONE') return null
  if (/^[A-Z]{2}\d{6}$/i.test(trimmed)) return null
  return prettyStormName(trimmed)
}

function prettyStormName(name: string): string {
  if (name !== name.toUpperCase()) return name
  return name.charAt(0) + name.slice(1).toLowerCase()
}

function drawName(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.font = '700 29px "Segoe UI", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(5, 7, 10, 0.9)'
  ctx.fillStyle = '#f4ece3'
  const label = text.length > 16 ? `${text.slice(0, 15)}…` : text
  ctx.strokeText(label, CANVAS_W / 2, CANVAS_H / 2)
  ctx.fillText(label, CANVAS_W / 2, CANVAS_H / 2)
}
