-- =============================================================================
-- MIGRATION: ADR-012 Phase 3 — the vocabulary, and where records belong
-- File: 20260822300000_rename_partnership.sql
-- Date: 2026-08-22
--
-- Wright Adventures has clients, not partners. "Partnership" came across from
-- Confluence Colorado, where it was accurate. Here it named five tables, nine
-- status ids and six functions.
--
-- URGENT: Phase 2 dropped opportunities.type_id, and four trigger functions test
-- NEW.type_id. Every UPDATE to opportunities currently fails with
--   record "new" has no field "type_id"
-- This migration repairs that. It is not optional cleanup.
--
-- Two things move to where they belong, rather than just being renamed:
--
--   CONTACTS and INTERACTIONS hang off the ORGANISATION, with an optional
--   opportunity. A person works at an org, not at a deal. The old shape made it
--   impossible to log a nurture touch — City Thread has no open opportunity, so
--   there was nowhere to record a call — which defeats the purpose of nurture.
--
--   NURTURE stops being a stage (ADR-012). The three rows sitting in it are not
--   alike and are not treated alike:
--     • Golden Trout Rising and Avasol describe themselves as "Relationship to
--       nurture. No active opportunity at present." Placeholder records for a
--       deal that does not exist. Their content moves to the org; the rows go.
--     • City Thread is a REAL pursuit — a Zoho CRM RFP with 4 tasks and 2
--       contacts. Confirmed lost. It becomes closed_lost and keeps its history.
--       The ORG stays nurtured, which is the distinction the old model could not
--       draw.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop the triggers before touching anything they read.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS opportunities_stage_rules        ON opportunities;
DROP TRIGGER IF EXISTS opportunities_stage_history      ON opportunities;
DROP TRIGGER IF EXISTS trg_log_partnership_stage_change ON opportunities;
DROP TRIGGER IF EXISTS trg_create_partnership_details   ON opportunities;
DROP TRIGGER IF EXISTS opportunities_create_lead_details ON opportunities;

DROP FUNCTION IF EXISTS create_lead_details() CASCADE;

-- -----------------------------------------------------------------------------
-- 2. Rename the tables. ALTER ... RENAME keeps rows, FKs, indexes and policies.
-- -----------------------------------------------------------------------------
ALTER TABLE partnership_details       RENAME TO opportunity_details;
ALTER TABLE partnership_stage_tasks   RENAME TO stage_tasks;
ALTER TABLE partnership_stage_history RENAME TO stage_history;
ALTER TABLE partnership_contacts      RENAME TO contacts;
ALTER TABLE partnership_interactions  RENAME TO interactions;
ALTER TABLE lead_details              RENAME TO posting_details;

-- posting_details describes a JOB POSTING or RFP. It currently hangs off the two
-- opportunities that were converted from leads (GOBRP, CDI) and holds the apply
-- url, compensation and closing date. New leads attach it before conversion, so
-- it needs to reach both.
-- opportunity_id was its primary key, which cannot be null. A posting attaches
-- to a lead first and to an opportunity only if someone pursues it, so neither
-- side can be the identity. Surrogate key, both sides unique and optional.
ALTER TABLE posting_details DROP CONSTRAINT IF EXISTS lead_details_pkey;
ALTER TABLE posting_details ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE posting_details ADD PRIMARY KEY (id);

ALTER TABLE posting_details
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE posting_details ALTER COLUMN opportunity_id DROP NOT NULL;
ALTER TABLE posting_details ADD CONSTRAINT posting_details_opportunity_key UNIQUE (opportunity_id);
ALTER TABLE posting_details ADD CONSTRAINT posting_details_lead_key        UNIQUE (lead_id);

-- -----------------------------------------------------------------------------
-- 3. Contacts and interactions belong to the organisation.
-- -----------------------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE interactions
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE contacts c
   SET organization_id = o.organization_id
  FROM opportunities o
 WHERE o.id = c.opportunity_id AND c.organization_id IS NULL;

UPDATE interactions i
   SET organization_id = o.organization_id
  FROM opportunities o
 WHERE o.id = i.opportunity_id AND i.organization_id IS NULL;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM contacts WHERE organization_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% contacts could not be attached to an organisation', n; END IF;
  SELECT count(*) INTO n FROM interactions WHERE organization_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% interactions could not be attached to an organisation', n; END IF;
END $$;

ALTER TABLE contacts     ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE interactions ALTER COLUMN organization_id SET NOT NULL;
-- The deal is now the optional part: a nurture touch has an org and no deal.
ALTER TABLE contacts     ALTER COLUMN opportunity_id DROP NOT NULL;
ALTER TABLE interactions ALTER COLUMN opportunity_id DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Empty the nurture stage before removing it.
-- -----------------------------------------------------------------------------

-- Carry what the placeholder records knew onto the organisation.
UPDATE organizations g
   SET nurture_note = COALESCE(g.nurture_note, o.description),
       notes        = COALESCE(g.notes, o.description)
  FROM opportunities o
 WHERE o.organization_id = g.id
   AND o.status = 'partnership_nurture'
   AND o.partner_org IN ('Golden Trout Rising', 'Avasol');

-- Detach anything hanging off the placeholders, then remove them. Contacts keep
-- their organisation — JJ Trout stays reachable at Golden Trout Rising.
UPDATE contacts     SET opportunity_id = NULL WHERE opportunity_id IN
  (SELECT id FROM opportunities WHERE status = 'partnership_nurture' AND partner_org IN ('Golden Trout Rising','Avasol'));
UPDATE interactions SET opportunity_id = NULL WHERE opportunity_id IN
  (SELECT id FROM opportunities WHERE status = 'partnership_nurture' AND partner_org IN ('Golden Trout Rising','Avasol'));

DELETE FROM stage_history     WHERE opportunity_id IN
  (SELECT id FROM opportunities WHERE status = 'partnership_nurture' AND partner_org IN ('Golden Trout Rising','Avasol'));
DELETE FROM activity_log      WHERE opportunity_id IN
  (SELECT id FROM opportunities WHERE status = 'partnership_nurture' AND partner_org IN ('Golden Trout Rising','Avasol'));
DELETE FROM tasks             WHERE opportunity_id IN
  (SELECT id FROM opportunities WHERE status = 'partnership_nurture' AND partner_org IN ('Golden Trout Rising','Avasol'));
DELETE FROM opportunity_details WHERE opportunity_id IN
  (SELECT id FROM opportunities WHERE status = 'partnership_nurture' AND partner_org IN ('Golden Trout Rising','Avasol'));
DELETE FROM opportunities     WHERE status = 'partnership_nurture' AND partner_org IN ('Golden Trout Rising','Avasol');

-- City Thread's Zoho CRM RFP is a real pursuit, and it was lost. The
-- organisation stays nurtured — that separation is the point of ADR-012.
UPDATE opportunity_details d
   SET lost_reason = COALESCE(NULLIF(btrim(d.lost_reason), ''),
                              'Zoho CRM RFP not won. Relationship retained — City Thread remains an organisation to nurture.'),
       updated_at  = now()
  FROM opportunities o
 WHERE o.id = d.opportunity_id AND o.status = 'partnership_nurture';

UPDATE opportunities SET status = 'partnership_closed_lost', updated_at = now()
 WHERE status = 'partnership_nurture';

-- -----------------------------------------------------------------------------
-- 5. Status ids lose the prefix — with one kind of opportunity it means nothing.
-- -----------------------------------------------------------------------------
-- Both referencing FKs have to come off first; renaming a table does not rename
-- its constraints, so stage_tasks still carries the old constraint name.
ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_status_fkey;
ALTER TABLE stage_tasks   DROP CONSTRAINT IF EXISTS partnership_stage_tasks_stage_id_fkey;
ALTER TABLE stage_tasks   DROP CONSTRAINT IF EXISTS stage_tasks_stage_id_fkey;

UPDATE pipeline_statuses SET id     = replace(id,     'partnership_', '');
UPDATE opportunities     SET status = replace(status, 'partnership_', '');
UPDATE stage_tasks       SET stage_id   = replace(stage_id,   'partnership_', '');
UPDATE stage_history     SET from_stage = replace(from_stage, 'partnership_', ''),
                             to_stage   = replace(to_stage,   'partnership_', '');

DELETE FROM stage_tasks       WHERE stage_id = 'nurture';
DELETE FROM pipeline_statuses WHERE id       = 'nurture';

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_status_fkey
  FOREIGN KEY (status) REFERENCES pipeline_statuses(id);

ALTER TABLE stage_tasks
  ADD CONSTRAINT stage_tasks_stage_id_fkey
  FOREIGN KEY (stage_id) REFERENCES pipeline_statuses(id) ON DELETE CASCADE;

WITH ordered AS (SELECT id, row_number() OVER (ORDER BY sort_order) AS n FROM pipeline_statuses)
UPDATE pipeline_statuses p SET sort_order = ordered.n FROM ordered WHERE ordered.id = p.id;

-- -----------------------------------------------------------------------------
-- 6. Functions, rebuilt without type_id.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_stage_rules()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d RECORD;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- Terminal stages are terminal: reopen by creating a new opportunity linked
  -- via previous_opportunity_id, so history is not rewritten. Nurture is no
  -- longer an escape hatch here — a lost deal whose relationship continues is
  -- expressed on the ORGANISATION now.
  IF OLD.status IN ('closed_won', 'closed_lost') THEN
    RAISE EXCEPTION
      'Cannot move out of % — reopen by creating a new opportunity linked via previous_opportunity_id',
      OLD.status USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO d FROM opportunity_details WHERE opportunity_id = NEW.id;

  IF NEW.status = 'closed_lost' AND (d.lost_reason IS NULL OR btrim(d.lost_reason) = '') THEN
    RAISE EXCEPTION 'A lost opportunity requires a reason' USING ERRCODE = 'check_violation';
  END IF;

  -- decision_date at approval stays unenforced on purpose: a champion often
  -- cannot get a board date immediately, and blocking the move would push people
  -- to park deals in proposal, which is worse data than a missing date.
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION record_stage_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  INSERT INTO stage_history (opportunity_id, from_stage, to_stage, changed_by, note)
  VALUES (NEW.id, OLD.status, NEW.status, auth.uid(),
          NULLIF(current_setting('app.stage_note', true), ''));

  UPDATE opportunity_details SET stage_entered_at = now(), updated_at = now()
   WHERE opportunity_id = NEW.id;

  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION create_opportunity_details()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.opportunity_details (opportunity_id) VALUES (NEW.id)
  ON CONFLICT (opportunity_id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION log_stage_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.activity_log (opportunity_id, actor_id, action, details)
    VALUES (NEW.id, auth.uid(), 'stage_changed',
            jsonb_build_object('from_stage', OLD.status, 'to_stage', NEW.status));
  END IF;
  RETURN NEW;
END; $$;

-- Contacts and interactions can now exist without a deal, and activity_log is
-- keyed by opportunity — so skip the log rather than failing the insert.
CREATE OR REPLACE FUNCTION log_contact_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.opportunity_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_log (opportunity_id, actor_id, action, details)
    VALUES (NEW.opportunity_id, auth.uid(), 'contact_added',
            jsonb_build_object('contact_name', NEW.full_name, 'contact_title', NEW.title));
  ELSIF TG_OP = 'UPDATE' AND OLD.is_primary IS DISTINCT FROM NEW.is_primary AND NEW.is_primary = true THEN
    INSERT INTO public.activity_log (opportunity_id, actor_id, action, details)
    VALUES (NEW.opportunity_id, auth.uid(), 'primary_contact_changed',
            jsonb_build_object('contact_name', NEW.full_name));
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION log_interaction_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.opportunity_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.activity_log (opportunity_id, actor_id, action, details)
  VALUES (NEW.opportunity_id, COALESCE(NEW.logged_by, auth.uid()), 'interaction_logged',
          jsonb_build_object('interaction_type', NEW.interaction_type::text,
                             'direction', NEW.direction::text,
                             'subject', NEW.subject, 'contact_id', NEW.contact_id));
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION change_opportunity_stage(
  p_opportunity_id UUID,
  p_to_stage       TEXT,
  p_note           TEXT DEFAULT NULL,
  p_lost_reason    TEXT DEFAULT NULL,
  p_decision_date  DATE DEFAULT NULL,
  p_decision_body  TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.stage_note', COALESCE(p_note, ''), true);

  UPDATE opportunity_details
     SET lost_reason   = COALESCE(p_lost_reason,   lost_reason),
         decision_date = COALESCE(p_decision_date, decision_date),
         decision_body = COALESCE(p_decision_body, decision_body),
         updated_at    = now()
   WHERE opportunity_id = p_opportunity_id;

  UPDATE opportunities SET status = p_to_stage, updated_at = now()
   WHERE id = p_opportunity_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opportunity % not found', p_opportunity_id;
  END IF;
END; $$;

COMMENT ON FUNCTION change_opportunity_stage IS
  'Move an opportunity between stages. Supporting fields and status land in one '
  'transaction so the guard trigger sees them. History is written by the trigger, '
  'not here, so a direct UPDATE is recorded too.';

GRANT EXECUTE ON FUNCTION change_opportunity_stage TO authenticated;

DROP FUNCTION IF EXISTS change_partnership_stage(UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS enforce_partnership_stage_rules() CASCADE;
DROP FUNCTION IF EXISTS record_partnership_stage_change() CASCADE;
DROP FUNCTION IF EXISTS create_partnership_details() CASCADE;
DROP FUNCTION IF EXISTS log_partnership_stage_change() CASCADE;

-- -----------------------------------------------------------------------------
-- 7. Triggers back on.
-- -----------------------------------------------------------------------------
CREATE TRIGGER opportunities_stage_rules   BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION enforce_stage_rules();
CREATE TRIGGER opportunities_stage_history AFTER  UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION record_stage_change();
CREATE TRIGGER opportunities_log_stage     AFTER  UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION log_stage_change();
CREATE TRIGGER opportunities_create_details AFTER INSERT ON opportunities
  FOR EACH ROW EXECUTE FUNCTION create_opportunity_details();

COMMIT;
