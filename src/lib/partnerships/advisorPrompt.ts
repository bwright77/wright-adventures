import type { Opportunity, PartnershipDetails } from '../types'

// ── System prompt ─────────────────────────────────────────────

export const ADVISOR_SYSTEM = `You are a solution-fit advisor for Wright Adventures, a nonprofit technology consulting firm based in Colorado.

Your job is to analyze a partnership or consulting opportunity and produce a structured recommendation brief for the sales team.

Wright Adventures' service areas:
1. Technology Strategy — multi-year roadmap, vendor evaluation, IT governance for nonprofits
2. System Selection & Implementation — CRM (Salesforce, HubSpot), HRIS, program data, finance system selection and full rollout
3. Data & Reporting — dashboard builds, Salesforce reporting, outcome measurement, data clean-up projects
4. Digital Transformation — automations, workflow redesign, staff training, change management
5. Capacity Building — IT staffing assessment, fractional CTO/CITO advisory, board technology education
6. Grant & Partnership Management — OMP implementation, grant tracking, MOU workflow automation

You must return ONLY a valid JSON object matching the specified schema. No markdown. No explanation. No code blocks. Only the JSON.`

// ── User prompt builder ───────────────────────────────────────

export function buildAdvisorPrompt(
  opp: Pick<Opportunity, 'name' | 'description' | 'status' | 'partner_org' | 'partnership_type' | 'estimated_value'>,
  pd: Pick<PartnershipDetails, 'org_size' | 'pain_points' | 'tech_stack_notes' | 'qualification_notes'>,
): string {
  const lines: string[] = [
    'Analyze this nonprofit consulting opportunity and return a fit recommendation.',
    '',
    'OPPORTUNITY',
    `Name: ${opp.name}`,
  ]

  if (opp.description)       lines.push(`Description: ${opp.description}`)
  if (opp.status)            lines.push(`Pipeline stage: ${opp.status.replace('partnership_', '')}`)
  if (opp.partner_org)       lines.push(`Partner org: ${opp.partner_org}`)
  if (pd.org_size)           lines.push(`Org size: ${pd.org_size} employees`)
  if (opp.partnership_type)  lines.push(`Partnership type: ${opp.partnership_type}`)
  if (opp.estimated_value)   lines.push(`Estimated value: $${opp.estimated_value}`)

  lines.push('')
  lines.push('PAIN POINTS (what they need to solve):')
  lines.push(pd.pain_points?.trim() || '(not yet documented)')

  lines.push('')
  lines.push('TECHNOLOGY SYSTEMS (current stack):')
  lines.push(pd.tech_stack_notes?.trim() || '(not yet documented)')

  lines.push('')
  lines.push('QUALIFICATION NOTES:')
  lines.push(pd.qualification_notes?.trim() || '(not yet documented)')

  lines.push('')
  lines.push(`Return a JSON object with these exact keys:
{
  "fit_score": <integer 1-5>,
  "fit_rationale": "<1-2 sentence explanation>",
  "recommended_services": [
    { "service": "<name from WA catalog>", "rationale": "<why this fits>", "priority": "primary" | "secondary" }
  ],
  "talking_points": ["<point 1>", "<point 2>", ...],
  "open_questions": ["<question 1>", ...],
  "watch_outs": ["<risk 1>", ...]
}

Rules:
- Omit array entries you cannot support with the available information — return [] not fabricated content.
- talking_points must cite specific details from this opportunity (org size, systems, pain points) — not generic consulting platitudes.
- open_questions should address genuine unknowns that would change the recommendation.
- watch_outs should only appear if there is a real signal — not a generic disclaimer.
- fit_score: 1 = misaligned, 3 = plausible fit with unknowns, 5 = highly aligned across multiple service areas.`)

  return lines.join('\n')
}
