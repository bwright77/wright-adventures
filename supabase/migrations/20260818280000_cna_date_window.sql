-- =============================================================================
-- MIGRATION: Drop the count-based window on the CNA source
-- File: 20260818280000_cna_date_window.sql
-- Date: 2026-08-18
-- ADR: ADR-011
--
-- The seeded URL carried per_page=40. On a board this busy that reached back
-- only five days, and it silently dropped the two best candidates the rubric
-- knows about — the GOBRP Development Director (Independent Contractor, scored
-- 19) and the Climate Democracy communications consultant (Contract, scored 15).
-- Neither was extracted, scored, or rejected. They were never seen. The 40
-- postings that did fit were almost entirely full-time W-2 roles.
--
-- The window is now applied in code by date (`after=<last check>`, paginated,
-- with a 60-day lookback on a first run), so these query params are removed to
-- avoid two competing notions of "how much to fetch".
--
-- The lesson generalises: a count-based cap discards the tail, and on a job
-- board sorted by date the tail is where the contract work has aged to.
-- =============================================================================

BEGIN;

UPDATE discovery_sources
   SET url = 'https://api.coloradononprofits.org/wp-json/wp/v2/careers',
       last_content_hash = NULL,
       last_content_text = NULL,
       last_fetched_at   = NULL
 WHERE label = 'Colorado Nonprofit Association';

COMMIT;
