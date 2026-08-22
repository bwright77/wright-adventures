// ============================================================
// ADR-008 — Pipeline Analytics computation helpers
// Pure functions, no Supabase calls. All data from existing query cache.
// ============================================================

import { differenceInDays } from 'date-fns'
import type { Opportunity, DealConfidence, EngagementNature } from './types'

// Opportunity extended with opportunity_details fields needed for analytics
export type OpportunityWithDetails = Opportunity & {
  opportunity_details?: {
    logo_url: string | null
    confidence: DealConfidence | null
    next_action_date: string | null
  } | null
}

// Nature and worth moved to engagements in ADR-012: they describe the WORK, and
// an opportunity that was never won has no work to describe. Only the minimum
// needed here.
export interface EngagementForMetrics {
  opportunity_id: string | null
  nature: EngagementNature
  contract_value: number | string | null   // NUMERIC arrives as a string
  fmv: number | string | null
}

// Work that is real but is not a sales outcome. Counting it would put win rate
// at 80% off four ~$0 deals and drag average deal size to nothing, so it is
// excluded from the commercial metrics and reported separately.
//
// 'strategic' belongs here despite carrying an expected return: the return
// arrives as grant-funded technical support later, not as cash booked against
// this engagement. Reporting it as investment rather than revenue keeps both
// numbers honest.
const NON_COMMERCIAL: ReadonlySet<string> = new Set(['portfolio', 'pro_bono', 'strategic'])

/** Nature is only known once work exists, so it is looked up by opportunity. */
function makeIsCommercial(engagements: EngagementForMetrics[]) {
  const natureByOpp = new Map(
    engagements.filter(e => e.opportunity_id).map(e => [e.opportunity_id as string, e.nature]),
  )
  return (o: OpportunityWithDetails): boolean =>
    !NON_COMMERCIAL.has(natureByOpp.get(o.id) ?? 'paid')
}

// ── Stage definitions ─────────────────────────────────────────

// Mirrors pipeline_statuses. 'partnership_prospecting' used to sit at the top of
// this list and matched no row in the database at all, so the funnel silently
// showed an always-empty first stage.
export const PARTNERSHIP_STAGES = [
  { id: 'qualifying',  label: 'Qualifying'  },
  { id: 'discovery',   label: 'Discovery'   },
  { id: 'proposal',    label: 'Proposal'    },
  { id: 'evaluation',  label: 'Evaluation'  },
  { id: 'approval',    label: 'Approval'    },
  { id: 'negotiating', label: 'Negotiation' },
  { id: 'closed_won',  label: 'Closed-Won'  },
  { id: 'closed_lost', label: 'Closed-Lost' },
] as const

const CLOSED_PARTNERSHIP_STATUSES = new Set([
  'closed_won', 'closed_lost',
])

const CONFIDENCE_MULTIPLIERS: Record<DealConfidence, number> = {
  low:    0.2,
  medium: 0.5,
  high:   0.8,
}

// ── Output types ──────────────────────────────────────────────

export interface PartnershipStageStat {
  id: string
  label: string
  count: number
  totalValue: number
  weightedValue: number
  pct: number   // % of all partnerships (by count)
}

export interface PartnershipMetrics {
  activeCount: number
  totalPipelineValue: number
  stages: PartnershipStageStat[]
  winRate: number | null
  contributedValue: number
  contributedCount: number
  avgDealAgeDays: number | null
  weightedPipeline: number
  dealsAtRisk: number
  confidenceCounts: { low: number; medium: number; high: number }
}

// ── Computation ───────────────────────────────────────────────

export function computePartnershipMetrics(
  opps: OpportunityWithDetails[],
  engagements: EngagementForMetrics[] = [],
): PartnershipMetrics {
  const isCommercial  = makeIsCommercial(engagements)
  // Leads live in their own table now — everything here is an opportunity.
  const partnerships  = opps
  const active        = partnerships.filter(o => !CLOSED_PARTNERSHIP_STATUSES.has(o.status))
  const activeCount   = active.length
  const totalPipelineValue = active.filter(isCommercial).reduce((s, o) => s + (o.estimated_value ?? 0), 0)

  // What the portfolio and pro-bono work would have been worth at standard rate.
  // Read off the engagements themselves: the contributed work is the work, and
  // FMV is what it was worth whatever was actually collected.
  const contributed = engagements.filter(e => NON_COMMERCIAL.has(e.nature))
  const contributedValue = contributed.reduce(
    (sum, e) => sum + Number(e.fmv ?? e.contract_value ?? 0), 0,
  )
  const contributedCount = contributed.length

  const total = partnerships.length
  const stages: PartnershipStageStat[] = PARTNERSHIP_STAGES.map(stage => {
    const inStage       = partnerships.filter(o => o.status === stage.id)
    const count         = inStage.length
    const totalValue    = inStage.reduce((s, o) => s + (o.estimated_value ?? 0), 0)
    const weightedValue = inStage.reduce((s, o) => {
      const conf = o.opportunity_details?.confidence ?? null
      const m    = conf ? CONFIDENCE_MULTIPLIERS[conf] : CONFIDENCE_MULTIPLIERS.low
      return s + (o.estimated_value ?? 0) * m
    }, 0)
    return { id: stage.id, label: stage.label, count, totalValue, weightedValue, pct: total > 0 ? Math.round((count / total) * 100) : 0 }
  })

  const commercial  = partnerships.filter(isCommercial)
  const closedWon   = commercial.filter(o => o.status === 'closed_won').length
  const closedLost  = commercial.filter(o => o.status === 'closed_lost').length
  const closedTotal = closedWon + closedLost
  const winRate     = closedTotal > 0 ? Math.round((closedWon / closedTotal) * 100) : null

  const now = new Date()
  const avgDealAgeDays = active.length > 0
    ? Math.round(active.reduce((s, o) => s + differenceInDays(now, new Date(o.created_at)), 0) / active.length)
    : null

  const weightedPipeline = active.reduce((s, o) => {
    const conf = o.opportunity_details?.confidence ?? null
    const m    = conf ? CONFIDENCE_MULTIPLIERS[conf] : CONFIDENCE_MULTIPLIERS.low
    return s + (o.estimated_value ?? 0) * m
  }, 0)

  const dealsAtRisk = active.filter(o => {
    const nad = o.opportunity_details?.next_action_date
    return !nad || new Date(nad) < now
  }).length

  const confidenceCounts = { low: 0, medium: 0, high: 0 }
  for (const o of active) {
    const conf = o.opportunity_details?.confidence ?? 'low'
    confidenceCounts[conf]++
  }

  return { activeCount, totalPipelineValue, stages, winRate, avgDealAgeDays,
           weightedPipeline, dealsAtRisk, confidenceCounts, contributedValue, contributedCount }
}

// ── Shared utility ────────────────────────────────────────────

export function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return n > 0 ? `$${n.toLocaleString()}` : '—'
}
