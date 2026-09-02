-- =============================================================================
-- MIGRATION: time entry descriptions are required again
-- File: 20260902000000_required_description.sql
-- Date: 2026-09-02
--
-- Reverses 20260901030000_optional_description.sql.
--
-- That migration argued a description does not drive billing, because CMC's
-- retainer invoice is a flat monthly fee and time entries never appear on it.
-- True for CMC, and wrong as a general rule: hourly engagements bill entries
-- as line items, so on those the description IS what the client reads. The
-- checkpoint reviews want it too.
--
-- NOT NULL alone would not do it — the form sends btrim(description), and an
-- empty string satisfies NOT NULL. The CHECK is the part that bites.
--
-- All 6 existing rows already carry one, so nothing needs backfilling.
-- =============================================================================

BEGIN;

ALTER TABLE time_entries ALTER COLUMN description SET NOT NULL;

ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_description_present;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_description_present
  CHECK (btrim(description) <> '');

COMMENT ON COLUMN time_entries.description IS
  'Required, and non-blank. On hourly engagements this becomes the invoice line '
  'the client reads; on retainers it carries the checkpoint review.';

COMMENT ON COLUMN time_entries.user_id IS
  'Who did the work — not who typed it. Two people on the same meeting are two '
  'entries, so the retainer draws for both. NULL on the seeded historical '
  'estimates, which are firm totals nobody can now attribute.';

COMMIT;
