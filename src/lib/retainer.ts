// =============================================================================
// retainer.ts — the figures the CMC checkpoint reviews are contractually
// required to report, derived rather than stored.
//
// Balance is the SUM of the ledger, never a column. That is the whole point of
// the ledger: a correction or a refund is a new row, and every number below
// stays derivable from the same source instead of drifting from it.
//
// Pure functions, no Supabase — see scripts/retainer-check.ts.
// =============================================================================

export interface LedgerRow {
  entry_type: 'credit' | 'debit' | 'adjustment'
  /** Positive grants, negative consumes. NUMERIC arrives as a string. */
  hours: number | string
  created_at: string
}

export interface PeriodRow {
  period_number: number
  period_start: string
  period_end: string
  hours_granted: number | string
  fee: number | string
  status: 'scheduled' | 'invoiced' | 'paid' | 'refunded' | 'cancelled'
}

export interface TimeEntryRow {
  entry_date: string
  minutes: number
  billable: boolean
}

export interface RetainerTerms {
  committed_hours: number | string | null
  hours_per_period: number | string | null
  max_hours_per_period: number | string | null
  contract_rate: number | string | null
  started_on: string | null
  ended_on: string | null
}

const n = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

export interface RetainerStatus {
  /** Ledger sum. Hours still available to draw. */
  balance: number
  /** Total drawn, as a positive number. */
  hoursUsed: number
  committed: number
  /** Hours drawn within the current calendar month. */
  drawnThisMonth: number
  monthlyCeiling: number
  /** True once this month's draw has passed the ceiling the SOW sets. */
  overCeiling: boolean
  /** Money invoiced so far — periods past 'scheduled'. */
  invoicedToDate: number
  /**
   * Fee invoiced ÷ hours worked. Falls as hours accumulate against a fixed fee,
   * so it is the early warning that a retainer is being over-delivered. At 40
   * hours CMC is $150/hr; at 55 it is $109. Meaningless in the first days, when
   * a couple of hours against a full month's fee gives an absurd number.
   */
  effectiveRate: number | null
  /** Share of the term elapsed, 0–1. Null when the term has no dates. */
  termElapsed: number | null
  /**
   * Hours projected for the full term at the current burn rate, straight-line.
   *
   * Read it with the plan in hand. The CMC SOW is deliberately front-loaded —
   * Phase 1 estimates 55 hours against a 40-hour month — so an honest linear
   * projection reads as a large overrun in September even when the work is
   * exactly on plan. Effective rate is the sharper early warning; this is the
   * blunt one.
   */
  projectedHours: number | null
  /** Projected to exceed the commitment. */
  onPaceToOverrun: boolean
}

export function retainerStatus(
  terms: RetainerTerms,
  ledger: readonly LedgerRow[],
  periods: readonly PeriodRow[],
  entries: readonly TimeEntryRow[],
  today: Date,
): RetainerStatus {
  const balance = ledger.reduce((s, r) => s + n(r.hours), 0)
  const hoursUsed = -ledger.filter(r => r.entry_type === 'debit').reduce((s, r) => s + n(r.hours), 0)
  const committed = n(terms.committed_hours)

  const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const drawnThisMonth = entries
    .filter(e => e.billable && e.entry_date.startsWith(ym))
    .reduce((s, e) => s + e.minutes / 60, 0)

  const monthlyCeiling = n(terms.max_hours_per_period)
  const invoicedToDate = periods
    .filter(p => p.status !== 'scheduled' && p.status !== 'cancelled')
    .reduce((s, p) => s + n(p.fee), 0)

  let termElapsed: number | null = null
  let projectedHours: number | null = null
  if (terms.started_on && terms.ended_on) {
    const start = new Date(terms.started_on).getTime()
    const end = new Date(terms.ended_on).getTime()
    const now = today.getTime()
    if (end > start) {
      termElapsed = Math.min(1, Math.max(0, (now - start) / (end - start)))
      // Below roughly a week of elapsed term the projection is noise, so it is
      // withheld rather than reported as a wild number.
      if (termElapsed > 0.05) projectedHours = hoursUsed / termElapsed
    }
  }

  return {
    balance,
    hoursUsed,
    committed,
    drawnThisMonth,
    monthlyCeiling,
    overCeiling: monthlyCeiling > 0 && drawnThisMonth > monthlyCeiling,
    invoicedToDate,
    effectiveRate: hoursUsed > 0 ? invoicedToDate / hoursUsed : null,
    termElapsed,
    projectedHours,
    onPaceToOverrun: projectedHours != null && committed > 0 && projectedHours > committed,
  }
}

/** "2.5", "2.5h", "150m", "1:30" → minutes. Null when it cannot be read. */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase()
  if (!s) return null

  const hm = /^(\d+):([0-5]\d)$/.exec(s)
  if (hm) return Number(hm[1]) * 60 + Number(hm[2])

  const mins = /^(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?$/.exec(s)
  if (mins) return Math.round(Number(mins[1]))

  const hrs = /^(\d+(?:\.\d+)?)\s*h(?:ou)?r?s?$/.exec(s)
  if (hrs) return Math.round(Number(hrs[1]) * 60)

  const bare = /^(\d+(?:\.\d+)?)$/.exec(s)
  if (bare) return Math.round(Number(bare[1]) * 60)   // a bare number means hours

  return null
}

/** 150 → "2h 30m". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}
