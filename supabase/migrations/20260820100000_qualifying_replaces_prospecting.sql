-- =============================================================================
-- MIGRATION: The pipeline starts when there is something to apply for
-- File: 20260820100000_qualifying_replaces_prospecting.sql
-- Date: 2026-08-20
--
-- Identified and Contacted described the pre-opportunity phase: an organization
-- worth knowing, with nothing yet to pursue. Nurture now models that, and better
-- — it carries a revisit date, so a relationship cannot quietly go cold.
--
-- So the pipeline begins at QUALIFYING, which asks a different question: there
-- IS an opportunity, is it worth pursuing? Everything before that is Nurture.
--
-- The four stage tasks on the removed stages were relationship work — research
-- the organization, connect, offer the listen-and-learn — so they move to
-- Nurture rather than being deleted. Qualifying gets tasks that match its actual
-- question, including scoring against the fit rubric that already exists.
-- =============================================================================

BEGIN;

INSERT INTO pipeline_statuses (id, type_id, label, sort_order, is_active)
VALUES ('partnership_qualifying', 'partnership', 'Qualifying', 1, true)
ON CONFLICT (id) DO UPDATE SET sort_order = 1, label = 'Qualifying', is_active = true;

-- Defensive: nothing is in these stages today, but do not strand a row.
UPDATE opportunities SET status = 'partnership_qualifying'
 WHERE status IN ('partnership_identified', 'partnership_contacted');

-- Relationship work belongs to the relationship stage.
UPDATE partnership_stage_tasks
   SET stage_id = 'partnership_nurture', date_anchor = 'stage_entry'
 WHERE stage_id IN ('partnership_identified', 'partnership_contacted');

DELETE FROM pipeline_statuses WHERE id IN ('partnership_identified', 'partnership_contacted');

-- Qualifying asks whether an opportunity is worth pursuing.
INSERT INTO partnership_stage_tasks (stage_id, title, assignee_role, days_after_entry, sort_order, date_anchor) VALUES
  ('partnership_qualifying', 'Read the solicitation — confirm scope, deadline and eligibility', 'owner', 0, 1, 'stage_entry'),
  ('partnership_qualifying', 'Score against the fit rubric',                                    'owner', 1, 2, 'stage_entry'),
  ('partnership_qualifying', 'Check capacity — what else lands in the same month',              'owner', 1, 3, 'stage_entry'),
  ('partnership_qualifying', 'Go / no-go decision',                                             'owner', 3, 4, 'stage_entry')
ON CONFLICT DO NOTHING;

UPDATE pipeline_statuses SET sort_order = 2 WHERE id = 'partnership_discovery';
UPDATE pipeline_statuses SET sort_order = 3 WHERE id = 'partnership_proposal';
UPDATE pipeline_statuses SET sort_order = 4 WHERE id = 'partnership_evaluation';
UPDATE pipeline_statuses SET sort_order = 5 WHERE id = 'partnership_approval';
UPDATE pipeline_statuses SET sort_order = 6 WHERE id = 'partnership_negotiating';
UPDATE pipeline_statuses SET sort_order = 7 WHERE id = 'partnership_closed_won';
UPDATE pipeline_statuses SET sort_order = 8 WHERE id = 'partnership_closed_lost';
UPDATE pipeline_statuses SET sort_order = 9 WHERE id = 'partnership_nurture';

COMMIT;
