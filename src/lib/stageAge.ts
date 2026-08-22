// =============================================================================
// stageAge — how long has this opportunity been sitting, and is that a problem?
//
// Two different questions wear the same badge, and conflating them is what makes
// ageing indicators useless:
//
//   1. DURATION. "This has been in Discovery for 31 days." Measured from stage
//      entry, judged against what that stage normally takes. Discovery dragging
//      is a warning; Approval taking six weeks is a Tuesday.
//
//   2. A DATE WE ARE WAITING ON. "The board met eight days ago and we have not
//      heard." Measured from decision_date or revisit_on. Time in stage is
//      irrelevant here — an opportunity that entered Approval three months
//      before a quarterly board meeting is not late, it is early, and colouring
//      it red teaches everyone to ignore the colour.
//
// So when a date exists, it wins. Before it, you are fine no matter how long you
// have been waiting. After it, the clock starts and runs fast, because a passed
// date with no word is a real signal in a way that elapsed time is not.
//
// Duration thresholds live in the database on pipeline_statuses, so a new stage
// arrives carrying its own expectations instead of needing a UI change.
// =============================================================================

import type { PipelineStatus } from './types'

export type AgeLevel = 'ok' | 'amber' | 'red'
export type AgeBasis = 'stage_entry' | 'decision_date' | 'revisit_on'

export interface StageAge {
  level: AgeLevel
  /** Days elapsed. For a date basis this is days PAST the date; negative means still ahead of it. */
  days: number
  basis: AgeBasis
  /** Short badge text, e.g. "31d in stage" or "board met 8d ago". */
  label: string
  /** Longer explanation for a tooltip. */
  detail: string
}

// Once a date we were waiting on has passed, silence escalates quickly — this is
// not "how long does this stage take", it is "we expected to know by now".
const PAST_DUE_AMBER = 3
const PAST_DUE_RED = 14

/** Parse a bare `YYYY-MM-DD` or a timestamp into a local midnight. */
function toLocalDay(value: string): Date | null {
  if (!value) return null
  const bare = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (bare) {
    return new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]))
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function daysBetween(from: Date, to: Date): number {
  // Both are local midnights, so this is exact — no DST half-day rounding.
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export interface StageAgeInput {
  status: string
  stageEnteredAt: string | null
  decisionDate: string | null
  decisionBody: string | null
  /** The stage row, for its duration thresholds. */
  stage: PipelineStatus | undefined
  today: Date
}

export function computeStageAge(input: StageAgeInput): StageAge | null {
  const { status, decisionDate, decisionBody, stage, today } = input
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  // ---------------------------------------------------------------------------
  // A date we are waiting on takes precedence over time in stage.
  // ---------------------------------------------------------------------------
  const awaited: Array<{ basis: AgeBasis; date: Date; noun: string; ahead: (n: number) => string; past: (n: number) => string }> = []

  const decision = status === 'approval' && decisionDate ? toLocalDay(decisionDate) : null
  if (decision) {
    const body = decisionBody?.trim() || 'decision'
    awaited.push({
      basis: 'decision_date',
      date: decision,
      noun: body,
      ahead: n => `${body} in ${plural(n, 'day')}`,
      past: n => `${body} met ${plural(n, 'day')} ago`,
    })
  }


  if (awaited.length) {
    const a = awaited[0]
    const past = daysBetween(a.date, now)
    if (past < 0) {
      return {
        level: 'ok',
        days: past,
        basis: a.basis,
        label: a.ahead(-past),
        detail: `Waiting on the ${a.noun}. Nothing is overdue — time in stage is not meaningful until that date passes.`,
      }
    }
    const level: AgeLevel = past >= PAST_DUE_RED ? 'red' : past >= PAST_DUE_AMBER ? 'amber' : 'ok'
    return {
      level,
      days: past,
      basis: a.basis,
      label: a.past(past),
      detail:
        level === 'ok'
          ? `The ${a.noun} date has just passed.`
          : `The ${a.noun} date passed ${plural(past, 'day')} ago with no recorded outcome.`,
    }
  }

  // ---------------------------------------------------------------------------
  // Otherwise: time in stage, against that stage's own expectation.
  // ---------------------------------------------------------------------------
  if (!stage?.amber_days || !stage.red_days) return null // terminal stages, and nurture with no revisit date

  const entered = input.stageEnteredAt ? toLocalDay(input.stageEnteredAt) : null
  if (!entered) return null

  const days = daysBetween(entered, now)
  if (days < 0) return null

  const level: AgeLevel = days >= stage.red_days ? 'red' : days >= stage.amber_days ? 'amber' : 'ok'
  return {
    level,
    days,
    basis: 'stage_entry',
    label: `${days}d in stage`,
    detail:
      level === 'ok'
        ? `${plural(days, 'day')} in ${stage.label}. Typical is around ${stage.expected_days}.`
        : `${plural(days, 'day')} in ${stage.label} — typical is around ${stage.expected_days} days, and this passed ${stage.amber_days} on ${
            level === 'red' ? `its way past ${stage.red_days}` : 'the way up'
          }.`,
  }
}

/**
 * The same clock, for an ORGANISATION we are keeping warm. Nurture is no longer
 * a pipeline stage (ADR-012) — an org being nurtured has no opportunity by
 * definition — but the question is identical: a date we said we would come back
 * on, and whether it has slipped. Sharing the thresholds keeps a revisit that is
 * a week late looking exactly as urgent as a board decision that is a week late.
 */
export function computeRevisitAge(revisitOn: string | null, today: Date): StageAge | null {
  if (!revisitOn) return null
  const date = toLocalDay(revisitOn)
  if (!date) return null

  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const past = daysBetween(date, now)

  if (past < 0) {
    return {
      level: 'ok',
      days: past,
      basis: 'revisit_on',
      label: `revisit in ${plural(-past, 'day')}`,
      detail: 'Parked deliberately. Nothing is overdue until the revisit date passes.',
    }
  }

  const level: AgeLevel = past >= PAST_DUE_RED ? 'red' : past >= PAST_DUE_AMBER ? 'amber' : 'ok'
  return {
    level,
    days: past,
    basis: 'revisit_on',
    label: past === 0 ? 'revisit due today' : `revisit ${plural(past, 'day')} overdue`,
    detail:
      level === 'red'
        ? `The revisit date passed ${plural(past, 'day')} ago — this is the exact failure nurture exists to prevent.`
        : 'The revisit date has arrived.',
  }
}
