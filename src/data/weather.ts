import { loadLiveFires } from './fire.ts'
import { sortWeatherByTime, asFinite, polygonCentroid, windToCategory, cyclonePlace, basinFromId, ibtracsCsvToStorms } from './weatherParse.ts'
import type { WeatherEvent, WeatherTrackPoint } from './types.ts'

// Live sources (browser CORS-friendly NOAA/NWS/IEM/JMA endpoints; no API key):
// - NWS active tornado warnings: https://api.weather.gov/alerts/active?event=Tornado%20Warning
// - IEM local storm reports (7 days): https://mesonet.agron.iastate.edu/geojson/lsr.php?hours=168
// - NHC active tropical cyclones (Atlantic + East/Central Pacific):
//   https://www.nhc.noaa.gov/CurrentStorms.json (no CORS; browser uses IBTrACS ACTIVE)
// - JMA bosai active western Pacific typhoons:
//   https://www.jma.go.jp/bosai/typhoon/data/targetTc.json
//   https://www.jma.go.jp/bosai/typhoon/data/{TC id}/specifications.json
// - NASA EONET wildfires (global, no key): https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires
// - NIFC WFIGS current US wildfires (100+ acres)
// History snapshots are bundled under public/data/ (see scripts/fetch-weather.ts).

const NWS_TORNADO_ACTIVE = 'https://api.weather.gov/alerts/active?event=Tornado%20Warning'
const IEM_LSR_WEEK = [
  'https://mesonet.agron.iastate.edu/geojson/lsr.php?hours=168&type=T',
  'https://mesonet.agron.iastate.edu/geojson/lsr.php?hours=168',
]
const NHC_CURRENT = 'https://www.nhc.noaa.gov/CurrentStorms.json'
const JMA_TARGET_TC = 'https://www.jma.go.jp/bosai/typhoon/data/targetTc.json'
const IBTRACS_ACTIVE =
  'https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.ACTIVE.list.v04r01.csv'

type GeoJsonFeature = {
  id?: string | number
  geometry?: {
    type?: string
    coordinates?: unknown
  }
  properties?: Record<string, unknown>
}

type GeoJsonFeed = {
  features?: GeoJsonFeature[]
}

type NhcStorm = {
  id?: string
  name?: string
  classification?: string
  intensity?: string | number
  latitudeNumeric?: number
  longitudeNumeric?: number
  movementDir?: number
  movementSpeed?: number
  lastUpdate?: string
  publicAdvisory?: { url?: string }
}

type NhcFeed = {
  activeStorms?: NhcStorm[]
}

export type WeatherLoadResult = {
  events: WeatherEvent[]
  notice: string | null
}

const FETCH_MS = 20000

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) })
  if (!response.ok) throw new Error(`${url} failed (${response.status})`)
  return response.json()
}

async function fetchJsonFirst(urls: string[]): Promise<unknown> {
  let lastError: unknown = null
  for (let i = 0; i < urls.length; i += 1) {
    try {
      return await fetchJson(urls[i])
    } catch (error: unknown) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('all weather URLs failed')
}

function parseEf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const match = value.match(/(\d)/)
    if (!match) return null
    const n = Number(match[1])
    return Number.isFinite(n) && n >= 0 && n <= 5 ? n : null
  }
  return null
}

function iemLsrToTornado(feature: GeoJsonFeature): WeatherEvent | null {
  const props = feature.properties ?? {}
  const kind = String(props.type ?? props.typetext ?? '').toUpperCase()
  if (kind !== 'T' && kind !== 'TORNADO' && !kind.includes('TORN')) return null
  const lat = asFinite(props.lat) ?? asFinite((feature.geometry?.coordinates as number[] | undefined)?.[1])
  const lon = asFinite(props.lon) ?? asFinite((feature.geometry?.coordinates as number[] | undefined)?.[0])
  const valid = typeof props.valid === 'string' ? Date.parse(props.valid) : Number.NaN
  if (lat == null || lon == null || !Number.isFinite(valid)) return null
  const city = typeof props.city === 'string' ? props.city : ''
  const state = typeof props.state === 'string' ? props.state : typeof props.st === 'string' ? props.st : ''
  const ef = parseEf(props.magnitude ?? props.magf)
  const place = [city, state].filter(Boolean).join(', ') || 'Tornado report'
  return {
    id: `iem:${String(feature.id ?? props.product_id ?? `${valid}-${lat}-${lon}`)}`,
    kind: 'tornado',
    time: valid,
    endTime: valid,
    lat,
    lon,
    place: ef != null ? `EF${ef} tornado, ${place}` : `Tornado report, ${place}`,
    name: null,
    efRating: ef,
    category: null,
    windKt: null,
    acres: null,
    deaths: null,
    injuries: null,
    url: 'https://mesonet.agron.iastate.edu/request/gis/lsrs.php',
    track: null,
    source: 'iem',
  }
}

function nwsWarningToTornado(feature: GeoJsonFeature): WeatherEvent | null {
  const props = feature.properties ?? {}
  const messageType = String(props.messageType ?? '')
  if (messageType.toLowerCase() === 'cancel') return null
  const eventName = String(props.event ?? '')
  if (eventName !== 'Tornado Warning') return null
  const geometry = feature.geometry
  let lat: number | null = null
  let lon: number | null = null
  if (geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    const ring = geometry.coordinates[0]
    if (Array.isArray(ring)) {
      const c = polygonCentroid(ring as number[][])
      if (c) {
        lat = c.lat
        lon = c.lon
      }
    }
  } else if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
    lon = asFinite((geometry.coordinates as number[])[0])
    lat = asFinite((geometry.coordinates as number[])[1])
  }
  if (lat == null || lon == null) return null
  const onset = typeof props.onset === 'string' ? Date.parse(props.onset) : Number.NaN
  const effective = typeof props.effective === 'string' ? Date.parse(props.effective) : Number.NaN
  const time = Number.isFinite(onset) ? onset : effective
  if (!Number.isFinite(time)) return null
  const endsRaw = typeof props.ends === 'string' ? Date.parse(props.ends) : Number.NaN
  const expires = typeof props.expires === 'string' ? Date.parse(props.expires) : Number.NaN
  const endTime = Number.isFinite(endsRaw) ? endsRaw : Number.isFinite(expires) ? expires : time
  const area = typeof props.areaDesc === 'string' ? props.areaDesc : 'Tornado warning'
  const id = typeof props.id === 'string' ? props.id : String(feature.id ?? `${time}-${lat}-${lon}`)
  return {
    id: `nws:${id}`,
    kind: 'tornado',
    time,
    endTime,
    lat,
    lon,
    place: `Tornado warning, ${area}`,
    name: null,
    efRating: null,
    category: null,
    windKt: null,
    acres: null,
    deaths: null,
    injuries: null,
    url: typeof feature.id === 'string' ? feature.id : 'https://api.weather.gov/alerts/active',
    track: null,
    source: 'nws',
  }
}

function motionTrack(
  lat: number,
  lon: number,
  dirDeg: number | null,
  speedMph: number | null,
  now: number,
): WeatherTrackPoint[] {
  const dir = dirDeg ?? 0
  const speed = Math.max(0, speedMph ?? 0)
  const kmPerHour = speed * 1.60934
  const rad = (dir * Math.PI) / 180
  const offset = (hours: number): { lat: number; lon: number } => {
    const distKm = kmPerHour * hours
    const dLat = (distKm * Math.cos(rad)) / 111.32
    const cosLat = Math.cos((lat * Math.PI) / 180)
    const dLon = cosLat === 0 ? 0 : (distKm * Math.sin(rad)) / (111.32 * Math.max(0.2, Math.abs(cosLat)))
    return { lat: lat + dLat, lon: lon + dLon }
  }
  const back = offset(-18)
  const ahead = offset(18)
  return [
    { time: now - 18 * 3600_000, lat: back.lat, lon: back.lon, windKt: null },
    { time: now, lat, lon, windKt: null },
    { time: now + 18 * 3600_000, lat: ahead.lat, lon: ahead.lon, windKt: null },
  ]
}

function nhcStormToEvent(storm: NhcStorm): WeatherEvent | null {
  const lat = asFinite(storm.latitudeNumeric)
  const lon = asFinite(storm.longitudeNumeric)
  const updated = storm.lastUpdate ? Date.parse(storm.lastUpdate) : Number.NaN
  if (lat == null || lon == null || !Number.isFinite(updated)) return null
  const wind = typeof storm.intensity === 'number' ? storm.intensity : Number(storm.intensity)
  const windKt = Number.isFinite(wind) ? wind : null
  const category = windKt != null ? windToCategory(windKt) : 0
  const name = storm.name?.trim() ? storm.name.trim() : null
  const id = storm.id?.trim() || `${lat},${lon},${updated}`
  const dir = asFinite(storm.movementDir)
  const speed = asFinite(storm.movementSpeed)
  const basin = basinFromId(`nhc:${id}`)
  const cat = category > 0 ? category : 0
  return {
    id: `nhc:${id}`,
    kind: 'hurricane',
    time: updated - 2 * 24 * 3600_000,
    endTime: updated + 2 * 24 * 3600_000,
    lat,
    lon,
    place: cyclonePlace(basin, name, cat),
    name,
    efRating: null,
    category: category > 0 ? category : null,
    windKt,
    acres: null,
    deaths: null,
    injuries: null,
    url: storm.publicAdvisory?.url ?? 'https://www.nhc.noaa.gov/CurrentStorms.json',
    track: motionTrack(lat, lon, dir, speed, updated),
    source: 'nhc',
    basin,
  }
}

async function loadLiveTornadoes(): Promise<WeatherEvent[]> {
  const events: WeatherEvent[] = []
  const seen = new Set<string>()
  const push = (event: WeatherEvent | null): void => {
    if (!event || seen.has(event.id)) return
    seen.add(event.id)
    events.push(event)
  }

  const results = await Promise.allSettled([fetchJsonFirst(IEM_LSR_WEEK), fetchJson(NWS_TORNADO_ACTIVE)])
  const lsrBody = results[0].status === 'fulfilled' ? results[0].value : null
  const nwsBody = results[1].status === 'fulfilled' ? results[1].value : null
  if (lsrBody) {
    const feed = lsrBody as GeoJsonFeed
    for (const feature of feed.features ?? []) push(iemLsrToTornado(feature))
  }
  if (nwsBody) {
    const feed = nwsBody as GeoJsonFeed
    for (const feature of feed.features ?? []) push(nwsWarningToTornado(feature))
  }
  if (!lsrBody && !nwsBody) throw new Error('tornado feeds unavailable')
  return events
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) })
  if (!response.ok) throw new Error(`${url} failed (${response.status})`)
  return response.text()
}

type JmaTarget = {
  tropicalCyclone?: string
  typhoonNumber?: string
  category?: string
}

type JmaPart = {
  part?: unknown
  name?: { en?: string }
  typhoonNumber?: string
  category?: { en?: string }
  position?: { deg?: number[] }
  maximumWind?: { sustained?: { kt?: string } }
  validtime?: { UTC?: string }
}

function jmaSpecToEvent(tcId: string, parts: JmaPart[]): WeatherEvent | null {
  let name: string | null = null
  const points: WeatherTrackPoint[] = []
  let maxWind = 0
  let peakLat = 0
  let peakLon = 0
  const cap = Math.min(parts.length, 32)
  for (let i = 0; i < cap; i += 1) {
    const part = parts[i]
    if (part.name?.en) name = part.name.en.trim() || name
    const deg = part.position?.deg
    const lat = asFinite(deg?.[0])
    const lon = asFinite(deg?.[1])
    const time = part.validtime?.UTC ? Date.parse(part.validtime.UTC) : Number.NaN
    if (lat == null || lon == null || !Number.isFinite(time)) continue
    const wind = Number(part.maximumWind?.sustained?.kt)
    const windKt = Number.isFinite(wind) ? wind : null
    points.push({ time, lat, lon, windKt })
    if (windKt != null && windKt > maxWind) {
      maxWind = windKt
      peakLat = lat
      peakLon = lon
    }
  }
  if (points.length === 0) return null
  const start = points[0]
  const end = points[points.length - 1]
  const category = windToCategory(maxWind)
  return {
    id: `jma:${tcId}`,
    kind: 'hurricane',
    time: start.time - 2 * 24 * 3600_000,
    endTime: end.time,
    lat: peakLat || start.lat,
    lon: peakLon || start.lon,
    place: cyclonePlace('WP', name, category),
    name,
    efRating: null,
    category: category > 0 ? category : null,
    windKt: maxWind > 0 ? maxWind : null,
    acres: null,
    deaths: null,
    injuries: null,
    url: 'https://www.jma.go.jp/bosai/map.html#5/39.5/137/&elem=root&typhoon=on&contents=typhoon',
    track: points,
    source: 'jma',
    basin: 'WP',
  }
}

async function loadLiveJmaTyphoons(): Promise<WeatherEvent[]> {
  const targets = (await fetchJson(JMA_TARGET_TC)) as JmaTarget[]
  if (!Array.isArray(targets) || targets.length === 0) return []
  const events: WeatherEvent[] = []
  const cap = Math.min(targets.length, 8)
  for (let i = 0; i < cap; i += 1) {
    const id = targets[i].tropicalCyclone?.trim()
    if (!id) continue
    const spec = (await fetchJson(`https://www.jma.go.jp/bosai/typhoon/data/${id}/specifications.json`)) as JmaPart[]
    if (!Array.isArray(spec)) continue
    const event = jmaSpecToEvent(id, spec)
    if (event) events.push(event)
  }
  return events
}

async function loadLiveIbtracsActive(): Promise<WeatherEvent[]> {
  const csv = await fetchText(IBTRACS_ACTIVE)
  // NHC CurrentStorms.json has no CORS headers, so Atlantic / East Pacific
  // storms only reach the browser through this CORS-open IBTrACS ACTIVE file.
  const holdUntil = Date.now() + 2 * 24 * 3600_000
  return ibtracsCsvToStorms(csv, 34).map((event) => {
    const last = event.track?.[event.track.length - 1]
    return {
      ...event,
      lat: last?.lat ?? event.lat,
      lon: last?.lon ?? event.lon,
      endTime: Math.max(event.endTime ?? event.time, holdUntil),
    }
  })
}

async function loadLiveHurricanes(): Promise<WeatherEvent[]> {
  const results = await Promise.allSettled([
    fetchJson(NHC_CURRENT).then((body) => {
      const events: WeatherEvent[] = []
      for (const storm of (body as NhcFeed).activeStorms ?? []) {
        const event = nhcStormToEvent(storm)
        if (event) events.push(event)
      }
      return events
    }),
    loadLiveJmaTyphoons(),
    loadLiveIbtracsActive(),
  ])
  const events: WeatherEvent[] = []
  const seen = new Set<string>()
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]
    if (result.status !== 'fulfilled') continue
    for (const event of result.value) {
      const key = event.name ? event.name.toUpperCase() : event.id
      if (seen.has(key)) continue
      seen.add(key)
      events.push(event)
    }
  }
  if (events.length === 0 && results.every((result) => result.status === 'rejected')) {
    throw new Error('tropical cyclone feeds unavailable')
  }
  return events
}

async function settle(label: string, task: () => Promise<WeatherEvent[]>): Promise<{
  events: WeatherEvent[]
  error: string | null
}> {
  try {
    return { events: await task(), error: null }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : `${label} failed`
    return { events: [], error: `${label}: ${message}` }
  }
}

export async function loadLiveWeather(): Promise<WeatherLoadResult> {
  const tornadoes = await settle('Tornadoes', loadLiveTornadoes)
  const hurricanes = await settle('Hurricanes/Typhoons', loadLiveHurricanes)
  const fires = await settle('Fires', loadLiveFires)
  const notices = [tornadoes.error, hurricanes.error, fires.error].filter((text): text is string => text != null)
  return {
    events: sortWeatherByTime([...tornadoes.events, ...hurricanes.events, ...fires.events]),
    notice: notices.length > 0 ? notices.join(' · ') : null,
  }
}

async function loadSnapshot(file: string): Promise<WeatherEvent[]> {
  const url = `${import.meta.env.BASE_URL}data/${file}`
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) })
  if (!response.ok) throw new Error(`${file} failed (${response.status})`)
  const events = (await response.json()) as WeatherEvent[]
  if (!Array.isArray(events)) throw new Error(`${file} is not an array`)
  return events.filter(
    (event) => event && Number.isFinite(event.time) && Number.isFinite(event.lat) && Number.isFinite(event.lon),
  )
}

export async function loadHistoryWeather(): Promise<WeatherLoadResult> {
  const tornadoes = await settle('Tornado history', () => loadSnapshot('tornadoes-significant.json'))
  const hurricanes = await settle('Hurricane/typhoon history', () => loadSnapshot('hurricanes-significant.json'))
  const fires = await settle('Fire history', () => loadSnapshot('fires-significant.json'))
  const notices = [tornadoes.error, hurricanes.error, fires.error].filter((text): text is string => text != null)
  return {
    events: sortWeatherByTime([...tornadoes.events, ...hurricanes.events, ...fires.events]),
    notice: notices.length > 0 ? notices.join(' · ') : null,
  }
}

export function weatherInWindow(events: WeatherEvent[], start: number, end: number): WeatherEvent[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []
  const selected: WeatherEvent[] = []
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]
    const finish = event.endTime ?? event.time
    if (event.time <= end && finish >= start) selected.push(event)
  }
  return selected
}

export function weatherActiveAt(events: WeatherEvent[], playhead: number): WeatherEvent[] {
  const selected: WeatherEvent[] = []
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]
    const finish = event.endTime ?? event.time
    if (event.time <= playhead && finish >= playhead) selected.push(event)
  }
  return selected
}

export function clampWeatherTimes(events: WeatherEvent[], start: number, end: number): WeatherEvent[] {
  if (!Number.isFinite(start) || end <= start) return events
  const next: WeatherEvent[] = []
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]
    const time = Math.min(end, Math.max(start, event.time))
    next.push(time === event.time ? event : { ...event, time })
  }
  return sortWeatherByTime(next)
}
