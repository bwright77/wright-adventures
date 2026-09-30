// =============================================================================
// time-report-check.ts — Regression check for combining a day's time entries.
//
//   npx tsx scripts/time-report-check.ts
//
// The report shows one line per day. What has to hold:
//   • a day's hours are the sum of its entries, and nothing is lost overall
//   • descriptions keep the order the work happened in
//   • the same meeting logged for two people is described once
//   • billable, non-billable and estimated time never share a row, because the
//     summary reports them separately and a blended row would match none of it
// =============================================================================

import { combineByDay, reportTotals, hoursLabel, type TimeReportEntry } from '../src/lib/timeReport'

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(50)} ${ok ? '' : `\n     got      ${a}\n     expected ${e}`}`)
}

const E = (entry_date: string, minutes: number, description: string, who = 'Benjamin',
  billable = true, is_estimate = false): TimeReportEntry =>
  ({ entry_date, minutes, description, who, billable, is_estimate })

// An ordinary day: three stops of the timer become one line.
const ordinary = combineByDay([
  E('2026-09-03', 60, 'Kick-off meeting with Ashley'),
  E('2026-09-03', 90, 'Reviewed the subscriber data model'),
  E('2026-09-03', 30, 'Drafted the migration plan'),
])
check('three entries, one day, one row', ordinary.length, 1)
check('hours are summed', ordinary[0]?.minutes, 180)
check('descriptions keep their order', ordinary[0]?.descriptions, [
  'Kick-off meeting with Ashley', 'Reviewed the subscriber data model', 'Drafted the migration plan',
])

// Two people, one meeting — logged as two entries by the Who chips.
const joint = combineByDay([
  E('2026-09-04', 60, 'Stakeholder call', 'Benjamin'),
  E('2026-09-04', 60, 'Stakeholder call', 'Shane'),
  E('2026-09-04', 30, 'Follow-up notes', 'Benjamin'),
])
check('joint meeting stays one row', joint.length, 1)
check('both people named once each', joint[0]?.who, ['Benjamin', 'Shane'])
check('both people\'s hours count', joint[0]?.minutes, 150)
check('the shared description appears once', joint[0]?.descriptions, ['Stakeholder call', 'Follow-up notes'])

// A mixed day splits, billable first.
const mixed = combineByDay([
  E('2026-09-05', 30, 'Internal planning', 'Benjamin', false),
  E('2026-09-05', 120, 'Segmentation build'),
  E('2026-09-05', 60, 'Deliverability review'),
])
check('billable and non-billable split', mixed.length, 2)
check('billable row leads', mixed.map(d => d.billable), [true, false])
check('billable hours', mixed[0]?.minutes, 180)
check('non-billable hours', mixed[1]?.minutes, 30)

// Estimates never merge into tracked time.
const est = combineByDay([
  E('2026-09-06', 60, 'Tracked work'),
  E('2026-09-06', 600, 'Recalled work', 'Benjamin', true, true),
])
check('estimate kept separate', est.map(d => d.is_estimate), [false, true])

// Days come out in date order whatever order they went in.
const scrambled = combineByDay([
  E('2026-09-10', 6, 'c'), E('2026-09-02', 6, 'a'), E('2026-09-07', 6, 'b'),
])
check('sorted by date', scrambled.map(d => d.entry_date), ['2026-09-02', '2026-09-07', '2026-09-10'])

// Blank descriptions do not leave empty bullets behind.
const blank = combineByDay([E('2026-09-08', 30, '  '), E('2026-09-08', 30, 'Real work')])
check('blank description dropped', blank[0]?.descriptions, ['Real work'])

// Across everything, not a minute is lost or double-counted.
const all = [
  ...[E('2026-09-03', 60, 'a'), E('2026-09-03', 90, 'b')],
  ...[E('2026-09-04', 60, 's', 'Benjamin'), E('2026-09-04', 60, 's', 'Shane')],
  ...[E('2026-09-05', 30, 'x', 'Benjamin', false), E('2026-09-05', 120, 'y')],
]
check('total minutes conserved',
  combineByDay(all).reduce((s, d) => s + d.minutes, 0),
  all.reduce((s, e) => s + e.minutes, 0))

check('no entries, no rows', combineByDay([]), [])

// ─────────────────────────────────────────────────────────────────────────────
// THE MATH
//
// What a client does with this document: add up the Hours column and compare
// it to the Total. That has to come out exactly — in minutes, and in the
// tenths-of-an-hour the page actually prints.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── math ──')

// Worked by hand, so the arithmetic is visible.
//   3 Sep  0.5 + 1.2 + 0.3        = 2.0 h billable
//   4 Sep  1.0 (Ben) + 1.0 (Shane) = 2.0 h billable, one joint meeting
//   5 Sep  2.4 billable, 0.6 non-billable
//   1 Jan  10.0 estimated, listed but kept out of the Total
//   Tracked 2.0 + 2.0 + 2.4 + 0.6 = 7.0   Billable 6.4   Estimated 10.0
const worked = [
  E('2026-09-03', 30, 'Kick-off'), E('2026-09-03', 72, 'Data model'), E('2026-09-03', 18, 'Plan'),
  E('2026-09-04', 60, 'Stakeholder call', 'Benjamin'), E('2026-09-04', 60, 'Stakeholder call', 'Shane'),
  E('2026-09-05', 144, 'Segmentation'), E('2026-09-05', 36, 'Internal', 'Benjamin', false),
  E('2026-01-01', 600, 'Recalled', 'Benjamin', true, true),
]
const wDays = combineByDay(worked)
const wTot = reportTotals(worked)
check('3 Sep prints 2.0', hoursLabel(wDays.find(d => d.entry_date === '2026-09-03')?.minutes), '2.0')
check('4 Sep counts both people: 2.0', hoursLabel(wDays.find(d => d.entry_date === '2026-09-04')?.minutes), '2.0')
check('5 Sep billable prints 2.4', hoursLabel(wDays.find(d => d.entry_date === '2026-09-05' && d.billable)?.minutes), '2.4')
check('5 Sep non-billable prints 0.6', hoursLabel(wDays.find(d => d.entry_date === '2026-09-05' && !d.billable)?.minutes), '0.6')
check('Total prints 7.0', hoursLabel(wTot.trackedMin), '7.0')
check('Billable prints 6.4', hoursLabel(wTot.billableMin), '6.4')
check('Estimated prints 10.0', hoursLabel(wTot.estimateMin), '10.0')

// Then the same reconciliation across a large random month. Seeded, so a
// failure reproduces exactly.
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
}
const rand = rng(20260903)
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
const PEOPLE = ['Benjamin', 'Shane'] as const
const WORK = ['Kick-off', 'Data model', 'Segmentation', 'Stakeholder call', 'Deliverability', 'Plan'] as const

const TRIALS = 200
let tenthsDrift = 0, minuteDrift = 0, groupDrift = 0, splitLeaks = 0

for (let t = 0; t < TRIALS; t++) {
  const entries: TimeReportEntry[] = Array.from({ length: 5 + Math.floor(rand() * 60) }, () =>
    E(`2026-09-${String(1 + Math.floor(rand() * 30)).padStart(2, '0')}`,
      6 * (1 + Math.floor(rand() * 40)),           // every entry is a whole number of tenths
      pick(WORK), pick(PEOPLE), rand() > 0.15, rand() < 0.05))

  const days = combineByDay(entries)
  const tot = reportTotals(entries)
  const tracked = days.filter(d => !d.is_estimate)

  // Minutes: the tracked rows sum to exactly the Total; every row sums to everything.
  const rowMin = tracked.reduce((s, d) => s + d.minutes, 0)
  if (rowMin !== tot.trackedMin) minuteDrift++
  if (days.reduce((s, d) => s + d.minutes, 0) !== tot.trackedMin + tot.estimateMin) minuteDrift++
  if (tracked.filter(d => d.billable).reduce((s, d) => s + d.minutes, 0) !== tot.billableMin) minuteDrift++

  // Printed tenths: add up the column as a reader would — in integer tenths, so
  // floating point cannot excuse a mismatch — and compare to the printed Total.
  const columnTenths = tracked.reduce((s, d) => s + Math.round(Number(hoursLabel(d.minutes)) * 10), 0)
  if (columnTenths !== Math.round(Number(hoursLabel(tot.trackedMin)) * 10)) tenthsDrift++

  // Each row is the exact sum of the entries it claims.
  for (const d of days) {
    const own = entries.filter(e => e.entry_date === d.entry_date
      && e.billable === d.billable && e.is_estimate === d.is_estimate)
    if (own.reduce((s, e) => s + e.minutes, 0) !== d.minutes) groupDrift++
  }

  // No date appears twice with the same flags — i.e. nothing that should have
  // combined was left split.
  const keys = days.map(d => `${d.entry_date}|${d.billable}|${d.is_estimate}`)
  if (new Set(keys).size !== keys.length) splitLeaks++
}

check(`${TRIALS} random months: rows sum to the Total in minutes`, minuteDrift, 0)
check(`${TRIALS} random months: printed column sums to printed Total`, tenthsDrift, 0)
check(`${TRIALS} random months: every row equals its own entries`, groupDrift, 0)
check(`${TRIALS} random months: no day left split`, splitLeaks, 0)

console.log(failures === 0 ? '\nAll cases pass' : `\n${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
