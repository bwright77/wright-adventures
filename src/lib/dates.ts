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
