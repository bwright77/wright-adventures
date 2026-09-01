-- =============================================================================
-- MIGRATION: bill in six-minute increments, rounded up
-- File: 20260901020000_billing_increments.sql
-- Date: 2026-09-01
--
-- Time is billed in tenths of an hour, always rounded UP: five minutes on the
-- timer is 0.1, seven minutes is 0.2. Standard practice, and it is the unit the
-- client is actually charged in — so it belongs in the column, not in a UI
-- helper that the next caller forgets to use.
--
-- Minutes stay the storage unit because a tenth of an hour is exactly six
-- minutes, so integers keep it exact. Storing 0.1 as a float would reintroduce
-- the rounding error the integer was chosen to avoid. tenths = minutes / 6.
--
-- The CHECK is the point: any path that writes a non-multiple of six — a script,
-- a fixture, a future endpoint — fails loudly instead of quietly billing 7
-- minutes as 7.
-- =============================================================================

BEGIN;

-- Round anything already stored up to the next increment.
UPDATE time_entries
   SET minutes = CEIL(minutes::numeric / 6) * 6
 WHERE minutes % 6 <> 0;

ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_billing_increment;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_billing_increment
  CHECK (minutes > 0 AND minutes % 6 = 0);

COMMENT ON COLUMN time_entries.minutes IS
  'Billable time in minutes, always a multiple of 6 — one tenth of an hour. '
  'Rounded UP at entry: 5 minutes bills 0.1, 7 minutes bills 0.2. Divide by 6 '
  'for tenths, by 60 for hours.';

COMMIT;
