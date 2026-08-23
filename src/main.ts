import './style.css'
import { loadNoaaEvents } from './data/noaa.ts'
import { loadUsgsEvents } from './data/usgs.ts'
import { clampWeatherTimes, loadHistoryWeather, loadLiveWeather, weatherInWindow } from './data/weather.ts'
import type { PlaceHit } from './data/geocode.ts'
import { matchPlaceEvents, samePlaceMatch, type PlaceMatch } from './data/placeMatch.ts'
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
let showQuakes = true
let showTornadoes = true
let showHurricanes = true
let showFires = true
let placeHit: PlaceHit | null = null
let placeMatches: PlaceMatch[] = []
let placeCursor = -1
let placeWaitingForMatches = false

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
  onStep: (direction) => {
    if (placeHit) stepPlaceEvent(direction)
    else stepEvent(direction)
  },
  onSeek: (fraction) => {
    playback.seekFraction(fraction)
    weatherPlay.seekTo(playback.playhead)
    globe.clearMarks()
    hud.setClock(playback.playhead)
    stepCursorPlayhead = Number.NaN
    if (placeHit) {
      placeCursor = -1
      placeWaitingForMatches = false
    }
  },
  onResetView: () => globe.resetToPacific(),
  onMute: (muted) => {
    void sounds.setMuted(muted).then(() => hud.setMuted(sounds.isMuted()))
  },
  onVolume: (volume) => {
    void sounds.setVolume(volume).then(() => hud.setMuted(sounds.isMuted()))
  },
  onShowEarthquakes: (show) => {
    showQuakes = show
    globe.setShowEarthquakes(show)
    rematchPlaceFilter()
  },
  onShowMagLabels: (show) => globe.setShowMagLabels(show),
  onShowTornadoes: (show) => {
    showTornadoes = show
    globe.setShowTornadoes(show)
    rematchPlaceFilter()
  },
  onShowTornadoLabels: (show) => globe.setShowTornadoLabels(show),
  onShowHurricanes: (show) => {
    showHurricanes = show
    globe.setShowHurricanes(show)
    rematchPlaceFilter()
  },
  onShowHurricaneLabels: (show) => globe.setShowHurricaneLabels(show),
  onShowFires: (show) => {
    showFires = show
    globe.setShowFires(show)
    rematchPlaceFilter()
  },
  onShowFireLabels: (show) => globe.setShowFireLabels(show),
  onChoosePlace: (hit) => applyPlaceFilter(hit),
  onClearPlace: () => clearPlaceFilter(),
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
  rematchPlaceFilter()
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

function layerFlags(): { earthquakes: boolean; tornadoes: boolean; hurricanes: boolean; fires: boolean } {
  return {
    earthquakes: showQuakes,
    tornadoes: showTornadoes,
    hurricanes: showHurricanes,
    fires: showFires,
  }
}

function applyPlaceFilter(hit: PlaceHit): void {
  placeHit = hit
  placeMatches = matchPlaceEvents(hit, playback.events, weatherPlay.events, layerFlags())
  placeCursor = -1
  placeWaitingForMatches = placeMatches.length === 0
  hud.setPlaceFilter(hit.name, placeMatches.length)
  if (placeMatches.length === 0) {
    globe.lookAtLatLon(hit.lat, hit.lon)
    return
  }
  showPlaceMatch(0)
}

function rematchPlaceFilter(): void {
  if (!placeHit) return
  const prev = placeCursor >= 0 ? placeMatches[placeCursor] : null
  placeMatches = matchPlaceEvents(placeHit, playback.events, weatherPlay.events, layerFlags())
  hud.setPlaceFilter(placeHit.name, placeMatches.length)
  if (placeMatches.length === 0) {
    placeCursor = -1
    return
  }
  if (prev) {
    const idx = placeMatches.findIndex((match) => samePlaceMatch(match, prev))
    if (idx >= 0) {
      showPlaceMatch(idx)
      return
    }
  }
  if (placeWaitingForMatches) {
    placeWaitingForMatches = false
    showPlaceMatch(0)
  }
}

function clearPlaceFilter(): void {
  if (!placeHit) return
  placeHit = null
  placeMatches = []
  placeCursor = -1
  placeWaitingForMatches = false
  hud.setPlaceFilter(null, 0)
}

function firstPlaceIndexAfter(time: number): number {
  let lo = 0
  let hi = placeMatches.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (placeMatches[mid].time <= time) lo = mid + 1
    else hi = mid
  }
  return lo < placeMatches.length ? lo : -1
}

function lastPlaceIndexBefore(time: number): number {
  let lo = 0
  let hi = placeMatches.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (placeMatches[mid].time < time) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

function stepPlaceEvent(direction: -1 | 1): void {
  if (placeMatches.length === 0) return
  const next =
    direction > 0 ? firstPlaceIndexAfter(playback.playhead) : lastPlaceIndexBefore(playback.playhead)
  if (next < 0) {
    hud.setPlaceBoundHint(direction)
    return
  }
  showPlaceMatch(next)
}

function showPlaceMatch(index: number): void {
  const match = placeMatches[index]
  if (!match) return
  placeCursor = index
  playback.playing = false
  hud.setPlaying(false)
  playback.seekToTime(match.time)
  if (match.quake) {
    const quakeIndex = playback.events.indexOf(match.quake)
    if (quakeIndex >= 0) playback.index = quakeIndex + 1
  }
  weatherPlay.seekTo(match.time)
  if (match.weather) {
    const weatherIndex = weatherPlay.events.indexOf(match.weather)
    if (weatherIndex >= 0) weatherPlay.index = weatherIndex + 1
  }
  stepCursorPlayhead = playback.playhead
  globe.clearMarks()
  if (match.quake) {
    globe.spawn(match.quake)
    sounds.play(match.quake, playback.speed)
    hud.showEvent(match.quake)
  } else if (match.weather) {
    onWeather(match.weather)
  }
  globe.lookAtLatLon(match.lat, match.lon)
  hud.setClock(playback.playhead)
  hud.setFraction(playback.fraction())
  if (placeHit) hud.setPlaceFilter(placeHit.name, placeMatches.length)
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
