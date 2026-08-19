export type CatalogSource = 'usgs' | 'noaa'

export type PagerAlert = 'green' | 'yellow' | 'orange' | 'red'

export type QuakeEvent = {
  id: string
  lat: number
  lon: number
  depthKm: number | null
  mag: number | null
  magType: string | null
  time: number
  place: string
  deaths: number | null
  injuries: number | null
  tsunami: boolean
  source: CatalogSource
  damageUsdMillions: number | null
  housesDestroyed: number | null
  housesDamaged: number | null
  pagerAlert: PagerAlert | null
  country: string | null
  url: string | null
}

export type UsgsFeature = {
  id?: string
  geometry?: {
    coordinates?: number[]
  }
  properties?: {
    mag?: number | null
    magType?: string | null
    place?: string | null
    time?: number | null
    tsunami?: number | null
    alert?: string | null
    url?: string | null
    type?: string | null
  }
}

export type NoaaItem = {
  id?: number
  year?: number
  month?: number
  day?: number
  hour?: number
  minute?: number
  second?: number
  locationName?: string
  latitude?: number
  longitude?: number
  eqDepth?: number
  eqMagnitude?: number
  eqMagMw?: number
  eqMagMs?: number
  eqMagMb?: number
  eqMagMl?: number
  deaths?: number
  deathsTotal?: number
  injuries?: number
  injuriesTotal?: number
  tsunamiEventId?: number
  damageMillionsDollars?: number
  damageMillionsDollarsTotal?: number
  housesDestroyed?: number
  housesDestroyedTotal?: number
  housesDamaged?: number
  housesDamagedTotal?: number
  country?: string
}
