-- Add 'cancelling' and 'cancelled' to the discovery_runs status check constraint.
-- Required to support the Stop Run feature (api/discovery/cancel.ts).

ALTER TABLE discovery_runs
  DROP CONSTRAINT discovery_runs_status_check;

ALTER TABLE discovery_runs
  ADD CONSTRAINT discovery_runs_status_check
  CHECK (status IN ('running', 'cancelling', 'cancelled', 'completed', 'failed'));
