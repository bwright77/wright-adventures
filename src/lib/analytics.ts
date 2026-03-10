// ============================================================
// ADR-008 — Pipeline Analytics computation helpers
// Pure functions, no Supabase calls. All data from existing query cache.
// ============================================================

import { differenceInDays } from 'date-fns'
import type { Opportunity, DealConfidence } from './types'

// Opportunity extended with partnership_details fields needed for analytics
export type OpportunityWithDetails = Opportunity & {
  partnership_details?: {
    logo_url: string | null
    confidence: DealConfidence | null
    next_action_date: string | null
  } | null
}

// ── Stage definitions ─────────────────────────────────────────

export const GRANT_STAGES = [
  { id: 'grant_identified',   label: 'Identified'   },
  { id: 'grant_evaluating',   label: 'Evaluating'   },
  { id: 'grant_preparing',    label: 'Preparing'    },
  { id: 'grant_submitted',    label: 'Submitted'    },
  { id: 'grant_under_review', label: 'Under Review' },
  { id: 'grant_awarded',      label: 'Awarded'      },
  { id: 'grant_declined',     label: 'Declined'     },
] as const

export const PARTNERSHIP_STAGES = [
  { id: 'partnership_prospecting', label: 'Prospecting' },
  { id: 'partnership_qualifying',  label: 'Qualifying'  },
  { id: 'partnership_discovery',   label: 'Discovery'   },
  { id: 'partnership_proposal',    label: 'Proposal'    },
  { id: 'partnership_negotiating', label: 'Negotiating' },
  { id: 'partnership_closed_won',  label: 'Closed-Won'  },
  { id: 'partnership_closed_lost', label: 'Closed-Lost' },
] as const

const INACTIVE_GRANT_STATUSES = new Set([
  'grant_archived', 'grant_declined', 'grant_withdrawn', 'grant_discovered',
])
const CLOSED_PARTNERSHIP_STATUSES = new Set([
  'partnership_closed_won', 'partnership_closed_lost',
])

const CONFIDENCE_MULTIPLIERS: Record<DealConfidence, number> = {
  low:    0.2,
  medium: 0.5,
  high:   0.8,
}

// ── Output types ──────────────────────────────────────────────

export interface GrantStageStat {
  id: string
  label: string
  count: number
  totalRequested: number
  pct: number   // % of all non-discovered grants (by count)
}

export interface GrantMetrics {
  activeCount: number         // not archived / declined / withdrawn / discovered
  totalPipelineValue: number  // sum of amount_requested on active grants
  stages: GrantStageStat[]
  winRate: number | null      // null if no closed grants yet
  avgDaysToSubmission: number | null
  totalAwarded: number        // sum of amount_awarded for awarded grants
  upcomingDeadlines: number   // active grants with deadline in next 30 days
}

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
  avgDealAgeDays: number | null
  weightedPipeline: number
  dealsAtRisk: number
  confidenceCounts: { low: number; medium: number; high: number }
}

// ── Computation ───────────────────────────────────────────────

export function computeGrantMetrics(opps: Opportunity[]): GrantMetrics {
  const grants = opps.filter(o => o.type_id === 'grant' && o.status !== 'grant_discovered')

  const activeGrants = grants.filter(o => !INACTIVE_GRANT_STATUSES.has(o.status))
  const activeCount  = activeGrants.length
  const totalPipelineValue = activeGrants.reduce((s, o) => s + (o.amount_requested ?? 0), 0)

  const total = grants.length
  const stages: GrantStageStat[] = GRANT_STAGES.map(stage => {
    const inStage        = grants.filter(o => o.status === stage.id)
    const count          = inStage.length
    const totalRequested = inStage.reduce((s, o) => s + (o.amount_requested ?? 0), 0)
    return { id: stage.id, label: stage.label, count, totalRequested, pct: total > 0 ? Math.round((count / total) * 100) : 0 }
  })

  const awarded     = grants.filter(o => o.status === 'grant_awarded').length
  const declined    = grants.filter(o => o.status === 'grant_declined').length
  const withdrawn   = grants.filter(o => o.status === 'grant_withdrawn').length
  const closedTotal = awarded + declined + withdrawn
  const winRate     = closedTotal > 0 ? Math.round((awarded / closedTotal) * 100) : null

  // Avg days: primary_deadline - created_at for grants that have been submitted or further
  const submitted = grants.filter(o =>
    ['grant_submitted', 'grant_under_review', 'grant_awarded', 'grant_declined'].includes(o.status) &&
    o.primary_deadline
  )
  const avgDaysToSubmission = submitted.length > 0
    ? Math.round(
        submitted.reduce((s, o) => s + Math.max(0, differenceInDays(new Date(o.primary_deadline!), new Date(o.created_at))), 0)
        / submitted.length
      )
    : null

  const totalAwarded = grants
    .filter(o => o.status === 'grant_awarded')
    .reduce((s, o) => s + (o.amount_awarded ?? 0), 0)

  const now    = new Date()
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() + 30)
  const upcomingDeadlines = activeGrants.filter(o => {
    if (!o.primary_deadline) return false
    const d = new Date(o.primary_deadline)
    return d >= now && d <= cutoff
  }).length

  return { activeCount, totalPipelineValue, stages, winRate, avgDaysToSubmission, totalAwarded, upcomingDeadlines }
}

export function computePartnershipMetrics(opps: OpportunityWithDetails[]): PartnershipMetrics {
  const partnerships  = opps.filter(o => o.type_id === 'partnership')
  const active        = partnerships.filter(o => !CLOSED_PARTNERSHIP_STATUSES.has(o.status))
  const activeCount   = active.length
  const totalPipelineValue = active.reduce((s, o) => s + (o.estimated_value ?? 0), 0)

  const total = partnerships.length
  const stages: PartnershipStageStat[] = PARTNERSHIP_STAGES.map(stage => {
    const inStage       = partnerships.filter(o => o.status === stage.id)
    const count         = inStage.length
    const totalValue    = inStage.reduce((s, o) => s + (o.estimated_value ?? 0), 0)
    const weightedValue = inStage.reduce((s, o) => {
      const conf = o.partnership_details?.confidence ?? null
      const m    = conf ? CONFIDENCE_MULTIPLIERS[conf] : CONFIDENCE_MULTIPLIERS.low
      return s + (o.estimated_value ?? 0) * m
    }, 0)
    return { id: stage.id, label: stage.label, count, totalValue, weightedValue, pct: total > 0 ? Math.round((count / total) * 100) : 0 }
  })

  const closedWon   = partnerships.filter(o => o.status === 'partnership_closed_won').length
  const closedLost  = partnerships.filter(o => o.status === 'partnership_closed_lost').length
  const closedTotal = closedWon + closedLost
  const winRate     = closedTotal > 0 ? Math.round((closedWon / closedTotal) * 100) : null

  const now = new Date()
  const avgDealAgeDays = active.length > 0
    ? Math.round(active.reduce((s, o) => s + differenceInDays(now, new Date(o.created_at)), 0) / active.length)
    : null

  const weightedPipeline = active.reduce((s, o) => {
    const conf = o.partnership_details?.confidence ?? null
    const m    = conf ? CONFIDENCE_MULTIPLIERS[conf] : CONFIDENCE_MULTIPLIERS.low
    return s + (o.estimated_value ?? 0) * m
  }, 0)

  const dealsAtRisk = active.filter(o => {
    const nad = o.partnership_details?.next_action_date
    return !nad || new Date(nad) < now
  }).length

  const confidenceCounts = { low: 0, medium: 0, high: 0 }
  for (const o of active) {
    const conf = o.partnership_details?.confidence ?? 'low'
    confidenceCounts[conf]++
  }

  return { activeCount, totalPipelineValue, stages, winRate, avgDealAgeDays, weightedPipeline, dealsAtRisk, confidenceCounts }
}

// ── Shared utility ────────────────────────────────────────────

export function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return n > 0 ? `$${n.toLocaleString()}` : '—'
}
