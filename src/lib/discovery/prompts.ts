// =============================================================================
// prompts.ts — Extraction and scoring prompts for opportunity discovery (ADR-011).
//
// Pure string builders. No network, no Supabase — so they can be inspected and
// diffed without running the pipeline.
//
// Division of labour, deliberately:
//   • Haiku EXTRACTS  — what is on the page, verbatim where possible
//   • Sonnet SCORES   — seven rubric dimensions, 0–3 each
//   • TypeScript BANDS — classify() in fitRubric.ts turns scores into an action
//
// Banding is kept out of the prompts on purpose. The model judges dimensions;
// the code decides what the numbers mean. That keeps the thresholds testable and
// stops them drifting when a model is swapped.
// =============================================================================

import { WA_ORG_PROFILE_PROMPT } from './waOrgProfile.js'
import { GREEN_FLAGS, RED_FLAGS, DIMENSION_LABELS } from './fitRubric.js'

// ── Extraction (Haiku) ───────────────────────────────────────────────────────

export function buildExtractionPrompt(opts: {
  sourceLabel: string
  publisher: string
  relevanceNotes: string | null
  eligibilityNotes: string | null
  pageText: string
  isDiff: boolean
}): string {
  const { sourceLabel, publisher, relevanceNotes, eligibilityNotes, pageText, isDiff } = opts

  return `
You are extracting pursuable opportunities from "${sourceLabel}", published by ${publisher}.

${isDiff
  ? 'The text below is ONLY the portion that CHANGED since the last check. Treat every item in it as potentially new.'
  : 'The text below is the full page. This is the first time it has been checked.'}

WHAT COUNTS AS A CANDIDATE ON THIS SOURCE
${relevanceNotes ?? 'Consulting, technology, data, communications, fundraising, or program-design work.'}

${eligibilityNotes ? `ELIGIBILITY CONTEXT\n${eligibilityNotes}\n` : ''}
EXTRACT every distinct opportunity. For each one return:

  name             — the posting title, verbatim
  publisher        — the hiring or issuing organization (NOT the board operator)
  description      — 1–3 sentences on the actual scope of work
  source_kind      — "rfp" if it is an RFP/RFQ/solicitation, "contract" if a
                     contract or 1099 engagement, "job" if an employment posting
  engagement_raw   — the engagement wording verbatim, e.g. "RFP", "Independent
                     Contractor", "Full-time", "Part-time, 20 hrs/wk". null if absent.
  deadline         — application or submission deadline, YYYY-MM-DD. null if absent.
  posted_date      — YYYY-MM-DD. null if absent.
  compensation_raw — the compensation text verbatim, e.g. "$60,000–$75,000",
                     "$150/hr", "Budget not to exceed $40,000". null if absent.
  location         — city/state, or null
  remote           — true if remote or hybrid is offered, else false
  requirements     — required credentials, licenses, or residency. null if none stated.
  relevance_rationale — one sentence on why this might fit a small consulting firm
  confidence       — "high" | "medium" | "low" on the accuracy of this extraction
  url              — direct link to the posting if present, else null

RULES
- EXTRACT, DO NOT FILTER. Your job is to find everything on the page that a
  consulting firm could conceivably pursue — including full-time employee roles.
  A separate scoring pass decides what is worth pursuing, and it cannot weigh
  what you never returned. If the notes above express a preference, treat it as
  what to prioritize in relevance_rationale, never as permission to omit.
- Do NOT invent values. Absent means null.
- Do NOT infer a deadline from a posted date.
- compensation_raw must be copied, not normalized. Do not convert salary to hourly.
- Ignore navigation, headers, footers, cookie notices, and unrelated news items.
- If the page lists nothing pursuable, return an empty array.

Return ONLY a JSON array. No prose, no markdown fence.

--- PAGE TEXT ---
${pageText}
`.trim()
}

// ── Scoring (Sonnet) ─────────────────────────────────────────────────────────

export function buildScoringPrompt(
  candidate: {
  name: string
  publisher: string
  description: string
  source_kind: string
  engagement_raw: string | null
  compensation_raw: string | null
  location: string | null
  remote: boolean
    requirements: string | null
    deadline: string | null
  },
  /** Profile text to score against. Defaults to the static relationships. */
  orgProfilePrompt: string = WA_ORG_PROFILE_PROMPT,
): string {
  return `
${orgProfilePrompt}

────────────────────────────────────────────────────────────────
THE OPPORTUNITY

Title:         ${candidate.name}
Organization:  ${candidate.publisher}
Kind:          ${candidate.source_kind}
Engagement:    ${candidate.engagement_raw ?? 'not stated'}
Compensation:  ${candidate.compensation_raw ?? 'not stated'}
Location:      ${candidate.location ?? 'not stated'}${candidate.remote ? ' (remote/hybrid offered)' : ''}
Deadline:      ${candidate.deadline ?? 'not stated'}
Requirements:  ${candidate.requirements ?? 'none stated'}

Description:
${candidate.description}

────────────────────────────────────────────────────────────────
SCORE EACH DIMENSION 0–3

1. engagement_shape — ${DIMENSION_LABELS.engagement_shape}. The single best predictor.
   3 = RFP, RFQ, or contract explicitly open to a firm
   2 = contract or 1099 role a firm could reasonably fill
   1 = part-time employee role where a firm case can be argued
   0 = full-time W-2 hire

2. warm_path — ${DIMENSION_LABELS.warm_path}. Use the RELATIONSHIPS list above.
   3 = the organization IS an existing client, or a principal has direct history with it
   2 = shared network, mutual reference, or credible introduction available
   1 = sector adjacency only
   0 = entirely cold

3. both_halves — ${DIMENSION_LABELS.both_halves}. The differentiator.

   Score the engagement WRIGHT ADVENTURES WOULD PROPOSE, not the job as advertised.
   A posting describes the role an organization imagined; it is written by someone
   who does not know a firm could bid. The question is not "is this posting
   technical" — it is "would Wright Adventures' answer to this problem involve
   both halves".

   Nonprofit development work almost always sits on top of systems: a donor CRM
   nobody trusts, gift processing done by hand, spreadsheets standing in for
   segmentation, impact numbers assembled from scratch for every report. Naming a
   CRM (Raiser's Edge, Blackbaud, Salesforce, Bloomerang, DonorPerfect), manual
   data entry, reporting burden, or a website that feeds none of it is evidence
   the technical half is present even when the posting never says so.

   3 = the work genuinely needs fundraising judgment AND technical capability,
       whether or not the posting frames it that way
   2 = primarily one half, with clear pull-through for the other
   1 = single-discipline with no plausible pull-through
   0 = neither is central

   Do NOT reason "a competent solo contractor could do this." Most postings could
   be filled by one person doing it the way it has always been done. That is the
   status quo the firm is displacing, not a reason to score low.

4. contract_value — ${DIMENSION_LABELS.contract_value}.
   3 = $20k+, or four months and longer
   2 = $10–20k, or two to four months
   1 = $5–10k, or a small defined project
   0 = under $5k, or unpaid
   If compensation is not stated, score 1 and list contract_value in "uncertain".

5. expansion — ${DIMENSION_LABELS.expansion}.
   3 = obvious follow-on work; the first engagement is the door
   2 = plausible continuation if it goes well
   1 = self-contained but the organization has other needs
   0 = one and done

6. mission_alignment — ${DIMENSION_LABELS.mission_alignment}.
   3 = one of the MISSION AREAS listed above
   2 = adjacent mission-driven work
   1 = nonprofit but outside those areas
   0 = misaligned or reputationally awkward

7. portfolio_proof — ${DIMENSION_LABELS.portfolio_proof}. Use the PORTFOLIO list above.

   Match on TWO axes — the kind of work, and the sector — and score the better of
   the two. A same-sector reference is powerful even when the deliverable differs,
   because it is what makes the first meeting easy: "here is what we built for an
   organization like yours."

   Go through the PORTFOLIO list item by item and name the closest match before
   scoring. A bicycle organization has betterbikeshare.org. A watershed or
   bilingual community coalition has riversisterscolorado.com. A small
   organization needing brand and fundraising has kadysheepcamp.org. A grant or
   donor system has confluenceco.org. Food access, markets, or commerce has
   Mo'Betta Green.

   3 = a live, linkable example matching this work OR this sector
   2 = close analogue on one axis
   1 = adjacent experience only
   0 = nothing on the list is relevant

GREEN FLAGS — report any that are present:
${GREEN_FLAGS.map(f => `  - ${f}`).join('\n')}

RED FLAGS — report any that are present:
${RED_FLAGS.map(f => `  - ${f}`).join('\n')}

RULES
- Score only what the posting supports. Do not give credit for what it might mean.
- List any dimension you had to guess at in "uncertain".
- Do NOT recommend an action or compute a total. Scores and flags only —
  the calling code applies the thresholds.

Return ONLY this JSON object, no prose, no markdown fence:

{
  "scores": {
    "engagement_shape": 0-3,
    "warm_path": 0-3,
    "both_halves": 0-3,
    "contract_value": 0-3,
    "expansion": 0-3,
    "mission_alignment": 0-3,
    "portfolio_proof": 0-3
  },
  "rationale": "2-3 sentences: the strongest reason to pursue and the strongest reason not to",
  "green_flags": ["..."],
  "red_flags": ["..."],
  "uncertain": ["dimension_key", "..."]
}
`.trim()
}
