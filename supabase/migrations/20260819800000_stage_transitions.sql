-- =============================================================================
-- MIGRATION: Stage transition rules and history
-- File: 20260819800000_stage_transitions.sql
-- Date: 2026-08-19
--
-- History is written by a TRIGGER, not by the calling code, so it cannot be
-- bypassed by a direct update — which is the whole point of keeping it. The RPC
-- below exists to carry the extra fields a transition needs (note, lost reason,
-- revisit date) and to make the write atomic; it does NOT write history itself,
-- because then a direct UPDATE would produce none and the RPC would produce two.
--
-- The note travels through a transaction-local setting rather than a column,
-- since it belongs to the transition rather than to the opportunity.
--
-- Requirements are enforced in a BEFORE trigger rather than CHECK constraints:
-- stage lives on opportunities and the supporting fields on partnership_details,
-- and a CHECK cannot span two tables.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Guard: terminal stages are terminal, and some stages require a field.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_partnership_stage_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  d RECORD;
BEGIN
  IF NEW.type_id <> 'partnership' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Reopening a closed opportunity creates a NEW record linked by
  -- previous_opportunity_id. Moving out of a terminal stage would silently
  -- rewrite history — the deal really was won or lost.
  IF OLD.status IN ('partnership_closed_won', 'partnership_closed_lost') THEN
    RAISE EXCEPTION
      'Cannot move out of % — reopen by creating a new opportunity linked via previous_opportunity_id',
      OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO d FROM partnership_details WHERE opportunity_id = NEW.id;

  IF NEW.status = 'partnership_closed_lost'
     AND (d.lost_reason IS NULL OR btrim(d.lost_reason) = '') THEN
    RAISE EXCEPTION 'A lost opportunity requires a reason'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'partnership_nurture' AND d.revisit_on IS NULL THEN
    RAISE EXCEPTION 'Nurture requires a revisit date — otherwise it is just lost with extra steps'
      USING ERRCODE = 'check_violation';
  END IF;

  -- decision_date at approval is deliberately NOT enforced. A champion often
  -- cannot get a board date immediately, and blocking the move would push people
  -- to park deals in proposal, which is worse data than a missing date. The UI
  -- warns instead.

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunities_stage_rules ON opportunities;
CREATE TRIGGER opportunities_stage_rules
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION enforce_partnership_stage_rules();

-- -----------------------------------------------------------------------------
-- History: one row per transition, however the transition was made.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_partnership_stage_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.type_id <> 'partnership' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO partnership_stage_history (opportunity_id, from_stage, to_stage, changed_by, note)
  VALUES (
    NEW.id,
    OLD.status,
    NEW.status,
    auth.uid(),
    -- Set by change_partnership_stage(); empty for a direct update.
    NULLIF(current_setting('app.stage_note', true), '')
  );

  UPDATE partnership_details
     SET stage_entered_at = now(), updated_at = now()
   WHERE opportunity_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunities_stage_history ON opportunities;
CREATE TRIGGER opportunities_stage_history
  AFTER UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION record_partnership_stage_change();

-- -----------------------------------------------------------------------------
-- The transition API. One call, one transaction, so the supporting fields land
-- before the guard trigger reads them.
--
-- SECURITY INVOKER (the default) on purpose: the caller's RLS still applies.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION change_partnership_stage(
  p_opportunity_id UUID,
  p_to_stage       TEXT,
  p_note           TEXT DEFAULT NULL,
  p_lost_reason    TEXT DEFAULT NULL,
  p_revisit_on     DATE DEFAULT NULL,
  p_decision_date  DATE DEFAULT NULL,
  p_decision_body  TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.stage_note', COALESCE(p_note, ''), true);

  -- Supporting fields first: the BEFORE trigger reads them to decide whether the
  -- transition is allowed.
  UPDATE partnership_details
     SET lost_reason    = COALESCE(p_lost_reason,   lost_reason),
         revisit_on     = COALESCE(p_revisit_on,    revisit_on),
         decision_date  = COALESCE(p_decision_date, decision_date),
         decision_body  = COALESCE(p_decision_body, decision_body),
         updated_at     = now()
   WHERE opportunity_id = p_opportunity_id;

  UPDATE opportunities
     SET status = p_to_stage, updated_at = now()
   WHERE id = p_opportunity_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opportunity % not found', p_opportunity_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION change_partnership_stage IS
  'Move a partnership between stages. Writes the supporting fields and the '
  'status in one transaction so the guard trigger sees them. History is written '
  'by the trigger, not here, so a direct UPDATE is recorded too.';

GRANT EXECUTE ON FUNCTION change_partnership_stage TO authenticated;

COMMIT;
