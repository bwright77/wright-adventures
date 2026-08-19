// =============================================================================
// waOrgProfile.ts — Wright Adventures firm profile (ADR-011).
//
// Seeded into `org_profiles` and injected verbatim into the Sonnet scoring
// call. Two dimensions of the rubric cannot be scored from a posting alone:
//
//   • warm_path       — needs the relationship network below
//   • portfolio_proof — needs the linkable work below
//
// Keep this in sync with the rubric in docs/ADR-011. When a relationship or a
// portfolio piece changes, update here and re-seed; the scorer is only as good
// as this context.
// =============================================================================

export const WA_ORG_PROFILE = {
  org_name: 'Wright Adventures',
  location: 'Denver, Colorado',
  size: 'Two-person firm',

  thesis:
    'Organizations of a certain size have always needed technology and development ' +
    'leadership and have rarely been able to justify the salary. Fractionally, they can. ' +
    'AI-accelerated development is what makes custom software affordable for clients who ' +
    'would otherwise rent enterprise tooling forever.',

  differentiator:
    'A combination most mission-driven organizations cannot hire in one person: ' +
    'fundraising and program judgment alongside senior technical capability, with enough ' +
    'legal background to handle compliance questions without going outside.',

  principals: [
    {
      name: 'Shane Wright',
      focus: 'Fundraising, program design, nonprofit leadership',
      credentials: '15+ years; $8M+ secured via major gifts, grants, partnerships. MNM, Regis.',
      roles: [
        'Executive Director, Confluence Colorado',
        'Former Youth Program Director, Groundwork Denver',
      ],
      network: [
        'Denver Parks and Recreation Advisory Board',
        'Denver Moves',
        "Mayor's Youth Commission",
        'West Colfax Association of Neighbors',
        'Adaptive Action Sports',
      ],
      honors: ["Colorado Governor's Award for Serving Youth"],
    },
    {
      name: 'Ben Wright',
      focus: 'Engineering leadership, custom software, data',
      credentials:
        '~30 years building for the web; 10+ leading engineering teams at Fortune 100 and ' +
        'venture-backed companies. JD, University of Denver.',
      roles: ['Director of Technology & Innovation, Wright Adventures'],
      network: [],
      honors: [],
    },
  ],

  services: [
    { name: 'Fractional technology leadership', detail: 'Vendor management, architecture decisions, data governance, sequencing multi-vendor work' },
    { name: 'Data remediation',                 detail: 'CRM cleanup, entity resolution, integration audits, migration planning' },
    { name: 'Custom software',                  detail: 'Grant management, donor systems, dashboards, registration, purpose-built admin tools' },
    { name: 'Websites and digital fundraising', detail: 'Build, conversion paths, recurring giving, bilingual where it matters' },
    { name: 'Impact and storytelling',          detail: 'Impact reports in web and print, program archives, funder-facing narrative' },
    { name: 'Brand identity',                   detail: 'Logo and mark, visual language, messaging — the legitimacy that makes funders take an organization seriously' },
    { name: 'Development strategy',             detail: 'Case for support, grant pipeline, corporate partnerships, individual giving' },
    { name: 'Compliance navigation',            detail: 'Gift substantiation, fiscal sponsorship, worker classification, charitable registration' },
  ],

  // Scores warm_path. A posting from — or credibly connected to — any of these
  // is a 3. Shared network or a mutual reference is a 2.
  relationships: [
    { org: 'Confluence Colorado',      basis: 'Shane is Executive Director; WA builds and runs their platform' },
    { org: 'Colorado Mountain Club',   basis: 'Active engagement — hiring, ops, compliance' },
    { org: 'Groundwork Denver',        basis: 'Shane formerly Youth Program Director' },
    { org: 'GOBRP / Golden Optimists', basis: "Shane's Groundwork-era work with Ted Rains" },
    { org: 'Lincoln Hills Cares',      basis: 'Funding strategy and program infrastructure' },
    { org: 'PeopleForBikes / BBSP',    basis: 'Digital legacy and archive engagement' },
    { org: 'Kady Youth Sheep Camp',    basis: 'Fiscal partner; brand and web' },
    { org: 'River Sisters',            basis: 'Brand, bilingual web, advocacy engine' },
    { org: "Mo'Betta Green",           basis: 'Registration, donations, commerce on a custom admin' },
  ],

  // Scores portfolio_proof. A live, linkable example of exactly the work is a 3.
  portfolio: [
    { url: 'betterbikeshare.org',        proves: 'Impact reporting, web + print, large archive migration' },
    { url: 'riversisterscolorado.com',   proves: 'Bilingual community sites, community-led brand' },
    { url: 'kadysheepcamp.org',          proves: 'Small-organization branding and fundraising' },
    { url: 'confluenceco.org',           proves: 'Custom grant management platform' },
    { url: "Mo'Betta Green",             proves: 'Registration, donations, commerce on one custom admin' },
  ],

  mission_areas: [
    'Youth pathways',
    'Conservation and watershed',
    'Outdoor recreation and access',
    'Food and community health',
    'Equity-centered community organizations',
  ],

  rates: { standard_hourly: 170, partner_hourly: 150 },

  operating_principles: [
    'Listen and learn first. Never price before discovery.',
    'Purpose-built and client-owned. Full source, no license, no lock-in.',
    'Build capacity, not dependency.',
    "Lead with the partner's story, not ours.",
  ],
} as const

/** A relationship the scorer can use for warm_path. */
export interface ProfileRelationship {
  org: string
  basis: string
  /** 'direct' = client or principal history. 'network' = reachable through one. */
  tier?: 'direct' | 'network'
  /** For network relationships, who the introduction runs through. */
  via?: string | null
}

/**
 * Build the scoring prompt, optionally merging in relationships discovered at
 * runtime.
 *
 * The static list below covers relationships that are not opportunities —
 * Shane's Groundwork history, the Denver civic network. Closed-won engagements
 * are merged in from the database by the sync endpoint, because a hand-curated
 * list goes stale the moment work is won, and a missing organization scores
 * warm_path 0, which trips the downgrade gate and buries a real opportunity a
 * band lower than it deserves.
 *
 * De-duplicated by containment rather than exact match, because the same
 * organization is named differently in each place: "PeopleForBikes / BBSP" in
 * the static list against "PeopleForBikes Foundation" on the row, "River
 * Sisters" against "River Sisters · Hermanas del Río". Exact matching listed
 * all three pairs twice.
 *
 * Static entries win — their `basis` text is richer than anything derivable
 * from a row.
 */
export function buildOrgProfilePrompt(extra: readonly ProfileRelationship[] = []): string {
  // Strip punctuation, spacing and legal suffixes so "Mo'Betta Green" and
  // "Mo'Betta Green MarketPlace" reduce to comparable keys.
  const norm = (name: string): string =>
    name.toLowerCase()
      .replace(/\b(foundation|association|inc|llc|the|program|programs|marketplace)\b/g, '')
      .replace(/[^a-z0-9]/g, '')

  const seen = WA_ORG_PROFILE.relationships.map(r => norm(r.org))

  const isDuplicate = (candidate: string): boolean => {
    const key = norm(candidate)
    if (key.length < 4) return false
    return seen.some(k => k.includes(key) || key.includes(k))
  }

  const merged: ProfileRelationship[] = [
    // The static array is a SEED only — org_relationships in the database is the
    // source of truth, editable from Settings. These entries default to direct.
    ...WA_ORG_PROFILE.relationships.map(r => ({ org: r.org, basis: r.basis, tier: 'direct' as const })),
    ...extra.filter(r => {
      if (isDuplicate(r.org)) return false
      seen.push(norm(r.org))
      return true
    }),
  ]

  return `
You are scoring an opportunity for Wright Adventures, a two-person consulting firm in
Denver, Colorado.

WHO THEY ARE
${WA_ORG_PROFILE.differentiator}

Thesis: ${WA_ORG_PROFILE.thesis}

PRINCIPALS
${WA_ORG_PROFILE.principals
  .map(p => `- ${p.name} — ${p.focus}. ${p.credentials}${p.network.length ? ` Network: ${p.network.join('; ')}.` : ''}`)
  .join('\n')}

WHAT THEY SELL
${WA_ORG_PROFILE.services.map(s => `- ${s.name}: ${s.detail}`).join('\n')}

DIRECT RELATIONSHIPS — a client, or a principal's own history. warm_path 3.
${merged.filter(r => (r.tier ?? 'direct') === 'direct')
  .map(r => `- ${r.org} — ${r.basis}`).join('\n') || '- (none)'}

NETWORK — reachable through a relationship above, so an introduction is
available but the organization does not know us directly. warm_path 2.
${merged.filter(r => r.tier === 'network')
  .map(r => `- ${r.org} — ${r.basis}${r.via ? ` (via ${r.via})` : ''}`).join('\n') || '- (none)'}

PORTFOLIO (use for the portfolio_proof dimension)
${WA_ORG_PROFILE.portfolio.map(p => `- ${p.url} — ${p.proves}`).join('\n')}

MISSION AREAS (a 3 on mission_alignment)
${WA_ORG_PROFILE.mission_areas.map(m => `- ${m}`).join('\n')}

RATES
Standard $${WA_ORG_PROFILE.rates.standard_hourly}/hr; $${WA_ORG_PROFILE.rates.partner_hourly}/hr for existing partners.
Below roughly $5,000 the cost of bidding exceeds the return.
`.trim()
}

/** The profile with only the static relationships — used where no DB is available. */
export const WA_ORG_PROFILE_PROMPT = buildOrgProfilePrompt()
