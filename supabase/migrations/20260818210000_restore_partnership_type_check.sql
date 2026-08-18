-- =============================================================================
-- MIGRATION: Restore the partnership_type check constraint
-- File: 20260818210000_restore_partnership_type_check.sql
-- Author: Benjamin Wright, Director of Technology & Innovation
-- Date: 2026-08-18
--
-- 20260224000000_initial_schema.sql declares:
--   partnership_type text check (partnership_type in
--     ('mou','joint_program','coalition','referral','in_kind','other'))
--
-- The deployed constraint accepts only 'other'. Probed empirically — every
-- other value is rejected. This is a live bug, not a cosmetic one: both
-- NewOpportunity.tsx and EditOpportunity.tsx render all six options from the
-- PartnershipType union in src/lib/types.ts, so choosing anything except
-- "Other" fails on save with a check-constraint violation.
--
-- Third instance of the deployed schema drifting from the migration files
-- (see also: discovery_sources.url losing its UNIQUE constraint, and the
-- empty migration history repaired on 2026-08-18). All three trace back to
-- migrations having been applied by hand rather than through the CLI.
-- =============================================================================

-- The deployed vocabulary also holds 'strategic_alliance' — in use by the GSEMA
-- row and present in no migration file. Rather than guess at whatever the
-- replacement constraint was, the vocabulary is set deliberately here: the six
-- the application offers, plus the one the data actually contains. Nothing is
-- lost, the dropdowns work, and types.ts is updated to match.
BEGIN;

ALTER TABLE opportunities
  DROP CONSTRAINT IF EXISTS opportunities_partnership_type_check;

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_partnership_type_check
  CHECK (partnership_type IS NULL OR partnership_type IN
    ('mou', 'joint_program', 'coalition', 'referral', 'in_kind',
     'strategic_alliance', 'other'));

COMMENT ON COLUMN opportunities.partnership_type IS
  'Must stay in sync with the PartnershipType union in src/lib/types.ts, which '
  'drives the form dropdowns.';

COMMIT;
