import type { QuakeEvent, WeatherEvent } from '../data/types.ts'

const QUAKE_RGB = '232, 168, 124'
const TORNADO_RGB = '212, 165, 116'
const STORM_RGB = '142, 200, 232'
const FIRE_RGB = '255, 110, 48'
const MAX_WIDTH = 2048

export type DensityMarks = {
  start: number
  end: number
  quakes: QuakeEvent[]
  weather: WeatherEvent[]
}

export class TimelineDensity {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private marks: DensityMarks | null = null
  private showQuakes = true
  private showTornadoes = true
  private showHurricanes = true
  private showFires = true
  private readonly observer: ResizeObserver

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) throw new Error('Could not create timeline density canvas')
    this.ctx = ctx
    this.observer = new ResizeObserver(() => this.draw())
    this.observer.observe(canvas)
  }

  setVisible(quakes: boolean, tornadoes: boolean, hurricanes: boolean, fires: boolean): void {
    this.showQuakes = quakes
    this.showTornadoes = tornadoes
    this.showHurricanes = hurricanes
    this.showFires = fires
    this.draw()
  }

  setMarks(marks: DensityMarks | null): void {
    this.marks = marks
    this.draw()
  }

  private draw(): void {
    const cssW = Math.max(1, Math.floor(this.canvas.clientWidth))
    const cssH = Math.max(1, Math.floor(this.canvas.clientHeight))
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.min(MAX_WIDTH, Math.max(1, Math.round(cssW * dpr)))
    const height = Math.max(1, Math.round(cssH * dpr))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }

    const ctx = this.ctx
    ctx.clearRect(0, 0, width, height)
    const laneH = height / 4
    paintLane(ctx, 0, laneH, width, QUAKE_RGB)
    paintLane(ctx, laneH, laneH, width, TORNADO_RGB)
    paintLane(ctx, laneH * 2, laneH, width, STORM_RGB)
    paintLane(ctx, laneH * 3, laneH, width, FIRE_RGB)

    const marks = this.marks
    if (!marks || !Number.isFinite(marks.start) || marks.end <= marks.start) return

    const quakes = new Uint16Array(width)
    const tornadoes = new Uint16Array(width)
    const storms = new Uint16Array(width)
    const fires = new Uint16Array(width)
    const span = marks.end - marks.start

    const quakeList = marks.quakes
    const quakeCap = this.showQuakes ? Math.min(quakeList.length, 50_000) : 0
    for (let i = 0; i < quakeCap; i += 1) {
      bump(quakes, xAt(quakeList[i].time, marks.start, span, width))
    }

    const weather = marks.weather
    const weatherCap = Math.min(weather.length, 50_000)
    for (let i = 0; i < weatherCap; i += 1) {
      const event = weather[i]
      if (event.kind === 'tornado') {
        if (!this.showTornadoes) continue
        bump(tornadoes, xAt(event.time, marks.start, span, width))
        continue
      }
      if (event.kind === 'fire') {
        if (!this.showFires) continue
        const finish = event.endTime != null && event.endTime > event.time ? event.endTime : event.time
        const x0 = xAt(event.time, marks.start, span, width)
        const x1 = xAt(finish, marks.start, span, width)
        const last = Math.max(x0, x1)
        const first = Math.min(x0, x1)
        for (let x = first; x <= last; x += 1) bump(fires, x)
        continue
      }
      if (!this.showHurricanes) continue
      const finish = event.endTime != null && event.endTime > event.time ? event.endTime : event.time
      const x0 = xAt(event.time, marks.start, span, width)
      const x1 = xAt(finish, marks.start, span, width)
      const last = Math.max(x0, x1)
      const first = Math.min(x0, x1)
      for (let x = first; x <= last; x += 1) bump(storms, x)
    }

    if (this.showQuakes) strokeLane(ctx, quakes, 0, laneH, width, QUAKE_RGB)
    if (this.showTornadoes) strokeLane(ctx, tornadoes, laneH, laneH, width, TORNADO_RGB)
    if (this.showHurricanes) strokeLane(ctx, storms, laneH * 2, laneH, width, STORM_RGB)
    if (this.showFires) strokeLane(ctx, fires, laneH * 3, laneH, width, FIRE_RGB)
  }
}

function xAt(time: number, start: number, span: number, width: number): number {
  const t = (time - start) / span
  if (t <= 0) return 0
  if (t >= 1) return width - 1
  return Math.round(t * (width - 1))
}

function bump(bins: Uint16Array, x: number): void {
  if (x < 0 || x >= bins.length) return
  if (bins[x] < 65535) bins[x] += 1
}

function paintLane(
  ctx: CanvasRenderingContext2D,
  y: number,
  h: number,
  width: number,
  rgb: string,
): void {
  ctx.fillStyle = `rgba(${rgb}, 0.08)`
  ctx.fillRect(0, y + 0.5, width, Math.max(1, h - 1))
}

function strokeLane(
  ctx: CanvasRenderingContext2D,
  bins: Uint16Array,
  y: number,
  h: number,
  width: number,
  rgb: string,
): void {
  const top = y + 1
  const barH = Math.max(1, h - 2)
  for (let x = 0; x < width; x += 1) {
    const count = bins[x]
    if (count === 0) continue
    const alpha = Math.min(0.95, 0.28 + 0.22 * Math.log2(count + 1))
    ctx.fillStyle = `rgba(${rgb}, ${alpha})`
    ctx.fillRect(x, top, 1, barH)
  }
}
