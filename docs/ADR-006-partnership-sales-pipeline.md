# ADR-006: Partnership Sales Pipeline — CRM-Style Tracking & AI-Assisted Engagement

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-03-06
**Status:** Draft
**PRD Reference:** OMP PRD v2.0, Phase 3 — Platform Expansion
**Depends on:** ADR-001 (AI Grant Writing), ADR-003 (Email Notifications)

---

## Context

The current partnership model in the OMP treats partnerships as static records — a single
`primary_contact` field, one status field referencing a lightweight pipeline, and no way to
track the progression of conversations, meetings, and negotiations over time.

In practice, Wright Adventures' consulting and partnership engagements behave more like a
**B2B sales pipeline**: multiple stakeholders at the client org, a series of qualification
calls and scoping sessions before any proposal, and a distinct post-close onboarding phase.
The GSEMA Technology Platform Strategy RFP is a clear example — the opportunity has an RFP
contact, a finalist interview window, a selection date, a kickoff date, and multiple potential
follow-on phases. None of that lifecycle is capturable in the current data model.

Three gaps drive this ADR:

1. **Single contact per opportunity** — Real engagements involve the IT lead, a finance
   approver, a program sponsor, and an executive sponsor. There is no way to track all four.
2. **No interaction history** — Calls, discovery meetings, proposal presentations, follow-up
   emails, and LinkedIn messages all happen in sequence. Today they exist only in email threads.
3. **No AI assistance for the partnership side** — The AI Draft Assistant (ADR-001) is
   grant-only. There is no tooling to help with technology scoping, solution recommendation, or
   initial outreach synthesis for consulting/partnership opportunities.

Additionally, the current pipeline statuses for partnerships (`Prospecting`, `Outreach`,
`Negotiating`, `Formalizing`, `Active`) do not map to how the team actually works through
these engagements. A sales-stage model gives cleaner reporting and clearer "what happens next"
guidance at each stage.

---

## Decision

Extend the partnership model to function as a lightweight **CRM-style sales pipeline** within
the existing OMP — without introducing a separate CRM system.

Specific changes:

1. **Replace partnership pipeline statuses** with a seven-stage sales pipeline
2. **Add a `partnership_contacts` table** — multiple named contacts per opportunity with role,
   email, phone, and LinkedIn
3. **Add a `partnership_interactions` table** — interaction log for calls, meetings, emails,
   demos, and proposals with type, direction, notes, and timestamp
4. **Add BANT and close-tracking columns** to `opportunities` for partnerships
5. **Add a URL scrape + AI extraction endpoint** — given a `source_url`, extract key details
   and pre-populate the opportunity form using Claude Haiku
6. **Add an AI Solution Advisor endpoint** — given the opportunity description and discovery
   notes, use Claude Sonnet to generate recommended technology solutions, talking points, and
   a proposed engagement approach
7. **Update `OpportunityDetail.tsx`** — add Contacts, Interactions, and AI Advisor tabs for
   partnership-type opportunities

This does **not** introduce a separate CRM or replace the Opportunity record as the central
entity. All CRM-like data lives in the existing Supabase project under the same auth boundary.

---

## New Pipeline Stages

Replace all `partnership_*` rows in `pipeline_statuses`. Old stage IDs are renamed; any
existing rows referencing old IDs will be migrated in the same migration.

| New ID | Stage | Description |
|---|---|---|
| `partnership_prospecting` | Prospecting | Identified via LinkedIn, referral, discovery run, or networking. No contact made yet. |
| `partnership_qualifying` | Qualifying | Initial outreach made. Assessing BANT: Budget, Authority, Need, Timing. |
| `partnership_discovery` | Discovery / Scoping | Active discovery — scoping meetings, stakeholder interviews, problem definition. |
| `partnership_proposal` | Proposal | Proposal drafted or delivered. Awaiting response. May involve multiple stakeholders. |
| `partnership_negotiating` | Negotiating | Terms, scope, pricing in negotiation. Contract or MOU in draft. |
| `partnership_closed_won` | Closed-Won | Contract signed. Transitioning to delivery / onboarding. |
| `partnership_closed_lost` | Closed-Lost | Lost — reason documented for pipeline learning. |

`is_active = false` on `partnership_closed_won` and `partnership_closed_lost` so they appear
in history views but are excluded from active pipeline counts.

---

## Schema Changes

### Migration: `supabase/migrations/20260306000000_partnership_pipeline.sql`

#### 1. Replace pipeline statuses

```sql
-- Remove old stages (migrate any existing opportunities first)
UPDATE opportunities
  SET status = 'partnership_prospecting'
  WHERE type_id = 'partnership'
    AND status IN ('partnership_outreach', 'partnership_formalizing');

UPDATE opportunities
  SET status = 'partnership_negotiating'
  WHERE type_id = 'partnership'
    AND status = 'partnership_negotiating'; -- keep as-is

UPDATE opportunities
  SET status = 'partnership_closed_won'
  WHERE type_id = 'partnership'
    AND status IN ('partnership_active', 'partnership_completed');

UPDATE opportunities
  SET status = 'partnership_closed_lost'
  WHERE type_id = 'partnership'
    AND status IN ('partnership_declined', 'partnership_archived', 'partnership_on_hold');

DELETE FROM pipeline_statuses WHERE type_id = 'partnership';

INSERT INTO pipeline_statuses (id, type_id, label, sort_order, is_active) VALUES
  ('partnership_prospecting',  'partnership', 'Prospecting',    1, true),
  ('partnership_qualifying',   'partnership', 'Qualifying',     2, true),
  ('partnership_discovery',    'partnership', 'Discovery',      3, true),
  ('partnership_proposal',     'partnership', 'Proposal',       4, true),
  ('partnership_negotiating',  'partnership', 'Negotiating',    5, true),
  ('partnership_closed_won',   'partnership', 'Closed-Won',     6, false),
  ('partnership_closed_lost',  'partnership', 'Closed-Lost',    7, false);
```

#### 2. New columns on `opportunities` (partnership only — nullable, ignored for grants)

```sql
ALTER TABLE opportunities
  -- BANT qualification flags
  ADD COLUMN bant_budget_confirmed   boolean,
  ADD COLUMN bant_authority_confirmed boolean,
  ADD COLUMN bant_need_confirmed     boolean,
  ADD COLUMN bant_timing_confirmed   boolean,

  -- Sales pipeline fields
  ADD COLUMN pain_points             text,
  ADD COLUMN next_action             text,
  ADD COLUMN next_action_date        timestamptz,
  ADD COLUMN close_probability       smallint CHECK (close_probability BETWEEN 0 AND 100),
  ADD COLUMN expected_close_date     timestamptz,
  ADD COLUMN lost_reason             text,

  -- Tech engagement fields
  ADD COLUMN company_size            text,       -- e.g. '10-50 staff', '50-200 staff'
  ADD COLUMN tech_stack_notes        text,       -- current systems observed / reported
  ADD COLUMN ai_solution_summary     text,       -- cached AI recommendation output
  ADD COLUMN ai_solution_updated_at  timestamptz;
```

#### 3. `partnership_contacts` table

```sql
CREATE TABLE partnership_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  full_name       text NOT NULL,
  title           text,
  email           text,
  phone           text,
  linkedin_url    text,
  is_primary      boolean NOT NULL DEFAULT false,
  notes           text,       -- e.g. "decision-maker", "gatekeeper", "champion"
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE partnership_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read contacts"
  ON partnership_contacts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Managers and admins can insert contacts"
  ON partnership_contacts FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin','manager','member'));

CREATE POLICY "Managers and admins can update contacts"
  ON partnership_contacts FOR UPDATE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin','manager'));

CREATE POLICY "Admins can delete contacts"
  ON partnership_contacts FOR DELETE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin','manager'));
```

#### 4. `partnership_interactions` table

```sql
CREATE TYPE interaction_type AS ENUM (
  'call', 'meeting', 'email', 'message', 'demo',
  'proposal_sent', 'contract_sent', 'note', 'other'
);

CREATE TYPE interaction_direction AS ENUM ('inbound', 'outbound', 'internal');

CREATE TABLE partnership_interactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES partnership_contacts(id) ON DELETE SET NULL,
  interaction_type interaction_type NOT NULL,
  direction        interaction_direction NOT NULL DEFAULT 'outbound',
  subject         text,
  notes           text NOT NULL DEFAULT '',
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  logged_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE partnership_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated access on interactions"
  ON partnership_interactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

---

## New API Endpoints

### `/api/partnerships/scrape.ts` — URL Scrape + AI Extraction

**Method:** POST
**Auth:** Bearer JWT (any authenticated user)
**Body:** `{ url: string, opportunity_id?: string }`

**Flow:**
1. Validate JWT
2. Fetch the URL (server-side, avoids CORS) — strip to plain text via a simple HTML → text
   conversion (same approach as ADR-005 `extractPageText`)
3. Send to Claude Haiku with a structured extraction prompt
4. Return extracted fields as JSON — caller decides which to apply to the form

**Haiku Extraction Prompt Target Fields:**
```
organization_name, primary_contact_name, primary_contact_title, contact_email,
project_description, estimated_budget, timeline_notes, technology_systems_mentioned,
key_pain_points, partnership_type_hint, tags[]
```

**Response shape:**
```typescript
{
  extracted: {
    organization_name?: string
    primary_contact_name?: string
    primary_contact_title?: string
    contact_email?: string
    project_description?: string
    estimated_budget?: number
    timeline_notes?: string
    technology_systems_mentioned?: string
    key_pain_points?: string
    partnership_type_hint?: string
    tags?: string[]
  }
  confidence: 'high' | 'medium' | 'low'
  raw_excerpt: string   // first 500 chars of extracted text, for user verification
}
```

The frontend shows extracted fields in a review panel — the user confirms or discards each
field before it is applied to the opportunity form. Nothing is auto-saved.

---

### `/api/partnerships/recommend.ts` — AI Solution Advisor

**Method:** POST
**Auth:** Bearer JWT (admin | manager)
**Body:** `{ opportunity_id: string }`

**Flow:**
1. Validate JWT + role (admin or manager only)
2. Load full opportunity record + all contacts + last 10 interactions
3. Build a briefing for Claude Sonnet including:
   - org context, pain points, tech stack notes, mutual commitments, description
   - WA capabilities summary (injected from a static prompt template)
4. Call Sonnet (non-streaming — structured output) with a prompt requesting:
   - 2–3 recommended technology platforms or solution approaches
   - Specific talking points for the current pipeline stage
   - Suggested next action and timeline
   - Red flags or risks to validate in discovery
5. Persist response to `opportunities.ai_solution_summary` + `ai_solution_updated_at`
6. Return structured JSON

**Response shape:**
```typescript
{
  recommendations: Array<{
    platform_or_approach: string
    rationale: string
    fit_score: 'strong' | 'good' | 'possible'
    caveats: string[]
  }>
  talking_points: string[]
  suggested_next_action: string
  suggested_next_action_date: string | null   // ISO8601, relative to today
  risks: string[]
  generated_at: string
}
```

**Model:** `claude-sonnet-4-6`
**Token budget:** Charged to the existing `token_budgets` table (same org-wide budget as
grant writing). The prompt will be classified under a `partnership_advisor` label in a
future usage breakdown — for now it shares the same monthly pool.

---

## WA Capabilities Prompt Template

Stored in `src/lib/partnerships/advisorPrompt.ts` — injected as the system context for every
Sonnet call. Summarizes Wright Adventures' consulting practice areas:

- Technology strategy assessments and roadmaps
- Nonprofit systems integration (CRM, finance, membership, fundraising)
- Data architecture and unified platform design
- Workflow automation and process improvement
- AI-assisted tool implementation
- Methodology: Discovery → Needs Analysis → Unified Data Model → Phased Implementation Roadmap

This template should be kept up to date as WA's service offerings evolve.

---

## Frontend Changes

### Updated `OpportunityDetail.tsx` (partnership only)

Add three new tabs, visible only when `opportunity.type_id === 'partnership'`:

| Tab | Component | Content |
|---|---|---|
| Contacts | `ContactsPanel` | List + add/edit contacts; mark primary |
| Interactions | `InteractionsLog` | Chronological log; quick-add form for call/meeting/email/note |
| AI Advisor | `PartnershipAdvisorPanel` | Solution recommendations, talking points, next action |

Existing tabs (Overview, Tasks & Activity, Documents) remain unchanged.

### `ContactsPanel.tsx`

- Card list of contacts with name, title, email, phone, LinkedIn icon link
- "Add Contact" inline form (react-hook-form + zod)
- "Set as Primary" button — updates `is_primary`, clears other contacts' flag
- Edit / delete per contact (admin/manager only)

### `InteractionsLog.tsx`

- Chronological timeline (most recent first) with icon per type (phone, video, envelope, etc.)
- Each entry: type badge, direction badge, contact name (linked), subject, date, logged-by avatar, notes
- Quick-add form: type selector, direction, contact selector (from this opportunity's contacts),
  subject, date/time picker, notes textarea
- Log is append-only from the UI (no editing, to preserve interaction history integrity)

### `PartnershipAdvisorPanel.tsx`

- "Generate Recommendations" button — calls `/api/partnerships/recommend`
- Loading state with spinner (Sonnet call may take 5–10 seconds)
- Renders `recommendations` as cards with fit score badge
- Renders `talking_points` as a bulleted list
- Suggested next action displayed with a "Copy to Next Action" button that pre-fills
  `opportunity.next_action` and `next_action_date`
- Timestamp of last generation + "Regenerate" button
- Visible to admin and manager only; members see a read-only view of the cached summary

### BANT Tracker (in Overview tab)

Add a compact BANT status block to the partnership Overview tab:
- Four checkboxes: Budget Confirmed / Authority Confirmed / Need Confirmed / Timing Confirmed
- Updates `bant_*` columns via Supabase direct update (same pattern as other field edits)
- Only visible for `partnership_qualifying` and later stages

### Pipeline Stage Sidebar Widget

In the right sidebar of the Overview tab, add a stage progress indicator:
- Shows all seven stages in order
- Current stage highlighted
- Completed stages shown with checkmark
- Clicking a stage advances/retreats the opportunity (manager/admin only)
- `close_probability` percentage shown as an editable field once past Qualifying
- `expected_close_date` field shown from Proposal stage onwards

---

## Scrape Flow — User Experience

On the "New Partnership" form (and on the Overview edit panel), add:

```
[ Source URL field                              ] [ Scrape & Fill ▼ ]
```

On click:
1. Button shows spinner — "Fetching…"
2. Results appear in a collapsible review panel below the URL field:
   - Each extracted field shown as a key-value pair with a checkbox
   - User selects which fields to apply
3. "Apply Selected" button maps extracted fields into the form
4. Source URL is preserved for linking to the original RFP / org page

No auto-save. The user reviews, confirms, and saves the form as usual.

---

## Updated Task Template

Replace the default partnership task template with stage-aligned tasks keyed to the new
pipeline. New template ID: `00000000-0000-0000-0000-000000000003` (keep old template for
backward compatibility with existing partnerships).

New default tasks (days_offset relative to `primary_deadline`):
- Research organization and map stakeholders (-60)
- Connect on LinkedIn / send initial outreach email (-55)
- Follow up if no response in 5 days (-50)
- Qualification call — validate BANT (-45)
- Log BANT findings and update opportunity (-44)
- Schedule discovery / scoping session (-35)
- Discovery session — document pain points and tech stack (-35)
- Internal debrief and solution design (-28)
- Draft proposal with tailored recommendations (-21)
- Internal review of proposal (manager) (-14)
- Deliver proposal to client (-10)
- Follow up post-proposal (-7)
- Negotiation / scope refinement call (-3)
- Execute agreement / contract (0)
- Send kickoff welcome email (+1)
- Kickoff meeting (+7)
- First check-in / status call (+30)

---

## Implementation Sequence

1. **Migration** — new pipeline statuses, BANT/close columns on `opportunities`,
   `partnership_contacts`, `partnership_interactions` tables; update default task template
2. **TypeScript types** — `PartnershipContact`, `PartnershipInteraction`,
   `PartnershipAdvisorResult`; update `Opportunity` interface with new columns
3. **API: `/api/partnerships/scrape.ts`** — URL fetch + Haiku extraction
4. **API: `/api/partnerships/recommend.ts`** — Sonnet solution advisor
5. **`src/lib/partnerships/advisorPrompt.ts`** — WA capabilities prompt template
6. **`ContactsPanel.tsx`** — contact list + add/edit form
7. **`InteractionsLog.tsx`** — interaction timeline + quick-add
8. **`PartnershipAdvisorPanel.tsx`** — recommendations UI
9. **Update `OpportunityDetail.tsx`** — add three new tabs (contacts, interactions, advisor)
10. **Update `OpportunityForm.tsx` (or `PartnershipForm.tsx`)** — add Scrape & Fill flow,
    BANT fields, company size, tech stack notes, next action fields
11. **Update `AdminLayout.tsx` sidebar** — optionally split "Opportunities" into separate
    "Grants" and "Partnerships" nav items for cleaner access (evaluate after Step 10)
12. **Seed updated default task template** in same migration as Step 1

---

## Out of Scope

- Email sending directly from the interaction log (use external email client; log the
  interaction manually)
- LinkedIn API integration (link to profile URL; no automated outreach)
- Deal forecasting / revenue projections dashboard (Phase 4)
- Automated reminders for `next_action_date` (uses existing deadline notification cron from
  ADR-003 if a task is created; standalone next-action reminders are Phase 4)
- Separate CRM product / multi-tenant support
- Full-text search across interaction notes

---

## Environment Variables

No new environment variables required. The AI endpoints use the existing:
```
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## Model Selection

| Use Case | Model | Rationale |
|---|---|---|
| URL scrape extraction | `claude-haiku-4-5-20251001` | Fast, cheap — structured field extraction from short web text |
| Solution recommendations | `claude-sonnet-4-6` | Requires reasoning about tech fit and WA capabilities |

---

## References

- ADR-001: AI-Assisted Grant Writing (streaming chat pattern)
- ADR-003: Email Notifications (BANT reminder integration point)
- ADR-005: State & Local Discovery (`extractPageText` utility reused in scrape endpoint)
- GSEMA Technology Platform Strategy RFP — primary design reference for the consulting pipeline use case
