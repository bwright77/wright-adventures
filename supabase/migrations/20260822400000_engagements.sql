-- =============================================================================
-- MIGRATION: ADR-012 Phase 4 — engagements
-- File: 20260822400000_engagements.sql
-- Date: 2026-08-22
--
-- A closed-won opportunity is a historical fact that should stop changing. The
-- WORK is a separate thing that keeps changing: BBSP is finished, Mo'Betta is in
-- delivery, River Sisters still has a logo redesign open. Those were being
-- expressed by mutating delivery_status on the won opportunity, which meant the
-- record of what we won and the record of what we are doing were the same row.
--
-- Splitting them also gives ADR-010 somewhere to hang: you log time against an
-- ENGAGEMENT. An opportunity is not a thing you can bill to.
--
-- opportunity_id is NULLABLE on purpose. CMC's contract predates the OMP — the
-- work is real and there is no pursuit record for it. Requiring one would force
-- us to invent a fake won opportunity to describe work that actually exists.
--
-- The four-org model (ADR discussion, 2026-08-19) is why `nature` is not simply
-- paid/unpaid: Kady, River Sisters, Mo'Betta and Confluence are strategic, not
-- charity. Shane raises against them, Confluence is fiscal agent and takes an
-- admin fee, the digital work wins the grants, and it is all portfolio. `fmv`
-- carries what the work is worth so that contributed value stays visible next to
-- cash collected.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS engagements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  -- Null when the work predates the OMP, or arrived without a pursuit.
  opportunity_id  UUID REFERENCES opportunities(id) ON DELETE SET NULL,

  name            TEXT NOT NULL,

  nature          TEXT NOT NULL DEFAULT 'paid'
                  CHECK (nature IN ('paid', 'reduced_rate', 'strategic', 'portfolio')),
  delivery_status TEXT NOT NULL DEFAULT 'in_delivery'
                  CHECK (delivery_status IN ('in_delivery', 'supporting', 'complete', 'paused')),

  contract_value  NUMERIC(12,2),
  fmv             NUMERIC(12,2),
  fmv_basis       TEXT,
  service_lines   TEXT[] NOT NULL DEFAULT '{}',

  started_on      DATE,
  ended_on        DATE,
  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE engagements IS
  'Won work being delivered. ADR-010 logs time against this, not against an opportunity.';
COMMENT ON COLUMN engagements.fmv IS
  'What the work is worth at market rate, whatever was actually collected. Keeps '
  'contributed value visible instead of reading as $0 of activity.';

CREATE INDEX IF NOT EXISTS engagements_org_idx      ON engagements (organization_id);
CREATE INDEX IF NOT EXISTS engagements_delivery_idx ON engagements (delivery_status);

ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read engagements"
  ON engagements FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin and manager can modify engagements"
  ON engagements FOR ALL TO authenticated
  USING      ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'));

-- -----------------------------------------------------------------------------
-- Backfill from the five closed-won opportunities.
-- -----------------------------------------------------------------------------
INSERT INTO engagements (
  organization_id, opportunity_id, name, nature, delivery_status,
  contract_value, fmv, fmv_basis, service_lines, started_on
)
SELECT
  o.organization_id,
  o.id,
  o.name,
  COALESCE(d.engagement_nature, 'paid'),
  COALESCE(d.delivery_status, 'in_delivery'),
  o.estimated_value,
  d.list_value,
  d.list_value_basis,
  COALESCE(o.service_lines, '{}'),
  o.agreement_date::date
FROM opportunities o
JOIN opportunity_details d ON d.opportunity_id = o.id
WHERE o.status = 'closed_won'
  AND o.organization_id IS NOT NULL;

-- CMC: Shane has the relationship and Wright Adventures holds a contract, but the
-- work predates the OMP so there is no won opportunity for it. Recorded from what
-- org_relationships already asserts. Values are deliberately left NULL rather
-- than guessed — see the report accompanying this migration.
INSERT INTO engagements (organization_id, name, nature, delivery_status, notes)
SELECT g.id,
       'Hiring, operations and compliance support',
       'paid',
       'in_delivery',
       'Predates the OMP; no pursuit record exists. Contract value, FMV and start date not yet captured.'
  FROM organizations g
 WHERE g.name = 'Colorado Mountain Club'
   AND NOT EXISTS (SELECT 1 FROM engagements e WHERE e.organization_id = g.id);

-- -----------------------------------------------------------------------------
-- Client-ness is now a fact about the work, kept true by a trigger rather than
-- by whoever remembers to update a dropdown.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_client_tier()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID;
BEGIN
  target := COALESCE(NEW.organization_id, OLD.organization_id);

  IF EXISTS (SELECT 1 FROM engagements WHERE organization_id = target) THEN
    UPDATE organizations SET relationship_tier = 'client', updated_at = now()
     WHERE id = target AND relationship_tier <> 'client';
  ELSE
    -- No engagements left: fall back to prospect if a pursuit is open, else network.
    UPDATE organizations g
       SET relationship_tier = CASE
             WHEN EXISTS (SELECT 1 FROM opportunities o
                           WHERE o.organization_id = g.id
                             AND o.status NOT IN ('closed_won','closed_lost')) THEN 'prospect'
             ELSE 'network' END,
           updated_at = now()
     WHERE g.id = target AND g.relationship_tier = 'client';
  END IF;

  RETURN NULL;
END; $$;

CREATE TRIGGER engagements_sync_client_tier
  AFTER INSERT OR UPDATE OF organization_id OR DELETE ON engagements
  FOR EACH ROW EXECUTE FUNCTION sync_client_tier();

UPDATE organizations g SET relationship_tier = 'client'
 WHERE EXISTS (SELECT 1 FROM engagements e WHERE e.organization_id = g.id)
   AND relationship_tier <> 'client';

-- -----------------------------------------------------------------------------
-- The moved columns leave opportunity_details. Keeping them would mean two
-- places claiming to know the delivery status, which is how they drift.
-- -----------------------------------------------------------------------------
ALTER TABLE opportunity_details
  DROP COLUMN IF EXISTS delivery_status,
  DROP COLUMN IF EXISTS engagement_nature,
  DROP COLUMN IF EXISTS list_value,
  DROP COLUMN IF EXISTS list_value_basis;

COMMIT;
