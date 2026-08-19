import { usgsFeatureToEvent, sortByTime } from './normalize.ts'
import type { QuakeEvent, UsgsFeature } from './types.ts'

const USGS_WEEK =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson'

type UsgsFeed = {
  features?: UsgsFeature[]
}

export async function loadUsgsEvents(): Promise<QuakeEvent[]> {
  const response = await fetch(USGS_WEEK, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) {
    throw new Error(`USGS feed failed (${response.status})`)
  }
  const body = (await response.json()) as UsgsFeed
  const events: QuakeEvent[] = []
  const features = body.features ?? []
  for (let i = 0; i < features.length; i += 1) {
    const event = usgsFeatureToEvent(features[i])
    if (event) events.push(event)
  }
  return sortByTime(events)
}
