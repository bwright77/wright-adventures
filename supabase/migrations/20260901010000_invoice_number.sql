-- =============================================================================
-- MIGRATION: mint invoice numbers from the sequence
-- File: 20260901010000_invoice_number.sql
-- Date: 2026-09-01
--
-- The sequence exists but nothing could reach it: PostgREST exposes tables and
-- functions, not nextval. Without this the calling code would compute a number
-- itself, which means MAX(...)+1 or a client-side counter — both of which race
-- and silently duplicate. An invoice number that appears twice is a real
-- accounting problem, not a cosmetic one.
--
-- Format is WA-YYYY-NNNN, zero-padded, gap-free within the sequence.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  SELECT nextval('invoice_number_seq') INTO n;
  RETURN 'WA-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
END; $$;

GRANT EXECUTE ON FUNCTION next_invoice_number TO authenticated;

COMMIT;
