// =============================================================================
// StageAgeBadge — the visible half of src/lib/stageAge.ts.
//
// By default a HEALTHY duration is invisible. A badge on every row saying "4d in
// stage" is noise that trains the eye to skip the column, which costs exactly
// the attention the amber and red badges need. So healthy duration renders
// nothing and the board stays quiet until something actually needs looking at.
//
// A date we are waiting on always renders, even when healthy — "board in 12
// days" is information, not an alarm, and it is the thing you most want to see
// on an Approval card.
// =============================================================================

import type { StageAge } from '../../lib/stageAge'

const STYLES: Record<StageAge['level'], string> = {
  ok:    'bg-gray-100 text-gray-500',
  amber: 'bg-amber-50 text-amber-700',
  red:   'bg-red-50 text-red-600',
}

const DOTS: Record<StageAge['level'], string> = {
  ok:    'bg-gray-300',
  amber: 'bg-amber-500',
  red:   'bg-red-500',
}

export function StageAgeBadge({ age, showHealthy = false }: { age: StageAge | null; showHealthy?: boolean }) {
  if (!age) return null
  if (!showHealthy && age.level === 'ok' && age.basis === 'stage_entry') return null

  return (
    <span
      title={age.detail}
      className={`inline-flex items-center gap-1 text-[0.7rem] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${STYLES[age.level]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${DOTS[age.level]}`} aria-hidden />
      {age.label}
    </span>
  )
}
