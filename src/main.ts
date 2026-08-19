import './style.css'
import { loadNoaaEvents } from './data/noaa.ts'
import { loadUsgsEvents } from './data/usgs.ts'
import type { QuakeEvent } from './data/types.ts'
import { QuakeSounds } from './audio/QuakeSounds.ts'
import { Globe } from './globe/Globe.ts'
import { Playback } from './timeline/Playback.ts'
import { Hud, type Mode } from './ui/Hud.ts'

const LIVE_DURATION_MS = 60_000
const HISTORY_DURATION_MS = 120_000

const globeRoot = document.querySelector<HTMLElement>('#globe')
const hudRoot = document.querySelector<HTMLElement>('#hud')
if (!globeRoot || !hudRoot) {
  throw new Error('Missing #globe or #hud')
}

const globe = new Globe(globeRoot)
const playback = new Playback()
const sounds = new QuakeSounds()

let mode: Mode = 'live'
let minMag = 2.5
let liveEvents: QuakeEvent[] = []
let historyEvents: QuakeEvent[] = []
let eventsShown = 0
let maxMag = Number.NEGATIVE_INFINITY
let deathsShown = 0

const hud = new Hud(hudRoot, {
  onMode: (next) => {
    mode = next
    applyCatalog()
  },
  onMinMag: (next) => {
    minMag = next
    applyCatalog()
  },
  onSpeed: (speed) => {
    playback.speed = speed
  },
  onPlayToggle: () => {
    playback.playing = !playback.playing
    hud.setPlaying(playback.playing)
  },
  onSeek: (fraction) => {
    playback.seekFraction(fraction)
    globe.ripples.clear()
    hud.setClock(playback.playhead)
  },
  onResetView: () => globe.resetToPacific(),
  onMute: (muted) => {
    void sounds.setMuted(muted).then(() => hud.setMuted(sounds.isMuted()))
  },
  onVolume: (volume) => {
    void sounds.setVolume(volume).then(() => hud.setMuted(sounds.isMuted()))
  },
})

hud.setShowDeaths(false)

function resetStats(): void {
  eventsShown = 0
  maxMag = Number.NEGATIVE_INFINITY
  deathsShown = 0
  hud.setStats(0, Number.NaN, 0)
}

function applyCatalog(): void {
  const source = mode === 'live' ? liveEvents : historyEvents
  const filtered = source.filter((event) => (event.mag ?? 0) >= minMag)
  playback.setEvents(
    filtered,
    mode === 'live' ? LIVE_DURATION_MS : HISTORY_DURATION_MS,
    mode === 'history',
  )
  globe.ripples.clear()
  resetStats()
  hud.setShowDeaths(mode === 'history')
  hud.setClock(playback.events.length > 0 ? playback.playhead : Number.NaN)
  hud.setFraction(0)
  const label = mode === 'live' ? 'USGS past 7 days' : 'NOAA significant 1900–present'
  hud.setStatus(`${label}: ${filtered.length.toLocaleString('en-US')} events at M ≥ ${minMag}`)
}

function onEvent(event: QuakeEvent): void {
  globe.spawn(event)
  sounds.play(event, playback.speed)
  hud.showEvent(event)
  eventsShown += 1
  if (event.mag != null) maxMag = Math.max(maxMag, event.mag)
  if (event.deaths != null) deathsShown += event.deaths
  hud.setStats(eventsShown, maxMag, deathsShown)
}

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min(100, now - last)
  last = now
  const looped = playback.tick(dt, onEvent)
  if (looped) resetStats()
  globe.update(dt / 1000)
  globe.render()
  hud.setClock(playback.events.length > 0 ? playback.playhead : Number.NaN)
  hud.setFraction(playback.fraction())
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

hud.setStatus('Loading USGS week…')
loadUsgsEvents()
  .then((events) => {
    liveEvents = events
    if (mode === 'live') applyCatalog()
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'USGS load failed'
    hud.setStatus(message)
  })

loadNoaaEvents()
  .then((events) => {
    historyEvents = events
    if (mode === 'history') applyCatalog()
    else if (liveEvents.length === 0) {
      hud.setStatus(`NOAA history ready (${events.length.toLocaleString('en-US')} events). Loading USGS…`)
    }
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'NOAA load failed'
    if (mode === 'history') hud.setStatus(message)
  })
