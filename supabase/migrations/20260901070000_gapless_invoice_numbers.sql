-- =============================================================================
-- MIGRATION: gapless invoice numbers
-- File: 20260901070000_gapless_invoice_numbers.sql
-- Date: 2026-09-01
--
-- Invoice numbers came from a Postgres SEQUENCE, which was the right instinct
-- against MAX(...)+1 racing, but the wrong mechanism here: nextval does not roll
-- back. A transaction that fails after taking a number leaves a hole, and three
-- appeared within a day — two from voided test invoices and one from a function
-- that errored partway through.
--
-- A gap is not cosmetic in this domain. A ledger that runs 0001, 0004 reads as
-- two missing documents to anyone auditing it, and in several jurisdictions
-- gapless numbering is a requirement rather than a preference.
--
-- So the counter becomes a ROW instead. SELECT ... FOR UPDATE serialises
-- concurrent callers exactly as a sequence would, and because it is ordinary
-- table state it rolls back with its transaction — a failed invoice returns the
-- number rather than burning it.
--
-- Counted per year, so numbering restarts at 0001 each January.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS invoice_counters (
  year        INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read invoice_counters" ON invoice_counters;
CREATE POLICY "read invoice_counters" ON invoice_counters FOR SELECT TO authenticated USING (true);

-- Seed from what has actually been issued, so the next number follows the
-- highest real invoice rather than the high-water mark of the old sequence.
INSERT INTO invoice_counters (year, last_number)
SELECT EXTRACT(YEAR FROM now())::int,
       COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '^WA-\d{4}-', ''), '')::int), 0)
  FROM invoices
 WHERE invoice_number LIKE 'WA-' || to_char(now(), 'YYYY') || '-%'
ON CONFLICT (year) DO UPDATE SET last_number = EXCLUDED.last_number;

CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  y INTEGER := EXTRACT(YEAR FROM now())::int;
  n INTEGER;
BEGIN
  INSERT INTO invoice_counters (year, last_number) VALUES (y, 0)
  ON CONFLICT (year) DO NOTHING;

  -- FOR UPDATE holds the row for the rest of the transaction: a second caller
  -- waits here rather than reading the same number.
  SELECT last_number INTO n FROM invoice_counters WHERE year = y FOR UPDATE;
  n := n + 1;
  UPDATE invoice_counters SET last_number = n WHERE year = y;

  RETURN 'WA-' || y || '-' || lpad(n::text, 4, '0');
END; $$;

GRANT EXECUTE ON FUNCTION next_invoice_number TO authenticated;

DROP SEQUENCE IF EXISTS invoice_number_seq;

COMMIT;
