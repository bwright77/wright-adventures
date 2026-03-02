# ADR-005: State & Local Grant Discovery — Web Monitoring Pipeline

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-03-02
**Status:** Draft
**PRD Reference:** OMP PRD v2.0, Phase 3b — Platform Expansion
**Depends on:** ADR-002 (Federal Grant Discovery), ADR-003 (Email Notifications)

---

## Context

The federal grant discovery pipeline (ADR-002) is stable and running daily via Vercel Cron against Simpler.Grants.gov. However, Confluence Colorado's grant history shows that **state and local funders represent a significant share of the organization's pipeline** — GOCO, CWCB, CDPHE, DOLA, Colorado Health Foundation, Outdoor Equity Fund, and others appear repeatedly in the seeded historical data (migration `20260226000002`).

These sources have no public APIs. They publish opportunities on state government websites with varying structures, inconsistent update cadences, and no machine-readable feeds. ADR-002 explicitly deferred this work as "fragile and maintenance-heavy."

That assessment remains correct for traditional web scraping (DOM parsing, CSS selectors, XPath). But the approach proposed here avoids deep structural parsing entirely. Instead, it uses **lightweight page monitoring** (content hashing + text diffing) combined with **AI-powered extraction** to detect and interpret changes. The AI layer absorbs structural variation across sites, making the system resilient to redesigns that would break conventional scrapers.

**Why now:** Federal discovery is stable. The four target state sources (GOCO, CWCB, CDPHE, DOLA) collectively represent the highest-value unfunded discovery gap for Confluence Colorado's mission areas: watershed protection, youth pathways, environmental justice, and community development.

---

## Decision

Build a **page monitoring pipeline** that:

1. Periodically fetches a curated set of state/local grant index pages
2. Detects meaningful content changes via text-based diffing (not DOM diffing)
3. Sends changed content through an AI extraction stage to identify new or updated grant opportunities
4. Inserts qualifying opportunities into the existing discovery pipeline (same Haiku extraction → Sonnet scoring → admin review flow from ADR-002)
5. Applies a **source proximity bonus** of +1.0 to the weighted score for state and local opportunities, reflecting Confluence Colorado's stronger competitiveness and relationship networks at the state/local level vs. federal

Source configurations are stored as **data in Supabase** (not hardcoded) so new sources can be added, disabled, or reconfigured from the admin UI without code deploys.

---

## Target Sources — Initial Set

Reconnaissance conducted 2026-03-02 against all four targets. Findings:

### GOCO (Great Outdoors Colorado)

| Attribute | Value |
|---|---|
| Monitor URL | `https://goco.org/programs-projects/our-grant-programs` |
| Secondary URLs | `https://goco.org/grants/apply` (grant calendar + deadlines) |
| Update cadence | Seasonal — programs refresh annually (concept papers ~July, awards ~December) |
| Nonprofit eligibility | **Indirect only** for most programs — nonprofits must partner with local governments or land trusts. Exception: Generation Wild funds diverse coalitions directly. Conservation Service Corps is administered via CYCA. |
| Relevance to Confluence | **High** — Conservation Service Corps (youth crews), Generation Wild (youth + families outdoor access), Pathways (career pathways for underrepresented individuals) all align directly with mission. |
| Scraping complexity | Low — well-structured static HTML, program pages are distinct and stable. |
| Notes | GOCO invests ~$16M/year through base programs. FY2026 cycle is active. Concept paper deadlines and award dates are published on the grant calendar. |

### CWCB (Colorado Water Conservation Board)

| Attribute | Value |
|---|---|
| Monitor URL | `https://cwcb.colorado.gov/funding/grants` |
| Secondary URLs | `https://cwcb.colorado.gov/funding/colorado-water-plan-grants` (Water Plan Grants — primary target), `https://cwcb.colorado.gov/funding/water-supply-reserve-fund-grants` (WSRF — rolling deadlines) |
| Update cadence | Twice yearly for Water Plan Grants (July 1, Dec 1 deadlines). WSRF has rolling bimonthly deadlines (Oct 1, Dec 1, Feb 1, Apr 1, Jun 1, Aug 1). |
| Nonprofit eligibility | **Direct for WSRF** — private entities including nonprofit corporations are explicitly eligible. Water Plan Grants primarily target governmental entities and covered entities, but nonprofits can partner. |
| Relevance to Confluence | **High** — South Platte watershed conservation is a core strategic objective. CWCB's Watershed Health & Recreation category aligns directly. Confluence has applied previously (Colorado Water Plan Grant in seed data). |
| Scraping complexity | Medium — colorado.gov sites use a CMS with dynamic content blocks. Text extraction is straightforward but page structure may shift with CMS updates. |
| Notes | CWCB launched a Water Funding Explorer interactive tool in late 2025. The grants page itself remains the canonical listing. |

### CDPHE (Colorado Department of Public Health and Environment)

| Attribute | Value |
|---|---|
| Monitor URL | `https://cdphe.colorado.gov/funding-opportunities` (index page — lists all CDPHE grant programs) |
| Secondary URLs | `https://cdphe.colorado.gov/ej/grants` (Environmental Justice Grant Program — primary target) |
| Update cadence | EJ Grant Program is annual — Cycle 3 awarded May 2025 ($3.16M), next application period expected Summer 2026. Nonpoint Source Mini Grants are rolling year-round ($1K–$5K). |
| Nonprofit eligibility | **Direct** — nonprofits, local governments, tribal governments, universities, for-profit corporations, and grassroots organizations are all eligible for EJ grants. |
| Relevance to Confluence | **Very high** — Confluence applied for the CDPHE EJ grant in 2024 ($300K request, per seed data). Environmental justice, water quality, and community health are core mission areas. The EJ program explicitly targets communities disproportionately impacted by pollution — aligns with South Platte / Globeville-Elyria-Swansea focus areas. |
| Scraping complexity | Low-Medium — the funding opportunities page is a clean index. EJ grants page is well-structured with clear cycle information. |
| Notes | CDPHE also runs the NPS Mini Grant Program (year-round, small awards) and the Health Disparities and Community Grant Program — both worth monitoring long-term. |

### DOLA (Colorado Department of Local Affairs)

| Attribute | Value |
|---|---|
| Monitor URL | `https://cdola.colorado.gov/dola-funding-opportunities` (master index) |
| Secondary URLs | `https://dlg.colorado.gov/npi` (Nonprofit Infrastructure Grant — closed but monitor for reauthorization), `https://dlg.colorado.gov/community-development-block-grant-cdbg` (CDBG — nonprofits via local gov sponsors) |
| Update cadence | Varies by program. NPI was a one-time COVID recovery program (closed Aug 2023, funds expire Dec 2026). CDBG and REDI are ongoing with rolling cycles. Local Planning Capacity grants run twice annually (Feb, Sep). |
| Nonprofit eligibility | **Primarily indirect** — most DOLA programs target local governments. Nonprofits can be sponsored applicants for CDBG. NPI was the exception (directly funded small nonprofits, $150K–$2M budget). |
| Relevance to Confluence | **Medium** — DOLA is most relevant when partnering with local government entities (Denver, Adams County) on community development projects. Worth monitoring for NPI-like reauthorizations and CDBG opportunities where a government partner sponsors Confluence. Confluence has applied previously (DOLA 2023 in seed data). |
| Scraping complexity | Medium — multiple DLG subdomains (`dlg.colorado.gov`, `cdola.colorado.gov`). Program pages are distinct but spread across different site sections. |
| Notes | DOLA's Local Community Funding Guide is a useful meta-resource that aggregates funding sources across state agencies. Not directly scrapeable for opportunities, but could inform future source additions. |

---

## Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Vercel Cron (weekly)                            │
│                  /api/discovery/state-sync                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. Load enabled source configs from `discovery_sources` table      │
│  2. For each source: fetch page → extract text → compute hash       │
│  3. Compare hash to `last_content_hash` on the source record        │
│  4. If unchanged → skip. If changed → compute text diff.            │
│  5. Send diff + full page text to AI extraction (Haiku)             │
│  6. AI returns structured opportunity candidates (or "no new opps") │
│  7. Deduplicate against existing opportunities (name + funder fuzzy) │
│  8. For each new candidate → Sonnet scoring (same as ADR-002)       │
│     → Apply source_proximity_bonus (+1.0 for state/local)           │
│  9. Insert qualifying opportunities (weighted_score >= 5.0)         │
│ 10. Write `discovery_runs` audit row (same schema as ADR-002)       │
│ 11. Trigger notifications (same flow as ADR-003)                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Cron Cadence

**Weekly** (not daily like federal). Rationale: state/local grant pages update far less frequently than the federal API. Most sources operate on seasonal cycles (annual or biannual). Weekly monitoring is sufficient to catch new postings within the first week, and reduces unnecessary page fetches against government servers.

```json
// vercel.json addition
{
  "crons": [
    {
      "path": "/api/discovery/state-sync",
      "schedule": "0 8 * * 1"
    }
  ]
}
```

Runs Monday at 8:00 AM UTC (1:00 AM Mountain Time). Offset from the federal sync (daily at 7:00 AM UTC) to avoid overlapping execution windows.

---

## Data Model

### New Table: `discovery_sources`

```sql
CREATE TABLE discovery_sources (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Source identity
  label               TEXT NOT NULL,                -- e.g. "GOCO — Grant Programs"
  source_type         TEXT NOT NULL DEFAULT 'state', -- 'state' | 'local' | 'foundation' | 'federal_api'
  funder_name         TEXT NOT NULL,                -- e.g. "Great Outdoors Colorado"
  
  -- Monitoring config
  url                 TEXT NOT NULL,                -- page to monitor
  enabled             BOOLEAN NOT NULL DEFAULT true,
  check_frequency     TEXT NOT NULL DEFAULT 'weekly', -- 'daily' | 'weekly' | 'monthly'
  
  -- Eligibility context (injected into AI extraction prompt)
  eligibility_notes   TEXT,                         -- e.g. "Nonprofits must partner with local gov"
  relevance_notes     TEXT,                         -- e.g. "Conservation Service Corps, Generation Wild"
  
  -- Scoring adjustment
  source_proximity_bonus NUMERIC(3,1) NOT NULL DEFAULT 1.0,  -- added to weighted_score
  
  -- State tracking
  last_content_hash   TEXT,                         -- SHA-256 of extracted text from last fetch
  last_fetched_at     TIMESTAMPTZ,
  last_changed_at     TIMESTAMPTZ,                  -- last time content actually changed
  last_error          TEXT,
  consecutive_errors  INTEGER NOT NULL DEFAULT 0,
  
  -- Metadata
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- Index for cron query
CREATE INDEX idx_discovery_sources_enabled 
  ON discovery_sources(enabled) WHERE enabled = true;
```

### Schema Changes to Existing Tables

**`opportunities` table** — add column:

```sql
ALTER TABLE opportunities 
  ADD COLUMN discovery_source_id UUID REFERENCES discovery_sources(id);

COMMENT ON COLUMN opportunities.discovery_source_id IS 
  'Links auto-discovered state/local opportunities back to their monitoring source. NULL for federal (Simpler.Grants.gov) and manual entries.';
```

**`discovery_runs` table** — add column:

```sql
ALTER TABLE discovery_runs
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'federal';

COMMENT ON COLUMN discovery_runs.source_type IS 
  'Distinguishes federal API sync runs from state/local page monitoring runs.';
```

### Scoring Adjustment

The existing Sonnet scoring pipeline (ADR-002) produces a `weighted_score` on a 1–10 scale. For state/local sources, the `source_proximity_bonus` is added **after** the AI scoring step:

```typescript
const finalScore = Math.min(
  10.0,
  aiWeightedScore + source.source_proximity_bonus
);
```

**Rationale for +1.0 default bonus:**

- State/local funders have smaller applicant pools → higher win probability per application
- Confluence Colorado has existing relationships with several state funders (GOCO, CWCB, CDPHE — all in seed data)
- State/local grants often have lower compliance overhead than federal grants
- Geographic alignment is inherent (Colorado-only funders)
- The bonus is configurable per source — can be tuned up or down from the admin UI as relationship data accumulates

The bonus is capped at 10.0 to preserve the score scale's interpretability.

---

## Implementation Plan

### 1. New API Endpoint

```
/api/discovery/
  state-sync.ts    ← Cron-triggered (+ manual trigger from admin UI)
```

**`/api/discovery/state-sync.ts` — lifecycle:**

1. Validate request: Vercel Cron secret header OR admin JWT (same auth pattern as ADR-002)
2. Load enabled sources from `discovery_sources` table, filtered by `check_frequency` against current schedule
3. For each source:
   a. **Fetch** — HTTP GET with a reasonable User-Agent header, 15s timeout, retry once on 5xx
   b. **Extract text** — Strip HTML tags, normalize whitespace. No DOM parsing — treat the page as a text document. This is the key resilience decision: we don't depend on CSS selectors or page structure.
   c. **Hash** — SHA-256 of the extracted text
   d. **Compare** — If hash matches `last_content_hash`, update `last_fetched_at` and skip to next source
   e. **Diff** — If hash differs, compute a simple text diff (added/removed lines) between the cached text and the new text
   f. **AI Extraction** — Send to Haiku with the full page text + diff + source context (eligibility notes, relevance notes, funder name)
   g. **Deduplication** — Fuzzy match extracted opportunity names against existing `opportunities` records (same funder + similar name = duplicate)
   h. **AI Scoring** — For each new candidate, run through Sonnet scoring pipeline (identical to ADR-002). Apply `source_proximity_bonus` to final score.
   i. **Insert** — Opportunities with `weighted_score >= 5.0` inserted with `status = 'discovered'`, `auto_discovered = true`, `source = source.source_type`, `discovery_source_id = source.id`
   j. **Update source** — Set `last_content_hash`, `last_fetched_at`, `last_changed_at` (if changed), clear `last_error`, reset `consecutive_errors`
4. Write `discovery_runs` audit row with `source_type = 'state'`
5. Trigger notification flow (ADR-003) for any newly inserted opportunities

**Error handling per source:**
- On fetch failure: increment `consecutive_errors`, log error to `last_error`, continue to next source
- After 3 consecutive errors: auto-disable source (`enabled = false`), log warning to `discovery_runs.error_log`
- Admin UI shows disabled sources with error context for manual investigation

### 2. Text Extraction Strategy

The critical design decision: **text extraction, not DOM parsing.**

```typescript
function extractPageText(html: string): string {
  // 1. Remove script and style blocks entirely
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  
  // 2. Replace block-level elements with newlines
  text = text.replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n');
  
  // 3. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // 4. Decode HTML entities
  text = decodeHTMLEntities(text);
  
  // 5. Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  
  return text.trim();
}
```

This approach is deliberately simple. It sacrifices structural awareness (we don't know which text was in a heading vs. a paragraph) in exchange for **complete resilience to layout changes.** The AI extraction stage doesn't need DOM structure — it needs the words on the page.

### 3. AI Extraction Prompt (Haiku)

```typescript
const extractionPrompt = `You are analyzing a Colorado state/local government grant funding page for potential grant opportunities relevant to a conservation and youth development nonprofit.

SOURCE: ${source.funder_name}
SOURCE URL: ${source.url}
ELIGIBILITY CONTEXT: ${source.eligibility_notes ?? 'No specific notes.'}
RELEVANCE CONTEXT: ${source.relevance_notes ?? 'No specific notes.'}

ORGANIZATION CONTEXT:
Confluence Colorado is a 501(c)(3) focused on: watershed protection (South Platte), youth career pathways, environmental justice, outdoor recreation access, and urban agriculture. Based in Denver, Colorado.

PAGE CONTENT:
${pageText}

${diff ? `CHANGES SINCE LAST CHECK:\n${diff}\n` : ''}

TASK: Extract any grant opportunities from this page that could be relevant to Confluence Colorado. For each opportunity found, return a JSON array with:

{
  "opportunities": [
    {
      "name": "Program name",
      "funder": "${source.funder_name}",
      "description": "Brief description of the program",
      "deadline": "Application deadline if stated (ISO date or descriptive text)",
      "amount_range": "Funding range if stated",
      "eligibility_summary": "Who can apply and any partnership requirements",
      "relevance_rationale": "Why this is relevant to Confluence Colorado",
      "confidence": "high | medium | low",
      "url": "Direct URL to program page if identifiable"
    }
  ],
  "page_summary": "Brief summary of what this page contains",
  "notable_changes": "Description of meaningful changes detected, or null"
}

If no relevant opportunities are found, return an empty opportunities array.
Only include opportunities with medium or high confidence of relevance.
Return ONLY valid JSON — no preamble or explanation.`;
```

### 4. Deduplication Strategy

State/local opportunities don't have external IDs like federal grants (`opportunity_id` from Simpler.Grants.gov). Deduplication relies on fuzzy matching:

```typescript
async function isDuplicate(
  candidate: ExtractedOpportunity, 
  supabase: SupabaseClient
): Promise<boolean> {
  // 1. Exact funder match + name similarity
  const { data: existing } = await supabase
    .from('opportunities')
    .select('id, name, funder')
    .eq('funder', candidate.funder)
    .eq('type_id', GRANT_TYPE_ID);
  
  if (!existing?.length) return false;
  
  // 2. Normalized string similarity (Levenshtein or trigram)
  const candidateNorm = normalize(candidate.name);
  return existing.some(opp => {
    const similarity = stringSimilarity(normalize(opp.name), candidateNorm);
    return similarity > 0.75; // 75% threshold
  });
}

function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/\(\d{4}\)/, '')     // strip year suffixes like "(2025)"
    .replace(/[^a-z0-9\s]/g, '')  // strip special chars
    .replace(/\s+/g, ' ')
    .trim();
}
```

This catches cases like "CDPHE Environmental Justice (2024)" matching "CDPHE Environmental Justice (2026)" as the same recurring program. The year-stripping normalization is critical for recurring grant cycles.

### 5. Content Caching

To compute diffs, we need the previous page text. Two options:

**Option A: Store full text in Supabase** — Simple but potentially large rows (100KB+ per page). Adds a `last_content_text` column to `discovery_sources`.

**Option B: Store in Supabase Storage** — File-based, cleaner separation. Each source gets a text file at `discovery-cache/{source_id}/latest.txt`.

**Decision: Option A** for the initial implementation. The four target sources produce modest text volumes (5–50KB each after HTML stripping). If source count grows significantly, migrate to Option B.

```sql
ALTER TABLE discovery_sources
  ADD COLUMN last_content_text TEXT;

COMMENT ON COLUMN discovery_sources.last_content_text IS
  'Cached extracted text from last successful fetch. Used for diff computation on subsequent runs.';
```

### 6. Admin UI Changes

**Discovery Sources management page** (new, under Settings):

- Table listing all sources: label, funder, URL, enabled toggle, last fetched, last changed, error status
- Add/edit source form: label, URL, source_type, funder_name, eligibility_notes, relevance_notes, check_frequency, source_proximity_bonus
- Per-source actions: "Check Now" (manual trigger for single source), "View History" (filtered `discovery_runs`), "Disable/Enable"
- Error indicator: sources with `consecutive_errors > 0` shown in amber; auto-disabled sources shown in red with last error message

**Existing Discovered tab** — no changes needed. State/local opportunities flow into the same `status = 'discovered'` pipeline and appear alongside federal discoveries. The `source` column distinguishes them (`state` vs. `federal`), and a source badge can be added to the table row for visual differentiation.

**Discovery Runs log** — add `source_type` filter to distinguish federal API runs from state/local monitoring runs.

### 7. Seed Data

Initial source configurations:

```sql
INSERT INTO discovery_sources (label, source_type, funder_name, url, eligibility_notes, relevance_notes, check_frequency, source_proximity_bonus) VALUES

('GOCO — Grant Programs', 'state', 'Great Outdoors Colorado', 
 'https://goco.org/programs-projects/our-grant-programs',
 'Nonprofits cannot apply directly for most programs — must partner with local government or land trust. Exceptions: Generation Wild funds diverse coalitions directly. Conservation Service Corps administered via CYCA.',
 'Conservation Service Corps (youth crews), Generation Wild (youth + families outdoor), Pathways (career pathways for underrepresented individuals). ~$16M/year invested.',
 'weekly', 1.0),

('CWCB — Water Plan Grants', 'state', 'Colorado Water Conservation Board',
 'https://cwcb.colorado.gov/funding/colorado-water-plan-grants',
 'Water Plan Grants primarily target governmental entities. WSRF grants accept nonprofit corporations directly. Nonprofits can partner with local entities for Water Plan Grants.',
 'South Platte watershed conservation, Watershed Health & Recreation category. Confluence applied previously (Colorado Water Plan Grant). Deadlines: July 1 and Dec 1.',
 'weekly', 1.0),

('CDPHE — Funding Opportunities', 'state', 'Colorado Department of Public Health and Environment',
 'https://cdphe.colorado.gov/funding-opportunities',
 'Nonprofits are directly eligible for EJ grants. NPS Mini Grants are rolling year-round ($1K-$5K).',
 'Environmental Justice Grant Program is primary target — Confluence applied in 2024 ($300K). EJ program reopens Summer 2026. Also: NPS Mini Grants, Health Disparities grants.',
 'weekly', 1.0),

('DOLA — Funding Opportunities', 'state', 'Colorado Department of Local Affairs',
 'https://cdola.colorado.gov/dola-funding-opportunities',
 'Most programs target local governments. Nonprofits can be sponsored applicants for CDBG. NPI Grant (direct nonprofit funding) is closed but monitor for reauthorization.',
 'CDBG (via local gov partner), NPI-like reauthorizations. Confluence applied DOLA 2023. Less directly relevant unless partnering with Denver/Adams County.',
 'weekly', 0.5);
```

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| State site redesign breaks text extraction | Medium | Low | Text extraction (not DOM parsing) is resilient to layout changes. AI layer interprets content regardless of structure. Manual review of extraction quality after any detected format change. |
| Rate limiting or blocking by state servers | Low | Low | Weekly cadence is extremely conservative. Respectful User-Agent header. Single fetch per source per run. |
| AI hallucinates opportunities not on page | Low | Medium | All discoveries require admin review before pipeline promotion. Haiku extraction includes confidence scoring. Low-confidence results are flagged. |
| Deduplication false negatives (duplicates inserted) | Medium | Low | Fuzzy matching at 75% threshold catches most recurring programs. Admin review is the final gate. Duplicates can be merged manually. |
| Deduplication false positives (new cycle treated as duplicate) | Low | Medium | Year-stripping normalization is the main risk vector. Mitigate by also checking deadline dates — same name but different deadline = new cycle. |
| Page text too large for Haiku context window | Low | Low | Most index pages are 5–50KB of text. Haiku's 200K context window handles this easily. If a page exceeds reasonable size, truncate to first 100KB with a warning in the extraction prompt. |
| Source proximity bonus creates score inflation | Low | Low | Bonus is capped at 10.0 total. +1.0 on a 10-point scale is meaningful but not distortive. Configurable per source — can be reduced to 0.5 or 0 if needed. |
| Consecutive error auto-disable triggers on transient outages | Low | Low | 3-error threshold with weekly cadence means a source is only disabled after 3 consecutive weeks of failure. Admin notification on auto-disable. Easy re-enable from UI. |

---

## Token Cost Estimate

Per weekly run (4 sources):

| Stage | Model | Est. tokens/source | Cost/source | Total/run |
|---|---|---|---|---|
| Extraction (changed pages only) | Haiku | ~15K input + ~2K output | ~$0.005 | ~$0.02 |
| Scoring (new opportunities only) | Sonnet | ~5K input + ~1K output | ~$0.02 | ~$0.08 |
| **Weekly total** | | | | **~$0.10** |
| **Monthly total** | | | | **~$0.40** |

Most weeks, 0–2 sources will show changes, so actual costs will typically be lower. Well within existing `token_budgets` framework.

---

## Environment Variables

No new environment variables required. The state sync endpoint uses the same `CRON_SECRET` and Anthropic API key as the federal sync (ADR-002).

---

## Alternatives Considered

**Full DOM scraping with CSS selectors per source** — Higher precision extraction but completely fragile to site redesigns. Each source would need a custom scraper maintained indefinitely. Rejected — does not scale and contradicts the "source configs as data" principle.

**RSS/Atom feed monitoring** — Ideal if available. None of the four target sources publish RSS feeds for their grant programs. Revisit if any source adds feed support.

**Third-party grant aggregators (GrantStation, Instrumentl, Candid)** — These aggregate state/local grants but require paid subscriptions ($500–$2K+/year). Deferred until a paying partner org justifies the cost, consistent with ADR-002's treatment of Candid.

**Manual-only with calendar reminders** — Zero engineering cost but doesn't scale. Relies entirely on Shane/team remembering to check each source. Defeats the purpose of the discovery pipeline.

**Source proximity bonus as a multiplier instead of additive** — e.g., `score * 1.15` instead of `score + 1.0`. Rejected because multiplicative bonuses disproportionately boost already-high scores while barely affecting borderline scores. Additive bonus uniformly lifts all state/local opportunities, which better reflects the structural advantage (smaller applicant pools, existing relationships) that applies regardless of mission fit.

---

## Out of Scope (Future)

- Foundation grant discovery (Colorado Health Foundation, Chinook Fund, Denver Foundation, etc.) — similar approach but different source landscape. Phase 3c.
- Multi-state monitoring for partner orgs outside Colorado
- Automated application pre-fill from discovered opportunities
- Grant calendar integration (surfacing known deadlines from monitored sources into OMP calendar view)
- CWCB Water Funding Explorer integration (interactive tool — would require browser automation, not simple page fetching)

---

## References

- [ADR-002: Grant Discovery Pipeline](./ADR-002-grant-discovery-pipeline.md)
- [ADR-003: Email Notifications](./ADR-003-email-notifications.md)
- [ADR-004: Board Meeting Minutes Generator](./ADR-004-board-minutes.md)
- [OMP PRD v2.0](./OMP_PRD_v2) — Phase 3b scope
- GOCO Grant Programs: https://goco.org/programs-projects/our-grant-programs
- CWCB Grants: https://cwcb.colorado.gov/funding/grants
- CDPHE Funding Opportunities: https://cdphe.colorado.gov/funding-opportunities
- CDPHE EJ Grants: https://cdphe.colorado.gov/ej/grants
- DOLA Funding Opportunities: https://cdola.colorado.gov/dola-funding-opportunities
- App: `https://wrightadventures.org/`