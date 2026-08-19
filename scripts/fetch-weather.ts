import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  hurdat2ToHurricanes,
  ibtracsCsvToStorms,
  mergeCycloneCatalogs,
  spcCsvToTornadoes,
} from '../src/data/weatherParse.ts'
import {
  eonetFeedToFires,
  mergeFireCatalogs,
  nifcGeoJsonToFires,
  nifcJsonToPerimeterFires,
} from '../src/data/fire.ts'
import type { WeatherEvent } from '../src/data/types.ts'

// Snapshot sources (run via `npm run fetch-weather`):
// - SPC U.S. tornadoes (single-track): https://www.spc.noaa.gov/wcm/data/1950-2025_actual_tornadoes.csv
// - HURDAT2 Atlantic: https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-02272026.txt
// - HURDAT2 NE/NC Pacific: https://www.nhc.noaa.gov/data/hurdat/hurdat2-nepac-1949-2025-02272026.txt
// - IBTrACS basins not in HURDAT2 (WP typhoons + NI/SI/SP/SA cyclones):
//   https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/

const SPC_URLS = [
  'https://www.spc.noaa.gov/wcm/data/1950-2025_actual_tornadoes.csv',
  'https://www.spc.noaa.gov/wcm/data/1950-2024_actual_tornadoes.csv',
]
const HURDAT_ATLANTIC = 'https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-02272026.txt'
const HURDAT_PACIFIC = 'https://www.nhc.noaa.gov/data/hurdat/hurdat2-nepac-1949-2025-02272026.txt'
const IBTRACS_BASE =
  'https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv'
const IBTRACS_FILES = [
  'ibtracs.WP.list.v04r01.csv',
  'ibtracs.NI.list.v04r01.csv',
  'ibtracs.SI.list.v04r01.csv',
  'ibtracs.SP.list.v04r01.csv',
  'ibtracs.SA.list.v04r01.csv',
]
const NIFC_WFIGS =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations/FeatureServer/0/query?where=IncidentTypeCategory%3D%27WF%27%20AND%20IncidentSize%3E%3D10000&outFields=IncidentName,POOState,POOCounty,FireDiscoveryDateTime,FireOutDateTime,IncidentSize,FinalAcres,UniqueFireIdentifier&outSR=4326&f=geojson'
const NIFC_PERIMETERS =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0/query?where=GIS_ACRES%3E%3D10000%20AND%20FIRE_YEAR_INT%3C%3D2013&outFields=INCIDENT,GIS_ACRES,FIRE_YEAR,FIRE_YEAR_INT,UNQE_FIRE_ID&returnGeometry=false&returnCentroid=true&outSR=4326&f=json'
const EONET_BASE = 'https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=all&limit=1000'
const HISTORY_MIN_ACRES = 10000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'earthquakes-globe (github.com/pfaustino/earthquakes)' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.ok) return await response.text()
    if (response.status >= 500 || response.status === 429) {
      await delay(800 * (attempt + 1))
      continue
    }
    throw new Error(`${response.status} for ${url}`)
  }
  throw new Error(`Failed after retries: ${url}`)
}

async function fetchFirstOk(urls: string[]): Promise<string> {
  let lastError: unknown = null
  for (const url of urls) {
    try {
      console.log(`Fetching ${url}`)
      return await fetchText(url, 120000)
    } catch (error: unknown) {
      lastError = error
      console.warn(`  failed: ${error instanceof Error ? error.message : error}`)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All URLs failed')
}

function writeJson(root: string, file: string, events: WeatherEvent[]): void {
  const outDir = join(root, 'public', 'data')
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, file)
  writeFileSync(outFile, JSON.stringify(events))
  console.log(`Wrote ${events.length} events to ${outFile}`)
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  return JSON.parse(await fetchText(url, timeoutMs))
}

async function fetchArcgisPages(baseUrl: string): Promise<{ features?: unknown[] }> {
  const features: unknown[] = []
  let offset = 0
  for (let page = 0; page < 8; page += 1) {
    const joiner = baseUrl.includes('?') ? '&' : '?'
    const url = `${baseUrl}${joiner}resultOffset=${offset}&resultRecordCount=2000`
    console.log(`Fetching ${url}`)
    const body = (await fetchJson(url, 120000)) as { features?: unknown[]; exceededTransferLimit?: boolean }
    const batch = body.features ?? []
    features.push(...batch)
    if (!body.exceededTransferLimit || batch.length === 0) break
    offset += batch.length
    await delay(80)
  }
  return { features }
}

function keepHistoryEonet(event: WeatherEvent): boolean {
  if (event.name) return true
  return (event.acres ?? 0) >= 5000
}

function eonetBodyToFires(body: unknown): { rawCount: number; events: WeatherEvent[] } {
  const rawCount = Array.isArray((body as { events?: unknown[] }).events)
    ? ((body as { events: unknown[] }).events.length)
    : 0
  return { rawCount, events: eonetFeedToFires(body).filter(keepHistoryEonet) }
}

async function fetchEonetSpan(startMs: number, endMs: number): Promise<{ rawCount: number; events: WeatherEvent[] }> {
  const start = new Date(startMs).toISOString().slice(0, 10)
  const end = new Date(endMs).toISOString().slice(0, 10)
  const url = `${EONET_BASE}&start=${start}&end=${end}`
  console.log(`Fetching ${url}`)
  return eonetBodyToFires(await fetchJson(url, 60000))
}

async function fetchEonetYear(year: number, now: number): Promise<WeatherEvent[]> {
  const yearStart = Date.UTC(year, 0, 1)
  const yearEnd = Math.min(now, Date.UTC(year, 11, 31))
  const first = await fetchEonetSpan(yearStart, yearEnd)
  if (first.rawCount < 1000) return first.events

  let events: WeatherEvent[] = []
  for (let month = 0; month < 12; month += 1) {
    const monthStart = Date.UTC(year, month, 1)
    if (monthStart > yearEnd) break
    const monthEnd = Math.min(yearEnd, Date.UTC(year, month + 1, 0))
    const batch = await fetchEonetSpan(monthStart, monthEnd)
    if (batch.rawCount < 1000) {
      events = mergeFireCatalogs(events, batch.events)
    } else {
      for (let day = 1; day <= 31; day += 7) {
        const weekStart = Date.UTC(year, month, day)
        if (weekStart > monthEnd) break
        const weekEnd = Math.min(monthEnd, Date.UTC(year, month, day + 6))
        const week = await fetchEonetSpan(weekStart, weekEnd)
        events = mergeFireCatalogs(events, week.events)
        await delay(80)
      }
    }
    await delay(80)
  }
  return events
}

async function fetchFireSnapshot(root: string): Promise<void> {
  let wfigs: WeatherEvent[] = []
  try {
    wfigs = nifcGeoJsonToFires(await fetchArcgisPages(NIFC_WFIGS), HISTORY_MIN_ACRES)
    console.log(`  ${wfigs.length} NIFC WFIGS 10k+ acre fires`)
  } catch (error: unknown) {
    console.warn(`  WFIGS skipped: ${error instanceof Error ? error.message : error}`)
  }

  let perimeters: WeatherEvent[] = []
  try {
    perimeters = nifcJsonToPerimeterFires(await fetchArcgisPages(NIFC_PERIMETERS), HISTORY_MIN_ACRES)
    console.log(`  ${perimeters.length} NIFC pre-2014 10k+ acre perimeters`)
  } catch (error: unknown) {
    console.warn(`  Perimeters skipped: ${error instanceof Error ? error.message : error}`)
  }

  let eonet: WeatherEvent[] = []
  const now = Date.now()
  for (let year = 2000; year <= new Date(now).getUTCFullYear(); year += 1) {
    try {
      const batch = await fetchEonetYear(year, now)
      console.log(`  EONET ${year}: ${batch.length}`)
      eonet = mergeFireCatalogs(eonet, batch)
    } catch (error: unknown) {
      console.warn(`  EONET ${year} skipped: ${error instanceof Error ? error.message : error}`)
    }
    await delay(80)
  }

  if (wfigs.length === 0 && perimeters.length === 0 && eonet.length === 0) {
    throw new Error('no fire catalogs downloaded')
  }
  const fires = mergeFireCatalogs(mergeFireCatalogs(wfigs, perimeters), eonet)
  writeJson(root, 'fires-significant.json', fires)
}

async function fetchTornadoSnapshot(root: string): Promise<void> {
  const tornadoCsv = await fetchFirstOk(SPC_URLS)
  const tornadoes = spcCsvToTornadoes(tornadoCsv)
  writeJson(root, 'tornadoes-significant.json', tornadoes)
}

async function main(): Promise<void> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const firesOnly = process.argv.includes('--fires')
  const tornadoesOnly = process.argv.includes('--tornadoes')

  if (tornadoesOnly) {
    await fetchTornadoSnapshot(root)
    return
  }

  if (!firesOnly) {
    await fetchTornadoSnapshot(root)

    console.log(`Fetching ${HURDAT_ATLANTIC}`)
    const atlantic = hurdat2ToHurricanes(await fetchText(HURDAT_ATLANTIC, 120000))
    console.log(`  ${atlantic.length} Atlantic Cat 1+ (1900+)`)
    await delay(80)
    console.log(`Fetching ${HURDAT_PACIFIC}`)
    const pacific = hurdat2ToHurricanes(await fetchText(HURDAT_PACIFIC, 120000))
    console.log(`  ${pacific.length} East/Central Pacific Cat 1+ (1900+)`)

    let ibtracs: WeatherEvent[] = []
    for (const file of IBTRACS_FILES) {
      const url = `${IBTRACS_BASE}/${file}`
      try {
        console.log(`Fetching ${url}`)
        const storms = ibtracsCsvToStorms(await fetchText(url, 300000), 64)
        console.log(`  ${storms.length} Cat 1+ from ${file}`)
        ibtracs = mergeCycloneCatalogs(ibtracs, storms)
      } catch (error: unknown) {
        console.warn(`  skipped ${file}: ${error instanceof Error ? error.message : error}`)
      }
      await delay(80)
    }

    const wpCount = ibtracs.filter((event) => (event.basin ?? '').toUpperCase() === 'WP').length
    console.log(`IBTrACS extra basins: ${ibtracs.length} (${wpCount} WP typhoons)`)

    const storms = mergeCycloneCatalogs([...atlantic, ...pacific], ibtracs)
    writeJson(root, 'hurricanes-significant.json', storms)
  }

  try {
    await fetchFireSnapshot(root)
  } catch (error: unknown) {
    console.warn(`Fires snapshot skipped: ${error instanceof Error ? error.message : error}`)
    if (firesOnly) throw error instanceof Error ? error : new Error('fire fetch failed')
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
