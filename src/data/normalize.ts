import type { NoaaItem, PagerAlert, QuakeEvent, UsgsFeature } from './types.ts'

const PAGER_ALERTS = new Set<PagerAlert>(['green', 'yellow', 'orange', 'red'])

function asFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function pickMag(item: NoaaItem): { mag: number; magType: string } | null {
  if (asFinite(item.eqMagMw) != null) return { mag: item.eqMagMw as number, magType: 'mw' }
  if (asFinite(item.eqMagMl) != null) return { mag: item.eqMagMl as number, magType: 'ml' }
  if (asFinite(item.eqMagMs) != null) return { mag: item.eqMagMs as number, magType: 'ms' }
  if (asFinite(item.eqMagMb) != null) return { mag: item.eqMagMb as number, magType: 'mb' }
  if (asFinite(item.eqMagnitude) != null) return { mag: item.eqMagnitude as number, magType: 'mw' }
  return null
}

function noaaTime(item: NoaaItem): number | null {
  const year = asFinite(item.year)
  if (year == null) return null
  return Date.UTC(
    year,
    (asFinite(item.month) ?? 1) - 1,
    asFinite(item.day) ?? 1,
    asFinite(item.hour) ?? 0,
    asFinite(item.minute) ?? 0,
    Math.floor(asFinite(item.second) ?? 0),
  )
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = asFinite(value)
    if (n != null) return n
  }
  return null
}

export function usgsFeatureToEvent(feature: UsgsFeature): QuakeEvent | null {
  const coords = feature.geometry?.coordinates
  if (!coords || coords.length < 2) return null
  const lon = asFinite(coords[0])
  const lat = asFinite(coords[1])
  const time = asFinite(feature.properties?.time)
  const mag = asFinite(feature.properties?.mag)
  if (lat == null || lon == null || time == null || mag == null) return null
  if (feature.properties?.type && feature.properties.type !== 'earthquake') return null

  const alert = feature.properties?.alert
  const pagerAlert = alert && PAGER_ALERTS.has(alert as PagerAlert) ? (alert as PagerAlert) : null

  return {
    id: `usgs:${feature.id ?? `${lon},${lat},${time}`}`,
    lat,
    lon,
    depthKm: asFinite(coords[2]),
    mag,
    magType: feature.properties?.magType ?? null,
    time,
    place: feature.properties?.place?.trim() || 'Unknown location',
    deaths: null,
    injuries: null,
    tsunami: feature.properties?.tsunami === 1,
    source: 'usgs',
    damageUsdMillions: null,
    housesDestroyed: null,
    housesDamaged: null,
    pagerAlert,
    country: null,
    url: feature.properties?.url ?? null,
  }
}

export function noaaItemToEvent(item: NoaaItem): QuakeEvent | null {
  const lat = asFinite(item.latitude)
  const lon = asFinite(item.longitude)
  const time = noaaTime(item)
  const mag = pickMag(item)
  if (lat == null || lon == null || time == null || mag == null) return null

  return {
    id: `noaa:${item.id ?? `${lon},${lat},${time}`}`,
    lat,
    lon,
    depthKm: asFinite(item.eqDepth),
    mag: mag.mag,
    magType: mag.magType,
    time,
    place: item.locationName?.trim() || item.country || 'Unknown location',
    deaths: firstNumber(item.deathsTotal, item.deaths),
    injuries: firstNumber(item.injuriesTotal, item.injuries),
    tsunami: asFinite(item.tsunamiEventId) != null,
    source: 'noaa',
    damageUsdMillions: firstNumber(item.damageMillionsDollarsTotal, item.damageMillionsDollars),
    housesDestroyed: firstNumber(item.housesDestroyedTotal, item.housesDestroyed),
    housesDamaged: firstNumber(item.housesDamagedTotal, item.housesDamaged),
    pagerAlert: null,
    country: item.country ?? null,
    url: item.id != null
      ? `https://www.ngdc.noaa.gov/hazel/view/hazards/earthquake/event-more-info/${item.id}`
      : null,
  }
}

export function sortByTime(events: QuakeEvent[]): QuakeEvent[] {
  return events.slice().sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
}
