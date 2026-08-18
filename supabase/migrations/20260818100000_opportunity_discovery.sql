-- =============================================================================
-- MIGRATION: Opportunity discovery — leads, sources, WA scoring profile
-- File: 20260818100000_opportunity_discovery.sql
-- Author: Benjamin Wright, Director of Technology & Innovation
-- Date: 2026-08-18
-- ADR: ADR-011
--
-- Repoints the retained ADR-005 monitoring machinery at Wright Adventures' own
-- pipeline: RFP/procurement portals first, then job boards. Discovered items
-- land as opportunities with type_id = 'lead'.
--
-- Depends on 20260818000000_decommission_grants.sql having run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The 'lead' opportunity type and its pipeline
-- -----------------------------------------------------------------------------
INSERT INTO opportunity_types (id, label, description, sort_order) VALUES
  ('lead', 'Lead', 'Discovered RFP, contract, or role that Wright Adventures may pursue', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO pipeline_statuses (id, type_id, label, sort_order, is_active) VALUES
  ('lead_discovered', 'lead', 'Discovered', 1, true),
  ('lead_evaluating', 'lead', 'Evaluating', 2, true),
  ('lead_pursuing',   'lead', 'Pursuing',   3, true),
  ('lead_submitted',  'lead', 'Submitted',  4, true),
  ('lead_won',        'lead', 'Won',        5, true),
  ('lead_lost',       'lead', 'Lost',       6, true),
  ('lead_declined',   'lead', 'Declined',   7, true)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE pipeline_statuses IS
  'Per-type pipeline stages. lead_discovered is the unreviewed auto-insert queue (ADR-011).';

-- -----------------------------------------------------------------------------
-- 2. lead_details — 1:1 extension, mirroring partnership_details (ADR-006)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_details (
  opportunity_id    UUID PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,

  source_kind       TEXT,            -- 'rfp' | 'job' | 'contract'
  publisher         TEXT,            -- issuing organization or employer
  location          TEXT,
  remote            BOOLEAN NOT NULL DEFAULT false,
  engagement_type   TEXT,            -- 'rfp'|'contract'|'part_time'|'full_time'|'unknown'

  -- Compensation is inconsistently formatted across sources; keep the verbatim
  -- string alongside the parsed range so nothing is lost to a bad parse.
  compensation_raw  TEXT,
  comp_min          NUMERIC(12,2),
  comp_max          NUMERIC(12,2),

  posted_date       DATE,
  closes_date       DATE,
  apply_url         TEXT,
  requirements      TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE lead_details IS
  '1:1 extension of opportunities for type_id = ''lead'' (ADR-011). Fit scoring lives on '
  'the parent row in ai_match_score / ai_match_rationale / ai_score_detail.';
COMMENT ON COLUMN lead_details.comp_min IS
  'NUMERIC — Supabase JS returns this as a string. Coerce with Number() at every use site.';

ALTER TABLE lead_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read lead_details"
  ON lead_details FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin and manager can modify lead_details"
  ON lead_details FOR ALL TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'));

CREATE OR REPLACE FUNCTION update_lead_details_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER lead_details_updated_at
  BEFORE UPDATE ON lead_details
  FOR EACH ROW EXECUTE FUNCTION update_lead_details_timestamp();

-- Auto-create the extension row for new leads, matching the partnership trigger
CREATE OR REPLACE FUNCTION create_lead_details()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type_id = 'lead' THEN
    INSERT INTO lead_details (opportunity_id) VALUES (NEW.id)
    ON CONFLICT (opportunity_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opportunities_create_lead_details
  AFTER INSERT ON opportunities
  FOR EACH ROW EXECUTE FUNCTION create_lead_details();

CREATE INDEX IF NOT EXISTS lead_details_closes_date_idx ON lead_details(closes_date);

-- -----------------------------------------------------------------------------
-- 3. discovery_sources — make it source-kind agnostic
--
--    source_proximity_bonus is dropped rather than repurposed: it nudged
--    state/local grants for smaller applicant pools, and the ADR-011 fit rubric
--    is self-contained. A per-source thumb on the scale would distort it.
-- -----------------------------------------------------------------------------
ALTER TABLE discovery_sources RENAME COLUMN funder_name TO publisher;
ALTER TABLE discovery_sources DROP COLUMN IF EXISTS source_proximity_bonus;
ALTER TABLE discovery_sources ALTER COLUMN source_type SET DEFAULT 'procurement';

-- The ADR-005 migration declared `url TEXT NOT NULL UNIQUE`, but the deployed
-- schema has no such constraint — that migration was applied by hand rather than
-- through the CLI, and the constraint did not survive. Without it the seed's
-- ON CONFLICT (url) fails with SQLSTATE 42P10. Establish it explicitly; the
-- decommission migration emptied this table, so there is nothing to violate it.
ALTER TABLE discovery_sources DROP CONSTRAINT IF EXISTS discovery_sources_url_key;
ALTER TABLE discovery_sources ADD  CONSTRAINT discovery_sources_url_key UNIQUE (url);

COMMENT ON COLUMN discovery_sources.source_type IS
  '''procurement'' | ''job_board'' | ''foundation_rfp'' | ''sector_board'' (ADR-011)';
COMMENT ON COLUMN discovery_sources.publisher IS
  'Issuing body or board operator — e.g. "City and County of Denver", "Colorado Nonprofit Association".';
COMMENT ON COLUMN discovery_sources.relevance_notes IS
  'Free text injected into the Haiku extraction prompt — what counts as a candidate on this source.';

-- discovery_runs now tracks a single kind of run
ALTER TABLE discovery_runs ALTER COLUMN source_type SET DEFAULT 'sources';

-- -----------------------------------------------------------------------------
-- 4. Seeded sources — procurement first (an RFP open to firms scores 3 on
--    engagement shape, the rubric's single best predictor), boards second.
--
--    Authenticated / paid-alert sources (SAM.gov entity registration, bidnet
--    paid alerts) are intentionally absent — see ADR-011 §Out of Scope.
-- -----------------------------------------------------------------------------
INSERT INTO discovery_sources
  (label, source_type, publisher, url, enabled, check_frequency, eligibility_notes, relevance_notes)
VALUES
  ('Rocky Mountain E-Purchasing',
   'procurement',
   'BidNet Direct (Colorado)',
   'https://www.bidnetdirect.com/colorado',
   true,
   'weekly',
   'Open solicitations from Colorado state agencies, counties, cities, and special districts.',
   'Consulting, technology, data, communications, and website solicitations. Prioritize anything naming an RFP, RFQ, or firm.'),

  ('Denver Procurement',
   'procurement',
   'City and County of Denver',
   'https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/General-Services/Purchasing-Division',
   true,
   'weekly',
   'City and County of Denver solicitations.',
   'Professional services, technology, data, and community engagement solicitations.'),

  ('Colorado Nonprofit Association',
   'job_board',
   'Colorado Nonprofit Association',
   'https://coloradononprofits.org/careers',
   true,
   'weekly',
   'Colorado nonprofit sector. RFPs are frequently posted here formatted as job listings.',
   'Independent Contractor postings above all. Then Development, IT, and Marketing categories. Flag anything using the words RFP, RFQ, consultant, or firm.'),

  ('Andrew Hudson''s Jobs List',
   'job_board',
   'Andrew Hudson',
   'https://andrewhudsonsjobslist.com',
   true,
   'weekly',
   'Statewide Colorado; heavily nonprofit, communications, development, and government.',
   'Contract and consultant roles in development, communications, and technology. Skip full-time W-2 unless it names a fixed term.')
ON CONFLICT (url) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Wright Adventures scoring profile
--
--    Seeded empty and populated by the app from src/lib/discovery/waOrgProfile.ts,
--    which is the source of truth. Storing the prompt text here lets a run
--    reference the exact profile version it scored against via
--    discovery_runs.org_profile_id.
-- -----------------------------------------------------------------------------
INSERT INTO org_profiles (org_name, profile_json, prompt_text, is_active)
VALUES (
  'Wright Adventures',
  '{"seeded_from": "src/lib/discovery/waOrgProfile.ts", "pending_sync": true}'::jsonb,
  'PENDING — synced from waOrgProfile.ts on first discovery run.',
  true
)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE org_profiles IS
  'Scoring context injected into the Sonnet fit call. Load-bearing: warm_path and '
  'portfolio_proof cannot be scored from a posting alone, so a stale relationship list '
  'silently depresses scores and can trigger the warm_path downgrade gate (ADR-011).';

COMMIT;
