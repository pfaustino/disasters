import * as THREE from 'three'
import type { WeatherEvent } from '../data/types.ts'
import { GLOBE_RADIUS, latLonToVector3 } from './geo.ts'
import { StormLabelPool, weatherGlobeLabel } from './StormLabels.ts'
import { sampleTrack } from './TornadoPool.ts'

type Slot = {
  group: THREE.Group
  disk: THREE.Mesh
  diskMat: THREE.MeshBasicMaterial
  eyeMat: THREE.MeshBasicMaterial
  active: boolean
  age: number
  lifetime: number
  spinSpeed: number
  scale: number
  track: WeatherEvent['track']
  labelId: number
}

const POOL = 24
const SURFACE_LIFT = 1.008

export class HurricanePool {
  readonly group = new THREE.Group()
  enabled = true
  private readonly slots: Slot[]
  private readonly tmpPos = new THREE.Vector3()
  private readonly labels: StormLabelPool
  private cursor = 0

  constructor(labels: StormLabelPool) {
    const diskGeom = new THREE.CircleGeometry(1, 48)
    const eyeGeom = new THREE.CircleGeometry(0.16, 24)
    const texture = makeCycloneTexture()
    this.labels = labels

    this.slots = []
    for (let i = 0; i < POOL; i += 1) {
      const diskMat = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
      const eyeMat = new THREE.MeshBasicMaterial({
        color: 0x061018,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const disk = new THREE.Mesh(diskGeom, diskMat)
      const eye = new THREE.Mesh(eyeGeom, eyeMat)
      eye.position.z = 0.002
      disk.add(eye)

      const group = new THREE.Group()
      group.add(disk)
      group.visible = false
      group.renderOrder = 2
      this.group.add(group)
      this.slots.push({
        group,
        disk,
        diskMat,
        eyeMat,
        active: false,
        age: 0,
        lifetime: 6,
        spinSpeed: 0.8,
        scale: 0.06,
        track: null,
        labelId: -1,
      })
    }
  }

  spawn(event: WeatherEvent): void {
    if (!this.enabled || event.kind !== 'hurricane') return
    const slot = this.slots[this.cursor % POOL]
    this.cursor = (this.cursor + 1) % POOL
    const cat = event.category ?? (event.windKt != null && event.windKt >= 64 ? 1 : 0)
    slot.active = true
    slot.age = 0
    slot.lifetime = 5.2 + cat * 0.9
    slot.spinSpeed = 0.55 + cat * 0.12
    slot.scale = 0.038 + cat * 0.016
    slot.disk.rotation.z = 0
    tintStorm(slot.diskMat, cat)
    slot.track = event.track
    slot.group.visible = true
    const text = weatherGlobeLabel(event)
    slot.labelId =
      text != null ? this.labels.spawn('hurricane', text, event.lat, event.lon, slot.lifetime) : -1
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
      slot.disk.rotation.z += slot.spinSpeed * dtSec
      const appear = Math.min(1, slot.age / 0.25)
      const fade = t > 0.72 ? (1 - t) / 0.28 : 1
      this.setOpacity(slot, 0.88 * appear * fade)
      slot.group.scale.setScalar(slot.scale)
      if (slot.track && slot.track.length >= 2) {
        const pos = sampleTrack(slot.track, Math.min(1, t))
        this.place(slot, pos.lat, pos.lon)
      }
    }
  }

  clear(): void {
    for (const slot of this.slots) this.deactivate(slot)
    this.labels.clearKind('hurricane')
  }

  private place(slot: Slot, lat: number, lon: number): void {
    latLonToVector3(lat, lon, GLOBE_RADIUS * SURFACE_LIFT, this.tmpPos)
    slot.group.position.copy(this.tmpPos)
    slot.group.lookAt(0, 0, 0)
    this.labels.move(slot.labelId, lat, lon)
  }

  private setOpacity(slot: Slot, opacity: number): void {
    slot.diskMat.opacity = opacity
    slot.eyeMat.opacity = Math.min(0.85, opacity + 0.15)
  }

  private deactivate(slot: Slot): void {
    slot.active = false
    slot.labelId = -1
    slot.group.visible = false
    this.setOpacity(slot, 0)
  }
}

function tintStorm(material: THREE.MeshBasicMaterial, category: number): void {
  if (category >= 4) material.color.setHex(0xffd4c8)
  else if (category >= 2) material.color.setHex(0xfff0d2)
  else material.color.setHex(0xd7f1ff)
}

function makeCycloneTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create hurricane texture canvas')
  ctx.clearRect(0, 0, size, size)
  const cx = size / 2
  const cy = size / 2

  ctx.lineCap = 'round'
  for (let arm = 0; arm < 2; arm += 1) {
    ctx.beginPath()
    ctx.strokeStyle = arm === 0 ? 'rgba(210, 235, 255, 0.8)' : 'rgba(170, 210, 240, 0.55)'
    ctx.lineWidth = arm === 0 ? 16 : 10
    const offset = arm * Math.PI
    for (let i = 0; i <= 90; i += 1) {
      const t = i / 90
      const angle = offset + t * 3.05 * Math.PI
      const radius = 22 + t * 96
      const x = cx + Math.cos(angle) * radius
      const y = cy + Math.sin(angle) * radius
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  ctx.beginPath()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.lineWidth = 9
  ctx.arc(cx, cy, 28, 0, Math.PI * 2)
  ctx.stroke()

  ctx.beginPath()
  ctx.fillStyle = 'rgba(6, 16, 28, 0.7)'
  ctx.arc(cx, cy, 14, 0, Math.PI * 2)
  ctx.fill()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
