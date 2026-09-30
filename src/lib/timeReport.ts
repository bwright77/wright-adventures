// =============================================================================
// timeReport.ts — the shaping behind the time report PDF, kept free of the
// renderer so it can be tested without fonts, images or @react-pdf.
// Same discipline as retainer.ts and fitRubric.ts.
// =============================================================================

export interface TimeReportEntry {
  entry_date: string
  minutes: number
  description: string
  billable: boolean
  is_estimate: boolean
  who: string
}

/** One line of the report: a day's work, combined. */
export interface DayRow {
  entry_date: string
  minutes: number
  who: string[]
  descriptions: string[]
  billable: boolean
  is_estimate: boolean
}

/**
 * Combine each day's entries into a single line — hours summed, descriptions
 * gathered — so a day reads as a day rather than as a list of timer stops.
 *
 * Grouped by date AND by billable / estimated, not by date alone. The summary
 * above the table reports billable and non-billable separately and leaves
 * estimates out of the total entirely, so one row blending them would print a
 * figure for the day that matches none of those numbers. An ordinary day — all
 * billable, all tracked — is still exactly one row.
 *
 * Descriptions keep the order they arrive in, so pass entries chronologically.
 * Identical descriptions collapse: logging a meeting for two people writes the
 * same line twice, and the report should say it once.
 */
export function combineByDay(entries: TimeReportEntry[]): DayRow[] {
  const groups = new Map<string, DayRow>()

  for (const e of entries) {
    const key = `${e.entry_date}|${e.billable}|${e.is_estimate}`
    let g = groups.get(key)
    if (!g) {
      g = {
        entry_date: e.entry_date, minutes: 0, who: [], descriptions: [],
        billable: e.billable, is_estimate: e.is_estimate,
      }
      groups.set(key, g)
    }
    g.minutes += e.minutes
    if (!g.who.includes(e.who)) g.who.push(e.who)
    const d = e.description.trim()
    if (d && !g.descriptions.includes(d)) g.descriptions.push(d)
  }

  // Array.prototype.sort is stable, so within one day the billable row leads
  // and the arrival order of everything else is kept.
  return [...groups.values()].sort((a, b) =>
    a.entry_date.localeCompare(b.entry_date)
    || Number(b.billable) - Number(a.billable)
    || Number(a.is_estimate) - Number(b.is_estimate))
}

/** Minutes as the report prints them: tenths of an hour, "2.5". */
export const hoursLabel = (minutes: number) => (minutes / 60).toFixed(1)

export interface ReportTotals {
  /** Tracked time — everything except estimates. The report's Total. */
  trackedMin: number
  /** The billable share of tracked time. */
  billableMin: number
  /** Recalled time, listed but kept out of the Total. */
  estimateMin: number
}

/**
 * The figures in the summary and the Total row, computed from the raw entries.
 *
 * Kept here, not inline in the PDF, so the check script can reconcile the table
 * against exactly the numbers the document prints rather than a reimplementation
 * of them.
 */
export function reportTotals(entries: TimeReportEntry[]): ReportTotals {
  let trackedMin = 0, billableMin = 0, estimateMin = 0
  for (const e of entries) {
    if (e.is_estimate) { estimateMin += e.minutes; continue }
    trackedMin += e.minutes
    if (e.billable) billableMin += e.minutes
  }
  return { trackedMin, billableMin, estimateMin }
}
