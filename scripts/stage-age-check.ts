// Asserts the ageing rules, above all the one that is easy to regress: a long
// wait in Approval is NOT a warning when the board date is still ahead.
import { computeStageAge, computeRevisitAge } from '../src/lib/stageAge'
import type { PipelineStatus } from '../src/lib/types'

const TODAY = new Date(2026, 7, 22) // 2026-08-22
const day = (offset: number) => {
  const d = new Date(TODAY); d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const stage = (id: string, e: number|null, a: number|null, r: number|null): PipelineStatus =>
  ({ id, type_id: 'partnership', label: id, sort_order: 0, is_active: true,
     expected_days: e, amber_days: a, red_days: r }) as PipelineStatus

const DISCOVERY = stage('discovery', 14, 21, 42)
const APPROVAL  = stage('approval', 45, 60, 90)
const WON       = stage('closed_won', null, null, null)

const cases: Array<[string, any, string|null, string]> = [
  ['discovery, 5d in',            {status:'discovery', stage:DISCOVERY, stageEnteredAt:day(-5)},  'ok',    'healthy — renders no badge'],
  ['discovery, 25d in',           {status:'discovery', stage:DISCOVERY, stageEnteredAt:day(-25)}, 'amber', 'past 21'],
  ['discovery, 50d in',           {status:'discovery', stage:DISCOVERY, stageEnteredAt:day(-50)}, 'red',   'past 42'],
  ['approval 50d, no date',       {status:'approval',  stage:APPROVAL,  stageEnteredAt:day(-50)}, 'ok',    'board calendars are slow'],
  ['approval 100d, no date',      {status:'approval',  stage:APPROVAL,  stageEnteredAt:day(-100)},'red',   'past 90 with no date at all'],
  ['approval 200d, board in 30d', {status:'approval',  stage:APPROVAL,  stageEnteredAt:day(-200), decisionDate:day(30), decisionBody:'board'}, 'ok', 'THE case: early, not late'],
  ['approval, board met 5d ago',  {status:'approval',  stage:APPROVAL,  stageEnteredAt:day(-60), decisionDate:day(-5), decisionBody:'board'},  'amber','silence after the meeting'],
  ['approval, board met 20d ago', {status:'approval',  stage:APPROVAL,  stageEnteredAt:day(-60), decisionDate:day(-20), decisionBody:'board'}, 'red',  'no outcome recorded'],
  ['closed-won',                  {status:'closed_won',stage:WON,       stageEnteredAt:day(-300)}, null,   'not aged'],
  ['no stage_entered_at',         {status:'discovery', stage:DISCOVERY, stageEnteredAt:null},      null,   'nothing to measure'],
]

let pass = 0
for (const [name, input, want, why] of cases) {
  const got = computeStageAge({
    decisionDate: null, decisionBody: null, revisitOn: null, ...input, today: TODAY,
  })
  const level = got?.level ?? null
  const ok = level === want
  if (ok) pass++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name.padEnd(30)} ${String(level).padEnd(6)} ${(got?.label ?? '—').padEnd(24)} ${why}`)
  if (!ok) console.log(`       expected ${want}`)
}
// Nurture left the pipeline in ADR-012 — an org being nurtured has no
// opportunity — so the revisit clock is its own entry point. Same thresholds.
const revisitCases: Array<[string, string|null, string|null, string]> = [
  ['org, revisit in 30d',      day(30),  'ok',    'parked on purpose'],
  ['org, revisit due today',   day(0),   'ok',    'arrived, not yet late'],
  ['org, revisit 5d overdue',  day(-5),  'amber', 'slipping'],
  ['org, revisit 20d overdue', day(-20), 'red',   'the failure nurture exists to prevent'],
  ['org, no revisit date',     null,     null,    'nothing to measure'],
]
let rPass = 0
for (const [name, on, want, why] of revisitCases) {
  const got = computeRevisitAge(on, TODAY)
  const level = got?.level ?? null
  const ok = level === want
  if (ok) rPass++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name.padEnd(30)} ${String(level).padEnd(6)} ${(got?.label ?? '—').padEnd(24)} ${why}`)
}

const total = cases.length + revisitCases.length
console.log(`\n${pass + rPass}/${total}`)
process.exit(pass + rPass === total ? 0 : 1)
