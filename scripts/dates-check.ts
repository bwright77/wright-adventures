// =============================================================================
// dates-check.ts — Regression check for the local-calendar date helpers.
//
//   npx tsx scripts/dates-check.ts
//
// Two bugs live here, and both have already bitten:
//
//   1. `new Date().toISOString().slice(0, 10)` is TOMORROW west of Greenwich
//      for part of every day. At 18:00 in Denver it is already the next day in
//      UTC, so evening work was logged against the wrong date and dropped out
//      of a report that ended "today".
//
//   2. Freezing today at mount. A tab left open overnight kept offering
//      yesterday as the default entry date, and several entries went in on the
//      wrong day before anyone noticed. That one is fixed by useToday(), which
//      cannot be exercised here — but todayLocal() is what it re-reads, so the
//      primitive is what gets asserted.
// =============================================================================

import { todayLocal, monthStartLocal, monthEndLocal, parseLocalDate, toDateInput } from '../src/lib/dates'

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(52)} ${String(actual).padEnd(12)} ${ok ? '' : `(expected ${expected})`}`)
}

// A local Date built from parts is unambiguous: this IS 3 September, locally.
const eveningInDenver = new Date(2026, 8, 3, 18, 30, 0)   // month is 0-indexed
const justBeforeMidnight = new Date(2026, 8, 3, 23, 59, 0)
const justAfterMidnight = new Date(2026, 8, 4, 0, 1, 0)

check('evening does not roll forward', todayLocal(eveningInDenver), '2026-09-03')
check('23:59 is still the same day', todayLocal(justBeforeMidnight), '2026-09-03')
check('00:01 is the next day', todayLocal(justAfterMidnight), '2026-09-04')

// The bug, stated as a test: the naive spelling disagrees in the evening
// anywhere west of UTC. Skipped where it cannot fire (UTC or east of it).
const naive = eveningInDenver.toISOString().slice(0, 10)
const offsetMinutes = eveningInDenver.getTimezoneOffset()
if (offsetMinutes > 0) {
  check('toISOString disagrees, which is the bug', naive === '2026-09-03', false)
} else {
  console.log(`· skipped the toISOString comparison — this machine is UTC${offsetMinutes === 0 ? '' : '+'}, where it cannot fire`)
}

check('single-digit day pads', todayLocal(new Date(2026, 0, 5, 12, 0)), '2026-01-05')
check('single-digit month pads', todayLocal(new Date(2026, 2, 15, 12, 0)), '2026-03-15')

check('month start', monthStartLocal(0, eveningInDenver), '2026-09-01')
check('last month start', monthStartLocal(-1, eveningInDenver), '2026-08-01')
check('last month end', monthEndLocal(-1, eveningInDenver), '2026-08-31')
check('this month end', monthEndLocal(0, eveningInDenver), '2026-09-30')
check('February in a leap year', monthEndLocal(0, new Date(2028, 1, 10, 12, 0)), '2028-02-29')
check('February otherwise', monthEndLocal(0, new Date(2026, 1, 10, 12, 0)), '2026-02-28')
check('December rolls the year', monthEndLocal(0, new Date(2026, 11, 10, 12, 0)), '2026-12-31')
check('January steps back a year', monthStartLocal(-1, new Date(2026, 0, 10, 12, 0)), '2025-12-01')

// A stored date must survive the round trip to the input and back.
check('parseLocalDate keeps the day', todayLocal(parseLocalDate('2026-09-03')), '2026-09-03')
check('parseLocalDate ignores a UTC time', todayLocal(parseLocalDate('2026-09-03 00:00:00+00')), '2026-09-03')
check('toDateInput trims a timestamp', toDateInput('2026-09-03T14:22:00.000Z'), '2026-09-03')
check('toDateInput passes null through', toDateInput(null), '')

console.log(
  failures === 0
    ? `\nAll date helpers behave (${new Date().toString().match(/\(([^)]+)\)/)?.[1] ?? 'local time'})`
    : `\n${failures} failure(s)`,
)
process.exit(failures === 0 ? 0 : 1)
