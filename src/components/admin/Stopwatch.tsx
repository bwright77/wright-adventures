import { useEffect, useState } from 'react'
import { Play, Pause, RotateCcw } from 'lucide-react'
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
 *
 * The state is a hook rather than component-private because Log reads the clock
 * and stops it. Handing the time over used to be its own step — pause, accept,
 * then log — which is three deliberate acts for one intention.
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

export interface StopwatchControl {
  elapsedMs: number
  running: boolean
  /** Any time on the clock, running or paused. */
  started: boolean
  /** What the elapsed time bills as, rounded up to the six-minute increment. */
  billableMinutes: number
  start: () => void
  pause: () => void
  reset: () => void
  addMinutes: (m: number) => void
}

export function useStopwatch(): StopwatchControl {
  const [state, setState] = useState<Persisted>(load)
  const [, tick] = useState(0)

  useEffect(() => {
    if (state.startedAt == null) return
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [state.startedAt])

  useEffect(() => { save(state) }, [state])

  const elapsedMs = state.accumulatedMs + (state.startedAt ? Date.now() - state.startedAt : 0)

  return {
    elapsedMs,
    running: state.startedAt != null,
    started: elapsedMs > 0,
    billableMinutes: toBillingMinutes(elapsedMs / 60000),
    start: () => setState(s => ({ ...s, startedAt: Date.now() })),
    pause: () => setState(s => ({
      startedAt: null,
      accumulatedMs: s.accumulatedMs + (s.startedAt ? Date.now() - s.startedAt : 0),
    })),
    reset: () => setState({ startedAt: null, accumulatedMs: 0 }),
    /**
     * Credit time already worked before the timer was started.
     *
     * Adding to the banked total rather than moving startedAt backwards means it
     * behaves the same whether the clock is idle or already running — you can
     * realise you forgot at the start, or ten minutes in, and it lands the same
     * way. Repeatable, and reset clears it.
     */
    addMinutes: m => setState(s => ({ ...s, accumulatedMs: s.accumulatedMs + m * 60_000 })),
  }
}

export function Stopwatch({ sw }: { sw: StopwatchControl }) {
  const { hh, mm, ss } = clock(sw.elapsedMs)

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
          {sw.started
            ? <>bills as <span className="font-semibold text-white">{formatHours(sw.billableMinutes)} hours</span></>
            : 'Press start when you begin'}
        </p>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <div className="flex items-center gap-1.5 mr-1">
          <span className="text-xs text-white/70 hidden sm:inline">
            {sw.started ? 'Add' : 'Started late?'}
          </span>
          {[5, 10, 15, 30].map(m => (
            <button
              key={m}
              onClick={() => sw.addMinutes(m)}
              className="text-xs px-2 py-1 rounded border border-white/25 text-white/80 hover:border-white/60 hover:text-white transition-colors"
              title={`Credit ${m} minutes already worked`}
            >
              +{m}
            </button>
          ))}
        </div>
        {sw.started && (
          <button
            onClick={sw.reset}
            className="text-white/60 hover:text-white transition-colors p-2.5"
            aria-label="Reset timer"
          >
            <RotateCcw size={16} />
          </button>
        )}
        <button
          onClick={sw.running ? sw.pause : sw.start}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-sm transition-colors ${
            sw.running ? 'bg-white/15 hover:bg-white/25 text-white' : 'bg-river-700 hover:bg-river text-white'
          }`}
        >
          {sw.running ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          {sw.running ? 'Pause' : sw.started ? 'Resume' : 'Start timer'}
        </button>
      </div>
    </div>
  )
}
