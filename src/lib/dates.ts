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
