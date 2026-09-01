import { useEffect, useState } from 'react'
import { Play, Pause, RotateCcw, Check } from 'lucide-react'
import { toBillingMinutes, formatHours } from '../../lib/retainer'

/**
 * The clock itself. The engagement it belongs to is chosen above it, by the
 * page, because that choice is shared with manual entry.
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

export function Stopwatch({
  onApply, onRunningChange,
}: {
  onApply: (minutes: number) => void
  /** So the page can lock the engagement picker while the clock runs. */
  onRunningChange?: (running: boolean) => void
}) {
  const [state, setState] = useState<Persisted>(load)
  const [, tick] = useState(0)

  useEffect(() => {
    if (state.startedAt == null) return
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [state.startedAt])

  useEffect(() => { save(state) }, [state])
  useEffect(() => { onRunningChange?.(state.startedAt != null) }, [state.startedAt, onRunningChange])

  const elapsedMs = state.accumulatedMs + (state.startedAt ? Date.now() - state.startedAt : 0)
  const running = state.startedAt != null
  const billable = toBillingMinutes(elapsedMs / 60000)
  const { hh, mm, ss } = clock(elapsedMs)
  const started = elapsedMs > 0

  const start = () => setState(s => ({ ...s, startedAt: Date.now() }))
  const pause = () => setState(s => ({
    startedAt: null,
    accumulatedMs: s.accumulatedMs + (s.startedAt ? Date.now() - s.startedAt : 0),
  }))
  const reset = () => setState({ startedAt: null, accumulatedMs: 0 })
  const apply = () => { if (billable > 0) onApply(billable); reset() }

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
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
            : 'Press start when you begin'}
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
  )
}
