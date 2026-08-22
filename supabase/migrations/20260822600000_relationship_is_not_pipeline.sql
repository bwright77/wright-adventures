-- =============================================================================
-- MIGRATION: relationship_tier stops tracking the pipeline
-- File: 20260822600000_relationship_is_not_pipeline.sql
-- Date: 2026-08-22
--
-- Two things mean we have a relationship: they are a client, or we are actively
-- nurturing them. That is the whole rule.
--
-- 'prospect' broke it by putting pipeline state into the same column. An org we
-- started pursuing was stamped prospect, overwriting how we knew them — so GOBRP
-- lost Shane's Groundwork-era history the moment it became an opportunity, and
-- getting it back needed a third rule ("prospect, but only if someone wrote down
-- a basis"). Meanwhile Climate Democracy, a posting we found and applied to
-- cold, looked identical.
--
-- Whether an opportunity is open is already knowable from `opportunities`. It
-- does not belong here. So the column now answers one question — how do we know
-- them — with three honest answers:
--
--   client  : maintained by the engagements trigger. The work is the relationship.
--   network : somebody decided we know them and are keeping in touch. This is
--             the nurture list; the placement itself is the claim.
--   none    : we do not know them.
--
-- Reclassifying the two existing prospects:
--   GOBRP            → network  (carries "Shane's Groundwork-era work with Ted Rains")
--   Climate Democracy → none    (a cold application; no one has claimed a relationship)
-- =============================================================================

BEGIN;

UPDATE organizations
   SET relationship_tier = CASE
         WHEN btrim(COALESCE(relationship_basis, '')) <> '' THEN 'network'
         ELSE 'none'
       END,
       updated_at = now()
 WHERE relationship_tier = 'prospect';

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_relationship_tier_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_relationship_tier_check
  CHECK (relationship_tier IN ('none', 'network', 'client'));

COMMENT ON COLUMN organizations.relationship_tier IS
  'How we know them, never where they sit in the pipeline. none | network | client. '
  'client is trigger-maintained from engagements; network is the nurture list. '
  'Warm path = client OR network — see api/discovery/sources-sync.ts.';

-- The Phase 4 trigger fell back to 'prospect' when an org''s last engagement was
-- removed, which is no longer a legal value. Losing the work does not erase that
-- we know them, so it falls back to network.
CREATE OR REPLACE FUNCTION sync_client_tier()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID;
BEGIN
  target := COALESCE(NEW.organization_id, OLD.organization_id);

  IF EXISTS (SELECT 1 FROM engagements WHERE organization_id = target) THEN
    UPDATE organizations SET relationship_tier = 'client', updated_at = now()
     WHERE id = target AND relationship_tier <> 'client';
  ELSE
    UPDATE organizations SET relationship_tier = 'network', updated_at = now()
     WHERE id = target AND relationship_tier = 'client';
  END IF;

  RETURN NULL;
END; $$;

COMMIT;
