-- =============================================================================
-- MIGRATION: Record what discovery rejected
-- File: 20260818270000_discovery_rejections.sql
-- Date: 2026-08-18
-- ADR: ADR-011
--
-- Until now a candidate that scored below the threshold, or matched an existing
-- lead, vanished. Only a count survived on the run record. That made an empty
-- review queue indistinguishable from a broken pipeline — which is exactly how
-- the first live run presented, and it cost a diagnostic cycle to establish that
-- extraction was working and 16 candidates had genuinely scored low.
--
-- Rejections are deliberately NOT opportunities. They were never pursued, they
-- should not appear in any pipeline, and they should not carry an owner, tasks,
-- or a status. This is an append-only observability log, not a work queue.
--
-- What it makes answerable:
--   • Did the pipeline find nothing, or find things and rightly drop them?
--   • Is the scorer systematically wrong about a category of posting?
--   • What did we pass on, if a funder or partner asks later?
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS discovery_rejections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  run_id        UUID REFERENCES discovery_runs(id)     ON DELETE CASCADE,
  source_id     UUID REFERENCES discovery_sources(id)  ON DELETE SET NULL,

  -- Why it was dropped.
  --   below_threshold — scored, but under SCORE_THRESHOLD
  --   duplicate       — matched an existing lead; never scored, so score is NULL
  --   unscorable      — the scoring pass returned nothing usable
  --   incomplete      — extraction produced no name or publisher
  reason        TEXT NOT NULL,

  -- Enough of the candidate to recognise it without re-fetching the source.
  name          TEXT,
  publisher     TEXT,
  url           TEXT,
  source_kind   TEXT,
  engagement_raw TEXT,
  compensation_raw TEXT,

  -- NULL for duplicates and incomplete extractions, which are dropped before
  -- the scoring pass runs.
  score         INTEGER,
  score_detail  JSONB,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE discovery_rejections IS
  'Append-only log of candidates discovery dropped (ADR-011). NOT opportunities: '
  'never pursued, no owner, no pipeline. Exists so an empty review queue can be '
  'told apart from a broken pipeline, and so scorer bias against a category of '
  'posting is visible rather than invisible.';

COMMENT ON COLUMN discovery_rejections.score IS
  'NULL when the candidate was dropped before scoring — duplicates and '
  'incomplete extractions.';

CREATE INDEX IF NOT EXISTS discovery_rejections_run_idx     ON discovery_rejections(run_id);
CREATE INDEX IF NOT EXISTS discovery_rejections_created_idx ON discovery_rejections(created_at DESC);
CREATE INDEX IF NOT EXISTS discovery_rejections_reason_idx  ON discovery_rejections(reason);

ALTER TABLE discovery_rejections ENABLE ROW LEVEL SECURITY;

-- Read-only to the app. Only the service role writes, from the sync endpoint.
CREATE POLICY "Admin and manager can read discovery_rejections"
  ON discovery_rejections FOR SELECT TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'));

COMMIT;
