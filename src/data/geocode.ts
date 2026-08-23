export type PlaceKind = 'city' | 'region'

export type PlaceBBox = {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

export type PlaceHit = {
  label: string
  name: string
  lat: number
  lon: number
  bbox: PlaceBBox | null
  kind: PlaceKind
}

// Nominatim (openstreetmap.org) is the usual no-key geocoder, but it does not
// send Access-Control-Allow-Origin, so a browser fetch cannot read the
// response. Browsers also forbid setting User-Agent. This repo has no Vite
// proxy. Photon (photon.komoot.io) is the OSM-data fallback: CORS-friendly,
// no API key. Debounce + ~1 req/s still apply.
const PHOTON_URL = 'https://photon.komoot.io/api/'
const DEBOUNCE_MS = 400
const MIN_INTERVAL_MS = 1100
const LIMIT = 5
const FETCH_MS = 12000

type PhotonFeature = {
  geometry?: { coordinates?: number[] }
  properties?: {
    name?: string
    city?: string
    state?: string
    country?: string
    type?: string
    osm_key?: string
    osm_value?: string
    extent?: number[]
  }
}

type PhotonFeed = {
  features?: PhotonFeature[]
}

export class PlaceSearcher {
  private timer = 0
  private lastAt = 0
  private generation = 0
  private readonly onUpdate: (hits: PlaceHit[], status: string | null) => void

  constructor(onUpdate: (hits: PlaceHit[], status: string | null) => void) {
    this.onUpdate = onUpdate
  }

  setQuery(raw: string): void {
    window.clearTimeout(this.timer)
    const query = raw.trim()
    if (query.length < 2) {
      this.generation += 1
      this.onUpdate([], null)
      return
    }
    this.timer = window.setTimeout(() => {
      void this.run(query)
    }, DEBOUNCE_MS)
  }

  cancel(): void {
    window.clearTimeout(this.timer)
    this.generation += 1
    this.onUpdate([], null)
  }

  private async run(query: string): Promise<void> {
    const gen = ++this.generation
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - this.lastAt))
    if (wait > 0) await sleep(wait)
    if (gen !== this.generation) return
    this.onUpdate([], 'Searching…')
    this.lastAt = Date.now()
    try {
      const hits = await searchPhoton(query)
      if (gen !== this.generation) return
      this.onUpdate(hits, hits.length === 0 ? 'No places found' : null)
    } catch {
      if (gen !== this.generation) return
      this.onUpdate([], 'Place search unavailable')
    }
  }
}

async function searchPhoton(query: string): Promise<PlaceHit[]> {
  const url = new URL(PHOTON_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(LIMIT))
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) })
  if (!response.ok) throw new Error(`Photon failed (${response.status})`)
  const body = (await response.json()) as PhotonFeed
  const features = body.features ?? []
  const hits: PlaceHit[] = []
  for (let i = 0; i < features.length; i += 1) {
    const hit = toPhotonHit(features[i])
    if (hit) hits.push(hit)
  }
  return hits
}

const REGION_TYPES = new Set([
  'country',
  'state',
  'county',
  'region',
  'province',
  'municipality',
  'district',
  'continent',
  'archipelago',
])

function toPhotonHit(raw: PhotonFeature): PlaceHit | null {
  const coords = raw.geometry?.coordinates
  if (!coords || coords.length < 2) return null
  const lon = Number(coords[0])
  const lat = Number(coords[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const props = raw.properties
  const name = props?.name ?? props?.city ?? ''
  const parts = [name || null, props?.state, props?.country]
  const label = parts.filter((part, i) => part && parts.indexOf(part) === i).join(', ')
  return {
    label: label || 'Unknown place',
    name: name || label || 'Unknown place',
    lat,
    lon,
    bbox: parseExtent(props?.extent),
    kind: placeKind(props),
  }
}

function placeKind(props: PhotonFeature['properties']): PlaceKind {
  const type = (props?.type ?? '').toLowerCase()
  const value = (props?.osm_value ?? '').toLowerCase()
  if (REGION_TYPES.has(type) || REGION_TYPES.has(value)) return 'region'
  if ((props?.osm_key ?? '').toLowerCase() === 'boundary' && value === 'administrative') {
    if (type === 'city' || type === 'town' || type === 'village' || type === 'suburb') return 'city'
    return 'region'
  }
  return 'city'
}

// Photon extent is [west, north, east, south] in examples; take min/max so
// either lat order works. A lon span over 180° is treated as antimeridian wrap.
function parseExtent(extent: number[] | undefined): PlaceBBox | null {
  if (!extent || extent.length < 4) return null
  const west = Number(extent[0])
  const latA = Number(extent[1])
  const east = Number(extent[2])
  const latB = Number(extent[3])
  if (![west, latA, east, latB].every(Number.isFinite)) return null
  const minLat = Math.min(latA, latB)
  const maxLat = Math.max(latA, latB)
  if (minLat < -90 || maxLat > 90) return null
  if (Math.abs(east - west) <= 180) {
    return { minLat, maxLat, minLon: Math.min(west, east), maxLon: Math.max(west, east) }
  }
  return { minLat, maxLat, minLon: Math.max(west, east), maxLon: Math.min(west, east) }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
