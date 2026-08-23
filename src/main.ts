import './style.css'
import { loadNoaaEvents } from './data/noaa.ts'
import { loadUsgsEvents } from './data/usgs.ts'
import { clampWeatherTimes, loadHistoryWeather, loadLiveWeather, weatherInWindow } from './data/weather.ts'
import type { QuakeEvent, WeatherEvent } from './data/types.ts'
import { QuakeSounds } from './audio/QuakeSounds.ts'
import { Globe } from './globe/Globe.ts'
import { Playback } from './timeline/Playback.ts'
import { WeatherPlayback } from './timeline/WeatherPlayback.ts'
import { Hud, type Mode } from './ui/Hud.ts'

const LIVE_DURATION_MS = 60_000
const HISTORY_DURATION_MS = 120_000
// History catalog stays 1900+; playhead starts when Atlantic storms got given names (1953).
const HISTORY_PLAYHEAD_START_MS = Date.UTC(1953, 0, 1)

const globeRoot = document.querySelector<HTMLElement>('#globe')
const hudRoot = document.querySelector<HTMLElement>('#hud')
if (!globeRoot || !hudRoot) {
  throw new Error('Missing #globe or #hud')
}

const globe = new Globe(globeRoot)
const playback = new Playback()
const weatherPlay = new WeatherPlayback()
const sounds = new QuakeSounds()

let mode: Mode = 'history'
let minMag = 2.5
let liveEvents: QuakeEvent[] = []
let historyEvents: QuakeEvent[] = []
let liveWeather: WeatherEvent[] = []
let historyWeather: WeatherEvent[] = []
let weatherNotice: string | null = null
let eventsShown = 0
let maxMag = Number.NEGATIVE_INFINITY
let deathsShown = 0

type StepItem = {
  time: number
  quake: QuakeEvent | null
  weather: WeatherEvent | null
}

let stepItems: StepItem[] = []
let stepCursor = -1
let stepCursorPlayhead = Number.NaN

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
  onStep: (direction) => stepEvent(direction),
  onSeek: (fraction) => {
    playback.seekFraction(fraction)
    weatherPlay.seekTo(playback.playhead)
    globe.clearMarks()
    hud.setClock(playback.playhead)
    stepCursorPlayhead = Number.NaN
  },
  onResetView: () => globe.resetToPacific(),
  onMute: (muted) => {
    void sounds.setMuted(muted).then(() => hud.setMuted(sounds.isMuted()))
  },
  onVolume: (volume) => {
    void sounds.setVolume(volume).then(() => hud.setMuted(sounds.isMuted()))
  },
  onShowEarthquakes: (show) => globe.setShowEarthquakes(show),
  onShowMagLabels: (show) => globe.setShowMagLabels(show),
  onShowTornadoes: (show) => globe.setShowTornadoes(show),
  onShowTornadoLabels: (show) => globe.setShowTornadoLabels(show),
  onShowHurricanes: (show) => globe.setShowHurricanes(show),
  onShowHurricaneLabels: (show) => globe.setShowHurricaneLabels(show),
  onShowFires: (show) => globe.setShowFires(show),
  onShowFireLabels: (show) => globe.setShowFireLabels(show),
  onLookAtPlace: (lat, lon) => globe.lookAtLatLon(lat, lon),
})

hud.setShowDeaths(false)
hud.setMuted(false)
globe.setShowMagLabels(true)

function unlockAudioOnGesture(): void {
  window.removeEventListener('pointerdown', unlockAudioOnGesture)
  window.removeEventListener('keydown', unlockAudioOnGesture)
  void sounds.setMuted(false).then(() => hud.setMuted(sounds.isMuted()))
}
window.addEventListener('pointerdown', unlockAudioOnGesture)
window.addEventListener('keydown', unlockAudioOnGesture)

function resetStats(): void {
  eventsShown = 0
  maxMag = Number.NEGATIVE_INFINITY
  deathsShown = 0
  hud.setStats(0, Number.NaN, 0)
}

function catalogLabel(): string {
  return mode === 'live' ? 'USGS past 7 days' : 'NOAA significant 1900–present'
}

function setCatalogStatus(quakeCount: number): void {
  const weather = weatherPlay.events
  let tornadoes = 0
  let hurricanes = 0
  let fires = 0
  for (let i = 0; i < weather.length; i += 1) {
    if (weather[i].kind === 'tornado') tornadoes += 1
    else if (weather[i].kind === 'hurricane') hurricanes += 1
    else fires += 1
  }
  const parts = [`${catalogLabel()}: ${quakeCount.toLocaleString('en-US')} events at M ≥ ${minMag}`]
  parts.push(`${tornadoes.toLocaleString('en-US')} tornadoes`)
  parts.push(`${hurricanes.toLocaleString('en-US')} hurricanes/typhoons`)
  parts.push(`${fires.toLocaleString('en-US')} fires`)
  if (weatherNotice) parts.push(weatherNotice)
  hud.setStatus(parts.join(' · '))
}

function applyCatalog(): void {
  const source = mode === 'live' ? liveEvents : historyEvents
  const filtered = source.filter((event) => (event.mag ?? 0) >= minMag)
  playback.setEvents(
    filtered,
    mode === 'live' ? LIVE_DURATION_MS : HISTORY_DURATION_MS,
    mode === 'history',
  )
  if (mode === 'history' && playback.events.length > 0) {
    const span = playback.sourceEnd - playback.sourceStart
    const t = (HISTORY_PLAYHEAD_START_MS - playback.sourceStart) / span
    playback.seekFraction(Math.min(1, Math.max(0, t)))
  }
  const weatherSource = mode === 'live' ? liveWeather : historyWeather
  if (playback.events.length === 0) {
    weatherPlay.setEvents([])
  } else if (mode === 'live') {
    weatherPlay.setEvents(clampWeatherTimes(weatherSource, playback.sourceStart, playback.sourceEnd))
  } else {
    weatherPlay.setEvents(weatherInWindow(weatherSource, playback.sourceStart, playback.sourceEnd))
    weatherPlay.seekTo(playback.playhead)
  }
  globe.clearMarks()
  resetStats()
  hud.setShowDeaths(mode === 'history')
  hud.setClock(playback.events.length > 0 ? playback.playhead : Number.NaN)
  hud.setFraction(playback.fraction())
  hud.setDensity(
    playback.events.length === 0
      ? null
      : {
          start: playback.sourceStart,
          end: playback.sourceEnd,
          quakes: filtered,
          weather: weatherPlay.events,
        },
  )
  rebuildStepItems(filtered, weatherPlay.events)
  setCatalogStatus(filtered.length)
}

function rebuildStepItems(quakes: QuakeEvent[], weather: WeatherEvent[]): void {
  const items: StepItem[] = []
  const quakeCap = Math.min(quakes.length, 50_000)
  for (let i = 0; i < quakeCap; i += 1) {
    items.push({ time: quakes[i].time, quake: quakes[i], weather: null })
  }
  const weatherCap = Math.min(weather.length, 50_000)
  for (let i = 0; i < weatherCap; i += 1) {
    items.push({ time: weather[i].time, quake: null, weather: weather[i] })
  }
  items.sort((a, b) => a.time - b.time)
  stepItems = items
  stepCursor = -1
  stepCursorPlayhead = Number.NaN
}

function lastStepIndexAtOrBefore(time: number): number {
  let lo = 0
  let hi = stepItems.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (stepItems[mid].time <= time) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

function stepEvent(direction: -1 | 1): void {
  if (playback.playing || stepItems.length === 0) return
  if (stepCursorPlayhead !== playback.playhead) {
    stepCursor = lastStepIndexAtOrBefore(playback.playhead)
    stepCursorPlayhead = playback.playhead
  }
  const next = stepCursor + direction
  if (next < 0 || next >= stepItems.length) return
  const item = stepItems[next]
  stepCursor = next
  playback.seekToTime(item.time)
  if (item.quake) {
    const quakeIndex = playback.events.indexOf(item.quake)
    if (quakeIndex >= 0) playback.index = quakeIndex + 1
  }
  weatherPlay.seekTo(item.time)
  if (item.weather) {
    const weatherIndex = weatherPlay.events.indexOf(item.weather)
    if (weatherIndex >= 0) weatherPlay.index = weatherIndex + 1
  }
  stepCursorPlayhead = playback.playhead
  globe.clearMarks()
  if (item.quake) {
    globe.spawn(item.quake)
    sounds.play(item.quake, playback.speed)
    hud.showEvent(item.quake)
  } else if (item.weather) {
    onWeather(item.weather)
  }
  hud.setClock(playback.playhead)
  hud.setFraction(playback.fraction())
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

function onWeather(event: WeatherEvent): void {
  globe.spawnWeather(event)
  hud.showEvent(event)
}

let last = performance.now()
function frame(now: number): void {
  const dt = Math.min(100, now - last)
  last = now
  const looped = playback.tick(dt, onEvent)
  if (looped) {
    resetStats()
    weatherPlay.seekTo(playback.playhead)
  }
  weatherPlay.emitUpTo(playback.playhead, onWeather)
  globe.update(dt / 1000)
  globe.render()
  hud.setClock(playback.events.length > 0 ? playback.playhead : Number.NaN)
  hud.setFraction(playback.fraction())
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

hud.setStatus('Loading NOAA history…')
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

loadLiveWeather()
  .then((result) => {
    liveWeather = result.events
    if (mode === 'live') {
      weatherNotice = result.notice
      applyCatalog()
    }
  })
  .catch((error: unknown) => {
    weatherNotice = error instanceof Error ? error.message : 'Weather live load failed'
    if (mode === 'live') setCatalogStatus(playback.events.length)
  })

loadHistoryWeather()
  .then((result) => {
    historyWeather = result.events
    if (mode === 'history') {
      weatherNotice = result.notice
      applyCatalog()
    }
  })
  .catch((error: unknown) => {
    if (mode === 'history') {
      weatherNotice = error instanceof Error ? error.message : 'Weather history load failed'
      setCatalogStatus(playback.events.length)
    }
  })
