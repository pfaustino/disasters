import { sortByTime } from './normalize.ts'
import type { QuakeEvent } from './types.ts'

export async function loadNoaaEvents(): Promise<QuakeEvent[]> {
  const url = `${import.meta.env.BASE_URL}data/noaa-significant.json`
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) {
    throw new Error(`NOAA snapshot failed (${response.status})`)
  }
  const events = (await response.json()) as QuakeEvent[]
  if (!Array.isArray(events)) {
    throw new Error('NOAA snapshot is not an array')
  }
  return sortByTime(events.filter((event) => event && Number.isFinite(event.time) && event.mag != null))
}
