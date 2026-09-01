import { useEffect, useState } from 'react'
import { Play, Pause, RotateCcw, Check } from 'lucide-react'
import { toBillingMinutes, formatHours } from '../../lib/retainer'

/**
 * The timer, and the centre of the page.
 *
 * State lives in localStorage, not React alone, so navigating away or reloading
 * does not silently lose a running timer — the one failure that would make
 * anyone stop trusting it. Elapsed is derived from a start TIMESTAMP rather than
 * accumulated by the interval, so a backgrounded tab, where browsers throttle
 * timers, still reports the truth.
 *
 * It shows what the clock will BILL as while it runs, because that is the number
 * being committed to: seven minutes reads 0.2 before you stop, not after.
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

function clock(ms: number): { hh: string; mm: string; ss: string } {
  const total = Math.floor(ms / 1000)
  return {
    hh: String(Math.floor(total / 3600)).padStart(2, '0'),
    mm: String(Math.floor((total % 3600) / 60)).padStart(2, '0'),
    ss: String(total % 60).padStart(2, '0'),
  }
}

export function Stopwatch({ context, onApply }: { context?: string; onApply: (minutes: number) => void }) {
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
  const idle = elapsedMs === 0 && !running

  const start = () => setState(s => ({ ...s, startedAt: Date.now() }))
  const pause = () => setState(s => ({
    startedAt: null,
    accumulatedMs: s.accumulatedMs + (s.startedAt ? Date.now() - s.startedAt : 0),
  }))
  const reset = () => setState({ startedAt: null, accumulatedMs: 0 })
  const apply = () => { if (billable > 0) onApply(billable); reset() }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-navy via-navy-800 to-navy-900 text-white p-7 sm:p-8">
      {/* A slow pulse only while running — the page should look different from
          across the room when the clock is going. */}
      {running && (
        <span className="absolute top-5 right-5 flex items-center gap-2 text-xs font-medium text-white">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-river opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-river" />
          </span>
          Running
        </span>
      )}

      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
        {context ?? 'Timer'}
      </p>

      <div className="mt-4 flex items-end gap-1 font-bold tabular-nums leading-none">
        <span className="text-6xl sm:text-7xl">{hh}</span>
        <span className="text-4xl sm:text-5xl text-white/50 pb-0.5">:</span>
        <span className="text-6xl sm:text-7xl">{mm}</span>
        <span className="text-4xl sm:text-5xl text-white/50 pb-0.5">:</span>
        <span className="text-4xl sm:text-5xl text-white/70 pb-0.5">{ss}</span>
      </div>

      <p className="mt-3 text-sm text-white/70 h-5">
        {idle
          ? 'Press start, or enter a duration below'
          : <>bills as <span className="font-semibold text-white">{formatHours(billable)} hours</span></>}
      </p>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={running ? pause : start}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-sm transition-colors ${
            running
              ? 'bg-white/15 hover:bg-white/25 text-white'
              : 'bg-river-700 hover:bg-river text-white'
          }`}
        >
          {running ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          {running ? 'Pause' : elapsedMs > 0 ? 'Resume' : 'Start'}
        </button>

        {elapsedMs > 0 && (
          <>
            <button
              onClick={apply}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-navy font-medium text-sm hover:bg-white/90 transition-colors"
            >
              <Check size={16} />
              Use {formatHours(billable)} h
            </button>
            <button
              onClick={reset}
              className="ml-auto text-white/60 hover:text-white transition-colors p-2"
              aria-label="Reset timer"
            >
              <RotateCcw size={16} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
