import { useEffect, useState } from 'react'
import { Play, Pause, RotateCcw, Check } from 'lucide-react'
import { toBillingMinutes, formatHours } from '../../lib/retainer'

/**
 * The timer, and the top of the page.
 *
 * It owns the engagement picker rather than sitting above one: you choose what
 * you are timing before you start, and the card then says who the time belongs
 * to for as long as it runs. Applying the elapsed time hands straight to the
 * entry form below, which is attached to this card rather than floating beneath
 * it — one continuous motion from start to logged.
 *
 * State lives in localStorage, not React alone, so navigating away or reloading
 * does not silently lose a running timer — the one failure that would make
 * anyone stop trusting it. Elapsed is derived from a start TIMESTAMP rather than
 * accumulated by the interval, so a backgrounded tab, where browsers throttle
 * timers, still reports the truth.
 */

const KEY = 'wa.stopwatch'

interface Persisted {
  startedAt: number | null
  accumulatedMs: number
}

export interface TimerEngagement {
  id: string
  name: string
  organizations: { name: string; logo_url?: string | null } | null
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Persisted
  } catch { /* a cleared or unavailable store just starts fresh */ }
  return { startedAt: null, accumulatedMs: 0 }
}

function save(s: Persisted) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* nothing to do */ }
}

function clock(ms: number) {
  const total = Math.floor(ms / 1000)
  return {
    hh: String(Math.floor(total / 3600)).padStart(2, '0'),
    mm: String(Math.floor((total % 3600) / 60)).padStart(2, '0'),
    ss: String(total % 60).padStart(2, '0'),
  }
}

/** Initials, for when an organisation has no logo on file. */
function initials(name: string): string {
  return name.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w[0] ?? '')).slice(0, 2)
    .map(w => w[0]!.toUpperCase()).join('')
}

export function Stopwatch({
  engagements, selectedId, onSelect, onApply,
}: {
  engagements: TimerEngagement[]
  selectedId: string
  onSelect: (id: string) => void
  onApply: (minutes: number) => void
}) {
  const [state, setState] = useState<Persisted>(load)
  const [, tick] = useState(0)

  useEffect(() => {
    if (state.startedAt == null) return
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [state.startedAt])

  useEffect(() => { save(state) }, [state])

  const elapsedMs = state.accumulatedMs + (state.startedAt ? Date.now() - state.startedAt : 0)
  const running = state.startedAt != null
  const billable = toBillingMinutes(elapsedMs / 60000)
  const { hh, mm, ss } = clock(elapsedMs)
  const started = elapsedMs > 0

  const selected = engagements.find(e => e.id === selectedId)
  const org = selected?.organizations

  const start = () => setState(s => ({ ...s, startedAt: Date.now() }))
  const pause = () => setState(s => ({
    startedAt: null,
    accumulatedMs: s.accumulatedMs + (s.startedAt ? Date.now() - s.startedAt : 0),
  }))
  const reset = () => setState({ startedAt: null, accumulatedMs: 0 })
  const apply = () => { if (billable > 0) onApply(billable); reset() }

  return (
    <div className="rounded-t-2xl bg-gradient-to-br from-navy via-navy-800 to-navy-900 text-white p-6 sm:p-7">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0 overflow-hidden">
          {org?.logo_url
            ? <img src={org.logo_url} alt="" className="w-full h-full object-contain p-1.5" />
            : <span className="text-sm font-bold text-white/80">{org ? initials(org.name) : '—'}</span>}
        </div>

        <div className="min-w-0 flex-1">
          <select
            value={selectedId}
            onChange={e => onSelect(e.target.value)}
            // Changing what you are timing mid-run would silently reassign the
            // elapsed time to another client.
            disabled={running}
            className="w-full bg-transparent text-white font-semibold text-[0.95rem] -ml-1 px-1 py-0.5 rounded outline-none focus:bg-white/10 disabled:opacity-100 disabled:cursor-not-allowed cursor-pointer"
          >
            {engagements.map(e => (
              <option key={e.id} value={e.id} className="text-navy">
                {e.organizations?.name} · {e.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-white/70 mt-0.5 px-0.5">
            {running ? 'Locked while the timer runs' : 'What are you working on?'}
          </p>
        </div>

        {running && (
          <span className="flex items-center gap-2 text-xs font-medium text-white shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-river opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-river" />
            </span>
            Running
          </span>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-end gap-1 font-bold tabular-nums leading-none">
            <span className="text-5xl sm:text-6xl">{hh}</span>
            <span className="text-3xl sm:text-4xl text-white/50 pb-0.5">:</span>
            <span className="text-5xl sm:text-6xl">{mm}</span>
            <span className="text-3xl sm:text-4xl text-white/50 pb-0.5">:</span>
            <span className="text-3xl sm:text-4xl text-white/70 pb-0.5">{ss}</span>
          </div>
          <p className="mt-2 text-sm text-white/70 h-5">
            {started
              ? <>bills as <span className="font-semibold text-white">{formatHours(billable)} hours</span></>
              : 'Start the timer, or enter a duration below'}
          </p>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {started && (
            <button
              onClick={reset}
              className="text-white/60 hover:text-white transition-colors p-2.5"
              aria-label="Reset timer"
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            onClick={running ? pause : start}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-sm transition-colors ${
              running ? 'bg-white/15 hover:bg-white/25 text-white' : 'bg-river-700 hover:bg-river text-white'
            }`}
          >
            {running ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
            {running ? 'Pause' : started ? 'Resume' : 'Start timer'}
          </button>
          {started && !running && (
            <button
              onClick={apply}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-navy font-medium text-sm hover:bg-white/90 transition-colors"
            >
              <Check size={16} />
              Use {formatHours(billable)} h
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
