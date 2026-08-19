-- =============================================================================
-- MIGRATION: Delivery status — what happens after an opportunity is won
-- File: 20260819300000_delivery_status.sql
-- Date: 2026-08-19
-- ADR: ADR-010 (this is engagements.status arriving early)
--
-- `status` tracks the PIPELINE, and winning ends it. What follows is a delivery
-- lifecycle on a different axis, so adding a stage after partnership_closed_won
-- would mean the pipeline never terminates and the kanban would grow a column
-- that is not a sales stage.
--
-- The data showed this is not a two-state problem. Of five closed-won
-- engagements, exactly one has nothing outstanding:
--
--   BBSP        build delivered Jul 2026, hosting obligation runs to Jul 2030
--   Mo'Betta    still choosing which revenue path to build; WA holds hosting
--   Confluence  ongoing technology infrastructure and grant strategy partner
--   Kady        fiscal partner — a continuing obligation with no end date
--   River Sisters  nothing recorded as outstanding
--
-- Vocabulary deliberately matches ADR-010's engagements.status, so this
-- migrates into that entity rather than becoming a parallel concept.
-- =============================================================================

BEGIN;

ALTER TABLE partnership_details
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'in_delivery';

ALTER TABLE partnership_details
  DROP CONSTRAINT IF EXISTS partnership_details_delivery_status_check;

ALTER TABLE partnership_details
  ADD CONSTRAINT partnership_details_delivery_status_check
  CHECK (delivery_status IN ('in_delivery', 'supporting', 'complete', 'dormant'));

COMMENT ON COLUMN partnership_details.delivery_status IS
  'Post-win lifecycle, orthogonal to pipeline status. '
  'in_delivery = work actively happening. '
  'supporting = handed over, obligation still live (hosting, fiscal sponsorship). '
  'complete = nothing owed. '
  'dormant = relationship warm, no active work. '
  'Only meaningful once status = partnership_closed_won.';

-- -----------------------------------------------------------------------------
-- Set what the source documents support. River Sisters is left at the default
-- rather than guessed at — nothing on file says whether WA carries an ongoing
-- obligation there.
-- -----------------------------------------------------------------------------
UPDATE partnership_details pd SET delivery_status = 'supporting'
  FROM opportunities o
 WHERE o.id = pd.opportunity_id
   AND o.partner_org ILIKE '%PeopleForBikes%';        -- hosting reserve to Jul 2030

UPDATE partnership_details pd SET delivery_status = 'in_delivery'
  FROM opportunities o
 WHERE o.id = pd.opportunity_id
   AND o.partner_org ILIKE '%Betta Green%';           -- revenue path still being chosen

UPDATE partnership_details pd SET delivery_status = 'supporting'
  FROM opportunities o
 WHERE o.id = pd.opportunity_id
   AND o.partner_org ILIKE '%Kady%';                  -- fiscal partner, ongoing

COMMIT;
