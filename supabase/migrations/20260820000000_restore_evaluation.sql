-- =============================================================================
-- MIGRATION: Restore the Evaluation stage
-- File: 20260820000000_restore_evaluation.sql
-- Date: 2026-08-20
--
-- Reverses 20260819950000, which dropped it. That migration read "evaluation" as
-- US triaging a lead — which is the Leads page's job — and removed the stage on
-- that basis. The original definition was the opposite and is the one that
-- stands: THEY are evaluating US. Interviews, reference checks, competitive
-- comparison.
--
-- It belongs under the Pursuing tab alongside the other active stages, not as a
-- tab of its own. The distinction from Approval remains what it always was: in
-- evaluation there is work owed — references to supply, questions to answer. In
-- approval there is nothing to do but wait for a meeting.
--
-- The closed-lost -> nurture transition that migration also introduced is
-- retained; only the stage removal is reversed.
-- =============================================================================

BEGIN;

INSERT INTO pipeline_statuses (id, type_id, label, sort_order, is_active)
VALUES ('partnership_evaluation', 'partnership', 'Evaluation', 5, true)
ON CONFLICT (id) DO UPDATE SET sort_order = 5, label = 'Evaluation', is_active = true;

UPDATE pipeline_statuses SET sort_order = 6  WHERE id = 'partnership_approval';
UPDATE pipeline_statuses SET sort_order = 7  WHERE id = 'partnership_negotiating';
UPDATE pipeline_statuses SET sort_order = 8  WHERE id = 'partnership_closed_won';
UPDATE pipeline_statuses SET sort_order = 9  WHERE id = 'partnership_closed_lost';
UPDATE pipeline_statuses SET sort_order = 10 WHERE id = 'partnership_nurture';

-- Stage tasks: what is owed while they assess us.
INSERT INTO partnership_stage_tasks (stage_id, title, assignee_role, days_after_entry, sort_order, date_anchor) VALUES
  ('partnership_evaluation', 'Confirm what they still need from us',             'owner', 0, 1, 'stage_entry'),
  ('partnership_evaluation', 'Line up references and warn them a call is coming','owner', 1, 2, 'stage_entry'),
  ('partnership_evaluation', 'Prepare for interview or panel',                   'owner', 3, 3, 'stage_entry'),
  ('partnership_evaluation', 'Ask who else they are considering, and why',       'owner', 3, 4, 'stage_entry')
ON CONFLICT DO NOTHING;

COMMIT;
