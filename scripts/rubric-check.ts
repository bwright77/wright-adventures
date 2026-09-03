// =============================================================================
// rubric-check.ts — Regression check for the opportunity-fit banding (ADR-011).
//
//   npx tsx scripts/rubric-check.ts
//
// The rubric's stated pursue-hard band ("21+") is unreachable — 21 is a perfect
// 7x3, yet CMC and GOBRP top out at 20. fitRubric.ts keeps the stated 15 boundary
// and sets pursue-hard at 19, with two gates: convertibility <= 1 and
// warm_path === 0 each downgrade one band.
//
// This asserts that calibration still reproduces every recorded call. If someone
// retunes BAND_PURSUE_HARD / BAND_PURSUE_LEAN or the gates, this is what tells
// them they broke agreement with the real decisions.
// =============================================================================

import { classify, totalScore, type FitScores } from '../src/lib/discovery/fitRubric'

const S = (
  convertibility: number, warm_path: number, both_halves: number,
  contract_value: number, expansion: number, mission_alignment: number,
  portfolio_proof: number,
): FitScores => ({
  convertibility, warm_path, both_halves,
  contract_value, expansion, mission_alignment, portfolio_proof,
})

// Straight from the rubric's worked-examples table, with the call it records.
const CASES: Array<{ name: string; scores: FitScores; total: number; action: string; note: string }> = [
  { name: 'CMC',                scores: S(3,3,3,3,3,3,2), total: 20, action: 'pursue_hard', note: 'Won' },
  { name: 'GOBRP',              scores: S(3,3,3,3,2,3,3), total: 20, action: 'pursue_hard', note: 'Lost to a hire, relationship intact' },
  { name: 'Nourish Colorado',   scores: S(1,1,3,3,2,3,3), total: 16, action: 'monitor',     note: 'Deprioritized — outscores Climate, gated on convertibility' },
  { name: 'Climate Democracy',  scores: S(3,1,2,2,2,2,3), total: 15, action: 'pursue_lean', note: 'Lost, wanted a comms practitioner' },
  { name: 'United Way ER',      scores: S(3,0,3,1,2,2,2), total: 13, action: 'decline',     note: 'Small, Western Slope preference' },
  { name: 'Real Life Colorado', scores: S(3,0,2,3,2,1,1), total: 12, action: 'decline',     note: 'Deadline passed' },
  // The two new leads, scored in the 2026-09-03 handoff.
  { name: 'Evergreen Audubon',  scores: S(1,0,3,2,2,3,3), total: 14, action: 'decline',     note: 'Convertibility and warm-path gates both fire' },
  { name: 'La Veta Trails',     scores: S(3,0,2,2,2,3,2), total: 14, action: 'decline',     note: 'Convertible, but cold and 3.5 hours south — one email, no proposal' },
]

let failures = 0

for (const c of CASES) {
  const total = totalScore(c.scores)
  const { action, downgrades } = classify(c.scores)
  const ok = total === c.total && action === c.action
  if (!ok) failures++

  console.log(
    `${ok ? '✓' : '✗'} ${c.name.padEnd(20)} ` +
    `total=${String(total).padStart(2)} (expected ${c.total})  ` +
    `action=${action.padEnd(11)} (expected ${c.action})` +
    (downgrades.length ? `  ← ${downgrades.join('; ')}` : ''),
  )
  if (!ok) console.log(`    ${c.note}`)
}

console.log(`\n${CASES.length - failures}/${CASES.length} worked examples reproduced`)
process.exit(failures === 0 ? 0 : 1)
