import { PlaceSearcher, type PlaceHit } from '../data/geocode.ts'
import type { QuakeEvent, WeatherEvent } from '../data/types.ts'
import { cycloneWord } from '../data/weatherParse.ts'
import { TimelineDensity, type DensityMarks } from './TimelineDensity.ts'

export type Mode = 'live' | 'history'

export type HudHandlers = {
  onMode: (mode: Mode) => void
  onMinMag: (minMag: number) => void
  onSpeed: (speed: number) => void
  onPlayToggle: () => void
  onStep: (direction: -1 | 1) => void
  onSeek: (fraction: number) => void
  onResetView: () => void
  onMute: (muted: boolean) => void
  onVolume: (volume: number) => void
  onShowEarthquakes: (show: boolean) => void
  onShowMagLabels: (show: boolean) => void
  onShowTornadoes: (show: boolean) => void
  onShowTornadoLabels: (show: boolean) => void
  onShowHurricanes: (show: boolean) => void
  onShowHurricaneLabels: (show: boolean) => void
  onShowFires: (show: boolean) => void
  onShowFireLabels: (show: boolean) => void
  onLookAtPlace: (lat: number, lon: number) => void
}

function formatMag(event: QuakeEvent): string {
  if (event.mag == null) return 'Magnitude —'
  const type = event.magType ? ` ${event.magType.toUpperCase()}` : ''
  return `Magnitude ${event.mag.toFixed(1)}${type}`
}

function formatTime(ms: number): string {
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

function formatNumber(value: number | null, fallback: string): string {
  if (value == null) return fallback
  return value.toLocaleString('en-US')
}

export class Hud {
  private readonly clockEl: HTMLElement
  private readonly statusEl: HTMLElement
  private readonly cardEl: HTMLElement
  private readonly eventsEl: HTMLElement
  private readonly maxMagEl: HTMLElement
  private readonly deathsEl: HTMLElement
  private readonly deathsRow: HTMLElement
  private readonly scrubber: HTMLInputElement
  private readonly playBtn: HTMLButtonElement
  private readonly muteBtn: HTMLButtonElement
  private readonly cardTitleEl: HTMLElement
  private readonly density: TimelineDensity
  private seeking = false
  private muted = false
  private playing = true
  private showQuakes = true
  private showTornadoes = true
  private showHurricanes = true
  private showFires = true
  private readonly placeInput: HTMLInputElement
  private readonly placeResults: HTMLElement
  private readonly placeSearcher: PlaceSearcher
  private placeHits: PlaceHit[] = []

  constructor(root: HTMLElement, handlers: HudHandlers) {
    root.innerHTML = `
      <div class="hud-top">
        <section class="panel controls">
          <header class="panel-head">
            <div class="panel-head-row">
              <h1>World Disasters</h1>
              <button type="button" class="panel-toggle" aria-expanded="true">Collapse</button>
            </div>
            <div class="place-search">
              <div class="place-search-field">
                <input id="place-search" type="search" placeholder="Search a place…" autocomplete="off" spellcheck="false" aria-label="Search a place" aria-controls="place-results" aria-autocomplete="list" aria-expanded="false" />
                <ul id="place-results" class="place-results" hidden role="listbox"></ul>
              </div>
              <p class="place-hint">Moves the globe. Does not filter events.</p>
            </div>
          </header>
          <div class="panel-body">
            <p class="lede">Worldwide earthquakes, storms, and fires. Expanding blips scale with magnitude. Deaths appear only when a catalog recorded them.</p>
            <div class="row" role="group" aria-label="Catalog">
              <button type="button" data-mode="live">Live week</button>
              <button type="button" data-mode="history" class="active">History 1900+</button>
            </div>
            <div class="row" role="group" aria-label="Minimum magnitude">
              <button type="button" data-mag="2.5" class="active">M ≥ 2.5</button>
              <button type="button" data-mag="4">M ≥ 4</button>
              <button type="button" data-mag="6">M ≥ 6</button>
            </div>
            <div class="row" role="group" aria-label="Playback speed">
              <button type="button" data-speed="0.25">0.25×</button>
              <button type="button" data-speed="0.5">0.5×</button>
              <button type="button" data-speed="1" class="active">1×</button>
              <button type="button" data-speed="10">10×</button>
              <button type="button" data-speed="60">60×</button>
            </div>
            <div class="row">
              <button type="button" id="play-toggle" title="Space" aria-keyshortcuts="Space">Pause</button>
              <button type="button" id="reset-view">Pacific view</button>
            </div>
            <p class="note keys">Space pause/play. While paused, ← → previous/next event.</p>
            <div class="row sound-row">
              <button type="button" id="mute-toggle" class="active" aria-pressed="false">Sound on</button>
              <label class="volume">
                Volume
                <input id="volume" type="range" min="0" max="100" value="80" />
              </label>
            </div>
            <div class="layer-grid" role="group" aria-label="Disaster layers">
              <span class="layer-head">Disasters</span>
              <span class="layer-head">Labels</span>
              <label class="check">
                <input id="show-quakes" type="checkbox" checked />
                Earthquakes
              </label>
              <label class="check">
                <input id="show-quake-labels" type="checkbox" checked />
                <span class="vh">Earthquakes labels</span>
              </label>
              <label class="check">
                <input id="show-tornadoes" type="checkbox" checked />
                Tornadoes
              </label>
              <label class="check">
                <input id="show-tornado-labels" type="checkbox" checked />
                <span class="vh">Tornado labels</span>
              </label>
              <label class="check">
                <input id="show-hurricanes" type="checkbox" checked />
                Hurricanes/Typhoons
              </label>
              <label class="check">
                <input id="show-hurricane-labels" type="checkbox" checked />
                <span class="vh">Hurricane labels</span>
              </label>
              <label class="check">
                <input id="show-fires" type="checkbox" checked />
                Fires
              </label>
              <label class="check">
                <input id="show-fire-labels" type="checkbox" checked />
                <span class="vh">Fire labels</span>
              </label>
            </div>
            <p class="note">Magnitude uses the reported scale (Mw, ML, mb, …). ML is the original Richter scale; large events are usually Mw. History weather: U.S. EF2+ tornadoes (1950+); Cat 1+ Atlantic &amp; East/Central Pacific (HURDAT2) plus western Pacific typhoons and other-basin cyclones (IBTrACS); U.S. 10,000+ acre wildfires (NIFC) plus named/large EONET fires.</p>
          </div>
        </section>
        <section class="panel card">
          <header class="panel-head">
            <h2 id="card-title">Event</h2>
            <button type="button" class="panel-toggle" aria-expanded="true">Collapse</button>
          </header>
          <div class="panel-body" id="event-card">
            <p class="muted">Waiting for an event</p>
          </div>
        </section>
      </div>
      <div class="hud-bottom">
        <div class="panel timeline">
          <header class="panel-head">
            <div id="clock">—</div>
            <button type="button" class="panel-toggle" aria-expanded="true">Collapse</button>
          </header>
          <div class="panel-body">
            <div class="clock-row">
              <div class="stats">
                <span>Events <strong id="stat-events">0</strong></span>
                <span>Max mag <strong id="stat-maxmag">—</strong></span>
                <span id="deaths-stat">Deaths <strong id="stat-deaths">0</strong></span>
              </div>
            </div>
            <div class="density-legend" aria-hidden="true">
              <span class="quake">Earthquakes</span>
              <span class="tornado">Tornadoes</span>
              <span class="storm">Hurricanes/Typhoons</span>
              <span class="fire">Fires</span>
            </div>
            <canvas id="timeline-density" class="density" width="800" height="48" aria-hidden="true"></canvas>
            <input id="scrubber" type="range" min="0" max="1000" value="0" />
            <p class="status" id="status">Loading catalogs…</p>
            <p class="attr">Live: USGS earthquakes, NWS/IEM tornadoes, NHC hurricanes, JMA typhoons, NASA EONET/NIFC fires. History: NOAA NCEI quakes, SPC EF2+ tornadoes, HURDAT2/IBTrACS tropical cyclones, NIFC 10k+ acre wildfires and EONET fires. Globe: NASA Blue Marble.</p>
          </div>
        </div>
      </div>
    `

    this.clockEl = root.querySelector('#clock') as HTMLElement
    this.statusEl = root.querySelector('#status') as HTMLElement
    this.cardEl = root.querySelector('#event-card') as HTMLElement
    this.eventsEl = root.querySelector('#stat-events') as HTMLElement
    this.maxMagEl = root.querySelector('#stat-maxmag') as HTMLElement
    this.deathsEl = root.querySelector('#stat-deaths') as HTMLElement
    this.deathsRow = root.querySelector('#deaths-stat') as HTMLElement
    this.scrubber = root.querySelector('#scrubber') as HTMLInputElement
    this.playBtn = root.querySelector('#play-toggle') as HTMLButtonElement
    this.muteBtn = root.querySelector('#mute-toggle') as HTMLButtonElement
    this.cardTitleEl = root.querySelector('#card-title') as HTMLElement
    this.placeInput = root.querySelector('#place-search') as HTMLInputElement
    this.placeResults = root.querySelector('#place-results') as HTMLElement
    this.placeSearcher = new PlaceSearcher((hits, status) => this.renderPlaceResults(hits, status))
    const densityCanvas = root.querySelector('#timeline-density') as HTMLCanvasElement
    this.density = new TimelineDensity(densityCanvas)

    root.querySelectorAll<HTMLButtonElement>('.panel-toggle').forEach((button) => {
      button.addEventListener('click', () => this.togglePanel(button))
    })

    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        this.setToggleGroup('[data-mode]', button)
        handlers.onMode(button.dataset.mode as Mode)
      })
    })
    root.querySelectorAll<HTMLButtonElement>('[data-mag]').forEach((button) => {
      button.addEventListener('click', () => {
        this.setToggleGroup('[data-mag]', button)
        handlers.onMinMag(Number(button.dataset.mag))
      })
    })
    root.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => {
      button.addEventListener('click', () => {
        this.setToggleGroup('[data-speed]', button)
        handlers.onSpeed(Number(button.dataset.speed))
      })
    })
    this.playBtn.addEventListener('click', () => handlers.onPlayToggle())
    root.querySelector('#reset-view')?.addEventListener('click', () => handlers.onResetView())
    window.addEventListener('keydown', (event) => this.onKeyDown(event, handlers))
    this.muteBtn.addEventListener('click', () => {
      handlers.onMute(!this.muted)
    })
    root.querySelector<HTMLInputElement>('#volume')?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement
      handlers.onVolume(Number(target.value) / 100)
    })
    root.querySelector<HTMLInputElement>('#show-quakes')?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      this.showQuakes = target.checked
      this.syncDensityVisible()
      handlers.onShowEarthquakes(target.checked)
    })
    root.querySelector<HTMLInputElement>('#show-quake-labels')?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      handlers.onShowMagLabels(target.checked)
    })
    root.querySelector<HTMLInputElement>('#show-tornadoes')?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      this.showTornadoes = target.checked
      this.syncDensityVisible()
      handlers.onShowTornadoes(target.checked)
    })
    root.querySelector<HTMLInputElement>('#show-tornado-labels')?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      handlers.onShowTornadoLabels(target.checked)
    })
    root.querySelector<HTMLInputElement>('#show-hurricanes')?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      this.showHurricanes = target.checked
      this.syncDensityVisible()
      handlers.onShowHurricanes(target.checked)
    })
    root.querySelector<HTMLInputElement>('#show-hurricane-labels')?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      handlers.onShowHurricaneLabels(target.checked)
    })
    root.querySelector<HTMLInputElement>('#show-fires')?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      this.showFires = target.checked
      this.syncDensityVisible()
      handlers.onShowFires(target.checked)
    })
    root.querySelector<HTMLInputElement>('#show-fire-labels')?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      handlers.onShowFireLabels(target.checked)
    })

    this.placeInput.addEventListener('input', () => {
      this.placeSearcher.setQuery(this.placeInput.value)
    })
    this.placeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        this.clearPlaceSearch()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const first = this.placeHits[0]
        if (first) this.choosePlace(first, handlers)
      }
    })
    this.placeResults.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-place]')
      if (!button) return
      const index = Number(button.dataset.place)
      const hit = this.placeHits[index]
      if (hit) this.choosePlace(hit, handlers)
    })
    document.addEventListener('pointerdown', (event) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (this.placeInput.contains(target) || this.placeResults.contains(target)) return
      this.hidePlaceResults()
    })

    this.scrubber.addEventListener('pointerdown', () => {
      this.seeking = true
    })
    this.scrubber.addEventListener('pointerup', () => {
      this.seeking = false
    })
    this.scrubber.addEventListener('input', () => {
      handlers.onSeek(Number(this.scrubber.value) / 1000)
    })
  }

  private onKeyDown(event: KeyboardEvent, handlers: HudHandlers): void {
    if (isEditableTarget(event.target)) return
    if (event.code === 'Space') {
      if (event.repeat) return
      event.preventDefault()
      handlers.onPlayToggle()
      return
    }
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      if (this.playing) return
      event.preventDefault()
      handlers.onStep(event.code === 'ArrowLeft' ? -1 : 1)
    }
  }

  setPlaying(playing: boolean): void {
    this.playing = playing
    this.playBtn.textContent = playing ? 'Pause' : 'Play'
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.muteBtn.textContent = muted ? 'Sound off' : 'Sound on'
    this.muteBtn.classList.toggle('active', !muted)
    this.muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false')
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text
  }

  setClock(ms: number): void {
    this.clockEl.textContent = formatTime(ms)
  }

  setFraction(fraction: number): void {
    if (this.seeking) return
    this.scrubber.value = String(Math.round(fraction * 1000))
  }

  setShowDeaths(show: boolean): void {
    this.deathsRow.hidden = !show
  }

  setStats(eventsShown: number, maxMag: number, deaths: number): void {
    this.eventsEl.textContent = eventsShown.toLocaleString('en-US')
    this.maxMagEl.textContent = Number.isFinite(maxMag) ? maxMag.toFixed(1) : '—'
    this.deathsEl.textContent = deaths.toLocaleString('en-US')
  }

  setDensity(marks: DensityMarks | null): void {
    this.density.setMarks(marks)
  }

  showEvent(event: QuakeEvent | WeatherEvent): void {
    if ('kind' in event) {
      this.showWeather(event)
      return
    }
    const extra: string[] = []
    if (event.country) extra.push(`<div><dt>Country</dt><dd>${escapeHtml(event.country)}</dd></div>`)
    if (event.injuries != null) extra.push(`<div><dt>Injuries</dt><dd>${formatNumber(event.injuries, '—')}</dd></div>`)
    if (event.housesDestroyed != null) {
      extra.push(`<div><dt>Houses destroyed</dt><dd>${formatNumber(event.housesDestroyed, '—')}</dd></div>`)
    }
    if (event.housesDamaged != null) {
      extra.push(`<div><dt>Houses damaged</dt><dd>${formatNumber(event.housesDamaged, '—')}</dd></div>`)
    }
    if (event.damageUsdMillions != null) {
      extra.push(`<div><dt>Damage</dt><dd>$${event.damageUsdMillions.toLocaleString('en-US')} million</dd></div>`)
    }
    if (event.pagerAlert) {
      extra.push(`<div><dt>PAGER alert</dt><dd class="pager ${event.pagerAlert}">${event.pagerAlert}</dd></div>`)
    }

    const deaths = event.deaths == null ? 'unknown' : formatNumber(event.deaths, 'unknown')
    const link = event.url
      ? `<a href="${escapeHtml(event.url)}" target="_blank" rel="noreferrer">Source</a>`
      : ''

    this.cardTitleEl.textContent = event.place
    this.cardEl.innerHTML = `
      <p class="mag">${escapeHtml(formatMag(event))}</p>
      <dl>
        <div><dt>Time</dt><dd>${escapeHtml(formatTime(event.time))}</dd></div>
        <div><dt>Depth</dt><dd>${event.depthKm == null ? '—' : `${Math.round(event.depthKm)} km`}</dd></div>
        <div><dt>Deaths</dt><dd>${deaths}</dd></div>
        <div><dt>Tsunami</dt><dd>${event.tsunami ? 'yes' : 'no'}</dd></div>
        ${extra.join('')}
      </dl>
      ${link}
    `
  }

  private showWeather(event: WeatherEvent): void {
    const extra: string[] = []
    if (event.kind === 'tornado' && event.efRating != null) {
      extra.push(`<div><dt>EF rating</dt><dd>EF${event.efRating}</dd></div>`)
    }
    if (event.kind === 'hurricane') {
      extra.push(
        `<div><dt>Category</dt><dd>${event.category != null ? `Category ${event.category}` : 'tropical storm'}</dd></div>`,
      )
    }
    if (event.kind === 'fire' && event.acres != null) {
      extra.push(`<div><dt>Acres</dt><dd>${formatNumber(Math.round(event.acres), '—')}</dd></div>`)
    }
    if (event.windKt != null) extra.push(`<div><dt>Winds</dt><dd>${event.windKt} kt</dd></div>`)
    if (event.injuries != null) extra.push(`<div><dt>Injuries</dt><dd>${formatNumber(event.injuries, '—')}</dd></div>`)
    if (event.name) extra.push(`<div><dt>Name</dt><dd>${escapeHtml(event.name)}</dd></div>`)

    const deaths = event.deaths == null ? 'unknown' : formatNumber(event.deaths, 'unknown')
    const link = event.url
      ? `<a href="${escapeHtml(event.url)}" target="_blank" rel="noreferrer">Source</a>`
      : ''
    const word = cycloneWord(event)
    const headline =
      event.kind === 'tornado'
        ? event.efRating != null
          ? `EF${event.efRating} tornado`
          : 'Tornado'
        : event.kind === 'fire'
          ? event.name
            ? `Fire ${event.name}`
            : 'Fire'
          : event.name
            ? `${event.category != null ? `Category ${event.category} ` : ''}${word} ${event.name}`
            : word
    const kindClass = event.kind === 'tornado' ? 'tornado' : event.kind === 'fire' ? 'fire' : 'hurricane'

    this.cardTitleEl.textContent = event.place
    this.cardEl.innerHTML = `
      <p class="mag ${kindClass}">${escapeHtml(headline)}</p>
      <dl>
        <div><dt>Time</dt><dd>${escapeHtml(formatTime(event.time))}</dd></div>
        <div><dt>Deaths</dt><dd>${deaths}</dd></div>
        ${extra.join('')}
      </dl>
      ${link}
    `
  }

  private renderPlaceResults(hits: PlaceHit[], status: string | null): void {
    this.placeHits = hits
    if (hits.length === 0 && !status) {
      this.hidePlaceResults()
      return
    }
    const items = hits.map(
      (hit, index) =>
        `<li role="option"><button type="button" data-place="${index}">${escapeHtml(hit.label)}</button></li>`,
    )
    if (status) items.push(`<li class="place-status" role="presentation">${escapeHtml(status)}</li>`)
    this.placeResults.innerHTML = items.join('')
    this.placeResults.hidden = false
    this.placeInput.setAttribute('aria-expanded', 'true')
  }

  private choosePlace(hit: PlaceHit, handlers: HudHandlers): void {
    this.placeInput.value = hit.label
    this.hidePlaceResults()
    handlers.onLookAtPlace(hit.lat, hit.lon)
  }

  private clearPlaceSearch(): void {
    this.placeInput.value = ''
    this.placeSearcher.cancel()
    this.hidePlaceResults()
  }

  private hidePlaceResults(): void {
    this.placeHits = []
    this.placeResults.hidden = true
    this.placeResults.innerHTML = ''
    this.placeInput.setAttribute('aria-expanded', 'false')
  }

  private syncDensityVisible(): void {
    this.density.setVisible(this.showQuakes, this.showTornadoes, this.showHurricanes, this.showFires)
  }

  private togglePanel(button: HTMLButtonElement): void {
    const panel = button.closest('.panel')
    if (!panel) return
    const collapsed = panel.classList.toggle('collapsed')
    button.textContent = collapsed ? 'Expand' : 'Collapse'
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
  }

  private setToggleGroup(selector: string, active: HTMLButtonElement): void {
    active.parentElement?.querySelectorAll<HTMLButtonElement>(selector).forEach((button) => {
      button.classList.toggle('active', button === active)
    })
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  return type === 'text' || type === 'search' || type === 'checkbox'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
