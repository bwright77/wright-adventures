import { useEffect, useState } from 'react'
import { Play, Pause, RotateCcw } from 'lucide-react'
import { toBillingMinutes, formatHours } from '../../lib/retainer'

/**
 * A running timer for work happening now.
 *
 * State lives in localStorage, not React alone, so navigating away or reloading
 * does not silently lose a running timer — which is the one failure that would
 * make people stop trusting it. Elapsed time is derived from a start TIMESTAMP
 * rather than accumulated by the interval, so a backgrounded tab (where timers
 * are throttled) still reports the truth.
 *
 * It shows what the elapsed time will BILL as while it runs, because that is
 * the number being committed to: 7 minutes on the clock is 0.2 on the invoice.
 */

const KEY = 'wa.stopwatch'

interface Persisted {
  /** Epoch ms when the current run began, or null when paused. */
  startedAt: number | null
  /** Milliseconds banked from previous runs. */
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

function clock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function Stopwatch({ onApply }: { onApply: (minutes: number) => void }) {
  const [state, setState] = useState<Persisted>(load)
  const [, tick] = useState(0)

  // Re-render each second while running. Elapsed is recomputed from the
  // timestamp, so a missed tick costs nothing.
  useEffect(() => {
    if (state.startedAt == null) return
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [state.startedAt])

  useEffect(() => { save(state) }, [state])

  const elapsedMs = state.accumulatedMs + (state.startedAt ? Date.now() - state.startedAt : 0)
  const running = state.startedAt != null
  const billable = toBillingMinutes(elapsedMs / 60000)

  const start = () => setState(s => ({ ...s, startedAt: Date.now() }))
  const pause = () => setState(s => ({
    startedAt: null,
    accumulatedMs: s.accumulatedMs + (s.startedAt ? Date.now() - s.startedAt : 0),
  }))
  const reset = () => setState({ startedAt: null, accumulatedMs: 0 })

  const apply = () => {
    if (billable > 0) onApply(billable)
    reset()
  }

  return (
    <div className={`rounded-xl border p-4 transition-colors ${
      running ? 'border-river bg-river-50' : 'border-gray-200 bg-white'
    }`}>
      <div className="flex items-center gap-4">
        <button
          onClick={running ? pause : start}
          className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-colors ${
            running ? 'bg-river text-white hover:bg-river-700' : 'bg-navy text-white hover:bg-navy/90'
          }`}
          aria-label={running ? 'Pause timer' : 'Start timer'}
        >
          {running ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold text-navy tabular-nums leading-none">{clock(elapsedMs)}</p>
          <p className="text-xs text-gray-600 mt-1">
            {elapsedMs > 0
              ? <>bills as <span className="font-medium text-navy">{formatHours(billable)} h</span></>
              : running ? 'running' : 'Start the timer, or type a duration below'}
          </p>
        </div>

        {elapsedMs > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={reset}
              className="text-gray-400 hover:text-navy transition-colors p-2"
              aria-label="Reset timer"
            >
              <RotateCcw size={15} />
            </button>
            <button
              onClick={apply}
              className="text-sm font-medium bg-navy hover:bg-navy/90 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Use {formatHours(billable)} h
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
