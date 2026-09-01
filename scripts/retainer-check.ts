// Asserts the retainer figures, above all the ones the CMC checkpoint reviews
// are contractually required to report.
import { retainerStatus, parseDuration, parseBillable, toBillingMinutes, formatHours } from '../src/lib/retainer'

const TODAY = new Date(2026, 8, 15)          // Sep 15: 14 of 122 term days, ~11.5%
const TERMS = {
  committed_hours: 160, hours_per_period: 40, max_hours_per_period: 60,
  contract_rate: 150, started_on: '2026-09-01', ended_on: '2027-01-01',
}
const day = (d: number) => `2026-09-${String(d).padStart(2, '0')}`

let pass = 0, total = 0
const check = (name: string, got: unknown, want: unknown, why: string) => {
  total++
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name.padEnd(34)} ${String(got).padEnd(10)} ${why}`)
  if (!ok) console.log(`       expected ${want}`)
}

// 55 hours in month one — the SOW's own Phase 1 estimate, which exceeds the
// 40-hour commitment and is why the effective rate matters from day one.
const entries = [{ entry_date: day(10), minutes: 55 * 60, billable: true }]
const ledger = [
  { entry_type: 'credit' as const, hours: 160, created_at: day(1) },
  { entry_type: 'debit'  as const, hours: -55, created_at: day(10) },
]
const periods = [
  { period_number: 1, period_start: day(1), period_end: day(30), hours_granted: 40, fee: 6000, status: 'invoiced' as const },
  { period_number: 2, period_start: '2026-10-01', period_end: '2026-10-31', hours_granted: 40, fee: 6000, status: 'scheduled' as const },
]
const s = retainerStatus(TERMS, ledger, periods, entries, TODAY)

check('balance', s.balance, 105, 'ledger sum, not a stored column')
check('hours used', s.hoursUsed, 55, 'debits, positive')
check('drawn this month', s.drawnThisMonth, 55, 'against a 40 commitment')
check('over the 60 ceiling', s.overCeiling, false, '55 is under 60 — draw-ahead is allowed')
check('invoiced to date', s.invoicedToDate, 6000, 'only period 1 has been invoiced')
check('effective rate', Math.round(s.effectiveRate!), 109, 'THE warning: $109 against a $150 contract rate')
// Straight-line projection at 11.5% elapsed. Reads as a big overrun because the
// SOW front-loads Phase 1 — the plan, not the tool, is what makes it look bad.
check('projected hours', Math.round(s.projectedHours!), 471, '55 hrs at 11.5% elapsed')
check('on pace to overrun', s.onPaceToOverrun, true, 'front-loaded: linear projection over-reads')

// Push past the ceiling.
const over = retainerStatus(TERMS, ledger, periods,
  [{ entry_date: day(12), minutes: 62 * 60, billable: true }], TODAY)
check('62 hrs trips the ceiling', over.overCeiling, true, 'a constraint on draw rate, not a billing line')

// A month at the full commitment should read as exactly the contract rate.
const atRate = retainerStatus(TERMS,
  [{ entry_type: 'credit', hours: 160, created_at: day(1) }, { entry_type: 'debit', hours: -40, created_at: day(20) }],
  periods, [{ entry_date: day(20), minutes: 40 * 60, billable: true }], TODAY)
check('40 hrs = the contract rate', Math.round(atRate.effectiveRate!), 150, 'the retainer delivered as priced')

// Non-billable time never draws the retainer.
const nonBillable = retainerStatus(TERMS, ledger, periods,
  [{ entry_date: day(10), minutes: 55 * 60, billable: true }, { entry_date: day(11), minutes: 300, billable: false }], TODAY)
check('non-billable is excluded', nonBillable.drawnThisMonth, 55, 'logged for the record, not drawn')

// Raw parsing — before rounding.
for (const [input, want] of [['2.5', 150], ['2.5h', 150], ['90m', 90], ['1:30', 90], ['', null], ['soon', null]] as const)
  check(`parse "${input}"`, parseDuration(input), want, 'a bare number means hours')

// The billing increment: six minutes, always UP. Never round down — that gives
// away time already worked.
check('5 min bills',  toBillingMinutes(5),  6,   '0.1 h')
check('6 min bills',  toBillingMinutes(6),  6,   'exact, unchanged')
check('7 min bills',  toBillingMinutes(7),  12,  '0.2 h — the case Ben named')
check('1 min bills',  toBillingMinutes(1),  6,   'a minute still bills a tenth')
check('60 min bills', toBillingMinutes(60), 60,  'a whole hour is untouched')
check('61 min bills', toBillingMinutes(61), 66,  '1.1 h')
check('0 min bills',  toBillingMinutes(0),  0,   'nothing bills nothing')

check('"5m" end to end',  parseBillable('5m'),  6,   'typed as minutes, billed as a tenth')
check('"0.1" end to end', parseBillable('0.1'), 6,   'a tenth is exactly six minutes')
check('"1.33" rounds up', parseBillable('1.33'), 84, '79.8 raw → 1.4 h')

check('format 6',   formatHours(6),   '0.1', 'tenths, which is how it bills')
check('format 150', formatHours(150), '2.5', '')

// The stopwatch commits whatever the clock shows, rounded up — the numbers
// people will actually see between pressing stop and pressing log.
for (const [minutesOnClock, want] of [[0.5, 6], [5, 6], [6, 6], [7, 12], [61, 66], [90, 90]] as const)
  check(`stopwatch ${minutesOnClock} min`, toBillingMinutes(minutesOnClock), want, `bills ${formatHours(want)} h`)

// Starting the timer late: banked minutes plus whatever the clock has run,
// rounded once at the end rather than per-part.
const late = (creditedMin: number, ranMin: number) => toBillingMinutes(creditedMin + ranMin)
check('credited 10, ran 0',   late(10, 0),  12,  '10 min → 0.2 h')
check('credited 10, ran 5',   late(10, 5),  18,  '15 min → 0.3 h')
check('credited 10, ran 2',   late(10, 2),  12,  '12 min is exact → 0.2 h')
check('credited 5, ran 1',    late(5, 1),   6,   'rounds once at the end, not per part')
check('credited 30, ran 31',  late(30, 31), 66,  '61 min → 1.1 h')

console.log(`\n${pass}/${total}`)
process.exit(pass === total ? 0 : 1)
