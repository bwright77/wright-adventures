-- =============================================================================
-- MIGRATION: time entry descriptions are optional
-- File: 20260901030000_optional_description.sql
-- Date: 2026-09-01
--
-- CMC is a retainer invoiced in advance: the invoice line is the flat monthly
-- fee, and time entries never appear on it. So a description does not drive
-- billing, and requiring one only adds friction at the moment of logging.
-- Unlogged hours are a worse problem than undescribed ones.
--
-- The one thing that does want it is the contractual checkpoint review at the
-- end of Months 1 and 2 — "hours used, deliverables completed" — but that is a
-- report to assemble, not a reason to block an entry.
-- =============================================================================

BEGIN;

ALTER TABLE time_entries ALTER COLUMN description DROP NOT NULL;

COMMENT ON COLUMN time_entries.description IS
  'Optional. Does not reach a retainer invoice — the line item is the flat fee. '
  'Useful for the Month 1 and 2 checkpoint reviews.';

COMMIT;
