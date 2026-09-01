-- =============================================================================
-- MIGRATION: date-based invoice numbers
-- File: 20260901080000_dated_invoice_numbers.sql
-- Date: 2026-09-01
--
-- WA-2026-09-01 rather than WA-2026-0001.
--
-- A counter has to be defended: it can gap when a transaction rolls back, it
-- has to be serialised against concurrent callers, and it needs a row of state
-- that must not drift from the invoices themselves. All of that machinery
-- exists to answer "which number is next", which is a question a date already
-- answers — and the number then tells you when it was raised without a lookup.
--
-- Same-day invoices get a suffix: WA-2026-09-01, then WA-2026-09-01-2. The loop
-- checks for the number it is about to use, and the UNIQUE constraint on
-- invoice_number is the backstop if two callers race between the check and the
-- insert.
--
-- Replaces the counter table added an hour ago, which is deleted rather than
-- left as a table nothing reads.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  base      TEXT := 'WA-' || to_char(now(), 'YYYY-MM-DD');
  candidate TEXT := base;
  n         INTEGER := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM invoices WHERE invoice_number = candidate) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  RETURN candidate;
END; $$;

GRANT EXECUTE ON FUNCTION next_invoice_number TO authenticated;

-- The one existing invoice is a draft that has never been sent, so renumbering
-- it changes nothing anybody has seen and keeps the ledger in one scheme.
UPDATE invoices
   SET invoice_number = 'WA-' || to_char(issue_date, 'YYYY-MM-DD'), updated_at = now()
 WHERE invoice_number = 'WA-2026-0001' AND status = 'draft';

DROP TABLE IF EXISTS invoice_counters;

COMMIT;
