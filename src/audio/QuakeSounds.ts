import type { QuakeEvent } from '../data/types.ts'

const MAX_VOICES = 5
const NOISE_SECONDS = 1.6

export class QuakeSounds {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private voices = 0
  private muted = true
  private volume = 0.5

  isMuted(): boolean {
    return this.muted
  }

  async setMuted(muted: boolean): Promise<void> {
    this.muted = muted
    if (!muted) await this.unlock()
    this.applyGain()
  }

  async setVolume(volume: number): Promise<void> {
    this.volume = Math.min(1, Math.max(0, volume))
    if (this.volume > 0 && this.muted) this.muted = false
    await this.unlock()
    this.applyGain()
  }

  play(event: QuakeEvent, playbackSpeed: number): void {
    if (this.muted || this.volume <= 0) return
    const mag = event.mag ?? 0
    if (playbackSpeed >= 60 && mag < 6) return
    if (playbackSpeed >= 10 && mag < 4.5) return
    if (!this.ctx || !this.master || !this.noise || this.ctx.state !== 'running') return
    if (this.voices >= MAX_VOICES) return

    const now = this.ctx.currentTime
    const duration = 0.16 + mag * 0.1
    const amp = Math.min(0.5, 0.028 * 10 ** (mag / 12))
    const cutoff = Math.max(55, 400 - mag * 32)

    const source = this.ctx.createBufferSource()
    source.buffer = this.noise
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(cutoff, now)
    filter.Q.setValueAtTime(0.7, now)
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(amp, now + 0.018)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(this.master)
    source.start(now)
    source.stop(now + duration + 0.04)

    if (mag >= 5.5) this.playThump(now, mag, duration)

    this.voices += 1
    source.onended = () => {
      this.voices = Math.max(0, this.voices - 1)
    }
  }

  private playThump(now: number, mag: number, duration: number): void {
    if (!this.ctx || !this.master) return
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(Math.max(28, 72 - mag * 4), now)
    osc.frequency.exponentialRampToValueAtTime(22, now + duration * 0.8)
    const amp = Math.min(0.22, 0.02 * (mag - 4))
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(amp, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    osc.connect(gain)
    gain.connect(this.master)
    osc.start(now)
    osc.stop(now + duration + 0.02)
  }

  private async unlock(): Promise<void> {
    if (!this.ctx) {
      const ctx = new AudioContext()
      const master = ctx.createGain()
      master.connect(ctx.destination)
      this.ctx = ctx
      this.master = master
      this.noise = makeBrownNoise(ctx, NOISE_SECONDS)
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  private applyGain(): void {
    if (!this.master || !this.ctx) return
    const value = this.muted ? 0 : this.volume
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.03)
  }
}

function makeBrownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let last = 0
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = Math.max(-1, Math.min(1, last * 3.5))
  }
  return buffer
}
