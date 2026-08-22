-- =============================================================================
-- MIGRATION: Stage tasks audited against the new pipeline
-- File: 20260819900000_stage_task_audit.sql
-- Date: 2026-08-19
--
-- The stage task templates were written for the old five-stage pipeline. Three
-- problems, in order of seriousness.
--
-- 1. CONTACTED's tasks were BANT qualification — "assess budget, authority,
--    need, timing". That is the commercial-pipeline artifact this redesign
--    exists to reject: the premise is that the champion CANNOT buy, so
--    "authority" is a question whose answer is already known. And if discovery
--    is the product, you do not qualify before it — you listen first. Replaced.
--
-- 2. Three stages had no tasks at all: evaluation, approval, nurture. Approval
--    is the stage that motivated the redesign, and it was empty.
--
-- 3. Every task anchored to stage entry. An approval task needs to fire relative
--    to the DECISION DATE ("check in the week before the board meets"), and a
--    nurture task relative to REVISIT_ON. Anchoring those to stage entry makes
--    them fire at a time unrelated to the thing they are about. Added a
--    date_anchor column; the generator resolves it.
--
-- Smaller corrections:
--   • "Follow up if no response in 5 business days" sat in IDENTIFIED, which
--     exits when outreach is SENT. Chasing a non-response is CONTACTED's job.
--     It also said five business days and fired at seven calendar days.
--   • Discovery captured "pain points and tech stack". Tech stack is half the
--     business — without the fundraising half the rubric's both_halves
--     dimension has no input.
--   • Closed-lost only documented the reason, which the transition now REQUIRES
--     anyway. The task that matters is deciding whether the relationship goes to
--     nurture rather than disappearing.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Let a task anchor to something other than stage entry.
-- -----------------------------------------------------------------------------
ALTER TABLE partnership_stage_tasks
  ADD COLUMN IF NOT EXISTS date_anchor TEXT NOT NULL DEFAULT 'stage_entry';

ALTER TABLE partnership_stage_tasks
  DROP CONSTRAINT IF EXISTS partnership_stage_tasks_date_anchor_check;
ALTER TABLE partnership_stage_tasks
  ADD CONSTRAINT partnership_stage_tasks_date_anchor_check
  CHECK (date_anchor IN ('stage_entry', 'decision_date', 'revisit_on'));

COMMENT ON COLUMN partnership_stage_tasks.date_anchor IS
  'What days_after_entry is measured from. stage_entry is the default. '
  'decision_date and revisit_on allow a NEGATIVE offset — "seven days before the '
  'board meets". When the anchor date is unset, the generator falls back to '
  'stage entry so the task still appears.';

-- -----------------------------------------------------------------------------
-- 2. Fix what no longer fits.
-- -----------------------------------------------------------------------------

-- The follow-up belongs where the waiting happens.
UPDATE partnership_stage_tasks
   SET stage_id = 'partnership_contacted',
       title = 'Follow up — no substantive reply yet',
       days_after_entry = 5,
       sort_order = 10
 WHERE title = 'Follow up if no response in 5 business days';

-- BANT out, listen-first in.
DELETE FROM partnership_stage_tasks
 WHERE title IN (
   'Qualification call — assess budget, authority, need, timing',
   'Log qualification findings and update opportunity'
 );

-- Both halves, not just the technical one.
UPDATE partnership_stage_tasks
   SET title = 'Discovery session — capture the fundraising and the systems picture'
 WHERE title = 'Discovery session — document pain points and tech stack';

-- The reason is captured by the transition itself now.
UPDATE partnership_stage_tasks
   SET title = 'Debrief: what would have changed the outcome'
 WHERE title = 'Document loss reason and debrief notes';

-- -----------------------------------------------------------------------------
-- 3. Fill the gaps.
-- -----------------------------------------------------------------------------
INSERT INTO partnership_stage_tasks (stage_id, title, assignee_role, days_after_entry, sort_order, date_anchor) VALUES
  -- CONTACTED — the exit criterion is "responds with intent to talk", so the
  -- work is getting a listen-and-learn on the calendar, not qualifying them.
  ('partnership_contacted', 'Offer the listen-and-learn session',              'owner', 0, 1, 'stage_entry'),

  -- EVALUATION — the stage where we owe them something. That is what
  -- distinguishes it from approval, where there is nothing to do but wait.
  ('partnership_evaluation', 'Confirm what they still need from us',            'owner', 0, 1, 'stage_entry'),
  ('partnership_evaluation', 'Line up references and warn them a call is coming','owner', 1, 2, 'stage_entry'),
  ('partnership_evaluation', 'Prepare for interview or panel',                  'owner', 3, 3, 'stage_entry'),
  ('partnership_evaluation', 'Ask who else they are considering, and why',      'owner', 3, 4, 'stage_entry'),

  -- APPROVAL — nothing to do but wait, so the tasks are about arming the
  -- champion and knowing the date. Anchored to the decision date, not entry.
  ('partnership_approval', 'Confirm the deciding body and the meeting date',    'owner',  0, 1, 'stage_entry'),
  ('partnership_approval', 'Give the champion a one-pager they can take in',    'owner',  2, 2, 'stage_entry'),
  ('partnership_approval', 'Check in with the champion before the meeting',     'owner', -7, 3, 'decision_date'),
  ('partnership_approval', 'Follow up on the decision',                         'owner',  3, 4, 'decision_date'),

  -- NURTURE — one task, on the revisit date. Without it nurture is a hole
  -- things fall into, which is the exact failure the stage exists to prevent.
  ('partnership_nurture', 'Revisit — is there an opening now?',                 'owner', 0, 1, 'revisit_on'),

  -- CLOSED-LOST — keep the relationship rather than losing it with the deal.
  ('partnership_closed_lost', 'Decide whether this moves to nurture',           'owner', 2, 2, 'stage_entry')
ON CONFLICT DO NOTHING;

COMMIT;
