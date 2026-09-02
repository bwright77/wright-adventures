-- =============================================================================
-- MIGRATION: a task does not have to belong to a pursuit
-- File: 20260902020000_standalone_tasks.sql
-- Date: 2026-09-02
--
-- tasks.opportunity_id was NOT NULL, which made sense when tasks only ever came
-- from a stage template. Adding one from My Tasks makes the constraint bite:
-- "file the periodic report" is a real task and is not a pursuit, and forcing a
-- choice would have every such task hanging off whichever opportunity happened
-- to be open.
--
-- Nothing reads the column expecting a value — all five call sites filter BY it
-- (OpportunityDetail, TaskPanel, CloseLostDialog, Dashboard, MyTasks), and a
-- filtered query simply will not match a standalone task, which is correct.
-- =============================================================================

BEGIN;

ALTER TABLE tasks ALTER COLUMN opportunity_id DROP NOT NULL;

COMMENT ON COLUMN tasks.opportunity_id IS
  'The pursuit this task belongs to, or NULL for standing work that is not tied '
  'to one. Views scoped to an opportunity filter on it and will not show these.';

COMMIT;
