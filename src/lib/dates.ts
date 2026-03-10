/**
 * Parse a date-only DB value (stored as UTC midnight timestamptz, e.g. "2026-03-15 00:00:00+00")
 * as the correct local calendar date. Using `new Date(s)` directly shifts to local time
 * (e.g. March 14 at 5 PM in UTC-7), so we always use only the YYYY-MM-DD portion.
 */
export function parseLocalDate(s: string): Date {
  return new Date(s.slice(0, 10) + 'T00:00:00')
}
