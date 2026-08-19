import type { WeatherEvent } from '../data/types.ts'

export class WeatherPlayback {
  events: WeatherEvent[] = []
  index = 0

  setEvents(events: WeatherEvent[]): void {
    this.events = events
    this.index = 0
  }

  seekTo(playhead: number): void {
    this.index = this.findIndex(playhead)
  }

  emitUpTo(playhead: number, onEvent: (event: WeatherEvent) => void): void {
    let emitted = 0
    while (this.index < this.events.length && this.events[this.index].time <= playhead) {
      onEvent(this.events[this.index])
      this.index += 1
      emitted += 1
      if (emitted >= 48) break
    }
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
