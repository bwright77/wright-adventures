# ADR-002: Grant Discovery Pipeline

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-02-26
**Status:** Accepted
**Validated:** 2026-02-26 (two live API validation runs)
**PRD Reference:** OMP PRD v3.0 (draft), Phase 3 — Discovery & Intelligence

---

## Context

The OMP Phase 2 AI grant writing feature (ADR-001) is live. Users can open an opportunity already in the system and generate narrative drafts via Claude. The gap: opportunities still enter the system manually. Shane and Vivian currently discover grants through personal networks, email lists, and ad-hoc web searches — a time-intensive process with no systematic coverage and no historical record of what was evaluated and why.

Phase 3 closes this gap by introducing an automated discovery pipeline that:

1. Continuously monitors federal grant databases for new opportunities
2. Extracts structured fields from raw listings via AI
3. Scores each opportunity against Confluence Colorado's organizational profile
4. Surfaces high-fit opportunities in the OMP admin UI for human review
5. Promotes approved opportunities into the existing grant writing pipeline

**Applying entity:** Confluence Colorado (501(c)(3), EIN: TBD) — the programmatic arm of Wright Adventures. All eligibility scoring is against Confluence's profile, not Wright Adventures directly.

**Architectural constraint:** Same as ADR-001 — React 19 + Vite SPA on Vercel, Supabase backend, no standalone server. New functionality must fit the existing Vercel Serverless Function + Supabase pattern.

---

## Decision

Build a **two-stage AI pipeline** triggered by a **Vercel Cron Job** (daily) that:

1. **Fetches** new opportunity IDs from Simpler.Grants.gov `/v1/opportunities/search`
2. **Deduplicates** against existing `opportunities` rows
3. **Fetches full detail** via `GET /v1/opportunities/{id}` for each new opportunity (search results omit deadline, eligibility, and full description fields)
4. **Extracts** structured fields via `claude-haiku-4-5` (fast, cheap)
5. **Scores** each opportunity against the Confluence org profile via `claude-sonnet-4-6`
6. **Inserts** opportunities with `weighted_score >= 5.0` into `opportunities` with `status = 'discovered'`
7. **Notifies** admin via in-app badge (email notification deferred)

Source selection rationale: Simpler.Grants.gov (`api.simpler.grants.gov/v1`) is chosen over the legacy `api.grants.gov/v2` — it has a cleaner REST schema, active maintenance, free API key access, and supports the filter set needed for Confluence's profile. Rate limit: 60 req/min, 10,000 req/day per key — well within cron job constraints.

Foundation/private grant scraping is **deferred to Phase 3b** — more fragile, requires per-site maintenance, and federal grants represent the highest-value discovery gap today.

---

## Implementation Plan

### 1. New API Endpoints

```
/api/discovery/
  sync.ts       ← Cron-triggered (+ manual trigger from admin UI)
  score.ts      ← Re-score a single opportunity on demand
```

**`/api/discovery/sync.ts` — lifecycle:**
1. Validate request: Vercel Cron secret header OR admin JWT
2. Load active `ORG_PROFILE` from `org_profiles` Supabase table
3. Load enabled queries from `discovery_queries` table, ordered by `priority`
4. Execute each query against Simpler.Grants.gov `/v1/opportunities/search`
5. Collect unique `opportunity_id` values across all query results; deduplicate against `opportunities.external_id`
6. For each new `opportunity_id`: call `GET /v1/opportunities/{id}` to fetch full detail (deadline, eligibility, full description are not returned by search)
7. Run two-stage AI pipeline: Haiku extraction → Sonnet scoring
8. Insert rows where `weighted_score >= 5.0` with `status = 'discovered'`, `auto_discovered = true`
9. Write `discovery_runs` audit row (counts, token usage, errors, duration)

**`/api/discovery/score.ts` — on-demand re-score:**
- Accepts `opportunity_id` (UUID)
- Re-runs Sonnet scoring against current `org_profiles` row
- Updates `ai_match_score`, `ai_match_rationale`, `ai_score_detail` on the opportunity
- Useful when org profile changes or score needs a manual refresh

---

### 2. Query Configuration

Queries are stored in Supabase (`discovery_queries` table) so they can be edited from the admin UI without code deploys. Each query has:

```typescript
interface DiscoveryQuery {
  id: string
  label: string
  enabled: boolean
  payload: SimplerGrantsSearchPayload  // exact request body
  priority: number                      // order of execution
}
```

**Query strategy** — validated via two live API runs on 2026-02-26. See validation findings below.

**Key findings from validation:**
- Broad OR keyword search (147 results): too noisy — incidental keyword matches on human trafficking, clinical research, nursing homes
- `income_security_and_social_services` category: wrong federal taxonomy for youth dev — maps to SNAP/foster care programs
- Exact geographic keyword phrases ("watershed Colorado", "environmental justice"): zero results — API matches on title/short description only, not full NOFO text
- Agency-scoped + single-category queries: highest precision — all results were genuine fits
- USDA, EPA, AmeriCorps, HHS: zero results on 2026-02-26 — expected, federal grant cycles are seasonal; queries remain enabled to capture new postings
- `summary` field in search results is an **object** (`{ summary_description: string }`), not a flat string — extraction must use `opportunity.summary?.summary_description`
- Search results **omit** deadline, eligibility, and full description — `GET /v1/opportunities/{id}` required for complete data before Haiku extraction

**Query strategy — final** (validated via agency facet probe 2026-02-26):

**Category pool sizes** (nonprofit-eligible, across target categories):

| Category | Pool size | Signal strategy |
|---|---|---|
| `health` | 185 | Too broad — exclude unless keyword-scoped |
| `education` | 178 | High value — keyword-scoped to outdoor/youth/conservation |
| `food_and_nutrition` | 64 | Relevant — Mo Betta Green partnership |
| `environment` | 56 | Core — all results worth scoring |
| `employment_labor_and_training` | 8 | Small pool, high relevance — take all |
| `community_development` | 6 | Small pool, high relevance — take all |
| `natural_resources` | 5 | Small pool, high relevance — take all |
| `agriculture` | 25 | Relevant — urban farming / Mo Betta |

> Note: `top_level_agency` facets were not returned by the API (empty object despite 230 results). Agency scoping via `top_level_agency` filter is likely still valid for filtering but cannot be verified from facet data alone. Agency-scoped queries that returned zero results (USDA, EPA, CNCS, HHS) are retained but flagged as seasonal — the category pool data confirms those agencies have active opportunities, they may simply not be using the expected top-level codes.

**Initial query set** (9 queries):

```typescript
const INITIAL_QUERIES: DiscoveryQuery[] = [
  // ── Small pools: take everything, let Sonnet score ────────────────────────
  {
    label: "All agencies — natural_resources",
    enabled: true,
    priority: 1,
    payload: {
      filters: {
        opportunity_status: { one_of: ["posted", "forecasted"] },
        funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
        applicant_type: { one_of: ["nonprofits_non_higher_education_with_501c3"] },
        funding_category: { one_of: ["natural_resources"] },
      },
      pagination: { page_offset: 1, page_size: 25, sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
    },
  },
  {
    label: "All agencies — environment",
    enabled: true,
    priority: 2,
    payload: {
      filters: {
        opportunity_status: { one_of: ["posted", "forecasted"] },
        funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
        applicant_type: { one_of: ["nonprofits_non_higher_education_with_501c3"] },
        funding_category: { one_of: ["environment"] },
      },
      pagination: { page_offset: 1, page_size: 25, sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
    },
  },
  {
    label: "All agencies — employment_labor_and_training",
    enabled: true,
    priority: 3,
    payload: {
      filters: {
        opportunity_status: { one_of: ["posted", "forecasted"] },
        funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
        applicant_type: { one_of: ["nonprofits_non_higher_education_with_501c3"] },
        funding_category: { one_of: ["employment_labor_and_training"] },
      },
      pagination: { page_offset: 1, page_size: 25, sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
    },
  },
  {
    label: "All agencies — community_development",
    enabled: true,
    priority: 4,
    payload: {
      filters: {
        opportunity_status: { one_of: ["posted", "forecasted"] },
        funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
        applicant_type: { one_of: ["nonprofits_non_higher_education_with_501c3"] },
        funding_category: { one_of: ["community_development"] },
      },
      pagination: { page_offset: 1, page_size: 25, sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
    },
  },
  // ── Larger pools: keyword-scoped to reduce noise ──────────────────────────
  {
    label: "education — keyword: youth outdoor conservation",
    enabled: true,
    priority: 5,
    payload: {
      query: "youth outdoor conservation stewardship nature",
      filters: {
        opportunity_status: { one_of: ["posted", "forecasted"] },
        funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
        applicant_type: { one_of: ["nonprofits_non_higher_education_with_501c3"] },
        funding_category: { one_of: ["education"] },
      },
      pagination: { page_offset: 1, page_size: 25, sort_order: [{ order_by: "relevancy", sort_direction: "descending" }] },
    },
  },
  {
    label: "food_and_nutrition — keyword: community urban farm",
    enabled: true,
    priority: 6,
    payload: {
      query: "community urban farm market food access",
      filters: {
        opportunity_status: { one_of: ["posted", "forecasted"] },
        funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
        applicant_type: { one_of: ["nonprofits_non_higher_education_with_501c3"] },
        funding_category: { one_of: ["food_and_nutrition", "agriculture"] },
      },
      pagination: { page_offset: 1, page_size: 25, sort_order: [{ order_by: "relevancy", sort_direction: "descending" }] },
    },
  },
  // ── DOL workforce — confirmed working, high fit ───────────────────────────
  {
    label: "DOL — employment_labor_and_training + youth",
    enabled: true,
    priority: 7,
    payload: {
      query: "youth",
      filters: {
        opportunity_status: { one_of: ["posted", "forecasted"] },
        funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
        applicant_type: { one_of: ["nonprofits_non_higher_education_with_501c3"] },
        top_level_agency: { one_of: ["DOL"] },
        funding_category: { one_of: ["employment_labor_and_training"] },
      },
      pagination: { page_offset: 1, page_size: 25, sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
    },
  },
  // ── Agency-scoped (zero results 2026-02-26 — seasonal, kept for cycle pickup)
  {
    label: "DOI — natural_resources + education (seasonal)",
    enabled: true,
    priority: 8,
    payload: {
      filters: {
        opportunity_status: { one_of: ["posted", "forecasted"] },
        funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
        applicant_type: { one_of: ["nonprofits_non_higher_education_with_501c3"] },
        top_level_agency: { one_of: ["DOI"] },
        funding_category: { one_of: ["natural_resources", "education"] },
      },
      pagination: { page_offset: 1, page_size: 25, sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
    },
  },
  {
    label: "EPA + USDA — environment + natural_resources (seasonal)",
    enabled: true,
    priority: 9,
    payload: {
      filters: {
        opportunity_status: { one_of: ["posted", "forecasted"] },
        funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
        applicant_type: { one_of: ["nonprofits_non_higher_education_with_501c3"] },
        top_level_agency: { one_of: ["EPA", "USDA"] },
        funding_category: { one_of: ["environment", "natural_resources"] },
      },
      pagination: { page_offset: 1, page_size: 25, sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
    },
  },
]
```

---

### 3. Two-Stage AI Pipeline

**Stage 1 — Field Extraction (Haiku)**

Input: raw opportunity object from Simpler.Grants.gov API
Output: structured fields mapped to the `opportunities` table schema

```typescript
// Model: claude-haiku-4-5-20251001 — fast, ~$0.001/opportunity
// Purpose: normalize and enrich raw API fields into OMP schema

const extractionPrompt = `
Extract and normalize the following fields from this federal grant opportunity.
Return only valid JSON — no preamble or explanation.

{
  "name": "<opportunity title>",
  "funder": "<agency name>",
  "grant_type": "federal",
  "description": "<summary.summary_description, max 500 chars>",  // summary is an object in API response
  "amount_requested": null,
  "amount_max": <award_ceiling or null>,
  "primary_deadline": "<close_date ISO string or null>",
  "loi_deadline": null,
  "eligibility_notes": "<applicant types + any stated restrictions>",
  "cfda_number": "<assistance_listing_number or null>"
}
`
```

**Stage 2 — Fit Scoring (Sonnet)**

Input: extracted fields + full `ORG_PROFILE_PROMPT` from `confluence-org-profile.ts`
Output: structured score JSON

```typescript
// Model: claude-sonnet-4-6 — better reasoning for nuanced eligibility analysis
// Purpose: score 1-10 across 5 weighted criteria, flag red flags, recommend action

// Returns (per ORG_PROFILE_PROMPT schema):
// {
//   scores: { mission_alignment, geographic_eligibility, applicant_eligibility,
//             award_size_fit, population_alignment },
//   weighted_score: <1-10>,
//   auto_rejected: boolean,
//   auto_reject_reason: string | null,
//   rationale: string,
//   red_flags: string[],
//   recommended_action: "apply" | "investigate" | "skip"
// }
```

**Cost estimate per sync run:**
- ~20–30 new unique opportunities/day (realistic estimate based on validation; 8 queries with dedup)
- Detail fetch: 1 API call per new opportunity — well within 10,000/day rate limit
- Haiku extraction: ~800 tokens/opp (full detail text is longer than search snippet) → ~$0.02/day
- Sonnet scoring: ~1,200 tokens/opp → ~$0.05/day
- **Total: ~$0.07/day, ~$2/month** at current Anthropic pricing

Auto-rejected opportunities (score = 0) skip Stage 2 entirely to save tokens.

> Note: Original estimate of ~100 new opps/day was too high. Agency probe revealed ~230 total nonprofit-eligible opportunities across all target categories combined — not per day, but in total currently active. Daily new postings will be a small fraction of this. Realistic steady-state is 0–5 net-new opportunities per day, with occasional spikes when major agencies open new cycles.

---

### 4. Supabase Schema Changes

```sql
-- Migration: supabase/migrations/20260226000000_grant_discovery.sql

-- Extend opportunities table
ALTER TABLE opportunities
  ADD COLUMN source              TEXT,
  ADD COLUMN external_id         TEXT,
  ADD COLUMN external_url        TEXT,
  ADD COLUMN ai_match_score      NUMERIC(3,1),  -- weighted 1-10, one decimal
  ADD COLUMN ai_match_rationale  TEXT,
  ADD COLUMN ai_score_detail     JSONB,         -- full score breakdown + red_flags
  ADD COLUMN auto_discovered     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN discovered_at       TIMESTAMPTZ;

-- Prevent duplicate ingestion of the same external opportunity
CREATE UNIQUE INDEX opportunities_source_external_id_idx
  ON opportunities(source, external_id)
  WHERE external_id IS NOT NULL;

-- Org profile — editable from admin UI
CREATE TABLE org_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name      TEXT NOT NULL,
  profile_json  JSONB NOT NULL,   -- ORG_PROFILE object
  prompt_text   TEXT NOT NULL,    -- ORG_PROFILE_PROMPT string
  is_active     BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  updated_by    UUID REFERENCES auth.users(id)
);

-- Configurable query set — editable from admin UI
CREATE TABLE discovery_queries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  priority    INTEGER NOT NULL DEFAULT 0,
  payload     JSONB NOT NULL,    -- SimplerGrantsSearchPayload
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Audit log for each sync run
CREATE TABLE discovery_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  triggered_by      TEXT NOT NULL CHECK (triggered_by IN ('cron', 'manual')),
  opportunities_fetched   INTEGER NOT NULL DEFAULT 0,
  opportunities_new       INTEGER NOT NULL DEFAULT 0,
  opportunities_skipped   INTEGER NOT NULL DEFAULT 0,  -- deduped
  opportunities_rejected  INTEGER NOT NULL DEFAULT 0,  -- auto-rejected
  opportunities_inserted  INTEGER NOT NULL DEFAULT 0,
  token_cost_haiku        INTEGER,
  token_cost_sonnet       INTEGER,
  error_log         JSONB,
  status            TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed'))
);

-- RLS
-- org_profiles: admin read/write only
-- discovery_queries: admin read/write only
-- discovery_runs: admin read only
```

---

### 5. Admin UI Changes

**"Discovered" tab on the Opportunities list page**
- Filter: `auto_discovered = true AND status = 'discovered'`
- Columns: name, funder, match score (color-coded), deadline, recommended action
- Score badge: green (7–10) / amber (5–6) / red (1–4, below insertion threshold — shown only on re-scored items)
- Actions per row: "Add to Pipeline" (promotes to `status = 'new'`), "Skip" (sets `status = 'archived'`), "Re-score"
- Sort default: `ai_match_score DESC`

**Score detail drawer**
- Expands inline to show per-criterion scores, rationale, red flags
- Links to original opportunity on Simpler.Grants.gov

**Settings page additions**
- Discovery section: last run timestamp, next scheduled run, manual "Run Now" trigger
- Org Profile editor: JSON editor with save → updates `org_profiles` row
- Query manager: enable/disable/reorder discovery queries

**Cron badge in nav**
- Small indicator showing discovery status (idle / running / error)
- Click → opens discovery run log

---

### 6. Vercel Cron Configuration

```json
// vercel.json additions
{
  "crons": [
    {
      "path": "/api/discovery/sync",
      "schedule": "0 7 * * *"
    }
  ]
}
```

Runs at 7:00 AM UTC daily (midnight Mountain Time). Secured via `CRON_SECRET` environment variable — Vercel passes this as `Authorization: Bearer <secret>` header; the endpoint validates it before proceeding.

---

### 7. Environment Variables

New server-side variables (Vercel dashboard only):
```
SIMPLER_GRANTS_API_KEY=<from simpler.grants.gov/developer>
CRON_SECRET=<random secret, generated at deploy time>
```

---

## Alternatives Considered

**Legacy Grants.gov API (`api.grants.gov/v2`)** — no API key required, but older schema, less actively maintained, and weaker filter support. Simpler.Grants.gov is the strategic direction per HHS; `v2` will eventually be deprecated.

**Candid/Foundation Directory API** — gold standard for foundation grants but requires $2k+/yr subscription. Deferred until a paying partner org justifies the cost. Revisit in Phase 3b.

**State portal scraping** — CDPHE, DNR, OEDIT post relevant grants but have no APIs. Web scraping is fragile and maintenance-heavy. Deferred to Phase 3b after federal coverage is stable.

**Single-stage AI pipeline (Sonnet only)** — simpler but ~3x the token cost for extraction tasks that don't require Sonnet-level reasoning. Haiku is sufficient for field normalization; Sonnet reserved for nuanced eligibility judgment.

**Webhook / real-time sync** — Simpler.Grants.gov doesn't offer webhooks. Daily cron is the right polling interval given grant posting cadence (new opportunities typically appear weekly, not hourly).

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| API enum values change (already hit once) | Medium | Low | Validate query payloads at sync start; log 422 errors to `discovery_runs.error_log`; alert admin |
| High false-positive rate (low-relevance results flooding admin UI) | Low | Medium | Score threshold `weighted_score >= 5.0` (raised from 4.0 after validation showed low result volume — surface more candidates for human review); tune after 30 days |
| Simpler.Grants.gov federal funding lapse / outage | Low | Low | Site has already noted it remains available during funding lapses; `discovery_runs` log surfaces failures visibly |
| AI scoring inconsistency across runs | Low | Low | `ai_score_detail` JSONB preserves full scoring breakdown; on-demand re-score available |
| Token costs exceed budget | Low | Low | ~$12/month estimate is well within existing `token_budgets` framework from Phase 2; cron can be paused from admin UI |
| Multi-tenancy (partner orgs want their own discovery) | Future | Medium | `org_profiles` table designed for multiple rows; `discovery_queries` can be org-scoped in Phase 3b |

---

## Out of Scope (Phase 3)

- Foundation / private funder scraping (Phase 3b)
- State grant portal integration (Phase 3b)
- Multi-org / partner org discovery (Phase 3b)
- Email / Slack notifications on new high-score discoveries (Phase 3b)
- Document injection into Phase 2 chat (PDF/DOCX extraction via `pdf-parse` + `mammoth`) — still deferred
- Past application ingestion as few-shot examples — still deferred
- SAM.gov integration — overlaps heavily with Simpler.Grants.gov for nonprofit applicants; revisit if gaps emerge

---

## References

- [ADR-001: AI-Assisted Grant Writing](./ADR-001-ai-grant-writing.md)
- [Simpler.Grants.gov API Docs](https://wiki.simpler.grants.gov/product/api/search-opportunities)
- [Simpler.Grants.gov Developer Portal](https://simpler.grants.gov/developer)
- [Confluence Colorado Org Profile](./confluence-org-profile.ts)
- [Grant Discovery Test Script](./grants-discovery-test.ts)
- App: `https://wright-adventures.vercel.app/`
