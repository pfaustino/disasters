import type { WeatherEvent, WeatherTrackPoint } from './types.ts'

export function asFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function windToCategory(windKt: number): number {
  if (windKt >= 137) return 5
  if (windKt >= 113) return 4
  if (windKt >= 96) return 3
  if (windKt >= 83) return 2
  if (windKt >= 64) return 1
  return 0
}

export function sortWeatherByTime(events: WeatherEvent[]): WeatherEvent[] {
  return events.slice().sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
}

export function cycloneWord(event: WeatherEvent): 'Hurricane' | 'Typhoon' | 'Cyclone' {
  return cycloneWordForBasin(event.basin ?? basinFromId(event.id))
}

export function cycloneWordForBasin(basin: string | null | undefined): 'Hurricane' | 'Typhoon' | 'Cyclone' {
  const code = (basin ?? '').toUpperCase()
  if (code === 'WP') return 'Typhoon'
  if (code === 'NI' || code === 'SI' || code === 'SP' || code === 'SA') return 'Cyclone'
  return 'Hurricane'
}

export function basinFromId(id: string): string | null {
  const hurdat = id.match(/^hurdat:([A-Za-z]{2})/)
  if (hurdat) {
    const code = hurdat[1].toUpperCase()
    return code === 'AL' ? 'NA' : code
  }
  const nhc = id.match(/^nhc:([A-Za-z]{2})/)
  if (nhc) {
    const code = nhc[1].toUpperCase()
    return code === 'AL' ? 'NA' : code
  }
  return null
}

export function cyclonePlace(basin: string | null | undefined, named: string | null, category: number): string {
  const word = cycloneWordForBasin(basin)
  if (named) return `${word} ${named}`
  if (category >= 1) return `Category ${category} ${word.toLowerCase()}`
  return word
}

export function parseSignedHemisphere(token: string, positive: string, negative: string): number | null {
  const text = token.trim()
  if (text.length < 2) return null
  const hemi = text.slice(-1).toUpperCase()
  const mag = Number(text.slice(0, -1))
  if (!Number.isFinite(mag)) return null
  if (hemi === positive) return mag
  if (hemi === negative) return -mag
  return null
}

export function downsampleTrack(points: WeatherTrackPoint[], maxPoints: number): WeatherTrackPoint[] {
  if (points.length <= maxPoints) return points
  const kept: WeatherTrackPoint[] = []
  const last = maxPoints - 1
  for (let i = 0; i <= last; i += 1) {
    const index = Math.round((i * (points.length - 1)) / last)
    kept.push(points[index])
  }
  let peakIndex = 0
  let peakWind = -1
  for (let i = 0; i < points.length; i += 1) {
    const wind = points[i].windKt ?? -1
    if (wind > peakWind) {
      peakWind = wind
      peakIndex = i
    }
  }
  const peak = points[peakIndex]
  if (peak && !kept.some((point) => point.time === peak.time)) {
    kept[Math.min(kept.length - 1, 1)] = peak
    kept.sort((a, b) => a.time - b.time)
  }
  return kept
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      quoted = !quoted
      continue
    }
    if (ch === ',' && !quoted) {
      fields.push(current)
      current = ''
      continue
    }
    current += ch
  }
  fields.push(current)
  return fields
}

function headerIndex(header: string[], name: string): number {
  return header.findIndex((col) => col.trim().toLowerCase() === name)
}

const CST_OFFSET_MS = 6 * 60 * 60 * 1000

export function spcCsvToTornadoes(csv: string): WeatherEvent[] {
  const lines = csv.split(/\r?\n/)
  if (lines.length < 2) return []
  const header = splitCsvLine(lines[0]).map((col) => col.trim().toLowerCase())
  const yr = headerIndex(header, 'yr')
  const mo = headerIndex(header, 'mo')
  const dy = headerIndex(header, 'dy')
  const timeIdx = headerIndex(header, 'time')
  const tzIdx = headerIndex(header, 'tz')
  const stIdx = headerIndex(header, 'st')
  const magIdx = headerIndex(header, 'mag')
  const injIdx = headerIndex(header, 'inj')
  const fatIdx = headerIndex(header, 'fat')
  const slatIdx = headerIndex(header, 'slat')
  const slonIdx = headerIndex(header, 'slon')
  const elatIdx = headerIndex(header, 'elat')
  const elonIdx = headerIndex(header, 'elon')
  const omIdx = headerIndex(header, 'om')
  if (yr < 0 || mo < 0 || dy < 0 || slatIdx < 0 || slonIdx < 0 || magIdx < 0) return []

  const events: WeatherEvent[] = []
  // SPC actual-tornado CSV; keep EF2+ / F2+ only (mag >= 2). Unknown ratings are -9.
  const limit = Math.min(lines.length, 200_000)
  for (let i = 1; i < limit; i += 1) {
    const line = lines[i]
    if (!line) continue
    const cols = splitCsvLine(line)
    const mag = Number(cols[magIdx])
    if (!Number.isFinite(mag) || mag < 2) continue
    const year = Number(cols[yr])
    const month = Number(cols[mo])
    const day = Number(cols[dy])
    const lat = Number(cols[slatIdx])
    const lon = Number(cols[slonIdx])
    if (!Number.isFinite(year) || year < 1950) continue
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue

    const clock = timeIdx >= 0 ? cols[timeIdx].trim() : '12:00:00'
    const parts = clock.split(':')
    const hour = Number(parts[0])
    const minute = Number(parts[1] ?? 0)
    const second = Number(parts[2] ?? 0)
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue
    const tz = tzIdx >= 0 ? Number(cols[tzIdx]) : 3
    let time = Date.UTC(year, month - 1, day, hour, minute || 0, second || 0)
    // tz 9 = GMT; otherwise treat as CST (standard SPC convention).
    if (tz !== 9) time += CST_OFFSET_MS

    const endLat = elatIdx >= 0 ? Number(cols[elatIdx]) : Number.NaN
    const endLon = elonIdx >= 0 ? Number(cols[elonIdx]) : Number.NaN
    const hasPath =
      Number.isFinite(endLat) &&
      Number.isFinite(endLon) &&
      (Math.abs(endLat - lat) > 0.01 || Math.abs(endLon - lon) > 0.01)
    const om = omIdx >= 0 ? cols[omIdx].trim() : String(i)
    const state = stIdx >= 0 ? cols[stIdx].trim() : ''
    const deaths = fatIdx >= 0 ? Number(cols[fatIdx]) : Number.NaN
    const injuries = injIdx >= 0 ? Number(cols[injIdx]) : Number.NaN
    const track: WeatherTrackPoint[] | null = hasPath
      ? [
          { time, lat, lon, windKt: null },
          { time: time + 15 * 60 * 1000, lat: endLat, lon: endLon, windKt: null },
        ]
      : null

    events.push({
      id: `spc:${year}-${om}-${lat.toFixed(2)}-${lon.toFixed(2)}`,
      kind: 'tornado',
      time,
      endTime: hasPath ? time + 15 * 60 * 1000 : time,
      lat,
      lon,
      place: state ? `EF${Math.floor(mag)} tornado, ${state}` : `EF${Math.floor(mag)} tornado`,
      name: null,
      efRating: Math.min(5, Math.floor(mag)),
      category: null,
      windKt: null,
      acres: null,
      deaths: Number.isFinite(deaths) ? deaths : null,
      injuries: Number.isFinite(injuries) ? injuries : null,
      url: 'https://www.spc.noaa.gov/wcm/#data',
      track,
      source: 'spc',
    })
  }
  return sortWeatherByTime(events)
}

function parseHurdatTime(ymd: string, hhmm: string): number | null {
  if (ymd.length < 8 || hhmm.length < 3) return null
  const year = Number(ymd.slice(0, 4))
  const month = Number(ymd.slice(4, 6))
  const day = Number(ymd.slice(6, 8))
  const padded = hhmm.trim().padStart(4, '0')
  const hour = Number(padded.slice(0, 2))
  const minute = Number(padded.slice(2, 4))
  if (!Number.isFinite(year) || year < 1900) return null
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(hour)) return null
  return Date.UTC(year, month - 1, day, hour, minute || 0, 0)
}

export function hurdat2ToHurricanes(text: string): WeatherEvent[] {
  const lines = text.split(/\r?\n/)
  const events: WeatherEvent[] = []
  let i = 0
  // Header + 6-hourly rows. Keep storms that reached Cat 1 (64 kt) from 1900 onward.
  const limit = Math.min(lines.length, 400_000)
  while (i < limit) {
    const header = lines[i]
    i += 1
    if (!header || !header.includes(',')) continue
    const headerCols = header.split(',')
    const stormId = headerCols[0]?.trim()
    const name = headerCols[1]?.trim()
    const count = Number(headerCols[2])
    if (!stormId || stormId.length < 8 || !Number.isFinite(count) || count < 1) continue

    const points: WeatherTrackPoint[] = []
    let maxWind = 0
    let peakLat = 0
    let peakLon = 0
    const rowCap = Math.min(count, 400)
    for (let n = 0; n < rowCap && i < limit; n += 1) {
      const row = lines[i]
      i += 1
      if (!row) continue
      const cols = row.split(',')
      const time = parseHurdatTime(cols[0]?.trim() ?? '', cols[1]?.trim() ?? '')
      const lat = parseSignedHemisphere(cols[4] ?? '', 'N', 'S')
      const lon = parseSignedHemisphere(cols[5] ?? '', 'E', 'W')
      const wind = Number(cols[6])
      if (time == null || lat == null || lon == null) continue
      const windKt = Number.isFinite(wind) && wind >= 0 ? wind : null
      points.push({ time, lat, lon, windKt })
      if (windKt != null && windKt > maxWind) {
        maxWind = windKt
        peakLat = lat
        peakLon = lon
      }
    }
    if (maxWind < 64 || points.length === 0) continue
    const track = downsampleTrack(points, 24)
    const start = points[0]
    const end = points[points.length - 1]
    const category = windToCategory(maxWind)
    const named = name && name.toUpperCase() !== 'UNNAMED' ? name : null
    const basin = stormId.slice(0, 2).toUpperCase() === 'AL' ? 'NA' : stormId.slice(0, 2).toUpperCase()
    events.push({
      id: `hurdat:${stormId}`,
      kind: 'hurricane',
      time: start.time,
      endTime: end.time,
      lat: peakLat || start.lat,
      lon: peakLon || start.lon,
      place: cyclonePlace(basin, named, category),
      name: named,
      efRating: null,
      category,
      windKt: maxWind,
      acres: null,
      deaths: null,
      injuries: null,
      url: 'https://www.nhc.noaa.gov/data/',
      track,
      source: 'hurdat',
      basin,
    })
  }
  return sortWeatherByTime(events)
}

export function polygonCentroid(ring: number[][]): { lat: number; lon: number } | null {
  if (!ring || ring.length < 3) return null
  let lon = 0
  let lat = 0
  let count = 0
  const cap = Math.min(ring.length, 256)
  for (let i = 0; i < cap; i += 1) {
    const pair = ring[i]
    if (!pair || pair.length < 2) continue
    const x = asFinite(pair[0])
    const y = asFinite(pair[1])
    if (x == null || y == null) continue
    lon += x
    lat += y
    count += 1
  }
  if (count === 0) return null
  return { lon: lon / count, lat: lat / count }
}

function ibtracsNamed(name: string | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  const upper = trimmed.toUpperCase()
  if (upper === 'UNNAMED' || upper === 'NOT_NAMED' || upper === 'INVEST' || upper === 'UNKNOWN') return null
  return trimmed
}

function parseIsoTime(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  const iso = text.includes('T') ? text : text.replace(' ', 'T')
  const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`)
  return Number.isFinite(ms) ? ms : null
}

function wrapLon(lon: number): number {
  if (lon > 180) return lon - 360
  if (lon < -180) return lon + 360
  return lon
}

function rowWind(cols: string[], windIdx: number[]): number {
  let max = 0
  for (let i = 0; i < windIdx.length; i += 1) {
    const wind = Number(cols[windIdx[i]])
    if (Number.isFinite(wind) && wind > max) max = wind
  }
  return max
}

type IbtracsAcc = {
  sid: string
  season: number
  name: string | null
  basin: string
  points: WeatherTrackPoint[]
  maxWind: number
  peakLat: number
  peakLon: number
}

function flushIbtracs(acc: IbtracsAcc | null, minWindKt: number, out: WeatherEvent[]): void {
  if (!acc || acc.maxWind < minWindKt || acc.season < 1900 || acc.points.length === 0) return
  const track = downsampleTrack(acc.points, 24)
  const start = acc.points[0]
  const end = acc.points[acc.points.length - 1]
  const category = windToCategory(acc.maxWind)
  out.push({
    id: `ibtracs:${acc.sid}`,
    kind: 'hurricane',
    time: start.time,
    endTime: end.time,
    lat: acc.peakLat || start.lat,
    lon: acc.peakLon || start.lon,
    place: cyclonePlace(acc.basin, acc.name, category),
    name: acc.name,
    efRating: null,
    category,
    windKt: acc.maxWind,
    acres: null,
    deaths: null,
    injuries: null,
    url: 'https://www.ncei.noaa.gov/products/international-best-track-archive',
    track,
    source: 'ibtracs',
    basin: acc.basin,
  })
}

export function ibtracsCsvToStorms(csv: string, minWindKt: number): WeatherEvent[] {
  const lines = csv.split(/\r?\n/)
  if (lines.length < 3) return []
  const header = splitCsvLine(lines[0].replace(/^\uFEFF/, '')).map((col) => col.trim())
  const sidIdx = headerIndex(header, 'sid')
  const seasonIdx = headerIndex(header, 'season')
  const basinIdx = headerIndex(header, 'basin')
  const nameIdx = headerIndex(header, 'name')
  const timeIdx = headerIndex(header, 'iso_time')
  const latIdx = headerIndex(header, 'lat')
  const lonIdx = headerIndex(header, 'lon')
  if (sidIdx < 0 || timeIdx < 0 || latIdx < 0 || lonIdx < 0) return []
  const windIdx: number[] = []
  for (let i = 0; i < header.length; i += 1) {
    const col = header[i].toUpperCase()
    if (col.endsWith('_WIND') && !col.includes('GUST')) windIdx.push(i)
  }

  const events: WeatherEvent[] = []
  let acc: IbtracsAcc | null = null
  // Two header rows (names, units), then 6-hourly points grouped by SID.
  const limit = Math.min(lines.length, 900_000)
  for (let i = 2; i < limit; i += 1) {
    const line = lines[i]
    if (!line) continue
    const cols = splitCsvLine(line)
    const sid = cols[sidIdx]?.trim()
    if (!sid) continue
    const time = parseIsoTime(cols[timeIdx] ?? '')
    const lat = Number(cols[latIdx])
    const lonRaw = Number(cols[lonIdx])
    if (time == null || !Number.isFinite(lat) || !Number.isFinite(lonRaw)) continue
    const lon = wrapLon(lonRaw)
    const wind = rowWind(cols, windIdx)
    const season = seasonIdx >= 0 ? Number(cols[seasonIdx]) : new Date(time).getUTCFullYear()
    const basin = basinIdx >= 0 ? cols[basinIdx].trim().toUpperCase() : 'WP'
    const name = nameIdx >= 0 ? ibtracsNamed(cols[nameIdx]) : null

    if (!acc || acc.sid !== sid) {
      flushIbtracs(acc, minWindKt, events)
      acc = {
        sid,
        season: Number.isFinite(season) ? season : new Date(time).getUTCFullYear(),
        name,
        basin: basin || 'WP',
        points: [],
        maxWind: 0,
        peakLat: lat,
        peakLon: lon,
      }
    }
    if (name && !acc.name) acc.name = name
    acc.points.push({ time, lat, lon, windKt: wind > 0 ? wind : null })
    if (wind > acc.maxWind) {
      acc.maxWind = wind
      acc.peakLat = lat
      acc.peakLon = lon
      if (basin) acc.basin = basin
    }
  }
  flushIbtracs(acc, minWindKt, events)
  return sortWeatherByTime(events)
}

export function mergeCycloneCatalogs(primary: WeatherEvent[], extra: WeatherEvent[]): WeatherEvent[] {
  const keys = new Set<string>()
  const out: WeatherEvent[] = []
  for (let i = 0; i < primary.length; i += 1) {
    const event = primary[i]
    out.push(event)
    if (event.name) keys.add(`${new Date(event.time).getUTCFullYear()}:${event.name.toUpperCase()}`)
  }
  for (let i = 0; i < extra.length; i += 1) {
    const event = extra[i]
    const key = event.name ? `${new Date(event.time).getUTCFullYear()}:${event.name.toUpperCase()}` : ''
    if (key && keys.has(key)) continue
    out.push(event)
    if (key) keys.add(key)
  }
  return sortWeatherByTime(out)
}
