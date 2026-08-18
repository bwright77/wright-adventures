// =============================================================================
// fitRubric.ts — Wright Adventures opportunity-fit rubric (ADR-011).
//
// The scoring contract for the discovery pipeline: seven dimensions, 0–3 each,
// 21 max. Pure data + pure functions — no Supabase, no fetch — so the banding
// logic is unit-testable in isolation (same discipline as state-utils.ts).
//
// This replaces the Confluence grant-scoring rubric that left with the ADR-009
// split. We are scoring for Wright Adventures' own pipeline now: what should
// this firm pursue?
// =============================================================================

export type FitDimension =
  | 'engagement_shape'
  | 'warm_path'
  | 'both_halves'
  | 'contract_value'
  | 'expansion'
  | 'mission_alignment'
  | 'portfolio_proof'

export type FitAction = 'pursue_hard' | 'pursue_lean' | 'monitor' | 'decline'

export interface FitScores {
  engagement_shape: number
  warm_path: number
  both_halves: number
  contract_value: number
  expansion: number
  mission_alignment: number
  portfolio_proof: number
}

export interface FitAssessment {
  scores: FitScores
  total: number
  action: FitAction
  /** Gates that downgraded the raw band, in the order applied. */
  downgrades: string[]
  rationale: string
  green_flags: string[]
  red_flags: string[]
  /** Dimensions the posting gave no signal on — scored conservatively. */
  uncertain: FitDimension[]
}

export const MAX_FIT_SCORE = 21

export const DIMENSION_LABELS: Record<FitDimension, string> = {
  engagement_shape:  'Engagement shape',
  warm_path:         'Warm path in',
  both_halves:       'Both halves needed',
  contract_value:    'Contract value & duration',
  expansion:         'Expansion potential',
  mission_alignment: 'Mission alignment',
  portfolio_proof:   'Portfolio proof',
}

// ── Banding ──────────────────────────────────────────────────────────────────
//
// Calibrated against the worked examples in the rubric rather than the stated
// "21+ / 15–20 / under 15" bands, which no real opportunity can reach — 21 is a
// perfect score, yet CMC and GOBRP both scored 19 and were pursued and won.
//
//   CMC              19  shape 2  warm 3  → pursue_hard   ("Pursued, won")
//   GOBRP            19  shape 2  warm 3  → pursue_hard   ("Pursued, filed")
//   Climate Democracy 15 shape 3  warm 1  → pursue_lean   ("Lean proposal")
//   Nourish Colorado 15  shape 0  warm 1  → monitor       ("Deprioritized")
//   United Way ER    13  shape 3  warm 0  → decline       ("Two-page letter at most")
//   Real Life CO     12  shape 3  warm 0  → decline       ("Ask if open, don't build")
//
export const BAND_PURSUE_HARD = 18
export const BAND_PURSUE_LEAN = 14

const ORDER: FitAction[] = ['pursue_hard', 'pursue_lean', 'monitor', 'decline']

function downgrade(action: FitAction): FitAction {
  const i = ORDER.indexOf(action)
  return ORDER[Math.min(i + 1, ORDER.length - 1)]
}

export function totalScore(scores: FitScores): number {
  return (
    scores.engagement_shape +
    scores.warm_path +
    scores.both_halves +
    scores.contract_value +
    scores.expansion +
    scores.mission_alignment +
    scores.portfolio_proof
  )
}

/**
 * Band a raw total, then apply the two gates the worked examples imply:
 *
 *  - `engagement_shape === 0` (full-time W-2) is a structural mismatch. Nourish
 *    Colorado scored 15 — the same as Climate Democracy — but was deprioritized
 *    purely on shape.
 *  - `warm_path === 0` means, per the rubric's own closing note, "the rest of
 *    the score has to be exceptional to be worth the time."
 *
 * Both gates downgrade one band. They stack.
 */
export function classify(scores: FitScores): { action: FitAction; downgrades: string[] } {
  const total = totalScore(scores)
  let action: FitAction =
    total >= BAND_PURSUE_HARD ? 'pursue_hard'
    : total >= BAND_PURSUE_LEAN ? 'pursue_lean'
    : 'monitor'

  const downgrades: string[] = []

  if (scores.engagement_shape === 0) {
    action = downgrade(action)
    downgrades.push('Full-time W-2 role — structural mismatch for a firm')
  }
  if (scores.warm_path === 0) {
    action = downgrade(action)
    downgrades.push('No warm path in — cold outreach rarely converts')
  }

  return { action, downgrades }
}

export function assess(
  scores: FitScores,
  meta: Pick<FitAssessment, 'rationale' | 'green_flags' | 'red_flags' | 'uncertain'>,
): FitAssessment {
  const { action, downgrades } = classify(scores)
  return { scores, total: totalScore(scores), action, downgrades, ...meta }
}

// ── Signals the extractor and scorer look for ────────────────────────────────

export const GREEN_FLAGS = [
  'The words "RFP", "RFQ", or "firm" appear in the posting',
  'A stated budget or compensation range',
  'Fixed-term, contract, or funded-window work',
  'A deadline the organization does not control (contract expiry, grant period, funding cliff)',
  'Multiple vendors already involved — vendor management is a service we sell',
  'Explicit mention of data problems, migrations, or systems nobody understands',
  'Work samples or a portfolio requested',
] as const

export const RED_FLAGS = [
  'Full-time, benefits, W-2',
  'Compensation blank with no range',
  'Must be local to a region we are not (e.g. Pikes Peak, Western Slope)',
  'Heavy clerical component — scheduling, filing, meeting minutes',
  'Requires a credential we do not hold (RN, LPN, CPA)',
  'No 990 filed, no public financials, no budget signal',
  'Committee with no executive director',
  'Priority deadline already passed',
] as const
