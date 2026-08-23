export type PlaceHit = {
  label: string
  lat: number
  lon: number
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

function toPhotonHit(raw: PhotonFeature): PlaceHit | null {
  const coords = raw.geometry?.coordinates
  if (!coords || coords.length < 2) return null
  const lon = Number(coords[0])
  const lat = Number(coords[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const props = raw.properties
  const parts = [props?.name ?? props?.city, props?.state, props?.country]
  const label = parts.filter((part, i) => part && parts.indexOf(part) === i).join(', ')
  return { label: label || 'Unknown place', lat, lon }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
