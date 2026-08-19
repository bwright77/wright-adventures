-- =============================================================================
-- MIGRATION: Relationships become editable data
-- File: 20260819200000_org_relationships.sql
-- Date: 2026-08-19
-- ADR: ADR-011
--
-- The warm_path dimension is scored entirely against a relationship list that
-- lived in a hardcoded array in src/lib/discovery/waOrgProfile.ts. Editing it
-- meant a code change and a deploy, which is why it was incomplete — and an
-- incomplete list scores warm_path 0, which trips the downgrade gate and buries
-- a real opportunity a band lower than it deserves.
--
-- Two additions this migration makes possible, both of which prove the point:
--
--   TIER. A BBSP partner is not warm the way a client is. PeopleForBikes is a
--   direct relationship; the City of Philadelphia, NACTO and NABSA are warm
--   THROUGH it. The rubric already distinguishes these — 3 for direct history,
--   2 for shared network or a credible introduction — but a flat list gave the
--   scorer no way to tell them apart, so everything read as equally warm.
--
--   REACH. A single partnership carries a network behind it. BBSP alone brings
--   partner cities, sector bodies, and the living labs. None of that was
--   reachable while the list was a literal in a source file.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS org_relationships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  org        TEXT NOT NULL,
  basis      TEXT NOT NULL,

  -- 'direct'  → warm_path 3 territory: a client, or a principal's own history
  -- 'network' → warm_path 2 territory: reachable through someone we know
  tier       TEXT NOT NULL DEFAULT 'direct',

  -- For network relationships, who the introduction runs through.
  via        TEXT,

  is_active  BOOLEAN NOT NULL DEFAULT true,
  notes      TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE org_relationships
  DROP CONSTRAINT IF EXISTS org_relationships_tier_check;
ALTER TABLE org_relationships
  ADD CONSTRAINT org_relationships_tier_check CHECK (tier IN ('direct', 'network'));

CREATE UNIQUE INDEX IF NOT EXISTS org_relationships_org_idx ON org_relationships (lower(org));

COMMENT ON TABLE org_relationships IS
  'Warm-path network, editable from Settings. Injected into the Sonnet scoring '
  'prompt for the warm_path dimension (ADR-011). Closed-won clients are merged '
  'in automatically at scoring time and do not need rows here.';
COMMENT ON COLUMN org_relationships.tier IS
  '''direct'' = client or principal history (rubric 3). ''network'' = reachable '
  'through a relationship we already have (rubric 2).';

ALTER TABLE org_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read org_relationships"
  ON org_relationships FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin and manager can modify org_relationships"
  ON org_relationships FOR ALL TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'));

CREATE OR REPLACE FUNCTION update_org_relationships_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER org_relationships_updated_at
  BEFORE UPDATE ON org_relationships
  FOR EACH ROW EXECUTE FUNCTION update_org_relationships_timestamp();

-- -----------------------------------------------------------------------------
-- Seed: the nine that were hardcoded, plus the BBSP partnership network.
-- -----------------------------------------------------------------------------
INSERT INTO org_relationships (org, basis, tier, via) VALUES
  ('Confluence Colorado',      'Shane is Executive Director; WA builds and runs their platform', 'direct', NULL),
  ('Colorado Mountain Club',   'Active engagement — hiring, ops, compliance',                    'direct', NULL),
  ('Groundwork Denver',        'Shane formerly Youth Program Director',                          'direct', NULL),
  ('GOBRP / Golden Optimists', 'Shane''s Groundwork-era work with Ted Rains',                    'direct', NULL),
  ('Lincoln Hills Cares',      'Funding strategy and program infrastructure',                    'direct', NULL),
  ('PeopleForBikes / BBSP',    'Digital legacy and archive engagement',                          'direct', NULL),
  ('Kady Youth Sheep Camp',    'Fiscal partner; brand and web',                                  'direct', NULL),
  ('River Sisters',            'Brand, bilingual web, advocacy engine',                          'direct', NULL),
  ('Mo''Betta Green',          'Registration, donations, commerce on a custom admin',            'direct', NULL),

  -- The Better Bike Share Partnership was a partnership, so its partners and
  -- living labs are reachable through it.
  ('City of Philadelphia',     'BBSP partner city',                                              'network', 'PeopleForBikes / BBSP'),
  ('NACTO',                    'BBSP partner — National Association of City Transportation Officials', 'network', 'PeopleForBikes / BBSP'),
  ('NABSA',                    'BBSP partner — North American Bikeshare & Scootershare Association',   'network', 'PeopleForBikes / BBSP'),
  ('Tugo Bike Share',          'BBSP living lab',                                                'network', 'PeopleForBikes / BBSP'),
  ('Bike LA',                  'BBSP living lab',                                                'network', 'PeopleForBikes / BBSP')
ON CONFLICT (lower(org)) DO NOTHING;

COMMIT;
