import * as THREE from 'three'
import type { QuakeEvent } from '../data/types.ts'
import { GLOBE_RADIUS, latLonToVector3, magToLifetime } from './geo.ts'

type Slot = {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  texture: THREE.CanvasTexture
  active: boolean
  age: number
  lifetime: number
}

const POOL = 64
const MIN_LIFE_SEC = 1.5
const CANVAS_W = 256
const CANVAS_H = 128
const LABEL_LIFT = 1.045

export class MagLabelPool {
  readonly group = new THREE.Group()
  enabled = true
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
      if (!ctx) throw new Error('Could not create magnitude label canvas')
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
      sprite.scale.set(0.28, 0.14, 1)
      sprite.renderOrder = 4
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
      })
    }
  }

  spawn(event: QuakeEvent): void {
    if (!this.enabled || event.mag == null) return
    const slot = this.slots[this.cursor % POOL]
    this.cursor = (this.cursor + 1) % POOL
    latLonToVector3(event.lat, event.lon, GLOBE_RADIUS * LABEL_LIFT, this.tmpPos)
    slot.sprite.position.copy(this.tmpPos)
    drawMag(slot.ctx, event.mag)
    slot.texture.needsUpdate = true
    slot.active = true
    slot.age = 0
    slot.lifetime = Math.max(MIN_LIFE_SEC, magToLifetime(event.mag))
    slot.material.opacity = 1
    slot.sprite.visible = true
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
      const fade = t > 0.7 ? (1 - t) / 0.3 : 1
      slot.material.opacity = fade
    }
  }

  clear(): void {
    for (const slot of this.slots) this.deactivate(slot)
  }

  private deactivate(slot: Slot): void {
    slot.active = false
    slot.sprite.visible = false
    slot.material.opacity = 0
  }
}

function drawMag(ctx: CanvasRenderingContext2D, mag: number): void {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.font = '700 36px "Segoe UI", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(5, 7, 10, 0.9)'
  ctx.fillStyle = '#f4ece3'
  const text = mag.toFixed(1)
  ctx.strokeText(text, CANVAS_W / 2, CANVAS_H / 2)
  ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2)
}
