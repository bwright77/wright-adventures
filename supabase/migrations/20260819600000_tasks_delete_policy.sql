-- =============================================================================
-- MIGRATION: Add the missing DELETE policy on tasks
-- File: 20260819600000_tasks_delete_policy.sql
-- Date: 2026-08-19
--
-- tasks has SELECT, INSERT and UPDATE policies and no DELETE policy. RLS is
-- enabled, so a delete from the browser matches no rows, affects nothing, and
-- returns success — a silent no-op rather than an error.
--
-- Two consequences:
--
--   The task delete added alongside task editing would never have worked.
--
--   More importantly, the closed-lost cleanup shipped earlier — "closing an
--   opportunity lost deletes its unfinished tasks" — has been silently doing
--   nothing in the browser this whole time. It was verified against the service
--   role, which bypasses RLS, so the check passed while the feature did not
--   work. Deleting through a client is exactly where RLS has to be checked, and
--   a service-role probe cannot tell you that.
--
-- Mirrors the UPDATE policy: assignees manage their own tasks, admin and
-- manager manage any.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "Assignees and managers can delete tasks" ON tasks;

CREATE POLICY "Assignees and managers can delete tasks"
  ON tasks FOR DELETE TO authenticated
  USING (
    assignee_id = auth.uid()
    OR (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager')
  );

COMMIT;
