-- =============================================================================
-- Migration: 20260302000000_state_discovery_sources.sql
-- Phase 3b — State & Local Grant Discovery Pipeline
-- ADR Reference: ADR-005-state-local-grant-discovery.md
-- Author: Benjamin Wright, Director of Technology & Innovation
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. New table: discovery_sources
--    Stores monitored state/local grant pages as configurable data (not code).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS discovery_sources (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source identity
  label                  TEXT        NOT NULL,
  source_type            TEXT        NOT NULL DEFAULT 'state',  -- 'state' | 'local' | 'foundation' | 'federal_api'
  funder_name            TEXT        NOT NULL,

  -- Monitoring config
  url                    TEXT        NOT NULL UNIQUE,
  enabled                BOOLEAN     NOT NULL DEFAULT true,
  check_frequency        TEXT        NOT NULL DEFAULT 'weekly',  -- 'daily' | 'weekly' | 'monthly'

  -- Eligibility & relevance context (injected into AI extraction prompt)
  eligibility_notes      TEXT,
  relevance_notes        TEXT,

  -- Scoring adjustment (added to Sonnet weighted_score, capped at 10.0)
  source_proximity_bonus NUMERIC(3,1) NOT NULL DEFAULT 1.0,

  -- State tracking
  last_content_hash      TEXT,
  last_content_text      TEXT,        -- Cached extracted text for diff computation (Option A per ADR-005 §5)
  last_fetched_at        TIMESTAMPTZ,
  last_changed_at        TIMESTAMPTZ,
  last_error             TEXT,
  consecutive_errors     INTEGER     NOT NULL DEFAULT 0,

  -- Metadata
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE discovery_sources IS
  'Curated set of state/local grant index pages monitored weekly by the state discovery cron (ADR-005).';

COMMENT ON COLUMN discovery_sources.source_proximity_bonus IS
  'Added to Sonnet weighted_score after AI scoring. Default +1.0 for state/local — reflects smaller applicant pools and Confluence existing relationships. Capped at 10.0 total.';

COMMENT ON COLUMN discovery_sources.last_content_text IS
  'Cached extracted text from last successful fetch. Used for diff computation on subsequent runs (Option A per ADR-005 §5).';

COMMENT ON COLUMN discovery_sources.consecutive_errors IS
  'Incremented on each fetch/extraction failure. Auto-disable fires at 3 consecutive errors.';

-- Partial index for the cron query (only scans enabled sources)
CREATE INDEX IF NOT EXISTS idx_discovery_sources_enabled
  ON discovery_sources(enabled) WHERE enabled = true;

-- Reuse the existing trigger function from the initial schema migration
CREATE TRIGGER discovery_sources_updated_at
  BEFORE UPDATE ON discovery_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Extend opportunities table: link back to source
-- -----------------------------------------------------------------------------

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS discovery_source_id UUID REFERENCES discovery_sources(id);

COMMENT ON COLUMN opportunities.discovery_source_id IS
  'Links auto-discovered state/local opportunities back to their monitoring source. NULL for federal (Simpler.Grants.gov) and manual entries.';

-- -----------------------------------------------------------------------------
-- 3. Extend discovery_runs table: distinguish run types
-- -----------------------------------------------------------------------------

ALTER TABLE discovery_runs
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'federal';

COMMENT ON COLUMN discovery_runs.source_type IS
  'Distinguishes federal API sync runs (value: federal) from state/local page monitoring runs (value: state). DEFAULT fills existing rows.';

-- -----------------------------------------------------------------------------
-- 4. Row-level security
-- -----------------------------------------------------------------------------

ALTER TABLE discovery_sources ENABLE ROW LEVEL SECURITY;

-- Admins: full access
CREATE POLICY discovery_sources_admin_all ON discovery_sources
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Managers: read-only (they can see sources in Settings but not edit)
CREATE POLICY discovery_sources_manager_read ON discovery_sources
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'manager')
  );

-- -----------------------------------------------------------------------------
-- 5. Seed data: initial four Colorado sources
--    ON CONFLICT (url) DO NOTHING — safe to re-run on existing DBs.
--    Note: GOCO URL is /grants/apply — /programs-projects/our-grant-programs returns 503.
-- -----------------------------------------------------------------------------

INSERT INTO discovery_sources (label, source_type, funder_name, url, eligibility_notes, relevance_notes, check_frequency, source_proximity_bonus)
VALUES

  ('GOCO — Grant Programs',
   'state',
   'Great Outdoors Colorado',
   'https://goco.org/grants/apply',
   'Nonprofits cannot apply directly for most programs — must partner with local government or land trust. Exceptions: Generation Wild funds diverse coalitions directly. Conservation Service Corps administered via CYCA.',
   'Conservation Service Corps (youth crews), Generation Wild (youth + families outdoor), Pathways (career pathways for underrepresented individuals). ~$16M/year invested.',
   'weekly', 1.0),

  ('CWCB — Water Plan Grants',
   'state',
   'Colorado Water Conservation Board',
   'https://cwcb.colorado.gov/funding/colorado-water-plan-grants',
   'Water Plan Grants primarily target governmental entities. WSRF grants accept nonprofit corporations directly. Nonprofits can partner with local entities for Water Plan Grants.',
   'South Platte watershed conservation, Watershed Health & Recreation category. Confluence applied previously (Colorado Water Plan Grant). Deadlines: July 1 and Dec 1.',
   'weekly', 1.0),

  ('CDPHE — Funding Opportunities',
   'state',
   'Colorado Department of Public Health and Environment',
   'https://cdphe.colorado.gov/funding-opportunities',
   'Nonprofits are directly eligible for EJ grants. NPS Mini Grants are rolling year-round ($1K-$5K).',
   'Environmental Justice Grant Program is primary target — Confluence applied in 2024 ($300K). EJ program reopens Summer 2026. Also: NPS Mini Grants, Health Disparities grants.',
   'weekly', 1.0),

  ('DOLA — Funding Opportunities',
   'state',
   'Colorado Department of Local Affairs',
   'https://cdola.colorado.gov/dola-funding-opportunities',
   'Most programs target local governments. Nonprofits can be sponsored applicants for CDBG. NPI Grant (direct nonprofit funding) is closed but monitor for reauthorization.',
   'CDBG (via local gov partner), NPI-like reauthorizations. Confluence applied DOLA 2023. Less directly relevant unless partnering with Denver/Adams County.',
   'weekly', 0.5)

ON CONFLICT (url) DO NOTHING;
