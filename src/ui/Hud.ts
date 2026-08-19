import type { QuakeEvent } from '../data/types.ts'

export type Mode = 'live' | 'history'

export type HudHandlers = {
  onMode: (mode: Mode) => void
  onMinMag: (minMag: number) => void
  onSpeed: (speed: number) => void
  onPlayToggle: () => void
  onSeek: (fraction: number) => void
  onResetView: () => void
  onMute: (muted: boolean) => void
  onVolume: (volume: number) => void
  onShowMagLabels: (show: boolean) => void
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
  private seeking = false
  private muted = true

  constructor(root: HTMLElement, handlers: HudHandlers) {
    root.innerHTML = `
      <div class="hud-top">
        <section class="panel controls">
          <header class="panel-head">
            <h1>Pacific Earthquake Globe</h1>
            <button type="button" class="panel-toggle" aria-expanded="true">Collapse</button>
          </header>
          <div class="panel-body">
            <p class="lede">Ring of Fire view. Expanding blips scale with magnitude. Deaths appear only when a catalog recorded them.</p>
            <div class="row" role="group" aria-label="Catalog">
              <button type="button" data-mode="live" class="active">Live week</button>
              <button type="button" data-mode="history">History 1900+</button>
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
              <button type="button" id="play-toggle">Pause</button>
              <button type="button" id="reset-view">Pacific view</button>
            </div>
            <div class="row sound-row">
              <button type="button" id="mute-toggle" aria-pressed="true">Sound off</button>
              <label class="volume">
                Volume
                <input id="volume" type="range" min="0" max="100" value="80" />
              </label>
            </div>
            <label class="check">
              <input id="show-mag-labels" type="checkbox" />
              Show magnitude on globe
            </label>
            <p class="note">Magnitude uses the reported scale (Mw, ML, mb, …). ML is the original Richter scale; large events are usually Mw.</p>
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
            <input id="scrubber" type="range" min="0" max="1000" value="0" />
            <p class="status" id="status">Loading catalogs…</p>
            <p class="attr">Live: USGS earthquake feed. History: NOAA NCEI Significant Earthquake Database. Globe: NASA Blue Marble.</p>
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
    this.muteBtn.addEventListener('click', () => {
      handlers.onMute(!this.muted)
    })
    root.querySelector<HTMLInputElement>('#volume')?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement
      handlers.onVolume(Number(target.value) / 100)
    })
    root.querySelector<HTMLInputElement>('#show-mag-labels')?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      handlers.onShowMagLabels(target.checked)
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

  setPlaying(playing: boolean): void {
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

  showEvent(event: QuakeEvent): void {
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
