import type { PlaceBBox, PlaceHit } from './geocode.ts'
import type { QuakeEvent, WeatherEvent } from './types.ts'

export const CITY_RADIUS_KM = 80
export const REGION_RADIUS_KM = 250

export type PlaceArea =
  | { kind: 'bbox'; bbox: PlaceBBox }
  | { kind: 'radius'; lat: number; lon: number; radiusKm: number }

export type PlaceMatch = {
  time: number
  lat: number
  lon: number
  quake: QuakeEvent | null
  weather: WeatherEvent | null
}

export type LayerFlags = {
  earthquakes: boolean
  tornadoes: boolean
  hurricanes: boolean
  fires: boolean
}

export function areaFromPlace(hit: PlaceHit): PlaceArea {
  if (hit.bbox) return { kind: 'bbox', bbox: hit.bbox }
  return {
    kind: 'radius',
    lat: hit.lat,
    lon: hit.lon,
    radiusKm: hit.kind === 'region' ? REGION_RADIUS_KM : CITY_RADIUS_KM,
  }
}

export function matchPlaceEvents(
  hit: PlaceHit,
  quakes: QuakeEvent[],
  weather: WeatherEvent[],
  layers: LayerFlags,
): PlaceMatch[] {
  const area = areaFromPlace(hit)
  const matches: PlaceMatch[] = []
  if (layers.earthquakes) {
    const cap = Math.min(quakes.length, 50_000)
    for (let i = 0; i < cap; i += 1) {
      const quake = quakes[i]
      if (!pointInArea(quake.lat, quake.lon, area)) continue
      matches.push({ time: quake.time, lat: quake.lat, lon: quake.lon, quake, weather: null })
    }
  }
  const weatherCap = Math.min(weather.length, 50_000)
  for (let i = 0; i < weatherCap; i += 1) {
    const event = weather[i]
    if (event.kind === 'tornado' && !layers.tornadoes) continue
    if (event.kind === 'hurricane' && !layers.hurricanes) continue
    if (event.kind === 'fire' && !layers.fires) continue
    const at = weatherMatchPoint(event, area)
    if (!at) continue
    matches.push({ time: at.time, lat: at.lat, lon: at.lon, quake: null, weather: event })
  }
  matches.sort((a, b) => a.time - b.time)
  return matches
}

export function samePlaceMatch(a: PlaceMatch, b: PlaceMatch): boolean {
  if (a.quake && b.quake) return a.quake.id === b.quake.id
  if (a.weather && b.weather) return a.weather.id === b.weather.id
  return false
}

function weatherMatchPoint(
  event: WeatherEvent,
  area: PlaceArea,
): { time: number; lat: number; lon: number } | null {
  if (event.kind === 'hurricane' && event.track && event.track.length > 0) {
    for (let i = 0; i < event.track.length; i += 1) {
      const point = event.track[i]
      if (pointInArea(point.lat, point.lon, area)) {
        return { time: point.time, lat: point.lat, lon: point.lon }
      }
    }
  }
  if (pointInArea(event.lat, event.lon, area)) {
    return { time: event.time, lat: event.lat, lon: event.lon }
  }
  return null
}

export function pointInArea(lat: number, lon: number, area: PlaceArea): boolean {
  if (area.kind === 'bbox') return pointInBBox(lat, lon, area.bbox)
  return distanceKm(lat, lon, area.lat, area.lon) <= area.radiusKm
}

function pointInBBox(lat: number, lon: number, bbox: PlaceBBox): boolean {
  if (lat < bbox.minLat || lat > bbox.maxLat) return false
  if (bbox.minLon <= bbox.maxLon) return lon >= bbox.minLon && lon <= bbox.maxLon
  return lon >= bbox.minLon || lon <= bbox.maxLon
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dPhi = ((lat2 - lat1) * Math.PI) / 180
  const dLam = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLam / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
