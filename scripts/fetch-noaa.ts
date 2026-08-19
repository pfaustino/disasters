import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noaaItemToEvent } from '../src/data/normalize.ts'
import type { NoaaItem, QuakeEvent } from '../src/data/types.ts'

const BASE = 'https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/earthquakes'
const PAGE_SIZE = 200
const MIN_YEAR = 1900

type HazelPage = {
  items?: NoaaItem[]
  page?: number
  totalPages?: number
  totalItems?: number
}

async function fetchPage(page: number): Promise<HazelPage> {
  const url = `${BASE}?minYear=${MIN_YEAR}&page=${page}&itemsPerPage=${PAGE_SIZE}`
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    })
    if (response.ok) return (await response.json()) as HazelPage
    if (response.status >= 500 || response.status === 429) {
      await delay(500 * (attempt + 1))
      continue
    }
    throw new Error(`HazEL ${response.status} for ${url}`)
  }
  throw new Error(`HazEL failed after retries: ${url}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function main(): Promise<void> {
  const first = await fetchPage(1)
  const totalPages = Math.max(1, first.totalPages ?? 1)
  const events: QuakeEvent[] = []
  const seen = new Set<string>()

  const ingest = (items: NoaaItem[] | undefined): void => {
    for (const item of items ?? []) {
      const event = noaaItemToEvent(item)
      if (!event || seen.has(event.id)) continue
      seen.add(event.id)
      events.push(event)
    }
  }

  ingest(first.items)
  console.log(`Fetched page 1/${totalPages} (${events.length} events)`)

  for (let page = 2; page <= totalPages; page += 1) {
    const body = await fetchPage(page)
    ingest(body.items)
    console.log(`Fetched page ${page}/${totalPages} (${events.length} events)`)
    await delay(80)
  }

  events.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))

  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const outDir = join(root, 'public', 'data')
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, 'noaa-significant.json')
  writeFileSync(outFile, JSON.stringify(events))
  console.log(`Wrote ${events.length} events to ${outFile}`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
