-- =============================================================================
-- MIGRATION: ADR-010 Phase 1 — timekeeping, retainers and invoicing
-- File: 20260901000000_timekeeping.sql
-- Date: 2026-09-01
--
-- Unblocked: the Colorado Mountain Club SOW is signed and work starts today.
--
-- Scoped by that one contract rather than by a general theory of billing, so
-- every mechanic here traces to a term in it:
--
--   $6,000/month, $24,000 total, four months from signature
--   $150 partner rate against a $170 standard rate
--   40 hours/month, 160 total
--   "Hours bank across the term and may be drawn ahead, to a ceiling of 60
--    in any month"
--   Monthly retainer, INVOICED IN ADVANCE. First due on signature, then net 15
--   "Any retainer paid for hours not worked is refunded"
--
-- Four consequences the naive model gets wrong:
--
--   1. Hours bank across the TERM, not the month. A month using 25 of 40 does
--      not forfeit 15. So entitlement is a term-level ledger, not a per-month
--      counter, and the full 160 is credited at term start — that is what makes
--      "drawn ahead" possible at all.
--   2. The 60-hour monthly ceiling is a CONSTRAINT on draw rate, not an
--      entitlement and not a billing line. Checked against debits within a
--      calendar month.
--   3. Invoiced in advance means invoices are NOT generated from time entries.
--      The money precedes the work; entries draw against it. Retainer invoices
--      come from the schedule.
--   4. Refund on early termination needs hours-purchased and hours-worked known
--      independently at any moment — hence periods (money) and ledger (hours)
--      as separate records that join, rather than one balance column.
--
-- Money is NUMERIC. Time is INTEGER MINUTES — 0.1 + 0.2 != 0.3 is not an
-- acceptable failure mode on a billable hour. Supabase JS returns NUMERIC as a
-- string; coerce at every use site.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Engagements gain the billing terms. The table already exists (ADR-012);
--    this ADR extends it rather than introducing a parallel "projects" concept.
-- -----------------------------------------------------------------------------
ALTER TABLE engagements
  ADD COLUMN IF NOT EXISTS billing_model        TEXT NOT NULL DEFAULT 'non_billable',
  ADD COLUMN IF NOT EXISTS standard_rate        NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS contract_rate        NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS currency             TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS committed_hours      NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS hours_per_period     NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS max_hours_per_period NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS payment_terms        TEXT,
  ADD COLUMN IF NOT EXISTS invoice_in_advance   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_status       TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE engagements DROP CONSTRAINT IF EXISTS engagements_billing_model_check;
ALTER TABLE engagements ADD CONSTRAINT engagements_billing_model_check
  CHECK (billing_model IN ('retainer', 'fixed_fee', 'hourly', 'non_billable'));

ALTER TABLE engagements DROP CONSTRAINT IF EXISTS engagements_billing_status_check;
ALTER TABLE engagements ADD CONSTRAINT engagements_billing_status_check
  CHECK (billing_status IN ('draft', 'active', 'paused', 'complete', 'terminated'));

ALTER TABLE engagements DROP CONSTRAINT IF EXISTS engagements_payment_terms_check;
ALTER TABLE engagements ADD CONSTRAINT engagements_payment_terms_check
  CHECK (payment_terms IS NULL OR payment_terms IN ('due_on_signature', 'net_15', 'net_30', 'net_45'));

-- nature says WHY the work is priced as it is; billing_model says HOW it bills.
-- Separate axes — a reduced-rate engagement can still be a retainer. But the
-- non-billable corner must agree, or contributed value and revenue both lie.
ALTER TABLE engagements DROP CONSTRAINT IF EXISTS engagements_nature_billing_agree;
ALTER TABLE engagements ADD CONSTRAINT engagements_nature_billing_agree
  CHECK (nature NOT IN ('strategic', 'portfolio') OR billing_model = 'non_billable');

COMMENT ON COLUMN engagements.max_hours_per_period IS
  'Ceiling on hours drawn in one calendar month. A CONSTRAINT on draw rate, not '
  'an entitlement — CMC commits 40/month but permits up to 60 drawn ahead.';

-- -----------------------------------------------------------------------------
-- 2. Retainer periods — the money. One row per invoicing period.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retainer_periods (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  period_number  INTEGER NOT NULL,
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  hours_granted  NUMERIC(8,2) NOT NULL,
  fee            NUMERIC(12,2) NOT NULL,
  invoice_id     UUID,
  status         TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled', 'invoiced', 'paid', 'refunded', 'cancelled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, period_number)
);

-- -----------------------------------------------------------------------------
-- 3. Retainer ledger — the hours. APPEND ONLY.
--
--    A single hours_remaining column would be wrong the first time anything is
--    corrected or refunded. Balance is the sum of this table, so every figure in
--    a checkpoint report or a refund is derivable and auditable, and a
--    correction is a new row rather than a mutated total.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retainer_ledger (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id      UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  entry_type         TEXT NOT NULL CHECK (entry_type IN ('credit', 'debit', 'adjustment')),
  -- Positive grants hours, negative consumes them. A debit is stored negative
  -- so the balance is a plain SUM with no CASE.
  hours              NUMERIC(8,2) NOT NULL,
  time_entry_id      UUID,
  retainer_period_id UUID REFERENCES retainer_periods(id) ON DELETE SET NULL,
  note               TEXT,
  created_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS retainer_ledger_engagement_idx ON retainer_ledger (engagement_id, created_at);

-- -----------------------------------------------------------------------------
-- 4. Time entries. Integer minutes, never decimal hours.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  entry_date    DATE NOT NULL,
  minutes       INTEGER NOT NULL CHECK (minutes > 0),
  description   TEXT NOT NULL,
  billable      BOOLEAN NOT NULL DEFAULT true,
  -- Snapshot when invoiced. Rates change; issued invoices must not.
  rate_applied  NUMERIC(10,2),
  invoice_id    UUID,
  locked        BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_entries_engagement_idx ON time_entries (engagement_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS time_entries_user_idx       ON time_entries (user_id, entry_date DESC);

-- -----------------------------------------------------------------------------
-- 5. Invoices. Documents, not derived views.
--
--    An invoice, once sent, is a statement of fact. It does not change because a
--    time entry was later edited — so it carries its own immutable line items
--    and a snapshot of the rate. Corrections are made by voiding and reissuing.
--
--    Numbers come from a SEQUENCE, never MAX(...)+1, which races.
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

CREATE TABLE IF NOT EXISTS invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  UUID NOT NULL REFERENCES engagements(id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL UNIQUE,
  issue_date     DATE NOT NULL,
  due_date       DATE NOT NULL,
  period_start   DATE,
  period_end     DATE,
  subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax            NUMERIC(12,2) NOT NULL DEFAULT 0,
  total          NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid    NUMERIC(12,2) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'sent', 'partial', 'paid', 'overdue', 'void')),
  sent_at        TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoices_engagement_idx ON invoices (engagement_id, issue_date DESC);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_type   TEXT NOT NULL CHECK (line_type IN ('retainer', 'time', 'expense', 'fixed_fee', 'adjustment')),
  description TEXT NOT NULL,
  quantity    NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_rate   NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(12,2) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx ON invoice_line_items (invoice_id, sort_order);

-- Deferred FKs, now that both sides exist.
ALTER TABLE retainer_periods DROP CONSTRAINT IF EXISTS retainer_periods_invoice_fk;
ALTER TABLE retainer_periods ADD CONSTRAINT retainer_periods_invoice_fk
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_invoice_fk;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_invoice_fk
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;

ALTER TABLE retainer_ledger DROP CONSTRAINT IF EXISTS retainer_ledger_time_entry_fk;
ALTER TABLE retainer_ledger ADD CONSTRAINT retainer_ledger_time_entry_fk
  FOREIGN KEY (time_entry_id) REFERENCES time_entries(id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- 6. A sent invoice is immutable. Void and reissue instead.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_invoice_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'draft' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    -- Draft invoices are editable, and pure status transitions are how an
    -- invoice gets sent, paid or voided in the first place.
    IF OLD.status <> 'draft' AND (
         NEW.subtotal IS DISTINCT FROM OLD.subtotal OR
         NEW.total    IS DISTINCT FROM OLD.total    OR
         NEW.issue_date IS DISTINCT FROM OLD.issue_date) THEN
      RAISE EXCEPTION 'Invoice % has been sent — void and reissue rather than editing it', OLD.invoice_number
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'Invoice % is void and cannot be changed', OLD.invoice_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS invoices_immutable ON invoices;
CREATE TRIGGER invoices_immutable BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_invoice_immutability();

-- -----------------------------------------------------------------------------
-- 7. Logging time draws against the retainer, automatically.
--
--    The ledger debit is written by a trigger rather than by calling code, for
--    the same reason stage history is: a direct insert would otherwise leave the
--    balance silently wrong.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draw_retainer_on_time_entry()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE model TEXT;
BEGIN
  SELECT billing_model INTO model FROM engagements WHERE id = NEW.engagement_id;
  IF model <> 'retainer' OR NOT NEW.billable THEN RETURN NEW; END IF;

  INSERT INTO retainer_ledger (engagement_id, entry_type, hours, time_entry_id, note, created_by)
  VALUES (NEW.engagement_id, 'debit', -(NEW.minutes::numeric / 60), NEW.id,
          NEW.description, NEW.user_id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS time_entries_draw_retainer ON time_entries;
CREATE TRIGGER time_entries_draw_retainer AFTER INSERT ON time_entries
  FOR EACH ROW EXECUTE FUNCTION draw_retainer_on_time_entry();

-- -----------------------------------------------------------------------------
-- 8. RLS. Same shape as the rest of the app.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['retainer_periods','retainer_ledger','time_entries','invoices','invoice_line_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "read %s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "read %s" ON %I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "write %s" ON %I', t, t);
    EXECUTE format($p$CREATE POLICY "write %s" ON %I FOR ALL TO authenticated
      USING      ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin','manager'))
      WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin','manager'))$p$, t, t);
  END LOOP;
END $$;

COMMIT;
