-- =============================================================================
-- MIGRATION: ADR-012 Phase 2 — leads leave the opportunities table
-- File: 20260822200000_leads_table.sql
-- Date: 2026-08-22
--
-- A lead and a pursuit were the same table discriminated by type_id. They are
-- not the same shape: of the columns on `opportunities`, FOURTEEN are null on
-- every one of the 24 lead rows — owner_id, tags, partner_org, primary_contact,
-- contact_email, contact_phone, mutual_commitments, agreement_date,
-- renewal_date, estimated_value, alignment_notes, created_by, external_id,
-- service_lines. That is two tables wearing one trenchcoat.
--
-- The cost of the pretence was a filter on every list — isOpportunity(),
-- TAB_STATUSES, INACTIVE_PARTNERSHIP_STATUSES — existing only to hide rows of
-- the wrong kind. The ?tab=partnership crash came from exactly that machinery.
--
-- Leads carry NO dependent rows (0 tasks, 0 activity_log, 0 partnership_details),
-- so this is a straight lift with nothing to cascade.
--
-- With leads gone there is only one kind of opportunity, so type_id and the
-- whole opportunity_types table have nothing left to discriminate.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The table. Only the columns leads actually use.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  description         TEXT,

  -- new: not yet judged. declined: judged, not worth pursuing — kept so the
  -- discovery pipeline does not re-surface it. converted: became an opportunity.
  status              TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'declined', 'converted')),

  -- Set on conversion. Both nullable: a lead usually names an employer we have
  -- no record of until someone decides to pursue it.
  organization_id     UUID REFERENCES organizations(id) ON DELETE SET NULL,
  opportunity_id      UUID REFERENCES opportunities(id) ON DELETE SET NULL,

  primary_deadline    TIMESTAMPTZ,
  source              TEXT,
  source_url          TEXT,
  external_url        TEXT,
  external_id         TEXT,

  -- ADR-011 scoring.
  ai_match_score      INTEGER,
  ai_match_rationale  TEXT,
  ai_score_detail     JSONB,
  auto_discovered     BOOLEAN NOT NULL DEFAULT false,
  discovered_at       TIMESTAMPTZ,
  discovery_source_id UUID REFERENCES discovery_sources(id) ON DELETE SET NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_status_idx    ON leads (status);
CREATE INDEX IF NOT EXISTS leads_score_idx     ON leads (ai_match_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS leads_discovered_idx ON leads (discovered_at DESC NULLS LAST);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read leads"
  ON leads FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin and manager can modify leads"
  ON leads FOR ALL TO authenticated
  USING      ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'));

-- -----------------------------------------------------------------------------
-- 2. Move the rows. Only two lead statuses were ever used — lead_discovered (9)
--    and lead_declined (15). The other four (evaluating, pursuing, submitted,
--    won, lost) were seeded and never reached, so they map to nothing.
-- -----------------------------------------------------------------------------
INSERT INTO leads (
  id, name, description, status, primary_deadline, source, source_url,
  external_url, external_id, ai_match_score, ai_match_rationale, ai_score_detail,
  auto_discovered, discovered_at, discovery_source_id, created_at, updated_at
)
SELECT
  o.id, o.name, o.description,
  CASE o.status
    WHEN 'lead_declined'  THEN 'declined'
    WHEN 'lead_discovered' THEN 'new'
    WHEN 'lead_evaluating' THEN 'new'
    ELSE 'new'
  END,
  o.primary_deadline, o.source, o.source_url, o.external_url, o.external_id,
  o.ai_match_score, o.ai_match_rationale, o.ai_score_detail,
  COALESCE(o.auto_discovered, false), o.discovered_at, o.discovery_source_id,
  o.created_at, o.updated_at
FROM opportunities o
WHERE o.type_id = 'lead';

DO $$
DECLARE moved INT; expected INT;
BEGIN
  SELECT count(*) INTO moved    FROM leads;
  SELECT count(*) INTO expected FROM opportunities WHERE type_id = 'lead';
  IF moved <> expected THEN
    RAISE EXCEPTION 'lead move incomplete: % moved, % expected', moved, expected;
  END IF;
END $$;

DELETE FROM opportunities WHERE type_id = 'lead';

-- -----------------------------------------------------------------------------
-- 3. Nothing left to discriminate on.
-- -----------------------------------------------------------------------------
DELETE FROM pipeline_statuses WHERE type_id = 'lead';

ALTER TABLE opportunities     DROP COLUMN IF EXISTS type_id;
ALTER TABLE pipeline_statuses DROP COLUMN IF EXISTS type_id;

-- task_templates is dormant — 1 template, 11 items, and no code reads it since
-- the grants template left in ADR-009; partnership_stage_tasks is the live
-- mechanism. Drop only its type_id so opportunity_types can go, and leave the
-- table itself alone rather than destroying rows nothing asked us to destroy.
ALTER TABLE task_templates    DROP COLUMN IF EXISTS type_id;

DROP TABLE IF EXISTS opportunity_types;

-- Close the gaps the lead_* rows left in the board ordering.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY sort_order) AS n FROM pipeline_statuses
)
UPDATE pipeline_statuses p SET sort_order = ordered.n
  FROM ordered WHERE ordered.id = p.id;

COMMIT;
