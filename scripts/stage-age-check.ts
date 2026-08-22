// Asserts the ageing rules, above all the one that is easy to regress: a long
// wait in Approval is NOT a warning when the board date is still ahead.
import { computeStageAge } from '../src/lib/stageAge'
import type { PipelineStatus } from '../src/lib/types'

const TODAY = new Date(2026, 7, 22) // 2026-08-22
const day = (offset: number) => {
  const d = new Date(TODAY); d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const stage = (id: string, e: number|null, a: number|null, r: number|null): PipelineStatus =>
  ({ id, type_id: 'partnership', label: id, sort_order: 0, is_active: true,
     expected_days: e, amber_days: a, red_days: r }) as PipelineStatus

const DISCOVERY = stage('partnership_discovery', 14, 21, 42)
const APPROVAL  = stage('partnership_approval', 45, 60, 90)
const NURTURE   = stage('partnership_nurture', null, null, null)
const WON       = stage('partnership_closed_won', null, null, null)

const cases: Array<[string, any, string|null, string]> = [
  ['discovery, 5d in',            {status:'partnership_discovery', stage:DISCOVERY, stageEnteredAt:day(-5)},  'ok',    'healthy — renders no badge'],
  ['discovery, 25d in',           {status:'partnership_discovery', stage:DISCOVERY, stageEnteredAt:day(-25)}, 'amber', 'past 21'],
  ['discovery, 50d in',           {status:'partnership_discovery', stage:DISCOVERY, stageEnteredAt:day(-50)}, 'red',   'past 42'],
  ['approval 50d, no date',       {status:'partnership_approval',  stage:APPROVAL,  stageEnteredAt:day(-50)}, 'ok',    'board calendars are slow'],
  ['approval 100d, no date',      {status:'partnership_approval',  stage:APPROVAL,  stageEnteredAt:day(-100)},'red',   'past 90 with no date at all'],
  ['approval 200d, board in 30d', {status:'partnership_approval',  stage:APPROVAL,  stageEnteredAt:day(-200), decisionDate:day(30), decisionBody:'board'}, 'ok', 'THE case: early, not late'],
  ['approval, board met 5d ago',  {status:'partnership_approval',  stage:APPROVAL,  stageEnteredAt:day(-60), decisionDate:day(-5), decisionBody:'board'},  'amber','silence after the meeting'],
  ['approval, board met 20d ago', {status:'partnership_approval',  stage:APPROVAL,  stageEnteredAt:day(-60), decisionDate:day(-20), decisionBody:'board'}, 'red',  'no outcome recorded'],
  ['nurture, revisit in 30d',     {status:'partnership_nurture',   stage:NURTURE,   stageEnteredAt:day(-90), revisitOn:day(30)},  'ok',    'parked on purpose'],
  ['nurture, revisit 20d overdue',{status:'partnership_nurture',   stage:NURTURE,   stageEnteredAt:day(-200),revisitOn:day(-20)}, 'red',   'fell through the crack'],
  ['closed-won',                  {status:'partnership_closed_won',stage:WON,       stageEnteredAt:day(-300)}, null,   'not aged'],
  ['no stage_entered_at',         {status:'partnership_discovery', stage:DISCOVERY, stageEnteredAt:null},      null,   'nothing to measure'],
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
console.log(`\n${pass}/${cases.length}`)
process.exit(pass === cases.length ? 0 : 1)
