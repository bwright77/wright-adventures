# ADR-006: Partnership Sales Pipeline — CRM-Style Tracking & URL Scrape Extraction

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-03-06
**Status:** Draft
**PRD Reference:** OMP PRD v2.0, Phase 3 — Platform Expansion
**Depends on:** ADR-001 (AI Grant Writing), ADR-003 (Email Notifications)
**Supersedes:** Original ADR-006 draft (same date, pre-review revision)

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
   grant-only. There is no tooling to help with initial outreach synthesis or form pre-fill
   for consulting/partnership opportunities.

Additionally, the current pipeline statuses for partnerships (`Prospecting`, `Outreach`,
`Negotiating`, `Formalizing`, `Active`) do not map to how the team actually works through
these engagements. A sales-stage model gives cleaner reporting and clearer "what happens next"
guidance at each stage.

A fourth structural issue drives a schema change: the `opportunities` table is accumulating
type-specific columns (grant fields, discovery fields, and now partnership CRM fields). Adding
14+ nullable partnership-only columns to the same wide table degrades schema clarity and makes
future opportunity types (events, sponsorships) inherit irrelevant column sprawl. This ADR
introduces a `partnership_details` extension table to keep the base `opportunities` table
type-agnostic.

---

## Decision

Extend the partnership model to function as a lightweight **CRM-style sales pipeline** within
the existing OMP — without introducing a separate CRM system.

This ADR is scoped to **Phase 1: CRM Foundation**. AI-assisted solution recommendations
(the "Solution Advisor" endpoint) are deferred to **ADR-007** to ship the CRM foundation
faster and validate the pipeline model before layering AI recommendations on top.

### Phase 1 (This ADR) — CRM Foundation

1. **Replace partnership pipeline statuses** with a seven-stage sales pipeline
2. **Add a `partnership_details` extension table** — 1:1 FK to `opportunities` for all
   partnership-specific CRM fields (qualification, confidence, pain points, tech engagement)
3. **Add a `partnership_contacts` table** — multiple named contacts per opportunity with role,
   email, phone, and LinkedIn
4. **Add a `partnership_interactions` table** — append-only interaction log for calls,
   meetings, emails, demos, and proposals with type, direction, notes, and timestamp.
   RLS enforces append-only integrity (no UPDATE/DELETE except admin).
5. **Add a URL scrape + AI extraction endpoint** — given a `source_url`, extract key details
   and pre-populate the opportunity form using Claude Haiku
6. **Add stage-triggered task templates** — tasks are created when an opportunity transitions
   to a new pipeline stage, not offset from a deadline that may not exist
7. **Integrate with activity log** — all contact additions, interaction entries, and stage
   changes are logged to the existing `activity_entries` table
8. **Update `OpportunityDetail.tsx`** — add Contacts and Interactions tabs for
   partnership-type opportunities

### Deferred to ADR-007 — AI Solution Advisor

- `/api/partnerships/recommend.ts` — Sonnet-powered solution recommendations
- `src/lib/partnerships/advisorPrompt.ts` — WA capabilities prompt template
- `PartnershipAdvisorPanel.tsx` — recommendations UI with fit scores and talking points
- AI Advisor tab on `OpportunityDetail.tsx`

This split lets the team validate whether the pipeline stages, interaction tracking, and
contact management actually work before investing in the AI recommendation layer.

This does **not** introduce a separate CRM or replace the Opportunity record as the central
entity. All CRM-like data lives in the existing Supabase project under the same auth boundary.

---

## New Pipeline Stages

Replace all `partnership_*` rows in `pipeline_statuses`. Old stage IDs are renamed; any
existing rows referencing old IDs will be migrated in the same migration.

| New ID | Stage | Description |
|---|---|---|
| `partnership_prospecting` | Prospecting | Identified via LinkedIn, referral, discovery run, or networking. No contact made yet. |
| `partnership_qualifying` | Qualifying | Initial outreach made. Assessing fit: budget reality, decision-makers, need clarity, timing. |
| `partnership_discovery` | Discovery / Scoping | Active discovery — scoping meetings, stakeholder interviews, problem definition. |
| `partnership_proposal` | Proposal | Proposal drafted or delivered. Awaiting response. May involve multiple stakeholders. |
| `partnership_negotiating` | Negotiating | Terms, scope, pricing in negotiation. Contract or MOU in draft. |
| `partnership_closed_won` | Closed-Won | Contract signed. Transitioning to delivery / onboarding. |
| `partnership_closed_lost` | Closed-Lost | Lost — reason documented for pipeline learning. |

`is_active = false` on `partnership_closed_won` and `partnership_closed_lost` so they appear
in history views but are excluded from active pipeline counts.

**Note on `partnership_on_hold` → `partnership_closed_lost` mapping:** The original schema
includes `partnership_on_hold`. Mapping this to `closed_lost` is a deliberate data decision:
"on hold" partnerships with no active timeline are operationally dead. If a paused partnership
re-engages, it should be re-created as a new opportunity with a link to the original for
context. The migration includes a guard query to surface any on-hold records for manual review
before the destructive status change.

---

## Schema Changes

### Migration: `supabase/migrations/20260306000000_partnership_pipeline.sql`

The entire migration is wrapped in an explicit transaction with a guard query to prevent
orphaned FK references.

```sql
BEGIN;

-- ============================================================
-- GUARD: Verify all existing partnership statuses are covered
-- by the migration mapping. Raise exception if any are missed.
-- ============================================================
DO $$
DECLARE
  unmapped_count integer;
  unmapped_statuses text;
BEGIN
  SELECT count(*), string_agg(DISTINCT status, ', ')
  INTO unmapped_count, unmapped_statuses
  FROM opportunities
  WHERE type_id = 'partnership'
    AND status NOT IN (
      'partnership_prospecting',
      'partnership_outreach',
      'partnership_formalizing',
      'partnership_negotiating',
      'partnership_active',
      'partnership_completed',
      'partnership_declined',
      'partnership_archived',
      'partnership_on_hold'
    );

  IF unmapped_count > 0 THEN
    RAISE EXCEPTION 'Migration blocked: % opportunities have unmapped statuses: %',
      unmapped_count, unmapped_statuses;
  END IF;
END $$;

-- ============================================================
-- 1. MIGRATE EXISTING PARTNERSHIP STATUSES
-- ============================================================

-- Outreach and Formalizing → Prospecting (earliest active stage;
-- manual re-triage expected after migration)
UPDATE opportunities
  SET status = 'partnership_prospecting'
  WHERE type_id = 'partnership'
    AND status IN ('partnership_outreach', 'partnership_formalizing');

-- Negotiating stays as-is (same ID in new pipeline)
-- No UPDATE needed for partnership_negotiating

-- Active and Completed → Closed-Won
UPDATE opportunities
  SET status = 'partnership_closed_won'
  WHERE type_id = 'partnership'
    AND status IN ('partnership_active', 'partnership_completed');

-- Declined, Archived, On Hold → Closed-Lost
UPDATE opportunities
  SET status = 'partnership_closed_lost'
  WHERE type_id = 'partnership'
    AND status IN ('partnership_declined', 'partnership_archived', 'partnership_on_hold');

-- Prospecting stays as-is (same ID in new pipeline)
-- No UPDATE needed for partnership_prospecting

-- ============================================================
-- 2. REPLACE PIPELINE STATUSES
-- ============================================================

DELETE FROM pipeline_statuses WHERE type_id = 'partnership';

INSERT INTO pipeline_statuses (id, type_id, label, sort_order, is_active) VALUES
  ('partnership_prospecting',  'partnership', 'Prospecting',    1, true),
  ('partnership_qualifying',   'partnership', 'Qualifying',     2, true),
  ('partnership_discovery',    'partnership', 'Discovery',      3, true),
  ('partnership_proposal',     'partnership', 'Proposal',       4, true),
  ('partnership_negotiating',  'partnership', 'Negotiating',    5, true),
  ('partnership_closed_won',   'partnership', 'Closed-Won',     6, false),
  ('partnership_closed_lost',  'partnership', 'Closed-Lost',    7, false);

-- ============================================================
-- 3. ENUMS
-- ============================================================

CREATE TYPE company_size AS ENUM (
  '1-10',       -- Micro
  '11-50',      -- Small
  '51-200',     -- Mid-size
  '201-500',    -- Large
  '501-1000',   -- Enterprise
  '1000+'       -- Large enterprise
);

CREATE TYPE deal_confidence AS ENUM ('low', 'medium', 'high');

CREATE TYPE interaction_type AS ENUM (
  'call', 'meeting', 'email', 'message', 'demo',
  'proposal_sent', 'contract_sent', 'note', 'other'
);

CREATE TYPE interaction_direction AS ENUM ('inbound', 'outbound', 'internal');

-- ============================================================
-- 4. PARTNERSHIP_DETAILS EXTENSION TABLE (1:1 with opportunities)
-- ============================================================

CREATE TABLE partnership_details (
  opportunity_id       uuid PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,

  -- Qualification (freeform — nonprofits don't fit rigid BANT booleans)
  qualification_status text CHECK (qualification_status IN (
    'unqualified', 'partially_qualified', 'qualified'
  )) DEFAULT 'unqualified',
  qualification_notes  text,            -- freeform: budget signals, decision structure,
                                        -- need clarity, timing constraints

  -- Pipeline tracking
  pain_points          text,
  next_action          text,
  next_action_date     timestamptz,
  confidence           deal_confidence,
  expected_close_date  timestamptz,
  lost_reason          text,

  -- Tech engagement fields
  org_size             company_size,
  tech_stack_notes     text,            -- current systems observed / reported
  ai_solution_summary  text,            -- cached AI recommendation output (ADR-007)
  ai_solution_updated_at timestamptz,   -- last AI recommendation timestamp (ADR-007)

  -- Metadata
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Auto-create partnership_details row when a partnership opportunity is inserted
CREATE OR REPLACE FUNCTION create_partnership_details()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.type_id = 'partnership' THEN
    INSERT INTO public.partnership_details (opportunity_id)
    VALUES (NEW.id)
    ON CONFLICT (opportunity_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_partnership_details
  AFTER INSERT ON opportunities
  FOR EACH ROW EXECUTE FUNCTION create_partnership_details();

-- Backfill for any existing partnership opportunities
INSERT INTO partnership_details (opportunity_id)
SELECT id FROM opportunities WHERE type_id = 'partnership'
ON CONFLICT (opportunity_id) DO NOTHING;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_partnership_details_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_partnership_details_updated_at
  BEFORE UPDATE ON partnership_details
  FOR EACH ROW EXECUTE FUNCTION update_partnership_details_timestamp();

ALTER TABLE partnership_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read partnership_details"
  ON partnership_details FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin and manager can modify partnership_details"
  ON partnership_details FOR ALL TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'));

-- ============================================================
-- 5. PARTNERSHIP_CONTACTS TABLE
-- ============================================================

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

-- updated_at trigger
CREATE TRIGGER trg_partnership_contacts_updated_at
  BEFORE UPDATE ON partnership_contacts
  FOR EACH ROW EXECUTE FUNCTION update_partnership_details_timestamp();

ALTER TABLE partnership_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read contacts"
  ON partnership_contacts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Members+ can insert contacts"
  ON partnership_contacts FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin','manager','member'));

CREATE POLICY "Managers+ can update contacts"
  ON partnership_contacts FOR UPDATE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin','manager'));

CREATE POLICY "Managers+ can delete contacts"
  ON partnership_contacts FOR DELETE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin','manager'));

-- ============================================================
-- 6. PARTNERSHIP_INTERACTIONS TABLE (append-only enforced by RLS)
-- ============================================================

CREATE TABLE partnership_interactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id   uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  contact_id       uuid REFERENCES partnership_contacts(id) ON DELETE SET NULL,
  interaction_type interaction_type NOT NULL,
  direction        interaction_direction NOT NULL DEFAULT 'outbound',
  subject          text,
  notes            text NOT NULL DEFAULT '',
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  logged_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- updated_at trigger
CREATE TRIGGER trg_partnership_interactions_updated_at
  BEFORE UPDATE ON partnership_interactions
  FOR EACH ROW EXECUTE FUNCTION update_partnership_details_timestamp();

ALTER TABLE partnership_interactions ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user
CREATE POLICY "Authenticated users can read interactions"
  ON partnership_interactions FOR SELECT TO authenticated USING (true);

-- INSERT: members, managers, admins
CREATE POLICY "Members+ can insert interactions"
  ON partnership_interactions FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin','manager','member'));

-- UPDATE: admin only (interaction log is append-only from the UI;
-- admin override for corrections only)
CREATE POLICY "Admin can update interactions"
  ON partnership_interactions FOR UPDATE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- DELETE: admin only
CREATE POLICY "Admin can delete interactions"
  ON partnership_interactions FOR DELETE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- ============================================================
-- 7. STAGE-TRIGGERED TASK TEMPLATES
-- ============================================================

-- New template structure: tasks are keyed to a pipeline stage, not a deadline offset.
-- When an opportunity transitions to a stage, the system creates tasks for that stage
-- that don't already exist.

CREATE TABLE partnership_stage_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id        text NOT NULL REFERENCES pipeline_statuses(id) ON DELETE CASCADE,
  title           text NOT NULL,
  assignee_role   text DEFAULT 'owner'
                    CHECK (assignee_role IN ('owner','contributor','leadership')),
  days_after_entry int NOT NULL DEFAULT 0,  -- days after entering this stage
  sort_order      int DEFAULT 0 NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO partnership_stage_tasks (stage_id, title, assignee_role, days_after_entry, sort_order) VALUES
  -- Prospecting
  ('partnership_prospecting', 'Research organization and map stakeholders',           'owner', 0, 1),
  ('partnership_prospecting', 'Connect on LinkedIn / send initial outreach email',    'owner', 1, 2),
  ('partnership_prospecting', 'Follow up if no response in 5 business days',          'owner', 7, 3),

  -- Qualifying
  ('partnership_qualifying',  'Qualification call — assess budget, authority, need, timing', 'owner', 0, 1),
  ('partnership_qualifying',  'Log qualification findings and update opportunity',     'owner', 1, 2),

  -- Discovery
  ('partnership_discovery',   'Schedule discovery / scoping session',                  'owner', 0, 1),
  ('partnership_discovery',   'Discovery session — document pain points and tech stack','owner', 3, 2),
  ('partnership_discovery',   'Internal debrief and solution design',                  'owner', 5, 3),

  -- Proposal
  ('partnership_proposal',    'Draft proposal with tailored recommendations',          'owner', 0, 1),
  ('partnership_proposal',    'Internal review of proposal',                          'leadership', 5, 2),
  ('partnership_proposal',    'Deliver proposal to client',                           'owner', 7, 3),
  ('partnership_proposal',    'Follow up post-proposal',                              'owner', 14, 4),

  -- Negotiating
  ('partnership_negotiating', 'Negotiation / scope refinement call',                  'owner', 0, 1),
  ('partnership_negotiating', 'Finalize contract or MOU',                             'owner', 5, 2),
  ('partnership_negotiating', 'Final legal / leadership review',                      'leadership', 7, 3),

  -- Closed-Won
  ('partnership_closed_won',  'Execute agreement / contract',                         'owner', 0, 1),
  ('partnership_closed_won',  'Send kickoff welcome email',                           'owner', 1, 2),
  ('partnership_closed_won',  'Kickoff meeting',                                      'owner', 7, 3),
  ('partnership_closed_won',  'First check-in / status call',                         'owner', 30, 4),

  -- Closed-Lost
  ('partnership_closed_lost', 'Document loss reason and debrief notes',               'owner', 0, 1);

-- ============================================================
-- 8. ACTIVITY LOG INTEGRATION
-- ============================================================

-- partnership_contacts: log additions and primary-contact changes
CREATE OR REPLACE FUNCTION log_contact_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_entries (opportunity_id, actor_id, action, details)
    VALUES (
      NEW.opportunity_id,
      auth.uid(),
      'contact_added',
      jsonb_build_object('contact_name', NEW.full_name, 'contact_title', NEW.title)
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.is_primary IS DISTINCT FROM NEW.is_primary AND NEW.is_primary = true THEN
    INSERT INTO public.activity_entries (opportunity_id, actor_id, action, details)
    VALUES (
      NEW.opportunity_id,
      auth.uid(),
      'primary_contact_changed',
      jsonb_build_object('contact_name', NEW.full_name)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_contact_activity
  AFTER INSERT OR UPDATE ON partnership_contacts
  FOR EACH ROW EXECUTE FUNCTION log_contact_activity();

-- partnership_interactions: log every new interaction
CREATE OR REPLACE FUNCTION log_interaction_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.activity_entries (opportunity_id, actor_id, action, details)
  VALUES (
    NEW.opportunity_id,
    NEW.logged_by,
    'interaction_logged',
    jsonb_build_object(
      'interaction_type', NEW.interaction_type::text,
      'direction', NEW.direction::text,
      'subject', NEW.subject,
      'contact_id', NEW.contact_id
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_interaction_activity
  AFTER INSERT ON partnership_interactions
  FOR EACH ROW EXECUTE FUNCTION log_interaction_activity();

-- Stage transitions: log when partnership status changes
-- (This assumes an existing updated_at trigger on opportunities fires on UPDATE.
-- If no activity logging trigger exists for status changes on opportunities, add one.)
CREATE OR REPLACE FUNCTION log_partnership_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.type_id = 'partnership'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.activity_entries (opportunity_id, actor_id, action, details)
    VALUES (
      NEW.id,
      auth.uid(),
      'stage_changed',
      jsonb_build_object(
        'from_stage', OLD.status,
        'to_stage', NEW.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_partnership_stage_change
  AFTER UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION log_partnership_stage_change();

COMMIT;
```

---

## New API Endpoint

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

## Stage-Triggered Task Generation

### How It Works

When an opportunity's `status` changes (detected by the `trg_log_partnership_stage_change`
trigger or by the frontend after a successful status update), the frontend calls a task
generation function that:

1. Looks up all `partnership_stage_tasks` rows for the new `stage_id`
2. Checks which tasks already exist for this opportunity (by title match) to avoid duplicates
3. Creates new `tasks` rows with `due_date` calculated as
   `now() + days_after_entry * interval '1 day'`
4. Assigns tasks based on `assignee_role` (same logic as existing grant task template)

**Why stage-triggered instead of deadline-offset:** Many partnership opportunities have no
hard deadline (`primary_deadline` is null). Offset-based templates produce tasks with null
due dates, which are useless. Stage transitions are the natural cadence of partnership work —
when you move to Discovery, you need discovery tasks. When you close, you need onboarding
tasks. The tasks materialize when they're relevant.

**Implementation options:**
- **Option A (recommended):** Supabase Edge Function triggered by a database webhook on
  `opportunities` UPDATE where `status` changes. Same pattern as ADR-003 task-assigned
  notifications.
- **Option B:** Client-side — after successfully updating status, the frontend calls a
  Vercel serverless function that reads the template and inserts tasks. Simpler but less
  reliable (user could close browser mid-flow).

The old partnership task template (`00000000-0000-0000-0000-000000000002`) remains in the
database for backward compatibility with existing partnerships. New partnerships use the
stage-triggered system exclusively.

---

## Frontend Changes

### Updated `OpportunityDetail.tsx` (partnership only)

Add two new tabs, visible only when `opportunity.type_id === 'partnership'`:

| Tab | Component | Content |
|---|---|---|
| Contacts | `ContactsPanel` | List + add/edit contacts; mark primary |
| Interactions | `InteractionsLog` | Chronological log; quick-add form for call/meeting/email/note |

Existing tabs (Overview, Tasks & Activity, Documents) remain unchanged.

### `ContactsPanel.tsx`

- Card list of contacts with name, title, email, phone, LinkedIn icon link
- "Add Contact" inline form (react-hook-form + zod)
- "Set as Primary" button — updates `is_primary`, clears other contacts' flag
- Edit / delete per contact (manager/admin only)
- Contact additions and primary-contact changes appear in the Activity feed
  via the `log_contact_activity` trigger

### `InteractionsLog.tsx`

- Chronological timeline (most recent first) with icon per type (phone, video, envelope, etc.)
- Each entry: type badge, direction badge, contact name (linked), subject, date, logged-by
  avatar, notes
- Quick-add form: type selector, direction, contact selector (from this opportunity's
  contacts), subject, date/time picker, notes textarea
- Log is append-only from the UI (no editing — enforced by RLS). Admin can edit/delete via
  Supabase dashboard for corrections.
- New interactions appear in the Activity feed via the `log_interaction_activity` trigger

### Qualification Tracker (in Overview tab)

Add a compact qualification block to the partnership Overview tab:
- `qualification_status` dropdown: Unqualified / Partially Qualified / Qualified
- `qualification_notes` textarea — freeform field for budget signals, decision structure,
  need clarity, timing constraints, and any other qualification context
- Visible for `partnership_qualifying` and later stages
- Reads from / writes to `partnership_details`

### Pipeline Stage Sidebar Widget

In the right sidebar of the Overview tab, add a stage progress indicator:
- Shows all seven stages in order
- Current stage highlighted
- Completed stages shown with checkmark
- Clicking a stage advances/retreats the opportunity (manager/admin only)
- **Stage transitions trigger task generation** (see Stage-Triggered Task Generation above)
- `confidence` enum shown as a dropdown (`Low` / `Medium` / `High`) from Qualifying onwards
- `expected_close_date` field shown from Proposal stage onwards

### Scrape Flow — User Experience

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

## TypeScript Types

```typescript
// -- Enums --

export type CompanySize = '1-10' | '11-50' | '51-200' | '201-500' | '501-1000' | '1000+';
export type DealConfidence = 'low' | 'medium' | 'high';
export type QualificationStatus = 'unqualified' | 'partially_qualified' | 'qualified';
export type InteractionType =
  | 'call' | 'meeting' | 'email' | 'message' | 'demo'
  | 'proposal_sent' | 'contract_sent' | 'note' | 'other';
export type InteractionDirection = 'inbound' | 'outbound' | 'internal';

// -- Extension table --

export interface PartnershipDetails {
  opportunity_id: string
  qualification_status: QualificationStatus
  qualification_notes: string | null
  pain_points: string | null
  next_action: string | null
  next_action_date: string | null
  confidence: DealConfidence | null
  expected_close_date: string | null
  lost_reason: string | null
  org_size: CompanySize | null
  tech_stack_notes: string | null
  ai_solution_summary: string | null        // populated by ADR-007
  ai_solution_updated_at: string | null     // populated by ADR-007
  created_at: string
  updated_at: string
}

// -- CRM tables --

export interface PartnershipContact {
  id: string
  opportunity_id: string
  full_name: string
  title: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  is_primary: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PartnershipInteraction {
  id: string
  opportunity_id: string
  contact_id: string | null
  interaction_type: InteractionType
  direction: InteractionDirection
  subject: string | null
  notes: string
  occurred_at: string
  logged_by: string | null
  created_at: string
  updated_at: string
  // Joined (optional)
  contact?: Pick<PartnershipContact, 'id' | 'full_name'>
  logger?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
}

// -- Stage tasks --

export interface PartnershipStageTask {
  id: string
  stage_id: string
  title: string
  assignee_role: 'owner' | 'contributor' | 'leadership'
  days_after_entry: number
  sort_order: number
  created_at: string
}

// -- Scrape endpoint --

export interface ScrapeResult {
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
  raw_excerpt: string
}
```

---

## Implementation Sequence

### Phase 1A: Schema & Core UI

1. **Migration** — new pipeline statuses (with guard query), `partnership_details` extension
   table, `partnership_contacts`, `partnership_interactions`, `partnership_stage_tasks`,
   activity log triggers, all wrapped in explicit transaction
2. **TypeScript types** — `PartnershipDetails`, `PartnershipContact`,
   `PartnershipInteraction`, `PartnershipStageTask`, `ScrapeResult`; update `Opportunity`
   interface to include optional `details?: PartnershipDetails` join
3. **`ContactsPanel.tsx`** — contact list + add/edit form
4. **`InteractionsLog.tsx`** — interaction timeline + quick-add
5. **Update `OpportunityDetail.tsx`** — add Contacts and Interactions tabs for partnership-type
   opportunities
6. **Update Overview tab** — add qualification tracker block, pipeline stage sidebar widget
   with confidence dropdown
7. **Stage-triggered task generation** — Edge Function or serverless function wired to
   status change events

### Phase 1B: AI Scrape & Form Enhancement

8. **API: `/api/partnerships/scrape.ts`** — URL fetch + Haiku extraction
9. **Update `OpportunityForm.tsx` (or `PartnershipForm.tsx`)** — add Scrape & Fill flow,
   qualification fields, org size dropdown, tech stack notes, next action fields
10. **Update `AdminLayout.tsx` sidebar** — optionally split "Opportunities" into separate
    "Grants" and "Partnerships" nav items for cleaner access (evaluate after Step 9)

### Phase 2 (ADR-007): AI Solution Advisor

11. API: `/api/partnerships/recommend.ts`
12. `src/lib/partnerships/advisorPrompt.ts`
13. `PartnershipAdvisorPanel.tsx`
14. AI Advisor tab on `OpportunityDetail.tsx`

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
- AI Solution Advisor (deferred to ADR-007)

---

## Environment Variables

No new environment variables required. The AI scrape endpoint uses the existing:
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

The Solution Advisor model selection (`claude-sonnet-4-6` for reasoning about tech fit) is
documented in ADR-007.

---

## Key Design Decisions Log

| # | Decision | Rationale |
|---|---|---|
| 1 | `partnership_details` extension table instead of columns on `opportunities` | Keeps base table type-agnostic; prevents column sprawl; marginal join cost |
| 2 | Freeform `qualification_notes` + status enum instead of BANT booleans | Nonprofit budget/authority patterns don't fit rigid boolean qualification; gradients > binaries |
| 3 | `confidence` enum (`low`/`medium`/`high`) instead of `close_probability` percentage | No weighted pipeline forecast in scope; percentage precision is false at this pipeline scale |
| 4 | `company_size` as enum instead of freeform text | Prevents inconsistent entries; enables future filtering and reporting |
| 5 | RLS enforces append-only on `partnership_interactions` | UI constraint alone is not a security boundary; interaction history integrity requires DB enforcement |
| 6 | Stage-triggered tasks instead of deadline-offset tasks | Many partnerships lack a hard deadline; tasks should materialize when the stage demands them |
| 7 | Activity log integration via triggers | Unified history across contacts, interactions, and stage changes in the existing Activity feed |
| 8 | AI Solution Advisor deferred to ADR-007 | Ship CRM foundation first; validate pipeline model before layering AI recommendations |
| 9 | `partnership_on_hold` maps to `closed_lost` | On-hold with no timeline is operationally dead; re-engagement creates a new opportunity |
| 10 | Guard query in migration | Prevents orphaned FK references if unmapped statuses exist |

---

## References

- ADR-001: AI-Assisted Grant Writing (streaming chat pattern)
- ADR-003: Email Notifications (task-assigned webhook pattern, deadline cron pattern)
- ADR-005: State & Local Discovery (`extractPageText` utility reused in scrape endpoint)
- ADR-007: AI Solution Advisor (forthcoming — deferred from this ADR)
- GSEMA Technology Platform Strategy RFP — primary design reference for the consulting
  pipeline use case
