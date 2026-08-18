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

export const PARTNERSHIP_STAGES = [
  { id: 'partnership_prospecting', label: 'Prospecting' },
  { id: 'partnership_qualifying',  label: 'Qualifying'  },
  { id: 'partnership_discovery',   label: 'Discovery'   },
  { id: 'partnership_proposal',    label: 'Proposal'    },
  { id: 'partnership_negotiating', label: 'Negotiating' },
  { id: 'partnership_closed_won',  label: 'Closed-Won'  },
  { id: 'partnership_closed_lost', label: 'Closed-Lost' },
] as const

const CLOSED_PARTNERSHIP_STATUSES = new Set([
  'partnership_closed_won', 'partnership_closed_lost',
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
  avgDealAgeDays: number | null
  weightedPipeline: number
  dealsAtRisk: number
  confidenceCounts: { low: number; medium: number; high: number }
}

// ── Computation ───────────────────────────────────────────────

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
