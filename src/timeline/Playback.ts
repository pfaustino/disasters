import type { QuakeEvent } from '../data/types.ts'

const MAX_GAP_MS = 1000 * 60 * 60 * 24 * 120
const DEADLY_PAUSE_MAX_MS = 800

export class Playback {
  events: QuakeEvent[] = []
  playhead = 0
  playing = true
  speed = 1
  playDurationMs = 60_000
  compressGaps = false
  sourceStart = 0
  sourceEnd = 1
  index = 0
  private pauseRemain = 0
  private looped = false

  setEvents(events: QuakeEvent[], playDurationMs: number, compressGaps: boolean): void {
    this.events = events
    this.playDurationMs = playDurationMs
    this.compressGaps = compressGaps
    this.pauseRemain = 0
    this.looped = false
    if (events.length === 0) {
      this.sourceStart = 0
      this.sourceEnd = 1
      this.playhead = 0
      this.index = 0
      return
    }
    this.sourceStart = events[0].time
    this.sourceEnd = Math.max(events[events.length - 1].time, this.sourceStart + 1)
    this.playhead = this.sourceStart
    this.index = 0
  }

  fraction(): number {
    return (this.playhead - this.sourceStart) / (this.sourceEnd - this.sourceStart)
  }

  seekFraction(fraction: number): void {
    const t = Math.min(1, Math.max(0, fraction))
    this.playhead = this.sourceStart + t * (this.sourceEnd - this.sourceStart)
    this.index = this.findIndex(this.playhead)
    this.pauseRemain = 0
    this.looped = false
  }

  tick(dtMs: number, onEvent: (event: QuakeEvent) => void): boolean {
    this.looped = false
    if (!this.playing || this.events.length === 0) return false

    if (this.pauseRemain > 0) {
      this.pauseRemain -= dtMs
      return false
    }

    if (this.compressGaps && this.index < this.events.length) {
      const gap = this.events[this.index].time - this.playhead
      if (gap > MAX_GAP_MS) {
        this.playhead = this.events[this.index].time - MAX_GAP_MS * 0.15
      }
    }

    const span = this.sourceEnd - this.sourceStart
    const rate = (span / this.playDurationMs) * this.speed
    this.playhead += dtMs * rate

    let emitted = 0
    while (this.index < this.events.length && this.events[this.index].time <= this.playhead) {
      const event = this.events[this.index]
      this.index += 1
      onEvent(event)
      emitted += 1
      if (this.compressGaps && event.deaths != null && event.deaths > 0) {
        this.pauseRemain = Math.min(
          DEADLY_PAUSE_MAX_MS,
          220 + Math.log10(event.deaths + 1) * 160,
        )
        break
      }
      if (emitted >= 48) {
        this.playhead = event.time
        break
      }
    }

    if (this.playhead >= this.sourceEnd || this.index >= this.events.length) {
      this.playhead = this.sourceStart
      this.index = 0
      this.pauseRemain = 0
      this.looped = true
    }

    return this.looped
  }

  private findIndex(playhead: number): number {
    let lo = 0
    let hi = this.events.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.events[mid].time <= playhead) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
