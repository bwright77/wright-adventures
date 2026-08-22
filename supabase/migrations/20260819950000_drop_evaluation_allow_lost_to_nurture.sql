-- =============================================================================
-- MIGRATION: Drop the Evaluation stage; allow closed-lost to move to nurture
-- File: 20260819950000_drop_evaluation_allow_lost_to_nurture.sql
-- Date: 2026-08-19
--
-- 1. EVALUATION removed from the partnership pipeline.
--
--    It was added as "the prospect is actively assessing us" — interviews,
--    reference checks, competitive comparison. In practice the word reads as US
--    evaluating THEM, which is lead triage, and that already has a home: the
--    Leads page, where a discovered lead is either pursued or declined.
--
--    Keeping a seventh active column on a board a two-person firm maintains, for
--    a distinction that has to be explained every time, is not worth it. If the
--    "they are assessing us" state proves real on an RFP with a panel, it is one
--    INSERT to bring back.
--
-- 2. CLOSED-LOST may now move to NURTURE.
--
--    The original rule made both terminal stages absolute: reopening creates a
--    new record. That is right for reopening — claiming a lost deal is live
--    again would rewrite history. But moving a lost opportunity to nurture is
--    not reopening it. The deal stayed lost; the RELATIONSHIP continues. "We did
--    not win that scope, but we want to keep talking about how we could work
--    together" is a normal and valuable outcome, and it was blocked.
--
--    Closed-won stays absolute. Won work continues through delivery_status,
--    which already models it.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Remove the stage. Nothing is sitting in it, but move defensively first so
--    this cannot strand a row if it is ever re-run against different data.
-- -----------------------------------------------------------------------------
UPDATE opportunities
   SET status = 'partnership_proposal'
 WHERE status = 'partnership_evaluation';

DELETE FROM partnership_stage_tasks WHERE stage_id = 'partnership_evaluation';
DELETE FROM pipeline_statuses       WHERE id       = 'partnership_evaluation';

-- Close the gap left in the ordering.
UPDATE pipeline_statuses SET sort_order = 5 WHERE id = 'partnership_approval';
UPDATE pipeline_statuses SET sort_order = 6 WHERE id = 'partnership_negotiating';
UPDATE pipeline_statuses SET sort_order = 7 WHERE id = 'partnership_closed_won';
UPDATE pipeline_statuses SET sort_order = 8 WHERE id = 'partnership_closed_lost';
UPDATE pipeline_statuses SET sort_order = 9 WHERE id = 'partnership_nurture';

-- -----------------------------------------------------------------------------
-- 2. Allow the one transition out of a terminal stage that is not a reopening.
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

  IF OLD.status IN ('partnership_closed_won', 'partnership_closed_lost') THEN
    -- Lost -> nurture is not a reopening. The deal stayed lost; the
    -- relationship continues. Everything else out of a terminal stage would
    -- rewrite what actually happened, so reopen by creating a new opportunity
    -- linked via previous_opportunity_id.
    IF NOT (OLD.status = 'partnership_closed_lost' AND NEW.status = 'partnership_nurture') THEN
      RAISE EXCEPTION
        'Cannot move from % to % — reopen by creating a new opportunity linked via previous_opportunity_id',
        OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
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

  RETURN NEW;
END;
$$;

COMMIT;
