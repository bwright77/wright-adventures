-- =============================================================================
-- MIGRATION: Replace partnership_type with service_lines
-- File: 20260819100000_service_lines.sql
-- Date: 2026-08-19
--
-- partnership_type carried no information. Across nine real opportunities:
--   other  5 · (null) 1 · in_kind 1 · coalition 1 · strategic_alliance 1
-- Two-thirds were "other" or empty, because the vocabulary — MOU, coalition,
-- joint program, in-kind, referral — describes how two NONPROFITS relate to
-- each other. Wright Adventures is a consultancy selling services, so nothing
-- fit and everything collapsed onto "other".
--
-- service_lines names what is actually being sold, drawn from the seven
-- services in waOrgProfile.ts — the same ones the fit rubric scores against.
--
-- It is an ARRAY on purpose. CMC is data remediation AND fractional technology
-- leadership; BBSP was impact storytelling AND custom software AND web. A
-- single-valued replacement would force the same collapse in a new costume.
--
-- Backfill below is from the source documents: the CMC and BBSP SOWs, the GOBRP
-- proposal, and the case-study copy. City Thread and Avasol are left empty —
-- their scope is not recorded anywhere, and inventing it would defeat the point.
-- =============================================================================

BEGIN;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS service_lines TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE opportunities
  DROP CONSTRAINT IF EXISTS opportunities_service_lines_check;

-- `<@` asserts every element is drawn from the allowed set.
ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_service_lines_check
  CHECK (service_lines <@ ARRAY[
    'fractional_tech_leadership',
    'data_remediation',
    'custom_software',
    'websites_fundraising',
    'impact_storytelling',
    'development_strategy',
    'compliance'
  ]::TEXT[]);

COMMENT ON COLUMN opportunities.service_lines IS
  'What Wright Adventures is selling on this engagement. Multi-valued; kept in '
  'sync with SERVICE_LINES in src/lib/serviceLines.ts and the services list in '
  'waOrgProfile.ts. Replaced partnership_type, which described nonprofit-to-'
  'nonprofit relationship structure and did not fit a consultancy.';

CREATE INDEX IF NOT EXISTS opportunities_service_lines_idx
  ON opportunities USING GIN (service_lines);

-- -----------------------------------------------------------------------------
-- Backfill from the source documents
-- -----------------------------------------------------------------------------

-- BBSP: nine-section retrospective site, print edition, 500+ story archive
UPDATE opportunities SET service_lines =
  ARRAY['impact_storytelling','custom_software','websites_fundraising']
 WHERE partner_org ILIKE '%PeopleForBikes%';

-- CMC: Marketing Cloud extraction, Salesforce repair, platform migration,
-- vendor oversight. The SOW calls it "the sort of work a CTO would own".
UPDATE opportunities SET service_lines =
  ARRAY['data_remediation','fractional_tech_leadership']
 WHERE partner_org ILIKE '%Colorado Mountain Club%';

-- Mo'Betta Green: site, hosting, and five digital revenue paths
UPDATE opportunities SET service_lines =
  ARRAY['websites_fundraising','custom_software']
 WHERE partner_org ILIKE '%Betta Green%';

-- Kady: brand and web, fundraising strategy, and fiscal sponsorship
UPDATE opportunities SET service_lines =
  ARRAY['websites_fundraising','development_strategy','compliance']
 WHERE partner_org ILIKE '%Kady%';

-- River Sisters: bilingual site, brand, advocacy engine
UPDATE opportunities SET service_lines =
  ARRAY['websites_fundraising','impact_storytelling']
 WHERE partner_org ILIKE '%River Sisters%';

-- GOBRP: case for support, donor system, grant pipeline, compliance floor
UPDATE opportunities SET service_lines =
  ARRAY['development_strategy','custom_software','compliance']
 WHERE partner_org ILIKE '%Golden Optimists%';

-- GSEMA: technology platform strategy assessment
UPDATE opportunities SET service_lines =
  ARRAY['fractional_tech_leadership']
 WHERE partner_org ILIKE '%Girl Scouts%';

-- -----------------------------------------------------------------------------
-- Retire partnership_type. The three rows carrying a real value (in_kind,
-- coalition, strategic_alliance) described relationship structure, which is not
-- what the field was being used to answer.
-- -----------------------------------------------------------------------------
ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_partnership_type_check;
ALTER TABLE opportunities DROP COLUMN IF EXISTS partnership_type;

COMMIT;
