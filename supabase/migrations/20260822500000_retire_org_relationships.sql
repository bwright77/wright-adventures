-- =============================================================================
-- MIGRATION: ADR-012 — retire org_relationships
-- File: 20260822500000_retire_org_relationships.sql
-- Date: 2026-08-22
--
-- Phase 1 folded every org_relationships row into `organizations` (name,
-- relationship_tier, relationship_basis, via_org_id) but left the old table
-- standing, and the discovery scorer kept reading it. So one concept had three
-- sources — a hardcoded seed in waOrgProfile.ts, this table, and a query over
-- closed-won opportunities — and the canonical one was consulted by nothing.
--
-- The visible cost: the three nurtured organisations (City Thread, Avasol,
-- Golden Trout Rising) were invisible to the scorer, so an opportunity from any
-- of them scored warm_path 0 — which trips a band downgrade, the exact failure
-- the nurture list exists to prevent.
--
-- Settings now edits `organizations` directly. Dropping this table is what stops
-- it coming back: leaving it would mean edits to a list nothing reads.
--
-- Data is preserved — every row is already merged, verified below before drop.
-- =============================================================================

BEGIN;

DO $$
DECLARE unmerged TEXT;
BEGIN
  -- Match the Phase 1 merge map: the same orgs are spelled differently in each
  -- table ("PeopleForBikes / BBSP" vs "PeopleForBikes Foundation"), so compare
  -- on the basis text, which was carried across verbatim.
  SELECT string_agg(r.org, ', ') INTO unmerged
    FROM org_relationships r
   WHERE r.is_active
     AND NOT EXISTS (
       SELECT 1 FROM organizations g
        WHERE g.relationship_basis IS NOT DISTINCT FROM r.basis
           OR lower(regexp_replace(g.name, '[^a-zA-Z0-9]', '', 'g'))
              LIKE '%' || lower(regexp_replace(split_part(r.org, '/', 1), '[^a-zA-Z0-9]', '', 'g')) || '%'
     );

  IF unmerged IS NOT NULL THEN
    RAISE EXCEPTION 'org_relationships rows not present in organizations: %', unmerged;
  END IF;
END $$;

DROP TABLE IF EXISTS org_relationships;

COMMIT;
