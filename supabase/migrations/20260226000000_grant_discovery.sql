-- =============================================================================
-- Migration: 20260226000000_grant_discovery.sql
-- Phase 3 — Grant Discovery Pipeline
-- ADR Reference: ADR-002-grant-discovery-pipeline.md
-- Author: Benjamin Wright, Director of Technology & Innovation
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend opportunities table with discovery metadata
-- -----------------------------------------------------------------------------

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS source             TEXT,
  ADD COLUMN IF NOT EXISTS external_id        TEXT,
  ADD COLUMN IF NOT EXISTS external_url       TEXT,
  ADD COLUMN IF NOT EXISTS ai_match_score     NUMERIC(3,1),  -- weighted 1.0–10.0
  ADD COLUMN IF NOT EXISTS ai_match_rationale TEXT,
  ADD COLUMN IF NOT EXISTS ai_score_detail    JSONB,         -- full breakdown: per-criterion scores, red_flags, recommended_action
  ADD COLUMN IF NOT EXISTS auto_discovered    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discovered_at      TIMESTAMPTZ;

COMMENT ON COLUMN opportunities.source             IS 'Origin of this opportunity: simpler_grants_gov | manual';
COMMENT ON COLUMN opportunities.external_id        IS 'UUID from Simpler.Grants.gov opportunity_id field';
COMMENT ON COLUMN opportunities.external_url       IS 'Canonical URL on Simpler.Grants.gov';
COMMENT ON COLUMN opportunities.ai_match_score     IS 'Weighted fit score 1.0–10.0 from Sonnet scoring against org profile';
COMMENT ON COLUMN opportunities.ai_match_rationale IS 'Plain-English summary of fit from Sonnet';
COMMENT ON COLUMN opportunities.ai_score_detail    IS 'Full JSON from scoring: {scores, weighted_score, auto_rejected, red_flags, recommended_action}';
COMMENT ON COLUMN opportunities.auto_discovered    IS 'True if inserted by discovery cron, false if manually entered';
COMMENT ON COLUMN opportunities.discovered_at      IS 'Timestamp when the cron first ingested this opportunity';

-- Prevent duplicate ingestion of the same external opportunity
CREATE UNIQUE INDEX IF NOT EXISTS opportunities_source_external_id_idx
  ON opportunities(source, external_id)
  WHERE external_id IS NOT NULL;

-- Index for the admin UI "Discovered" tab query
CREATE INDEX IF NOT EXISTS opportunities_auto_discovered_score_idx
  ON opportunities(auto_discovered, ai_match_score DESC NULLS LAST)
  WHERE auto_discovered = true;

-- -----------------------------------------------------------------------------
-- 2. Add 'grant_discovered' pipeline status
-- opportunities.status is a FK to pipeline_statuses(id) — this must exist before
-- the sync function can INSERT discovered opportunities.
-- sort_order = 0 places it before 'Identified'; is_active = false hides it
-- from the normal pipeline view (it's a pre-pipeline staging status).
-- -----------------------------------------------------------------------------

INSERT INTO pipeline_statuses (id, type_id, label, sort_order, is_active) VALUES
  ('grant_discovered', 'grant', 'Discovered', 0, false);

-- -----------------------------------------------------------------------------
-- 3. Org profiles — editable from admin UI without code deploys
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_profiles (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name      TEXT        NOT NULL,
  profile_json  JSONB       NOT NULL,  -- ORG_PROFILE structured object
  prompt_text   TEXT        NOT NULL,  -- ORG_PROFILE_PROMPT string injected into Sonnet
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID        REFERENCES auth.users(id)
);

COMMENT ON TABLE  org_profiles                IS 'Organizational profiles used by the AI scoring pipeline. One active row per applying entity.';
COMMENT ON COLUMN org_profiles.profile_json   IS 'Structured ORG_PROFILE object from confluence-org-profile.ts';
COMMENT ON COLUMN org_profiles.prompt_text    IS 'ORG_PROFILE_PROMPT string — injected verbatim into Sonnet scoring call';
COMMENT ON COLUMN org_profiles.is_active      IS 'Only one row should be active at a time; the sync endpoint loads the single active profile';

-- Only one active profile at a time
CREATE UNIQUE INDEX IF NOT EXISTS org_profiles_single_active_idx
  ON org_profiles(is_active)
  WHERE is_active = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER org_profiles_updated_at
  BEFORE UPDATE ON org_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Discovery queries — configurable query set, editable from admin UI
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS discovery_queries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT        NOT NULL,
  enabled     BOOLEAN     NOT NULL DEFAULT true,
  priority    INTEGER     NOT NULL DEFAULT 0,  -- lower = runs first
  payload     JSONB       NOT NULL,             -- SimplerGrantsSearchPayload (exact request body)
  notes       TEXT,                             -- human-readable notes (e.g. "seasonal — zero results Feb 2026")
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  discovery_queries         IS 'Configurable Simpler.Grants.gov query set. Edited from admin UI. Loaded by sync cron ordered by priority ASC.';
COMMENT ON COLUMN discovery_queries.payload IS 'Exact POST body sent to /v1/opportunities/search. Must use validated enum values.';
COMMENT ON COLUMN discovery_queries.notes   IS 'Operational notes — e.g. which queries returned zero results and why (seasonal cycles, etc.)';

CREATE TRIGGER discovery_queries_updated_at
  BEFORE UPDATE ON discovery_queries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- 5. Seed initial query set (from ADR-002, validated 2026-02-26)
-- -----------------------------------------------------------------------------

INSERT INTO discovery_queries (label, enabled, priority, payload, notes) VALUES

-- Small pools: take everything, let Sonnet score
('All agencies — natural_resources', true, 1,
  '{
    "filters": {
      "opportunity_status": {"one_of": ["posted", "forecasted"]},
      "funding_instrument": {"one_of": ["grant", "cooperative_agreement"]},
      "applicant_type": {"one_of": ["nonprofits_non_higher_education_with_501c3"]},
      "funding_category": {"one_of": ["natural_resources"]}
    },
    "pagination": {"page_offset": 1, "page_size": 25, "sort_order": [{"order_by": "post_date", "sort_direction": "descending"}]}
  }',
  'Pool size: ~5 active Feb 2026. Small — score everything.'
),

('All agencies — environment', true, 2,
  '{
    "filters": {
      "opportunity_status": {"one_of": ["posted", "forecasted"]},
      "funding_instrument": {"one_of": ["grant", "cooperative_agreement"]},
      "applicant_type": {"one_of": ["nonprofits_non_higher_education_with_501c3"]},
      "funding_category": {"one_of": ["environment"]}
    },
    "pagination": {"page_offset": 1, "page_size": 25, "sort_order": [{"order_by": "post_date", "sort_direction": "descending"}]}
  }',
  'Pool size: ~56 active Feb 2026. Score everything.'
),

('All agencies — employment_labor_and_training', true, 3,
  '{
    "filters": {
      "opportunity_status": {"one_of": ["posted", "forecasted"]},
      "funding_instrument": {"one_of": ["grant", "cooperative_agreement"]},
      "applicant_type": {"one_of": ["nonprofits_non_higher_education_with_501c3"]},
      "funding_category": {"one_of": ["employment_labor_and_training"]}
    },
    "pagination": {"page_offset": 1, "page_size": 25, "sort_order": [{"order_by": "post_date", "sort_direction": "descending"}]}
  }',
  'Pool size: ~8 active Feb 2026. Small — score everything. YouthBuild confirmed hit.'
),

('All agencies — community_development', true, 4,
  '{
    "filters": {
      "opportunity_status": {"one_of": ["posted", "forecasted"]},
      "funding_instrument": {"one_of": ["grant", "cooperative_agreement"]},
      "applicant_type": {"one_of": ["nonprofits_non_higher_education_with_501c3"]},
      "funding_category": {"one_of": ["community_development"]}
    },
    "pagination": {"page_offset": 1, "page_size": 25, "sort_order": [{"order_by": "post_date", "sort_direction": "descending"}]}
  }',
  'Pool size: ~6 active Feb 2026. Small — score everything.'
),

-- Larger pools: keyword-scoped to reduce noise
('education — youth outdoor conservation', true, 5,
  '{
    "query": "youth outdoor conservation stewardship nature",
    "filters": {
      "opportunity_status": {"one_of": ["posted", "forecasted"]},
      "funding_instrument": {"one_of": ["grant", "cooperative_agreement"]},
      "applicant_type": {"one_of": ["nonprofits_non_higher_education_with_501c3"]},
      "funding_category": {"one_of": ["education"]}
    },
    "pagination": {"page_offset": 1, "page_size": 25, "sort_order": [{"order_by": "relevancy", "sort_direction": "descending"}]}
  }',
  'Pool size: ~178 total. Keyword-scoped to reduce noise. NPS Research Techs was confirmed hit.'
),

('food_and_nutrition + agriculture — community urban farm', true, 6,
  '{
    "query": "community urban farm market food access",
    "filters": {
      "opportunity_status": {"one_of": ["posted", "forecasted"]},
      "funding_instrument": {"one_of": ["grant", "cooperative_agreement"]},
      "applicant_type": {"one_of": ["nonprofits_non_higher_education_with_501c3"]},
      "funding_category": {"one_of": ["food_and_nutrition", "agriculture"]}
    },
    "pagination": {"page_offset": 1, "page_size": 25, "sort_order": [{"order_by": "relevancy", "sort_direction": "descending"}]}
  }',
  'Pool size: ~64+25 combined. Relevant to Mo Betta Green Marketplace partnership.'
),

-- Agency-scoped: confirmed working
('DOL — employment_labor_and_training + youth', true, 7,
  '{
    "query": "youth",
    "filters": {
      "opportunity_status": {"one_of": ["posted", "forecasted"]},
      "funding_instrument": {"one_of": ["grant", "cooperative_agreement"]},
      "applicant_type": {"one_of": ["nonprofits_non_higher_education_with_501c3"]},
      "top_level_agency": {"one_of": ["DOL"]},
      "funding_category": {"one_of": ["employment_labor_and_training"]}
    },
    "pagination": {"page_offset": 1, "page_size": 25, "sort_order": [{"order_by": "post_date", "sort_direction": "descending"}]}
  }',
  'Confirmed working Feb 2026. YouthBuild + RESTART both genuine fits.'
),

-- Agency-scoped: seasonal (zero results Feb 2026, kept for cycle pickup)
('DOI — natural_resources + education (seasonal)', true, 8,
  '{
    "filters": {
      "opportunity_status": {"one_of": ["posted", "forecasted"]},
      "funding_instrument": {"one_of": ["grant", "cooperative_agreement"]},
      "applicant_type": {"one_of": ["nonprofits_non_higher_education_with_501c3"]},
      "top_level_agency": {"one_of": ["DOI"]},
      "funding_category": {"one_of": ["natural_resources", "education"]}
    },
    "pagination": {"page_offset": 1, "page_size": 25, "sort_order": [{"order_by": "post_date", "sort_direction": "descending"}]}
  }',
  'Seasonal — 0 results Feb 2026. Kept enabled to catch new cycle postings (NPS, BOR, BLM programs).'
),

('EPA + USDA — environment + natural_resources (seasonal)', true, 9,
  '{
    "filters": {
      "opportunity_status": {"one_of": ["posted", "forecasted"]},
      "funding_instrument": {"one_of": ["grant", "cooperative_agreement"]},
      "applicant_type": {"one_of": ["nonprofits_non_higher_education_with_501c3"]},
      "top_level_agency": {"one_of": ["EPA", "USDA"]},
      "funding_category": {"one_of": ["environment", "natural_resources"]}
    },
    "pagination": {"page_offset": 1, "page_size": 25, "sort_order": [{"order_by": "post_date", "sort_direction": "descending"}]}
  }',
  'Seasonal — 0 results Feb 2026. top_level_agency codes unverified (API facets returned empty). Kept enabled.'
);

-- -----------------------------------------------------------------------------
-- 6. Discovery run audit log
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS discovery_runs (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at              TIMESTAMPTZ,
  triggered_by              TEXT        NOT NULL CHECK (triggered_by IN ('cron', 'manual')),
  status                    TEXT        NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running', 'completed', 'failed')),
  opportunities_fetched     INTEGER     NOT NULL DEFAULT 0,  -- raw count from API across all queries
  opportunities_deduplicated INTEGER    NOT NULL DEFAULT 0,  -- skipped: already in opportunities table
  opportunities_detail_fetched INTEGER  NOT NULL DEFAULT 0,  -- detail calls made to GET /v1/opportunities/{id}
  opportunities_auto_rejected INTEGER   NOT NULL DEFAULT 0,  -- Sonnet score = 0 (auto-reject triggered)
  opportunities_below_threshold INTEGER NOT NULL DEFAULT 0,  -- scored but weighted_score < 5.0
  opportunities_inserted    INTEGER     NOT NULL DEFAULT 0,  -- rows inserted into opportunities table
  tokens_haiku              INTEGER,                         -- total Haiku tokens used this run
  tokens_sonnet             INTEGER,                         -- total Sonnet tokens used this run
  error_log                 JSONB,                           -- array of {query_label, error, timestamp}
  org_profile_id            UUID        REFERENCES org_profiles(id)
);

COMMENT ON TABLE  discovery_runs                          IS 'Audit log for each sync run. One row per execution.';
COMMENT ON COLUMN discovery_runs.opportunities_fetched    IS 'Raw count of opportunity IDs returned by search queries (before dedup)';
COMMENT ON COLUMN discovery_runs.opportunities_deduplicated IS 'Count skipped because external_id already exists in opportunities table';
COMMENT ON COLUMN discovery_runs.opportunities_auto_rejected IS 'Count rejected by Sonnet auto-reject rules (ineligible applicant, wrong geo, etc.)';
COMMENT ON COLUMN discovery_runs.opportunities_below_threshold IS 'Count scored but weighted_score < 5.0 — not inserted';
COMMENT ON COLUMN discovery_runs.opportunities_inserted   IS 'Count actually written to opportunities table';

-- Index for admin Settings page (recent runs display)
CREATE INDEX IF NOT EXISTS discovery_runs_started_at_idx
  ON discovery_runs(started_at DESC);

-- -----------------------------------------------------------------------------
-- 7. Row Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE org_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_runs  ENABLE ROW LEVEL SECURITY;

-- org_profiles: admin read/write only
CREATE POLICY "org_profiles_admin_all" ON org_profiles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- discovery_queries: admin read/write only
CREATE POLICY "discovery_queries_admin_all" ON discovery_queries
  FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- discovery_runs: admin read only (writes happen via service role in cron)
CREATE POLICY "discovery_runs_admin_read" ON discovery_runs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- -----------------------------------------------------------------------------
-- 8. Seed initial org profile (Confluence Colorado)
-- Prompt text references confluence-org-profile.ts — update after confirming EIN
-- -----------------------------------------------------------------------------

INSERT INTO org_profiles (org_name, is_active, profile_json, prompt_text) VALUES (
  'Confluence Colorado',
  true,
  '{
    "legal_name": "Confluence Colorado",
    "tax_status": "501(c)(3)",
    "ein": "TBD",
    "founded_year": 2022,
    "headquarters": {"city": "Denver", "state": "Colorado"},
    "geographic_focus": ["Denver, Colorado", "South Platte River corridor", "Front Range, Colorado", "Southwestern United States"],
    "mission": "Confluence Colorado exists to connect people to place. We exist at the confluence of public and environmental health, and social and environmental justice.",
    "target_populations": ["Underserved youth ages 14-24", "BIPOC communities", "Immigrant and first-generation communities", "West Denver neighborhoods", "Indigenous communities"],
    "grants_gov_applicant_types": ["nonprofits_non_higher_education_with_501c3"],
    "typical_grant_range": {"min": 5000, "max": 250000, "sweet_spot": "15000-75000"},
    "cost_sharing_capacity": false,
    "scoring_weights": {
      "mission_alignment": 30,
      "geographic_eligibility": 20,
      "applicant_eligibility": 20,
      "award_size_fit": 15,
      "population_alignment": 15
    },
    "disqualifiers": [
      "Requires for-profit applicant only",
      "Geographic restriction excludes Colorado",
      "Requires government entity as lead applicant",
      "Research-only grants with no program delivery component",
      "Grant size below $5,000"
    ]
  }',
  'You are evaluating grant opportunities for Confluence Colorado, a 501(c)(3) nonprofit based in Denver, Colorado.

MISSION: Connect people to place at the confluence of public and environmental health, and social and environmental justice.
LOCATION: Denver, Colorado — South Platte River corridor, Front Range, Southwestern US
TAX STATUS: 501(c)(3) nonprofit

PROGRAMS: Youth Leadership & Workforce Development (30-80 youth annually), Watershed Restoration (South Platte River), Natural Resource Conservation (Lorraine Granado Community Park), Outdoor Recreation & STREAM Education, Civic & Community Engagement, Public Health & Urban Agriculture (Mo Betta Green Marketplace partnership).

TARGET POPULATIONS: Underserved youth 14-24, BIPOC communities, immigrant and first-generation communities, West Denver neighborhoods, Indigenous communities.

GRANT SIZE: Sweet spot $15,000-$75,000. Max $250,000 with technical support. Minimum $5,000.

SCORE this opportunity 1-10 across five criteria, then return a weighted overall score:
- Mission alignment (30%): Does the grant focus match Confluence programs?
- Geographic eligibility (20%): Is Colorado/Denver explicitly eligible?
- Applicant eligibility (20%): Are 501(c)(3) nonprofits listed as eligible?
- Award size fit (15%): Is the award between $5,000-$250,000?
- Population alignment (15%): Does it target underserved youth, BIPOC, or environmental justice communities?

AUTO-REJECT (score=0) if: for-profit only, Colorado excluded, government entity required as lead, research-only, award below $5,000.

Return ONLY valid JSON:
{
  "scores": {"mission_alignment": 0, "geographic_eligibility": 0, "applicant_eligibility": 0, "award_size_fit": 0, "population_alignment": 0},
  "weighted_score": 0.0,
  "auto_rejected": false,
  "auto_reject_reason": null,
  "rationale": "",
  "red_flags": [],
  "recommended_action": "skip"
}'
);
