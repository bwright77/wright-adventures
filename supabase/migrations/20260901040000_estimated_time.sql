-- =============================================================================
-- MIGRATION: mark backfilled time as estimated
-- File: 20260901040000_estimated_time.sql
-- Date: 2026-09-01
--
-- Hours on the contributed engagements are being backfilled from memory — 40 on
-- BBSP, 50 on Confluence, and so on. They are worth having: without them those
-- engagements read as zero hours, which understates the investment badly.
--
-- But the reason ADR-010 wanted hours on non-billable work in the first place
-- was to replace a hand-estimated FMV with a MEASURED one. Filing estimates as
-- ordinary entries would quietly re-import the guess it set out to remove, and
-- nobody downstream could tell which was which.
--
-- So they are flagged. Contributed value can then be reported as measured,
-- estimated, or both — and as real logging accumulates the estimate can be
-- retired without hunting for which rows were which.
-- =============================================================================

BEGIN;

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS is_estimate BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN time_entries.is_estimate IS
  'True for hours recalled rather than tracked. Keeps a measured contributed '
  'value distinguishable from an estimated one — the whole point of logging '
  'hours on non-billable work.';

CREATE INDEX IF NOT EXISTS time_entries_estimate_idx ON time_entries (engagement_id, is_estimate);

COMMIT;
