-- =============================================================================
-- MIGRATION: time entries can be corrected
-- File: 20260902010000_editable_time_entries.sql
-- Date: 2026-09-02
--
-- Entries were insert-or-delete only, which is why the seeded estimates all sit
-- on 1 January — the date was a placeholder nobody could change afterwards.
--
-- Editing exposes two things the insert-only design hid:
--
--   1. The retainer ledger only drew on INSERT, and `time_entry_id` carried no
--      foreign key. Deleting an entry left its debit behind forever, and
--      changing the minutes would have left the ledger describing a row that no
--      longer said that. No orphans exist yet — this is a latent fault being
--      closed before the feature that would trigger it ships.
--
--      The debit is now DERIVED from the entry: the trigger re-derives on every
--      INSERT and UPDATE, and the FK cascades the delete. Balance stays a plain
--      SUM. Corrections are the point here, so the ledger tracks the entry
--      rather than keeping reversal rows nobody asked for; activity_log is
--      where history lives.
--
--   2. Invoiced time must not move. An entry carrying `locked` refuses edits
--      and deletes, and the only way past it is voiding the invoice — which is
--      already the sanctioned correction path, and which clears the lock.
--
-- NOT addressed, and worth a decision: the draw rule ignores `is_estimate`, so
-- a billable estimate added to a retainer would consume committed hours for a
-- number somebody remembered. No estimate sits on a retainer today, so this
-- changes nothing now.
-- =============================================================================

BEGIN;

-- 1. The ledger row belongs to its entry.
DELETE FROM retainer_ledger
 WHERE time_entry_id IS NOT NULL
   AND time_entry_id NOT IN (SELECT id FROM time_entries);

ALTER TABLE retainer_ledger DROP CONSTRAINT IF EXISTS retainer_ledger_time_entry_fk;
ALTER TABLE retainer_ledger ADD CONSTRAINT retainer_ledger_time_entry_fk
  FOREIGN KEY (time_entry_id) REFERENCES time_entries(id) ON DELETE CASCADE;

-- 2. Re-derive the draw whenever the entry changes.
CREATE OR REPLACE FUNCTION draw_retainer_on_time_entry()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE model TEXT;
BEGIN
  -- Cleared and rebuilt rather than patched: the engagement, the minutes and
  -- the billable flag can all move, and each changes what the ledger owes.
  DELETE FROM retainer_ledger WHERE time_entry_id = NEW.id;

  SELECT billing_model INTO model FROM engagements WHERE id = NEW.engagement_id;
  IF model <> 'retainer' OR NOT NEW.billable THEN RETURN NEW; END IF;

  INSERT INTO retainer_ledger (engagement_id, entry_type, hours, time_entry_id, note, created_by)
  VALUES (NEW.engagement_id, 'debit', -(NEW.minutes::numeric / 60), NEW.id,
          NEW.description, NEW.user_id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS time_entries_draw_retainer ON time_entries;
CREATE TRIGGER time_entries_draw_retainer AFTER INSERT OR UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION draw_retainer_on_time_entry();

-- 3. Invoiced time is fixed.
CREATE OR REPLACE FUNCTION guard_locked_time_entry()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked THEN
      RAISE EXCEPTION 'That time is on an issued invoice — void the invoice to release it'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- Still locked after the change means an edit to invoiced time. The unlock
  -- itself is allowed, because that is how void_invoice releases the entry.
  IF OLD.locked AND NEW.locked THEN
    RAISE EXCEPTION 'That time is on an issued invoice — void the invoice to change it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS time_entries_guard_locked ON time_entries;
CREATE TRIGGER time_entries_guard_locked BEFORE UPDATE OR DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION guard_locked_time_entry();

COMMIT;
