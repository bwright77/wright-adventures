-- =============================================================================
-- Migration: 20260331000000_fix_board_meetings_fk.sql
-- Fix board_meetings foreign keys to reference profiles instead of auth.users
-- so that PostgREST can resolve profiles!created_by and profiles!approved_by joins.
-- =============================================================================

ALTER TABLE board_meetings
  DROP CONSTRAINT board_meetings_created_by_fkey,
  ADD CONSTRAINT board_meetings_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES profiles(id);

ALTER TABLE board_meetings
  DROP CONSTRAINT board_meetings_approved_by_fkey,
  ADD CONSTRAINT board_meetings_approved_by_fkey
    FOREIGN KEY (approved_by) REFERENCES profiles(id);
