-- =============================================================================
-- MIGRATION: Ageing thresholds per stage
-- File: 20260822000000_stage_ageing.sql
-- Date: 2026-08-22
--
-- Thresholds live on pipeline_statuses for the same reason the stage list does:
-- hardcoding them in the UI is what let four stage arrays drift out of sync. A
-- new stage should arrive carrying its own expectations.
--
-- APPROVAL gets a deliberately long window. Board calendars are slow and that is
-- not a warning sign — a proposal sitting six weeks waiting on a quarterly board
-- meeting is normal, and colouring it red would train everyone to ignore the
-- colour. Where a decision_date is known the indicator ages off THAT instead:
-- before the meeting you are not late, after it you are waiting on an overdue
-- decision. Same idea for nurture and revisit_on.
--
-- Values are starting points to tune from real data, not measurements.
-- =============================================================================

BEGIN;

ALTER TABLE pipeline_statuses
  ADD COLUMN IF NOT EXISTS expected_days INTEGER,
  ADD COLUMN IF NOT EXISTS amber_days    INTEGER,
  ADD COLUMN IF NOT EXISTS red_days      INTEGER;

COMMENT ON COLUMN pipeline_statuses.expected_days IS
  'Typical time in this stage. NULL means do not age it — terminal stages, and '
  'nurture, which ages off revisit_on instead.';

UPDATE pipeline_statuses SET expected_days = 14, amber_days = 21, red_days = 42 WHERE id = 'partnership_qualifying';
UPDATE pipeline_statuses SET expected_days = 14, amber_days = 21, red_days = 42 WHERE id = 'partnership_discovery';
UPDATE pipeline_statuses SET expected_days = 21, amber_days = 30, red_days = 60 WHERE id = 'partnership_proposal';
UPDATE pipeline_statuses SET expected_days = 21, amber_days = 30, red_days = 60 WHERE id = 'partnership_evaluation';
UPDATE pipeline_statuses SET expected_days = 45, amber_days = 60, red_days = 90 WHERE id = 'partnership_approval';
UPDATE pipeline_statuses SET expected_days = 14, amber_days = 21, red_days = 42 WHERE id = 'partnership_negotiating';

-- Terminal stages and nurture are not aged off stage entry.
UPDATE pipeline_statuses
   SET expected_days = NULL, amber_days = NULL, red_days = NULL
 WHERE id IN ('partnership_closed_won', 'partnership_closed_lost', 'partnership_nurture');

COMMIT;
