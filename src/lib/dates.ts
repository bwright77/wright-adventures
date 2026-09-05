import { useEffect, useState } from 'react'

/**
 * Parse a date-only DB value (stored as UTC midnight timestamptz, e.g. "2026-03-15 00:00:00+00")
 * as the correct local calendar date. Using `new Date(s)` directly shifts to local time
 * (e.g. March 14 at 5 PM in UTC-7), so we always use only the YYYY-MM-DD portion.
 */
export function parseLocalDate(s: string): Date {
  return new Date(s.slice(0, 10) + 'T00:00:00')
}

/**
 * Format a stored date value for an `<input type="date">`, which only ever
 * accepts YYYY-MM-DD.
 *
 * Same slice as parseLocalDate, and for the same reason: due_date is a
 * timestamptz written inconsistently — some rows at UTC midnight, others
 * carrying a time from `addDays(...).toISOString()`. Taking the date portion
 * verbatim avoids a timezone shift moving the day.
 */
export function toDateInput(s: string | null | undefined): string {
  return s ? s.slice(0, 10) : ''
}

/**
 * Today as YYYY-MM-DD in the LOCAL calendar.
 *
 * `new Date().toISOString().slice(0, 10)` is the obvious spelling and is wrong
 * west of Greenwich for part of every day: at 18:00 in Denver it is already
 * tomorrow in UTC, so an evening's work would be logged against the wrong day
 * — and dropped from a report that ends today.
 */
export function todayLocal(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** First day of a month, as YYYY-MM-DD. `offset` steps months: -1 is last month. */
export function monthStartLocal(offset = 0, d: Date = new Date()): string {
  return todayLocal(new Date(d.getFullYear(), d.getMonth() + offset, 1))
}

/** Last day of a month, as YYYY-MM-DD. Day 0 of the next month is this month's last. */
export function monthEndLocal(offset = 0, d: Date = new Date()): string {
  return todayLocal(new Date(d.getFullYear(), d.getMonth() + offset + 1, 0))
}

/**
 * Today's local date, kept current in a tab that stays open.
 *
 * `useState(todayLocal)` freezes the date at mount. A browser left open
 * overnight then offers yesterday as the default for everything logged the
 * next morning — which is exactly how several entries ended up on the wrong
 * day and had to be corrected by hand.
 *
 * Re-checks when the tab regains focus or becomes visible, and once a minute
 * regardless, so a tab that was never blurred still rolls over.
 */
export function useToday(): string {
  const [today, setToday] = useState(todayLocal)

  useEffect(() => {
    const sync = () => setToday(prev => {
      const now = todayLocal()
      return now === prev ? prev : now   // same string keeps the reference, no re-render
    })
    const onVisible = () => { if (!document.hidden) sync() }

    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', onVisible)
    const id = setInterval(sync, 60_000)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(id)
    }
  }, [])

  return today
}
