import { asFinite, polygonCentroid, sortWeatherByTime } from './weatherParse.ts'
import type { WeatherEvent, WeatherTrackPoint } from './types.ts'

// Live (browser, no API key, CORS-open):
// - NASA EONET wildfires: https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires
// - NIFC WFIGS current US incidents (100+ acres)
// FIRMS needs a MAP_KEY; skip it.
// History snapshot: public/data/fires-significant.json (see scripts/fetch-weather.ts).

const EONET_OPEN = 'https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires'
const EONET_WEEK = 'https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&days=7&status=all'
const NIFC_CURRENT =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=IncidentTypeCategory%3D%27WF%27%20AND%20IncidentSize%3E%3D100&outFields=IncidentName,POOState,POOCounty,FireDiscoveryDateTime,FireOutDateTime,IncidentSize,FinalAcres,UniqueFireIdentifier&outSR=4326&f=geojson&resultRecordCount=2000'

const FETCH_MS = 20000
const LIVE_MIN_ACRES = 100

type EonetGeometry = {
  magnitudeValue?: number | null
  magnitudeUnit?: string | null
  date?: string
  type?: string
  coordinates?: unknown
}

type EonetEvent = {
  id?: string
  title?: string
  description?: string | null
  link?: string
  closed?: string | null
  sources?: { id?: string; url?: string }[]
  geometry?: EonetGeometry[]
}

type EonetFeed = {
  events?: EonetEvent[]
}

type GeoJsonFeature = {
  id?: string | number
  geometry?: {
    type?: string
    coordinates?: unknown
  }
  properties?: Record<string, unknown>
  attributes?: Record<string, unknown>
  centroid?: { x?: number; y?: number }
}

type GeoJsonFeed = {
  features?: GeoJsonFeature[]
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) })
  if (!response.ok) throw new Error(`${url} failed (${response.status})`)
  return response.json()
}

export function acresFromMagnitude(value: number | null, unit: string | null): number | null {
  if (value == null || value <= 0) return null
  const kind = (unit ?? '').toLowerCase()
  if (kind.startsWith('hect')) return value * 2.47105
  return value
}

export function fireDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null
  let text = raw.trim()
  if (!text) return null
  text = text.replace(/^wildfire\s+/i, '').trim()
  if (!text) return null
  if (/^in\s+/i.test(text)) return null
  const upper = text.toUpperCase()
  if (upper === 'UNNAMED' || upper === 'UNKNOWN' || upper === 'N/A' || upper === 'NA') return null
  if (/^\d+$/.test(text)) return null
  const head = text.split(',')[0]?.trim() ?? text
  if (head.length < 2) return null
  if (/^[A-Z]{2}\d{4,}$/i.test(head)) return null
  return head.length > 40 ? `${head.slice(0, 39)}…` : head
}

function pointFromGeometry(geometry: EonetGeometry | undefined): { lat: number; lon: number } | null {
  if (!geometry) return null
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const lon = asFinite((geometry.coordinates as number[])[0])
    const lat = asFinite((geometry.coordinates as number[])[1])
    if (lat == null || lon == null) return null
    return { lat, lon }
  }
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    const ring = (geometry.coordinates as number[][][])[0]
    if (Array.isArray(ring)) return polygonCentroid(ring)
  }
  return null
}

export function eonetEventToFire(raw: EonetEvent): WeatherEvent | null {
  const geometries = raw.geometry ?? []
  if (geometries.length === 0) return null
  const points: WeatherTrackPoint[] = []
  let acres: number | null = null
  const cap = Math.min(geometries.length, 24)
  for (let i = 0; i < cap; i += 1) {
    const geom = geometries[i]
    const pos = pointFromGeometry(geom)
    const time = geom.date ? Date.parse(geom.date) : Number.NaN
    if (!pos || !Number.isFinite(time)) continue
    const magAcres = acresFromMagnitude(asFinite(geom.magnitudeValue), geom.magnitudeUnit ?? null)
    if (magAcres != null) acres = Math.max(acres ?? 0, magAcres)
    points.push({ time, lat: pos.lat, lon: pos.lon, windKt: null })
  }
  if (points.length === 0) return null
  const start = points[0]
  const last = points[points.length - 1]
  const closed = raw.closed ? Date.parse(raw.closed) : Number.NaN
  const endTime = Number.isFinite(closed) ? closed : last.time
  const title = raw.title?.trim() || 'Wildfire'
  const name = fireDisplayName(title)
  const place = raw.description?.trim() || title
  const url = raw.sources?.[0]?.url || raw.link || 'https://eonet.gsfc.nasa.gov/'
  return {
    id: `eonet:${raw.id ?? `${start.time}-${start.lat}-${start.lon}`}`,
    kind: 'fire',
    time: start.time,
    endTime,
    lat: last.lat,
    lon: last.lon,
    place,
    name,
    efRating: null,
    category: null,
    windKt: null,
    acres,
    deaths: null,
    injuries: null,
    url,
    track: points.length >= 2 ? points : null,
    source: 'eonet',
  }
}

function nifcProps(feature: GeoJsonFeature): Record<string, unknown> {
  return feature.properties ?? feature.attributes ?? {}
}

function nifcCoords(feature: GeoJsonFeature): { lat: number; lon: number } | null {
  const geom = feature.geometry
  if (geom?.type === 'Point' && Array.isArray(geom.coordinates)) {
    const lon = asFinite((geom.coordinates as number[])[0])
    const lat = asFinite((geom.coordinates as number[])[1])
    if (lat != null && lon != null) return { lat, lon }
  }
  const centroid = feature.centroid
  const x = asFinite(centroid?.x)
  const y = asFinite(centroid?.y)
  if (x != null && y != null) {
    if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return { lat: y, lon: x }
    return webMercatorToLonLat(x, y)
  }
  return null
}

export function webMercatorToLonLat(x: number, y: number): { lat: number; lon: number } {
  const lon = (x / 20037508.342789244) * 180
  const lat = (Math.atan(Math.sinh(y / 6378137)) * 180) / Math.PI
  return { lat, lon }
}

function nifcTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function nifcFeatureToFire(feature: GeoJsonFeature, minAcres: number): WeatherEvent | null {
  const props = nifcProps(feature)
  const pos = nifcCoords(feature)
  if (!pos) return null
  const acres = asFinite(props.IncidentSize) ?? asFinite(props.FinalAcres) ?? asFinite(props.GIS_ACRES)
  if (acres != null && acres < minAcres) return null
  const time =
    nifcTime(props.FireDiscoveryDateTime) ??
    yearStartMs(props.FIRE_YEAR_INT ?? props.FIRE_YEAR)
  if (time == null) return null
  const out = nifcTime(props.FireOutDateTime)
  const name = fireDisplayName(typeof props.IncidentName === 'string' ? props.IncidentName : typeof props.INCIDENT === 'string' ? props.INCIDENT : null)
  const state = typeof props.POOState === 'string' ? props.POOState.replace(/^US-/, '') : ''
  const county = typeof props.POOCounty === 'string' ? props.POOCounty : ''
  const place = [name, county, state].filter(Boolean).join(', ') || 'Wildfire'
  const id =
    typeof props.UniqueFireIdentifier === 'string'
      ? props.UniqueFireIdentifier
      : typeof props.UNQE_FIRE_ID === 'string'
        ? props.UNQE_FIRE_ID
        : `${time}-${pos.lat}-${pos.lon}`
  return {
    id: `nifc:${id}`,
    kind: 'fire',
    time,
    endTime: out != null && out > time ? out : time,
    lat: pos.lat,
    lon: pos.lon,
    place,
    name,
    efRating: null,
    category: null,
    windKt: null,
    acres,
    deaths: null,
    injuries: null,
    url: 'https://data-nifc.opendata.arcgis.com/',
    track: null,
    source: 'nifc',
  }
}

export function perimeterFeatureToFire(feature: GeoJsonFeature, minAcres: number): WeatherEvent | null {
  const props = nifcProps(feature)
  const acres = asFinite(props.GIS_ACRES)
  if (acres == null || acres < minAcres) return null
  const year = asFinite(props.FIRE_YEAR_INT) ?? Number.parseInt(String(props.FIRE_YEAR ?? ''), 10)
  if (!Number.isFinite(year) || year < 1900) return null
  const pos = nifcCoords(feature)
  if (!pos) return null
  const time = Date.UTC(year, 6, 1)
  const name = fireDisplayName(typeof props.INCIDENT === 'string' ? props.INCIDENT : null)
  const id = typeof props.UNQE_FIRE_ID === 'string' ? props.UNQE_FIRE_ID : `${year}-${pos.lat}-${pos.lon}`
  return {
    id: `nifc:${id}`,
    kind: 'fire',
    time,
    endTime: Date.UTC(year, 8, 1),
    lat: pos.lat,
    lon: pos.lon,
    place: name ? `${name} (${year})` : `Wildfire ${year}`,
    name,
    efRating: null,
    category: null,
    windKt: null,
    acres,
    deaths: null,
    injuries: null,
    url: 'https://data-nifc.opendata.arcgis.com/datasets/nifc::interagencyfireperimeterhistory-all-years-view',
    track: null,
    source: 'nifc',
  }
}

function yearStartMs(value: unknown): number | null {
  const year = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(year) || year < 1900 || year > 2100) return null
  return Date.UTC(year, 6, 1)
}

export function mergeFireCatalogs(primary: WeatherEvent[], extra: WeatherEvent[]): WeatherEvent[] {
  const events = [...primary]
  const seen = new Set(primary.map((event) => event.id))
  const keys = new Set(
    primary.map((event) => fireDedupeKey(event)),
  )
  for (let i = 0; i < extra.length; i += 1) {
    const event = extra[i]
    if (seen.has(event.id)) continue
    const key = fireDedupeKey(event)
    if (keys.has(key)) continue
    seen.add(event.id)
    keys.add(key)
    events.push(event)
  }
  return sortWeatherByTime(events)
}

function fireDedupeKey(event: WeatherEvent): string {
  const name = (event.name ?? '').toUpperCase()
  const lat = event.lat.toFixed(1)
  const lon = event.lon.toFixed(1)
  const year = new Date(event.time).getUTCFullYear()
  if (name) return `${name}|${year}`
  return `${lat}|${lon}|${year}`
}

async function loadLiveEonet(): Promise<WeatherEvent[]> {
  const results = await Promise.allSettled([fetchJson(EONET_OPEN), fetchJson(EONET_WEEK)])
  const events: WeatherEvent[] = []
  const seen = new Set<string>()
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]
    if (result.status !== 'fulfilled') continue
    for (const raw of (result.value as EonetFeed).events ?? []) {
      const event = eonetEventToFire(raw)
      if (!event || seen.has(event.id)) continue
      seen.add(event.id)
      events.push(event)
    }
  }
  if (events.length === 0 && results.every((result) => result.status === 'rejected')) {
    throw new Error('EONET wildfire feed unavailable')
  }
  return events
}

async function loadLiveNifc(): Promise<WeatherEvent[]> {
  const body = (await fetchJson(NIFC_CURRENT)) as GeoJsonFeed
  const events: WeatherEvent[] = []
  const features = body.features ?? []
  const cap = Math.min(features.length, 2000)
  for (let i = 0; i < cap; i += 1) {
    const event = nifcFeatureToFire(features[i], LIVE_MIN_ACRES)
    if (event) events.push(event)
  }
  return events
}

export async function loadLiveFires(): Promise<WeatherEvent[]> {
  const results = await Promise.allSettled([loadLiveEonet(), loadLiveNifc()])
  const batches: WeatherEvent[][] = []
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]
    if (result.status === 'fulfilled') batches.push(result.value)
  }
  if (batches.length === 0) throw new Error('fire feeds unavailable')
  return mergeFireCatalogs(batches[0] ?? [], batches[1] ?? [])
}

export function eonetFeedToFires(body: unknown): WeatherEvent[] {
  const events: WeatherEvent[] = []
  for (const raw of (body as EonetFeed).events ?? []) {
    const event = eonetEventToFire(raw)
    if (event) events.push(event)
  }
  return events
}

export function nifcGeoJsonToFires(body: unknown, minAcres: number): WeatherEvent[] {
  const events: WeatherEvent[] = []
  for (const feature of (body as GeoJsonFeed).features ?? []) {
    const event = nifcFeatureToFire(feature, minAcres)
    if (event) events.push(event)
  }
  return events
}

export function nifcJsonToPerimeterFires(body: unknown, minAcres: number): WeatherEvent[] {
  const events: WeatherEvent[] = []
  for (const feature of (body as GeoJsonFeed).features ?? []) {
    const event = perimeterFeatureToFire(feature, minAcres)
    if (event) events.push(event)
  }
  return events
}
