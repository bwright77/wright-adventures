# ADR-011: Opportunity Discovery

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-08-18
**Status:** Proposed — implementation in progress
**Depends on:** ADR-005 (State/Local Discovery — machinery reused), ADR-009 (OMP Split)
**Amends:** ADR-009, which assigned the discovery tables to Confluence. They stay with WA.

---

## Context

ADR-009 left Wright Adventures with a partnership pipeline and no way to fill it.
Opportunities arrive today by hand: someone notices an RFP, or a client mentions a need.

The discovery machinery built for Confluence's grant search (ADR-005) is a near-exact fit for
the job — fetch a source page, hash it, diff against last run, extract candidates with Haiku,
score with Sonnet, dedupe, insert. Only the prompts and the scoring rubric were grant-specific.
Rather than delete it in the split and rebuild it, ADR-009 Phase 4 retained it.

### What the fit rubric changes

Wright Adventures' rubric scores seven dimensions 0–3 (21 max): engagement shape, warm path,
both halves needed, contract value, expansion potential, mission alignment, portfolio proof.

Two findings from the rubric's own worked examples drive this design.

**The stated bands were unreachable.** "21+ pursue hard" requires a perfect 7×3, yet CMC and
GOBRP both scored **19** and are recorded as pursued and won. Banding is therefore calibrated
to the observed calls, not the stated thresholds:

| Band | Total | Evidence |
|---|---|---|
| `pursue_hard` | ≥ 18 | CMC 19 (won), GOBRP 19 (filed) |
| `pursue_lean` | 14–17 | Climate Democracy 15 ("lean proposal") |
| `monitor` / `decline` | < 14 | United Way 13, Real Life 12 |

**Two dimensions act as gates, not addends.** Nourish Colorado scored 15 — identical to
Climate Democracy — but was deprioritized, the only difference being `engagement_shape = 0`
(full-time W-2). And the rubric's closing note says a 0 on warm path means "the rest of the
score has to be exceptional." So each of those zeros **downgrades one band**, and they stack.
This reproduces all six worked examples.

### The uncomfortable finding

Per the source ranking: *every opportunity that scored 19 came from a relationship; every one
sourced from a job board scored 15 or below.*

This tool automates the **low-yield** tier. That is still worth building — scanning boards and
portals is exactly the tedious, repetitive scanning that should not consume a principal's
attention — but it should be understood as **clearing the cold tier cheaply so human time goes
to warm channels**, not as the primary source of work. Warm channels are explicitly out of
scope for automation (§Out of Scope).

---

## Decision

### Procurement portals before job boards

An RFP or RFQ explicitly open to a firm scores **3 on engagement shape** — the single best
predictor in the rubric — and those rarely appear on job boards. Build order follows expected
value, not ease of scraping:

1. **Procurement** — Rocky Mountain E-Purchasing, Denver procurement, SAM.gov
2. **Colorado boards** — Colorado Nonprofit Association (filtered to Independent Contractor),
   Andrew Hudson's Jobs List
3. **Sector boards** — OIA/Camber, NABSA, NTEN, food-systems networks
4. **National** — Philanthropy News Digest, Work for Good, Tech Jobs for Good

For-profit mission-driven boards (B Corp, Climatebase, 80,000 Hours) are deliberately excluded:
a funded B Corp can afford both halves separately and hires employees or established agencies.

### Discovered items are `opportunities` with `type_id = 'lead'`

A lead is a candidate WA has not yet decided to pursue. It gets a pipeline, an owner, tasks,
and a deadline — everything an opportunity has — so it belongs in `opportunities` rather than a
parallel table. Posting-specific fields go in a **`lead_details` 1:1 extension**, following the
`partnership_details` pattern from ADR-006.

A lead that converts becomes a partnership. That conversion is manual and out of scope here.

**Stages:** `lead_discovered` → `lead_evaluating` → `lead_pursuing` → `lead_submitted` →
`lead_won` | `lead_lost` | `lead_declined`

`lead_discovered` is the review queue: auto-inserted, unreviewed.

### Reuse the existing discovery columns

`opportunities` already carries `source`, `external_id`, `external_url`, `auto_discovered`,
`discovered_at`, `discovery_source_id`, `ai_match_score`, `ai_match_rationale`, and
`ai_score_detail` (JSONB) from ADR-002. No new columns are needed:

| Column | Now holds |
|---|---|
| `ai_match_score` | Fit total, 0–21 |
| `ai_match_rationale` | One-paragraph rationale |
| `ai_score_detail` | The full `FitAssessment` JSON — per-dimension scores, action, gates applied, green/red flags, uncertainty |

The `ScoreDetail` TypeScript type is redefined from the five grant dimensions to the seven
rubric dimensions.

### `discovery_sources` becomes source-kind agnostic

- `source_type` values become `procurement | job_board | foundation_rfp | sector_board`
- `funder_name` → `publisher` (a job board has no funder)
- `source_proximity_bonus` is **dropped**. It existed to nudge state/local grants for smaller
  applicant pools. The fit rubric is self-contained and a per-source thumb on the scale would
  distort it — a bad opportunity from a good source is still a bad opportunity.

Retained unchanged and load-bearing: `last_content_hash`, `last_content_text`, the diff, and
the 3-strike `consecutive_errors` auto-disable.

### Scoring context lives in `org_profiles`

Two dimensions cannot be scored from a posting alone. `warm_path` needs WA's relationship
network; `portfolio_proof` needs the linkable work. Both live in the seeded WA profile
(`src/lib/discovery/waOrgProfile.ts`) and are injected verbatim into the Sonnet call.

**This makes the profile load-bearing.** A stale relationship list silently produces low
`warm_path` scores, which silently triggers the downgrade gate. It must be updated when
relationships change.

### Threshold

Insert at `total >= 12` — below the `pursue_lean` band, deliberately. A 12 with a warm path is
worth a look even when the arithmetic says decline, and the review queue is cheap. Anything
scoring under 12 is dropped without a record.

---

## Schema

```sql
-- 1:1 extension of opportunities for type_id = 'lead'
lead_details (
  opportunity_id  uuid PK → opportunities(id) ON DELETE CASCADE,
  source_kind     text,        -- 'rfp' | 'job' | 'contract'
  publisher       text,        -- issuing org / employer
  location        text,
  remote          boolean,
  engagement_type text,        -- 'rfp'|'contract'|'part_time'|'full_time'|'unknown'
  compensation_raw text,       -- verbatim; ranges are inconsistently formatted
  comp_min        numeric(12,2),
  comp_max        numeric(12,2),
  posted_date     date,
  closes_date     date,
  apply_url       text,
  requirements    text,
  created_at, updated_at
)
```

Money as `NUMERIC(12,2)`; **Supabase JS returns NUMERIC as a string** — coerce with `Number()`
at every use site (the ADR-005 `proximity_bonus` lesson).

---

## Pipeline

Per enabled source, on the weekly cron:

1. Fetch (15s timeout) → `extractPageText` → truncate to 100k chars for the prompt
2. `computeContentHash`; unchanged → skip, record `last_fetched_at`, move on
3. `computeTextDiff` against `last_content_text` → feed **only new text** to extraction
4. **Haiku** extracts candidate postings → title, publisher, url, dates, compensation, summary
5. **Sonnet** scores each against the rubric + WA profile → `FitAssessment`
6. `classify()` applies bands and gates — in TypeScript, not in the prompt, so it is testable
   and cannot drift with model behavior
7. `isDuplicate` against existing leads (dice coefficient on normalized names)
8. `total >= 12` → insert `opportunities` (`type_id='lead'`, `status='lead_discovered'`) +
   `lead_details`
9. Update source state; on error increment `consecutive_errors`, disable at 3
10. Finalize the `discovery_runs` row before the 250s soft deadline

Banding stays out of the prompt on purpose. The model scores dimensions; the code decides what
the scores mean.

---

## Implementation Sequence

1. Migration — `lead_details`, lead stages, `'lead'` opportunity type, `discovery_sources`
   rename/drop, WA `org_profiles` seed, source seeds
2. `state-utils.ts` — rename `normalizeGrantName` → `normalizeName` (grant-free vocabulary)
3. Prompts — `src/lib/discovery/extractionPrompt.ts`, `scoringPrompt.ts`
4. `api/discovery/sources-sync.ts` — replaces `state-sync.ts`
5. Review queue UI — leads sorted by fit, with the dimension breakdown
6. Settings — source management card
7. Cron + `opportunity-discovered` notification rewrite

---

## Out of Scope

- **Warm channels.** The highest-yield source is relationships, and no scraper reaches them.
  Do not build a CRM-nudge feature here; that is a different ADR.
- Auto-applying, auto-drafting proposals, or contacting anyone
- Bid/no-bid workflow beyond the pipeline stages
- Authenticated portals — SAM.gov entity registration, paid bidnet alerts
- Converting a won lead into a partnership (manual for now)
- For-profit mission-driven boards
