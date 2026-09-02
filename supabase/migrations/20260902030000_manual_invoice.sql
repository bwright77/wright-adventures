-- =============================================================================
-- MIGRATION: invoices you write yourself
-- File: 20260902030000_manual_invoice.sql
-- Date: 2026-09-02
--
-- The two existing generators both bill something the database already holds: a
-- retainer bills a scheduled period, hourly bills unbilled entries. Neither can
-- bill a flat amount that is neither — an annual hosting fee, a deposit, a
-- fixed-scope piece of work — so there was no way to raise one at all.
--
-- Same shape as the others: one transaction, a number from
-- next_invoice_number(), a due date from the engagement's terms. It differs
-- only in taking the line from the caller rather than deriving it.
--
-- non_billable is still refused. An engagement marked contributed work saying
-- it is never invoiced, and then carrying an invoice, is a record that
-- contradicts itself — the fix is to model the billable part as its own
-- engagement, which is what organization_id already supports.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION create_manual_invoice(
  p_engagement_id UUID,
  p_description   TEXT,
  p_amount        NUMERIC,
  p_issue_date    DATE DEFAULT CURRENT_DATE,
  p_period_start  DATE DEFAULT NULL,
  p_period_end    DATE DEFAULT NULL,
  p_notes         TEXT DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  eng     RECORD;
  v_id    UUID;
  v_num   TEXT;
  v_desc  TEXT := btrim(coalesce(p_description, ''));
BEGIN
  SELECT * INTO eng FROM engagements WHERE id = p_engagement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found'; END IF;

  IF eng.billing_model = 'non_billable' THEN
    RAISE EXCEPTION 'This engagement is contributed work and is never invoiced — model the billable part as its own engagement'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_desc = '' THEN
    RAISE EXCEPTION 'An invoice line needs a description — it is what the client reads'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero' USING ERRCODE = 'check_violation';
  END IF;

  IF (p_period_start IS NULL) <> (p_period_end IS NULL) THEN
    RAISE EXCEPTION 'Give both ends of the service period, or neither'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'The service period ends before it starts' USING ERRCODE = 'check_violation';
  END IF;

  v_num := next_invoice_number();

  INSERT INTO invoices (engagement_id, invoice_number, issue_date, due_date,
                        period_start, period_end, subtotal, total, status, notes)
  VALUES (p_engagement_id, v_num, p_issue_date,
          invoice_due_date(p_issue_date, eng.payment_terms),
          p_period_start, p_period_end, p_amount, p_amount, 'draft', p_notes)
  RETURNING id INTO v_id;

  INSERT INTO invoice_line_items (invoice_id, line_type, description, quantity, unit_rate, amount, sort_order)
  VALUES (v_id, 'fixed_fee', v_desc, 1, p_amount, p_amount, 0);

  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION create_manual_invoice TO authenticated;

COMMIT;
