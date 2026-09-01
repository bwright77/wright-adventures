-- =============================================================================
-- MIGRATION: fix an ambiguous column reference in generate_time_invoice
-- File: 20260901060000_fix_ambiguous_total.sql
-- Date: 2026-09-01
--
-- The function declared a variable called `total` and then wrote
--   UPDATE invoices SET subtotal = total, total = total
-- where `total` is also a column on that table. Postgres cannot tell which is
-- meant and raises "column reference total is ambiguous" — so arrears invoicing
-- failed at the last step, after the number had been consumed and the lines
-- written. Prefixed the locals instead.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION generate_time_invoice(p_engagement_id UUID, p_through DATE DEFAULT CURRENT_DATE)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  eng       RECORD;
  inv_id    UUID;
  inv_num   TEXT;
  issue     DATE := CURRENT_DATE;
  v_rate    NUMERIC(10,2);
  v_total   NUMERIC(12,2) := 0;
  v_lines   INT := 0;
  e         RECORD;
  first_d   DATE;
  last_d    DATE;
BEGIN
  SELECT * INTO eng FROM engagements WHERE id = p_engagement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF eng.billing_model = 'retainer' THEN
    RAISE EXCEPTION 'Retainers invoice from the schedule — use generate_retainer_invoice' USING ERRCODE = 'check_violation';
  END IF;
  IF eng.billing_model = 'non_billable' THEN
    RAISE EXCEPTION 'This engagement is contributed work and is never invoiced' USING ERRCODE = 'check_violation';
  END IF;

  v_rate := eng.contract_rate;
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RAISE EXCEPTION 'No rate recorded on this engagement — set one before invoicing its hours'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT min(entry_date), max(entry_date) INTO first_d, last_d
    FROM time_entries
   WHERE engagement_id = p_engagement_id AND billable AND NOT is_estimate
     AND invoice_id IS NULL AND entry_date <= p_through;

  IF first_d IS NULL THEN
    RAISE EXCEPTION 'No unbilled time on this engagement' USING ERRCODE = 'check_violation';
  END IF;

  inv_num := next_invoice_number();

  INSERT INTO invoices (engagement_id, invoice_number, issue_date, due_date,
                        period_start, period_end, subtotal, total, status, notes)
  VALUES (p_engagement_id, inv_num, issue,
          invoice_due_date(issue, eng.payment_terms),
          first_d, last_d, 0, 0, 'draft', 'Time billed in arrears.')
  RETURNING id INTO inv_id;

  FOR e IN
    SELECT * FROM time_entries
     WHERE engagement_id = p_engagement_id AND billable AND NOT is_estimate
       AND invoice_id IS NULL AND entry_date <= p_through
     ORDER BY entry_date, created_at
  LOOP
    INSERT INTO invoice_line_items (invoice_id, line_type, description, quantity, unit_rate, amount, sort_order)
    VALUES (inv_id, 'time',
            format('%s — %s', to_char(e.entry_date, 'DD Mon'),
                   COALESCE(NULLIF(btrim(e.description), ''), 'Professional services')),
            round(e.minutes::numeric / 60, 2), v_rate,
            round((e.minutes::numeric / 60) * v_rate, 2), v_lines);

    UPDATE time_entries
       SET invoice_id = inv_id, rate_applied = v_rate, locked = true, updated_at = now()
     WHERE id = e.id;

    v_total := v_total + round((e.minutes::numeric / 60) * v_rate, 2);
    v_lines := v_lines + 1;
  END LOOP;

  UPDATE invoices SET subtotal = v_total, total = v_total, updated_at = now() WHERE id = inv_id;
  RETURN inv_id;
END; $$;

COMMIT;
