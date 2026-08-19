// =============================================================================
// serviceLines.ts — What Wright Adventures sells, as a field.
//
// Replaces `partnership_type`, whose vocabulary (MOU, coalition, joint program,
// in-kind, referral) described how two NONPROFITS relate to each other. Wright
// Adventures is a consultancy selling services, so nothing fit and two-thirds of
// real opportunities collapsed onto "other".
//
// Multi-valued on purpose. CMC is data remediation AND fractional technology
// leadership; BBSP was impact storytelling AND custom software AND web. A single
// enum would force the same "other" collapse in a new costume.
//
// Kept in sync with WA_ORG_PROFILE.services in waOrgProfile.ts — the same seven
// services the fit rubric scores against.
// =============================================================================

export type ServiceLine =
  | 'fractional_tech_leadership'
  | 'data_remediation'
  | 'custom_software'
  | 'websites_fundraising'
  | 'impact_storytelling'
  | 'development_strategy'
  | 'compliance'
  | 'brand_identity'

export const SERVICE_LINES: Array<{
  id: ServiceLine
  label: string
  /** Which half of the differentiator this sits on — see the rubric's both_halves. */
  half: 'technical' | 'fundraising' | 'both'
  detail: string
}> = [
  {
    id: 'fractional_tech_leadership',
    label: 'Fractional tech leadership',
    half: 'technical',
    detail: 'Vendor management, architecture decisions, data governance, sequencing multi-vendor work',
  },
  {
    id: 'data_remediation',
    label: 'Data remediation',
    half: 'technical',
    detail: 'CRM cleanup, entity resolution, integration audits, migration planning',
  },
  {
    id: 'custom_software',
    label: 'Custom software',
    half: 'technical',
    detail: 'Grant management, donor systems, dashboards, registration, purpose-built admin tools',
  },
  {
    id: 'websites_fundraising',
    label: 'Websites & digital fundraising',
    half: 'both',
    detail: 'Build, conversion paths, recurring giving, bilingual where it matters',
  },
  {
    id: 'impact_storytelling',
    label: 'Impact & storytelling',
    half: 'both',
    detail: 'Impact reports in web and print, program archives, funder-facing narrative',
  },
  {
    id: 'development_strategy',
    label: 'Development strategy',
    half: 'fundraising',
    detail: 'Case for support, grant pipeline, corporate partnerships, individual giving',
  },
  {
    id: 'brand_identity',
    label: 'Brand identity',
    half: 'both',
    detail: 'Logo and mark, visual language, messaging — the legitimacy that makes funders take an organization seriously',
  },
  {
    id: 'compliance',
    label: 'Compliance navigation',
    half: 'fundraising',
    detail: 'Gift substantiation, fiscal sponsorship, worker classification, charitable registration',
  },
]

export const SERVICE_LINE_LABELS: Record<string, string> = Object.fromEntries(
  SERVICE_LINES.map(s => [s.id, s.label]),
)

/**
 * True when the selection spans both halves of the differentiator — the
 * combination most organizations cannot hire in one person, and the thing the
 * rubric's `both_halves` dimension is trying to detect.
 */
export function spansBothHalves(lines: readonly string[] | null | undefined): boolean {
  if (!lines?.length) return false
  const halves = new Set(
    lines.map(l => SERVICE_LINES.find(s => s.id === l)?.half).filter(Boolean) as string[],
  )
  return halves.has('both') || (halves.has('technical') && halves.has('fundraising'))
}
