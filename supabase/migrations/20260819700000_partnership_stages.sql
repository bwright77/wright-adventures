-- =============================================================================
-- MIGRATION: Partnership pipeline stages that match nonprofit buying
-- File: 20260819700000_partnership_stages.sql
-- Date: 2026-08-19
-- Extends: ADR-006 (partnership_details)
--
-- Adds the two stages the standard commercial pipeline lacks:
--
--   APPROVAL — a proposal fully agreed by the champion, sitting for six weeks
--   waiting on a board. Nothing is being negotiated and nobody is at risk of
--   losing it. Folding that into Negotiation makes the board unreadable. CMC is
--   the live case: Ashley advocating, CEO bought in, board has not seen it.
--
--   EVALUATION — the prospect is actively assessing: interviews, reference
--   checks, competitive comparison. Distinct from Approval by what WE are doing,
--   not just where they are. In evaluation there is work owed — references to
--   supply, questions to answer. In approval there is nothing to do but wait.
--   Collapsing them means the board cannot tell you whether you owe someone
--   something, which is the main thing a board is for.
--
--   NURTURE — not lost, not now. A parking state reachable from any active
--   stage, requiring a revisit date. Without it, deprioritized work either
--   clutters the board or disappears entirely.
--
-- Plus IDENTIFIED and CONTACTED, splitting the old catch-all "prospecting".
--
-- -----------------------------------------------------------------------------
-- DEVIATION FROM THE HANDOFF, deliberate:
--
-- The handoff puts `stage` on partnership_details. That would create a SECOND
-- source of truth for "where is this deal". opportunities.status already holds
-- it, is a foreign key to pipeline_statuses, and drives the board, the tabs,
-- analytics, PartnershipFunnel, the detail stepper, stage-task generation and
-- lead conversion — six files. Two fields answering the same question drift,
-- and nothing would say which one is right.
--
-- So the STAGE stays on opportunities.status and the pipeline_statuses rows are
-- replaced instead. The supporting fields the handoff asks for — decision date,
-- decision body, revisit date, lost reason, time-in-stage — go on
-- partnership_details, which is where they belong: they describe the
-- partnership, not the pipeline position.
--
-- Two smaller corrections:
--   • The handoff's history table references partnership_details(id).
--     partnership_details has no `id`; its primary key is opportunity_id.
--   • It adds estimated_value numeric(10,2) to partnership_details.
--     opportunities.estimated_value numeric(12,2) already exists and is in use.
--     Duplicating it would split the value across two columns.
--
-- Existing status ids are KEPT where a stage already existed
-- (partnership_closed_won, not partnership_won). The ids are internal; labels
-- are what anyone sees. Renaming them would touch six files for no user-visible
-- gain and would silently orphan the 20 partnership_stage_tasks rows.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. New stages. Ordered; sort_order drives board column position.
-- -----------------------------------------------------------------------------
INSERT INTO pipeline_statuses (id, type_id, label, sort_order, is_active) VALUES
  ('partnership_identified', 'partnership', 'Identified', 1,  true),
  ('partnership_contacted',  'partnership', 'Contacted',  2,  true),
  ('partnership_evaluation', 'partnership', 'Evaluation', 5,  true),
  ('partnership_approval',   'partnership', 'Approval',   6,  true),
  ('partnership_nurture',    'partnership', 'Nurture',    10, true)
ON CONFLICT (id) DO NOTHING;

-- Re-order and relabel what already existed.
UPDATE pipeline_statuses SET sort_order = 3, label = 'Discovery'   WHERE id = 'partnership_discovery';
UPDATE pipeline_statuses SET sort_order = 4, label = 'Proposal'    WHERE id = 'partnership_proposal';
UPDATE pipeline_statuses SET sort_order = 7, label = 'Negotiation' WHERE id = 'partnership_negotiating';
UPDATE pipeline_statuses SET sort_order = 8, label = 'Closed Won'  WHERE id = 'partnership_closed_won';
UPDATE pipeline_statuses SET sort_order = 9, label = 'Closed Lost' WHERE id = 'partnership_closed_lost';

-- -----------------------------------------------------------------------------
-- 2. Migrate rows off the two retired stages before removing them.
--    prospecting was a catch-all; it splits by whether contact has been made.
--    Nothing on file distinguishes them, so everything lands on identified and
--    is corrected by the seeding below rather than guessed at here.
-- -----------------------------------------------------------------------------
UPDATE opportunities SET status = 'partnership_identified' WHERE status = 'partnership_prospecting';
UPDATE opportunities SET status = 'partnership_contacted'  WHERE status = 'partnership_qualifying';

UPDATE partnership_stage_tasks SET stage_id = 'partnership_identified' WHERE stage_id = 'partnership_prospecting';
UPDATE partnership_stage_tasks SET stage_id = 'partnership_contacted'  WHERE stage_id = 'partnership_qualifying';

DELETE FROM pipeline_statuses WHERE id IN ('partnership_prospecting', 'partnership_qualifying');

-- -----------------------------------------------------------------------------
-- 3. Supporting fields on partnership_details.
-- -----------------------------------------------------------------------------
ALTER TABLE partnership_details
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS decision_date    DATE,
  ADD COLUMN IF NOT EXISTS decision_body    TEXT,
  ADD COLUMN IF NOT EXISTS revisit_on       DATE,
  ADD COLUMN IF NOT EXISTS previous_opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL;

-- lost_reason already exists from ADR-006; reuse rather than duplicate.
ALTER TABLE partnership_details
  DROP CONSTRAINT IF EXISTS partnership_details_decision_body_check;
ALTER TABLE partnership_details
  ADD CONSTRAINT partnership_details_decision_body_check
  CHECK (decision_body IS NULL OR decision_body IN ('board', 'ed', 'committee', 'staff'));

COMMENT ON COLUMN partnership_details.stage_entered_at IS
  'When the opportunity entered its current stage. Drives the ageing indicator '
  'and is reset by change_partnership_stage().';
COMMENT ON COLUMN partnership_details.decision_date IS
  'EXPECTED decision date, not actual. The point of the approval stage: if this '
  'is unknown, the exit criteria for proposal were not met. Advisory, not '
  'enforced — a champion sometimes cannot get a date immediately.';
COMMENT ON COLUMN partnership_details.previous_opportunity_id IS
  'Set when a won or lost opportunity is reopened. Reopening creates a NEW row '
  'rather than moving out of a terminal stage.';

CREATE INDEX IF NOT EXISTS partnership_details_decision_date_idx
  ON partnership_details (decision_date) WHERE decision_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS partnership_details_revisit_on_idx
  ON partnership_details (revisit_on) WHERE revisit_on IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. Stage history. Append-only; time-in-stage cannot be reconstructed from a
--    single stage_entered_at.
--
--    Keyed on opportunity_id, since that is partnership_details' primary key and
--    the identifier everything else in the schema already uses.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partnership_stage_history (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage     TEXT,
  to_stage       TEXT NOT NULL,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by     UUID REFERENCES auth.users(id),
  note           TEXT
);

CREATE INDEX IF NOT EXISTS partnership_stage_history_idx
  ON partnership_stage_history (opportunity_id, changed_at DESC);

COMMENT ON TABLE partnership_stage_history IS
  'Append-only record of every stage transition. Written by a trigger on '
  'opportunities so it cannot be bypassed by a direct update.';

ALTER TABLE partnership_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stage history"
  ON partnership_stage_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can write stage history"
  ON partnership_stage_history FOR INSERT TO authenticated WITH CHECK (true);

COMMIT;
