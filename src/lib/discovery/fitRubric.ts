// =============================================================================
// fitRubric.ts — Wright Adventures opportunity-fit rubric (ADR-011).
//
// The scoring contract for the discovery pipeline: seven dimensions, 0–3 each,
// 21 max. Dimension one is CONVERTIBILITY — not "is this already shaped like a
// contract" but "can we credibly propose something better for the same money".
// GOBRP was a posted role that converted into a firm proposal and reached
// interview; CMC was two described hires that became one engagement. Pure data + pure functions — no Supabase, no fetch — so the banding
// logic is unit-testable in isolation (same discipline as state-utils.ts).
//
// This replaces the Confluence grant-scoring rubric that left with the ADR-009
// split. We are scoring for Wright Adventures' own pipeline now: what should
// this firm pursue?
// =============================================================================

export type FitDimension =
  | 'convertibility'
  | 'warm_path'
  | 'both_halves'
  | 'contract_value'
  | 'expansion'
  | 'mission_alignment'
  | 'portfolio_proof'

export type FitAction = 'pursue_hard' | 'pursue_lean' | 'monitor' | 'decline'

export interface FitScores {
  convertibility: number
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
  convertibility:    'Convertibility',
  warm_path:         'Warm path in',
  both_halves:       'Both halves needed',
  contract_value:    'Contract value & duration',
  expansion:         'Expansion potential',
  mission_alignment: 'Mission alignment',
  portfolio_proof:   'Portfolio proof',
}

// ── Banding ──────────────────────────────────────────────────────────────────
//
// The rubric states "21+ pursue hard / 15–20 pursue lean / under 15 decline or
// monitor". The lean and decline boundaries are used as written. The pursue-hard
// threshold is not: 21 is a perfect 7x3, so nothing short of flawless could ever
// reach it, and CMC and GOBRP — the two the rubric holds up as what to pursue —
// score 20. Set at 19, which those two clear and which still takes a near-miss
// on only one or two dimensions.
//
//   CMC               20  convert 3  warm 3  → pursue_hard  ("Won")
//   GOBRP             20  convert 3  warm 3  → pursue_hard  ("Lost to a hire")
//   Nourish Colorado  16  convert 1  warm 1  → monitor      ("Deprioritized")
//   Climate Democracy 15  convert 3  warm 1  → pursue_lean  ("Lost, wanted a comms practitioner")
//   United Way ER     13  convert 3  warm 0  → decline      ("Small, Western Slope preference")
//   Real Life CO      12  convert 3  warm 0  → decline      ("Deadline passed")
//
// Nourish is why convertibility gates rather than just scoring: it outscores
// Climate Democracy by a point and was still deprioritised, on convertibility
// alone.
export const BAND_PURSUE_HARD = 19
export const BAND_PURSUE_LEAN = 15

const ORDER: FitAction[] = ['pursue_hard', 'pursue_lean', 'monitor', 'decline']

function downgrade(action: FitAction): FitAction {
  const i = ORDER.indexOf(action)
  return ORDER[Math.min(i + 1, ORDER.length - 1)]
}

export function totalScore(scores: FitScores): number {
  return (
    scores.convertibility +
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
 *  - `convertibility <= 1` — nothing credible to propose for the money already
 *    allocated. Nourish Colorado scored 16, a point ABOVE Climate Democracy,
 *    and was deprioritised anyway: full-time W-2 with benefits and a ClickUp
 *    application form. The total alone gets that pair backwards.
 *  - `warm_path === 0` — per the rubric's own note, a zero here means the rest
 *    has to be exceptional. Every opportunity that scored well came from a
 *    relationship; every one sourced from a job board scored 15 or below.
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

  if (scores.convertibility <= 1) {
    action = downgrade(action)
    downgrades.push('Little to convert — no credible firm proposal for the allocated budget')
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
