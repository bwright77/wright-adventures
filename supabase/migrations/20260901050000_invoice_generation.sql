-- =============================================================================
-- MIGRATION: ADR-010 — generating, sending and voiding invoices
-- File: 20260901050000_invoice_generation.sql
-- Date: 2026-09-01
--
-- Generation lives in the database, not the client, because an invoice is
-- assembled from several writes — header, lines, and the linking of whatever it
-- bills — and a half-written invoice with a consumed number is worse than none.
-- One transaction, or nothing.
--
-- Two generators, because the two billing models invoice from opposite
-- directions:
--
--   RETAINER (CMC): invoiced in ADVANCE from the schedule. The money precedes
--   the work, so this bills the next scheduled period and never looks at time
--   entries at all.
--
--   HOURLY (Shane's CMC engagement): invoiced in ARREARS from the work. This
--   bills unbilled entries and stamps the rate onto each one, because rates
--   change and an issued invoice must not.
--
-- Estimated time is never invoiced. The backfilled hours on the contributed
-- engagements are recalled, not tracked, and billing a client for a number
-- somebody remembered would be indefensible.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Due date from the engagement's payment terms.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invoice_due_date(p_issue DATE, p_terms TEXT)
RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_terms
    WHEN 'due_on_signature' THEN p_issue
    WHEN 'net_15' THEN p_issue + 15
    WHEN 'net_30' THEN p_issue + 30
    WHEN 'net_45' THEN p_issue + 45
    ELSE p_issue + 30
  END;
$$;

-- -----------------------------------------------------------------------------
-- Retainer: bill the next scheduled period.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_retainer_invoice(p_engagement_id UUID)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  eng      RECORD;
  per      RECORD;
  inv_id   UUID;
  inv_num  TEXT;
  issue    DATE := CURRENT_DATE;
BEGIN
  SELECT * INTO eng FROM engagements WHERE id = p_engagement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF eng.billing_model <> 'retainer' THEN
    RAISE EXCEPTION 'Not a retainer engagement — use generate_time_invoice' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO per FROM retainer_periods
   WHERE engagement_id = p_engagement_id AND status = 'scheduled'
   ORDER BY period_number LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Every period on this engagement has already been invoiced' USING ERRCODE = 'check_violation';
  END IF;

  inv_num := next_invoice_number();

  INSERT INTO invoices (engagement_id, invoice_number, issue_date, due_date,
                        period_start, period_end, subtotal, total, status, notes)
  VALUES (p_engagement_id, inv_num, issue,
          invoice_due_date(issue, eng.payment_terms),
          per.period_start, per.period_end, per.fee, per.fee, 'draft',
          'Monthly retainer, invoiced in advance.')
  RETURNING id INTO inv_id;

  INSERT INTO invoice_line_items (invoice_id, line_type, description, quantity, unit_rate, amount, sort_order)
  VALUES (inv_id, 'retainer',
          format('Monthly retainer — %s (%s hours)',
                 to_char(per.period_start, 'FMMonth YYYY'), trim_scale(per.hours_granted)),
          1, per.fee, per.fee, 0);

  UPDATE retainer_periods SET invoice_id = inv_id, status = 'invoiced', updated_at = now()
   WHERE id = per.id;

  RETURN inv_id;
END; $$;

-- -----------------------------------------------------------------------------
-- Hourly: bill the work already done.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_time_invoice(p_engagement_id UUID, p_through DATE DEFAULT CURRENT_DATE)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  eng     RECORD;
  inv_id  UUID;
  inv_num TEXT;
  issue   DATE := CURRENT_DATE;
  rate    NUMERIC(10,2);
  total   NUMERIC(12,2) := 0;
  n_lines INT := 0;
  e       RECORD;
  first_d DATE;
  last_d  DATE;
BEGIN
  SELECT * INTO eng FROM engagements WHERE id = p_engagement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  IF eng.billing_model = 'retainer' THEN
    RAISE EXCEPTION 'Retainers invoice from the schedule — use generate_retainer_invoice' USING ERRCODE = 'check_violation';
  END IF;
  IF eng.billing_model = 'non_billable' THEN
    RAISE EXCEPTION 'This engagement is contributed work and is never invoiced' USING ERRCODE = 'check_violation';
  END IF;

  rate := eng.contract_rate;
  IF rate IS NULL OR rate <= 0 THEN
    RAISE EXCEPTION 'No rate recorded on this engagement — set one before invoicing its hours'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Estimated hours are recalled, not tracked. Never bill them.
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
          first_d, last_d, 0, 0, 'draft',
          'Time billed in arrears.')
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
            round(e.minutes::numeric / 60, 2), rate,
            round((e.minutes::numeric / 60) * rate, 2), n_lines);

    -- The rate is stamped onto the entry: rates change, issued invoices do not.
    UPDATE time_entries
       SET invoice_id = inv_id, rate_applied = rate, locked = true, updated_at = now()
     WHERE id = e.id;

    total := total + round((e.minutes::numeric / 60) * rate, 2);
    n_lines := n_lines + 1;
  END LOOP;

  UPDATE invoices SET subtotal = total, total = total, updated_at = now() WHERE id = inv_id;
  RETURN inv_id;
END; $$;

-- -----------------------------------------------------------------------------
-- Void. Corrections are made by voiding and reissuing, never by editing a sent
-- invoice — so whatever it billed has to become billable again.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION void_invoice(p_invoice_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE inv RECORD;
BEGIN
  SELECT * INTO inv FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF inv.status = 'paid' THEN
    RAISE EXCEPTION 'Invoice % is paid — record a refund rather than voiding it', inv.invoice_number
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE time_entries SET invoice_id = NULL, rate_applied = NULL, locked = false, updated_at = now()
   WHERE invoice_id = p_invoice_id;

  UPDATE retainer_periods SET invoice_id = NULL, status = 'scheduled', updated_at = now()
   WHERE invoice_id = p_invoice_id;

  UPDATE invoices
     SET status = 'void',
         notes = COALESCE(notes, '') || CASE WHEN p_reason IS NULL THEN '' ELSE E'\nVoided: ' || p_reason END,
         updated_at = now()
   WHERE id = p_invoice_id;
END; $$;

GRANT EXECUTE ON FUNCTION generate_retainer_invoice, generate_time_invoice, void_invoice, invoice_due_date TO authenticated;

COMMIT;
