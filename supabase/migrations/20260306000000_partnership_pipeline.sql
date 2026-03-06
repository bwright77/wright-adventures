-- ============================================================
-- ADR-006: Partnership Sales Pipeline — CRM Foundation
-- Date: 2026-03-06
-- ============================================================

BEGIN;

-- ============================================================
-- GUARD: Verify all existing partnership statuses are covered
-- by the migration mapping. Raises exception if any are missed.
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

-- Outreach and Formalizing → Prospecting (earliest active stage)
UPDATE opportunities
  SET status = 'partnership_prospecting'
  WHERE type_id = 'partnership'
    AND status IN ('partnership_outreach', 'partnership_formalizing');

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

-- Prospecting and Negotiating stay as-is (same IDs in new pipeline)

-- ============================================================
-- 2. REPLACE PIPELINE STATUSES
-- ============================================================
-- partnership_prospecting and partnership_negotiating survive unchanged
-- into the new pipeline — we cannot DELETE them while opportunities still
-- reference them. Delete only the IDs that have been migrated away above.

DELETE FROM pipeline_statuses WHERE id IN (
  'partnership_outreach',
  'partnership_formalizing',
  'partnership_active',
  'partnership_completed',
  'partnership_declined',
  'partnership_archived',
  'partnership_on_hold'
);

-- Update the two surviving IDs to their new sort_order / is_active
UPDATE pipeline_statuses SET sort_order = 1, is_active = true, label = 'Prospecting'
  WHERE id = 'partnership_prospecting';
UPDATE pipeline_statuses SET sort_order = 5, is_active = true, label = 'Negotiating'
  WHERE id = 'partnership_negotiating';

-- Insert the five genuinely new stage IDs
INSERT INTO pipeline_statuses (id, type_id, label, sort_order, is_active) VALUES
  ('partnership_qualifying',  'partnership', 'Qualifying',  2, true),
  ('partnership_discovery',   'partnership', 'Discovery',   3, true),
  ('partnership_proposal',    'partnership', 'Proposal',    4, true),
  ('partnership_closed_won',  'partnership', 'Closed-Won',  6, false),
  ('partnership_closed_lost', 'partnership', 'Closed-Lost', 7, false);

-- ============================================================
-- 3. ENUMS
-- ============================================================

CREATE TYPE company_size AS ENUM (
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1000',
  '1000+'
);

CREATE TYPE deal_confidence AS ENUM ('low', 'medium', 'high');

CREATE TYPE interaction_type AS ENUM (
  'call', 'meeting', 'email', 'message', 'demo',
  'proposal_sent', 'contract_sent', 'note', 'other'
);

CREATE TYPE interaction_direction AS ENUM ('inbound', 'outbound', 'internal');

-- ============================================================
-- 4. SHARED updated_at TRIGGER FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION update_partnership_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- 5. PARTNERSHIP_DETAILS EXTENSION TABLE (1:1 with opportunities)
-- ============================================================

CREATE TABLE partnership_details (
  opportunity_id         uuid PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,

  -- Qualification
  qualification_status   text CHECK (qualification_status IN (
    'unqualified', 'partially_qualified', 'qualified'
  )) NOT NULL DEFAULT 'unqualified',
  qualification_notes    text,

  -- Pipeline tracking
  pain_points            text,
  next_action            text,
  next_action_date       timestamptz,
  confidence             deal_confidence,
  expected_close_date    timestamptz,
  lost_reason            text,

  -- Tech engagement
  org_size               company_size,
  tech_stack_notes       text,

  -- Reserved for ADR-007
  ai_solution_summary    text,
  ai_solution_updated_at timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_partnership_details_updated_at
  BEFORE UPDATE ON partnership_details
  FOR EACH ROW EXECUTE FUNCTION update_partnership_timestamp();

ALTER TABLE partnership_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read partnership_details"
  ON partnership_details FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin and manager can modify partnership_details"
  ON partnership_details FOR ALL TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'));

-- Auto-create partnership_details row on new partnership opportunity
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

-- Backfill existing partnership opportunities
INSERT INTO partnership_details (opportunity_id)
SELECT id FROM opportunities WHERE type_id = 'partnership'
ON CONFLICT (opportunity_id) DO NOTHING;

-- ============================================================
-- 6. PARTNERSHIP_CONTACTS TABLE
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
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_partnership_contacts_updated_at
  BEFORE UPDATE ON partnership_contacts
  FOR EACH ROW EXECUTE FUNCTION update_partnership_timestamp();

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
-- 7. PARTNERSHIP_INTERACTIONS TABLE (append-only via RLS)
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

CREATE TRIGGER trg_partnership_interactions_updated_at
  BEFORE UPDATE ON partnership_interactions
  FOR EACH ROW EXECUTE FUNCTION update_partnership_timestamp();

ALTER TABLE partnership_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read interactions"
  ON partnership_interactions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Members+ can insert interactions"
  ON partnership_interactions FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin','manager','member'));

-- Append-only from UI; admin-only override for corrections
CREATE POLICY "Admin can update interactions"
  ON partnership_interactions FOR UPDATE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admin can delete interactions"
  ON partnership_interactions FOR DELETE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- ============================================================
-- 8. PARTNERSHIP_STAGE_TASKS TABLE
-- ============================================================

CREATE TABLE partnership_stage_tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id         text NOT NULL REFERENCES pipeline_statuses(id) ON DELETE CASCADE,
  title            text NOT NULL,
  assignee_role    text NOT NULL DEFAULT 'owner'
                     CHECK (assignee_role IN ('owner','contributor','leadership')),
  days_after_entry int  NOT NULL DEFAULT 0,
  sort_order       int  NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE partnership_stage_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stage tasks"
  ON partnership_stage_tasks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin can manage stage tasks"
  ON partnership_stage_tasks FOR ALL TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

INSERT INTO partnership_stage_tasks (stage_id, title, assignee_role, days_after_entry, sort_order) VALUES
  -- Prospecting
  ('partnership_prospecting', 'Research organization and map stakeholders',            'owner', 0, 1),
  ('partnership_prospecting', 'Connect on LinkedIn / send initial outreach email',     'owner', 1, 2),
  ('partnership_prospecting', 'Follow up if no response in 5 business days',           'owner', 7, 3),

  -- Qualifying
  ('partnership_qualifying',  'Qualification call — assess budget, authority, need, timing', 'owner', 0, 1),
  ('partnership_qualifying',  'Log qualification findings and update opportunity',      'owner', 1, 2),

  -- Discovery
  ('partnership_discovery',   'Schedule discovery / scoping session',                   'owner', 0, 1),
  ('partnership_discovery',   'Discovery session — document pain points and tech stack','owner', 3, 2),
  ('partnership_discovery',   'Internal debrief and solution design',                   'owner', 5, 3),

  -- Proposal
  ('partnership_proposal',    'Draft proposal with tailored recommendations',           'owner',       0,  1),
  ('partnership_proposal',    'Internal review of proposal',                           'leadership',  5,  2),
  ('partnership_proposal',    'Deliver proposal to client',                            'owner',       7,  3),
  ('partnership_proposal',    'Follow up post-proposal',                               'owner',       14, 4),

  -- Negotiating
  ('partnership_negotiating', 'Negotiation / scope refinement call',                   'owner',       0, 1),
  ('partnership_negotiating', 'Finalize contract or MOU',                              'owner',       5, 2),
  ('partnership_negotiating', 'Final legal / leadership review',                       'leadership',  7, 3),

  -- Closed-Won
  ('partnership_closed_won',  'Execute agreement / contract',                          'owner', 0,  1),
  ('partnership_closed_won',  'Send kickoff welcome email',                            'owner', 1,  2),
  ('partnership_closed_won',  'Kickoff meeting',                                       'owner', 7,  3),
  ('partnership_closed_won',  'First check-in / status call',                          'owner', 30, 4),

  -- Closed-Lost
  ('partnership_closed_lost', 'Document loss reason and debrief notes',                'owner', 0, 1);

-- ============================================================
-- 9. ACTIVITY LOG TRIGGERS
-- ============================================================

-- Log contact additions and primary-contact changes to activity_log
CREATE OR REPLACE FUNCTION log_contact_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_log (opportunity_id, actor_id, action, details)
    VALUES (
      NEW.opportunity_id,
      auth.uid(),
      'contact_added',
      jsonb_build_object('contact_name', NEW.full_name, 'contact_title', NEW.title)
    );
  ELSIF TG_OP = 'UPDATE'
    AND OLD.is_primary IS DISTINCT FROM NEW.is_primary
    AND NEW.is_primary = true THEN
    INSERT INTO public.activity_log (opportunity_id, actor_id, action, details)
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

-- Log every new interaction to activity_log
CREATE OR REPLACE FUNCTION log_interaction_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.activity_log (opportunity_id, actor_id, action, details)
  VALUES (
    NEW.opportunity_id,
    COALESCE(NEW.logged_by, auth.uid()),
    'interaction_logged',
    jsonb_build_object(
      'interaction_type', NEW.interaction_type::text,
      'direction',        NEW.direction::text,
      'subject',          NEW.subject,
      'contact_id',       NEW.contact_id
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_interaction_activity
  AFTER INSERT ON partnership_interactions
  FOR EACH ROW EXECUTE FUNCTION log_interaction_activity();

-- Log partnership stage transitions to activity_log
CREATE OR REPLACE FUNCTION log_partnership_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.type_id = 'partnership'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.activity_log (opportunity_id, actor_id, action, details)
    VALUES (
      NEW.id,
      auth.uid(),
      'stage_changed',
      jsonb_build_object(
        'from_stage', OLD.status,
        'to_stage',   NEW.status
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
