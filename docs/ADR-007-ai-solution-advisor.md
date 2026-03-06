# ADR-007: AI Solution Advisor — Partnership Opportunity Recommendations

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-03-06
**Status:** Draft
**PRD Reference:** OMP PRD v2.0, Phase 3 — Platform Expansion
**Depends on:** ADR-006 (Partnership Sales Pipeline), ADR-001 (AI Grant Writing)

---

## Context

ADR-006 introduced the CRM-style partnership pipeline with `partnership_details` — a structured
store of pain points, tech stack observations, qualification notes, org size, and confidence
scores for each consulting/partnership opportunity.

That data has no AI layer yet. A sales team member looking at a Discovery-stage opportunity
for a 50-person nonprofit on Salesforce and Google Workspace must manually think through
which Wright Adventures services fit and what the opening talking points are. This takes
time and isn't consistent.

ADR-006 reserved two columns in `partnership_details` for this purpose:
- `ai_solution_summary text` — cached JSON output from the Solution Advisor
- `ai_solution_updated_at timestamptz` — when that cache was last generated

This ADR specifies the implementation.

---

## Decision

Add a **Solution Advisor** feature to partnership opportunities: an AI-generated recommendation
block that analyzes the known details of an opportunity and surfaces:

1. **Fit score** — how strong a match this org is for Wright Adventures' consulting services
2. **Recommended services** — which WA service areas are most relevant, and why
3. **Talking points** — 3–5 specific, evidence-based points for the next conversation
4. **Open questions** — gaps in qualification that should be addressed in discovery
5. **Watch-outs** — potential misalignment signals or red flags worth noting

The output is cached in `partnership_details` to avoid regenerating on every view.
Regeneration is manual (user-triggered) or auto-triggered when key fields change.

This does **not** replace human judgment — it's a pre-read brief, not a decision.

---

## Wright Adventures Service Areas (Prompt Context)

The advisor prompt embeds WA's current service catalog so Claude can reason about fit:

| Service Area | Description |
|---|---|
| Technology Strategy | Multi-year roadmap, vendor evaluation, IT governance for nonprofits |
| System Selection & Implementation | CRM (Salesforce, HubSpot), HRIS, program data, finance system selection and rollout |
| Data & Reporting | Dashboard builds, Salesforce reporting, outcome measurement, data clean-up |
| Digital Transformation | Automations, workflow redesign, staff training, change management |
| Capacity Building | IT staffing assessment, fractional CTO/CITO advisory, board tech education |
| Grant & Partnership Management | OMP implementation, grant tracking, MOU workflow |

---

## API Endpoint

### `/api/partnerships/recommend.ts`

**Method:** POST
**Auth:** Bearer JWT (admin or manager only)
**Body:** `{ opportunity_id: string, force_refresh?: boolean }`

**Flow:**
1. Validate JWT — admin or manager role required
2. Fetch `opportunities` + `partnership_details` for the given ID
3. If `ai_solution_summary` is non-null and `ai_solution_updated_at` is within 7 days,
   and `force_refresh` is not true → return cached result immediately
4. Build prompt from opportunity data (see Prompt Design below)
5. Call `claude-sonnet-4-6` with `generateText` — structured JSON output
6. Parse and validate response
7. `UPDATE partnership_details SET ai_solution_summary = ..., ai_solution_updated_at = now()`
8. Return the parsed recommendation

**Response shape:**
```typescript
{
  fit_score: 1 | 2 | 3 | 4 | 5          // 1 = weak, 5 = strong
  fit_rationale: string                   // 1-2 sentence explanation of the score
  recommended_services: Array<{
    service: string                       // from WA service catalog
    rationale: string                     // why this service fits this org
    priority: 'primary' | 'secondary'
  }>
  talking_points: string[]               // 3-5 specific, evidence-based points
  open_questions: string[]               // qualification gaps to fill
  watch_outs: string[]                   // red flags or misalignment signals
  generated_at: string                   // ISO timestamp
}
```

**Error handling:**
- AI call failures return 200 with `{ error: 'Could not generate recommendation' }` — never 500
- Missing partnership_details → 404
- Insufficient data (no pain_points, no description, no tech_stack_notes) → return a
  `{ fit_score: null, message: 'Add more context about this org before generating a recommendation.' }`

---

## Prompt Design

### System prompt

```
You are a solution-fit advisor for Wright Adventures, a nonprofit technology consulting firm.
Your job is to analyze a partnership or consulting opportunity and produce a structured
recommendation brief for the sales team.

Wright Adventures' service areas:
1. Technology Strategy — multi-year roadmap, vendor evaluation, IT governance
2. System Selection & Implementation — CRM (Salesforce, HubSpot), HRIS, program data,
   finance systems — full selection and rollout
3. Data & Reporting — dashboard builds, Salesforce reporting, outcome measurement, data
   clean-up projects
4. Digital Transformation — automations, workflow redesign, staff training, change management
5. Capacity Building — IT staffing assessment, fractional CTO/CITO advisory, board tech
   education
6. Grant & Partnership Management — OMP implementation, grant tracking, MOU workflow

You must return ONLY a valid JSON object matching the specified schema. No markdown.
No explanation. No code blocks. Only the JSON.
```

### User prompt template (`src/lib/partnerships/advisorPrompt.ts`)

```
Analyze this nonprofit consulting opportunity and return a fit recommendation.

OPPORTUNITY
Name: {{name}}
Description: {{description}}
Stage: {{stage}}
Partner org: {{partner_org}}
Org size: {{org_size}}
Partnership type: {{partnership_type}}

PAIN POINTS (what they need to solve):
{{pain_points}}

TECHNOLOGY SYSTEMS (current stack):
{{tech_stack_notes}}

QUALIFICATION NOTES:
{{qualification_notes}}

Return a JSON object with these exact keys:
{
  "fit_score": <integer 1-5>,
  "fit_rationale": "<1-2 sentence explanation>",
  "recommended_services": [
    { "service": "<name>", "rationale": "<why>", "priority": "primary" | "secondary" }
  ],
  "talking_points": ["<point 1>", "<point 2>", ...],
  "open_questions": ["<question 1>", ...],
  "watch_outs": ["<risk 1>", ...]
}

Rules:
- Omit any section where there is not enough information to make a credible statement.
  Return an empty array [] for arrays, not a fabricated list.
- talking_points must cite specific details from the opportunity (org size, systems,
  pain points) — not generic consulting platitudes.
- open_questions should address genuine unknowns that would change the recommendation.
- watch_outs should only appear if there is a real signal — not a generic disclaimer.
- fit_score: 1 = misaligned (wrong size/sector/need), 3 = plausible fit with unknowns,
  5 = highly aligned across multiple service areas.
```

---

## Frontend Component

### `PartnershipAdvisorPanel.tsx`

A self-contained panel rendered in a new **"AI Advisor"** tab on `OpportunityDetail.tsx`
(visible only for partnership-type opportunities, same gate as Contacts and Interactions).

**States:**
1. **No recommendation yet** — "Generate Recommendation" button + brief explanation
2. **Loading** — spinner with "Analyzing opportunity…" text
3. **Stale** (>7 days old) — shows cached result with amber "Outdated — Refresh" badge
4. **Current** — full recommendation UI

**Layout (current state):**
```
┌─────────────────────────────────────────────────┐
│ Fit Score: ●●●●○  Strong fit                    │
│ "This org's Salesforce pain + 50-person size…"  │
├─────────────────────────────────────────────────┤
│ RECOMMENDED SERVICES                             │
│  ● System Selection  (primary)                  │
│    "They mention Salesforce confusion…"         │
│  ● Data & Reporting  (secondary)                │
│    "Outcome tracking gap mentioned"             │
├─────────────────────────────────────────────────┤
│ TALKING POINTS                                   │
│  · We've helped 3 orgs of this size move off…  │
│  · Their Google Workspace + Salesforce combo…  │
├─────────────────────────────────────────────────┤
│ OPEN QUESTIONS                                   │
│  · Who is the IT decision-maker?                │
│  · What is their Salesforce license tier?       │
├─────────────────────────────────────────────────┤
│ WATCH-OUTS                                       │
│  · No budget signal yet — risk of scope creep  │
└─────────────────────────────────────────────────┘
                              [↻ Refresh]  generated 2h ago
```

**Behavior:**
- On mount, calls `/api/partnerships/recommend` (without `force_refresh`) to get or return
  the cached recommendation
- "Refresh" button calls with `force_refresh: true`
- TanStack Query with `staleTime: Infinity` — only refetches on explicit refresh or when
  the component mounts fresh (panel navigated to)
- Insufficient data state: shows a checklist of what's missing
  ("Add pain points and tech stack notes before generating a recommendation")

---

## Caching Strategy

| Scenario | Behavior |
|---|---|
| First visit, no cache | API generates + caches + returns |
| Revisit within 7 days | API returns cache immediately (no LLM call) |
| `force_refresh = true` | API always regenerates |
| Key fields updated (pain_points, tech_stack_notes, qualification_notes) | Cache is **not** automatically invalidated — user must hit Refresh. Avoids runaway LLM calls on every edit. |

The 7-day TTL is checked server-side. Client-side, TanStack Query caches the result for
the session (no extra refetch unless explicitly triggered).

---

## TypeScript Types

```typescript
// src/lib/types.ts additions

export interface AdvisorRecommendedService {
  service: string
  rationale: string
  priority: 'primary' | 'secondary'
}

export interface AdvisorRecommendation {
  fit_score: 1 | 2 | 3 | 4 | 5 | null
  fit_rationale: string
  recommended_services: AdvisorRecommendedService[]
  talking_points: string[]
  open_questions: string[]
  watch_outs: string[]
  generated_at: string
}

export interface AdvisorResponse {
  recommendation?: AdvisorRecommendation
  cached: boolean
  error?: string
  message?: string    // insufficient data message
}
```

---

## Implementation Sequence

1. **`src/lib/partnerships/advisorPrompt.ts`** — prompt builder function, takes `Opportunity`
   + `PartnershipDetails` → returns the user prompt string
2. **`api/partnerships/recommend.ts`** — POST handler: auth, cache check, LLM call, cache write
3. **TypeScript types** — `AdvisorRecommendation`, `AdvisorRecommendedService`, `AdvisorResponse`
   added to `src/lib/types.ts`
4. **`PartnershipAdvisorPanel.tsx`** — full recommendation UI component
5. **`OpportunityDetail.tsx`** — add "AI Advisor" tab (partnership only, after Interactions)

---

## Model Selection

| Use Case | Model | Rationale |
|---|---|---|
| Solution recommendations | `claude-sonnet-4-6` | Requires reasoning about service fit, tech stack context, and nonprofit org dynamics — Haiku is not sufficient for nuanced analysis |

---

## Key Design Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Sonnet (not Haiku) for recommendations | Fit analysis requires judgment about service alignment, not just structured extraction |
| 2 | 7-day cache in DB | Avoids LLM call on every tab open; partnership context rarely changes day-to-day |
| 3 | Manual refresh only (no auto-invalidate) | Prevents runaway calls; user is best judge of when enough new info warrants regeneration |
| 4 | Insufficient data → message, not error | Graceful UX — tells user what to add rather than failing silently |
| 5 | Structured JSON output (not streaming) | Recommendation is a structured artifact, not prose; no UX benefit to streaming a JSON object |
| 6 | Admin/manager auth gate on API | Only team members working the pipeline should trigger LLM calls; viewers read cached output only |
| 7 | `fit_score` as 1–5 integer | Simple enough for a sidebar badge; precise enough to distinguish strong/weak/neutral fit |

---

## Out of Scope

- Email draft generation based on recommendations (Phase 4)
- Automatic re-generation on field save
- Proposal template generation (separate ADR)
- Multi-org comparison / pipeline analytics
- External CRM sync (Salesforce, HubSpot)

---

## Environment Variables

No new variables required. Uses existing:
```
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```
