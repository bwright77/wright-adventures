-- =============================================================================
-- MIGRATION: ADR-012 Phase 1 — organizations
-- File: 20260822100000_organizations.sql
-- Date: 2026-08-22
--
-- The organisation is the durable thing. Until now it was a free-text string on
-- opportunities.partner_org, which is why the logo lookup had to GUESS a website
-- from a name, and why nothing recorded that CMC's existing contract and the new
-- tech-services pursuit are the same organisation.
--
-- Two sources have to be merged, and they SPELL THE SAME ORGS DIFFERENTLY:
--
--   opportunities.partner_org   "PeopleForBikes Foundation"
--   org_relationships.org       "PeopleForBikes / BBSP"
--
-- So the merge is an explicit map, written out below. Fuzzy matching over 26
-- rows would silently fuse the wrong pair and nobody would notice until a logo
-- showed up on the wrong client — which has already happened once on this repo.
--
-- Nothing is dropped here. partner_org stays until the UI stops reading it
-- (Phase 5), so this migration is additive and revertible.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. The table.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL UNIQUE,
  website            TEXT,
  logo_url           TEXT,
  sector             TEXT,

  -- How warm. 'client' is maintained by a trigger in Phase 4 once engagements
  -- exist; until then it is set from closed-won opportunities below.
  relationship_tier  TEXT NOT NULL DEFAULT 'none'
                     CHECK (relationship_tier IN ('none', 'network', 'prospect', 'client')),
  -- Why we know them. Carried from org_relationships.basis.
  relationship_basis TEXT,
  -- The warm path: who introduces us. NACTO is reachable *via* PeopleForBikes.
  via_org_id         UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- Nurture is a state of the ORGANISATION (ADR-012), not a pipeline stage. An
  -- org with a revisit date is one we are deliberately keeping warm with no deal
  -- on the table yet.
  revisit_on         DATE,
  nurture_note       TEXT,

  notes              TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE organizations IS
  'The durable entity. Leads, opportunities and (Phase 4) engagements all point here.';
COMMENT ON COLUMN organizations.relationship_tier IS
  'none | network | prospect | client. An org is a client because it has work, '
  'not because someone ticked a box — Phase 4 enforces that with a trigger.';

CREATE INDEX IF NOT EXISTS organizations_tier_idx    ON organizations (relationship_tier);
CREATE INDEX IF NOT EXISTS organizations_revisit_idx ON organizations (revisit_on) WHERE revisit_on IS NOT NULL;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read organizations"
  ON organizations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin and manager can modify organizations"
  ON organizations FOR ALL TO authenticated
  USING      ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'))
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'manager'));

-- -----------------------------------------------------------------------------
-- 2. Link column, added before the backfill so tiers can be derived from it.
-- -----------------------------------------------------------------------------
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS opportunities_organization_idx ON opportunities (organization_id);

-- -----------------------------------------------------------------------------
-- 3. Backfill from the opportunities that name an org. Names come FROM THE DATA
--    rather than being retyped here, so a typo cannot orphan a row.
-- -----------------------------------------------------------------------------
INSERT INTO organizations (name, logo_url, revisit_on)
SELECT DISTINCT ON (o.partner_org)
       o.partner_org,
       d.logo_url,
       d.revisit_on
  FROM opportunities o
  LEFT JOIN partnership_details d ON d.opportunity_id = o.id
 WHERE o.type_id = 'partnership'
   AND o.partner_org IS NOT NULL
   AND btrim(o.partner_org) <> ''
 ORDER BY o.partner_org, d.logo_url NULLS LAST
ON CONFLICT (name) DO NOTHING;

UPDATE opportunities o
   SET organization_id = g.id
  FROM organizations g
 WHERE g.name = o.partner_org
   AND o.organization_id IS NULL;

-- -----------------------------------------------------------------------------
-- 4. THE MERGE MAP. Left = how org_relationships spells it, right = the
--    canonical name already created above from partner_org. A NULL right-hand
--    side means the org exists only as a relationship and must be created.
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE rel_map (rel_name TEXT PRIMARY KEY, canonical TEXT) ON COMMIT DROP;

INSERT INTO rel_map (rel_name, canonical) VALUES
  ('Confluence Colorado',       'Confluence Colorado'),
  ('Colorado Mountain Club',    'Colorado Mountain Club'),
  ('Kady Youth Sheep Camp',     'Kady Youth Sheep Camp'),
  ('GOBRP / Golden Optimists',  'Golden Optimists Bicycle Recycle Program (GOBRP)'),
  ('PeopleForBikes / BBSP',     'PeopleForBikes Foundation'),
  ('River Sisters',             'River Sisters · Hermanas del Río'),
  ('Mo''Betta Green',           'Mo''Betta Green MarketPlace'),
  -- Relationships with no opportunity of their own — created fresh.
  ('Groundwork Denver',         NULL),
  ('Lincoln Hills Cares',       NULL),
  ('City of Philadelphia',      NULL),
  ('NACTO',                     NULL),
  ('NABSA',                     NULL),
  ('Tugo Bike Share',           NULL),
  ('Bike LA',                   NULL);

-- Guard: if org_relationships gains a row that is not in the map, fail loudly
-- rather than silently dropping that relationship on the floor.
DO $$
DECLARE missing TEXT;
BEGIN
  SELECT string_agg(r.org, ', ') INTO missing
    FROM org_relationships r
   WHERE NOT EXISTS (SELECT 1 FROM rel_map m WHERE m.rel_name = r.org);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'org_relationships rows not covered by the merge map: %', missing;
  END IF;
END $$;

-- Create the relationship-only orgs.
INSERT INTO organizations (name, relationship_tier, relationship_basis, notes)
SELECT r.org,
       CASE WHEN r.tier = 'network' THEN 'network' ELSE 'network' END,
       r.basis,
       r.notes
  FROM org_relationships r
  JOIN rel_map m ON m.rel_name = r.org
 WHERE m.canonical IS NULL
ON CONFLICT (name) DO NOTHING;

-- Carry basis/notes onto the orgs that already existed under another name.
UPDATE organizations g
   SET relationship_basis = COALESCE(g.relationship_basis, r.basis),
       notes              = COALESCE(g.notes, r.notes)
  FROM rel_map m
  JOIN org_relationships r ON r.org = m.rel_name
 WHERE m.canonical = g.name;

-- The warm path. Every 'via' in the data points at PeopleForBikes / BBSP.
UPDATE organizations g
   SET via_org_id = target.id
  FROM org_relationships r
  JOIN rel_map m       ON m.rel_name = r.org
  JOIN rel_map via_m   ON via_m.rel_name = r.via
  JOIN organizations target ON target.name = COALESCE(via_m.canonical, via_m.rel_name)
 WHERE g.name = COALESCE(m.canonical, m.rel_name)
   AND r.via IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. Tiers, derived from what the data actually says rather than hand-assigned.
-- -----------------------------------------------------------------------------
UPDATE organizations g SET relationship_tier = 'prospect'
 WHERE EXISTS (
   SELECT 1 FROM opportunities o
    WHERE o.organization_id = g.id
      AND o.status IN ('partnership_qualifying','partnership_discovery','partnership_proposal',
                       'partnership_evaluation','partnership_approval','partnership_negotiating')
 );

-- Client last, so it wins over prospect for an org doing both (CMC).
UPDATE organizations g SET relationship_tier = 'client'
 WHERE EXISTS (
   SELECT 1 FROM opportunities o
    WHERE o.organization_id = g.id AND o.status = 'partnership_closed_won'
 );

-- Orgs parked in the nurture stage become network orgs carrying their revisit
-- date — the stage itself goes away in Phase 3.
UPDATE organizations g SET relationship_tier = 'network'
 WHERE relationship_tier = 'none'
   AND EXISTS (
     SELECT 1 FROM opportunities o
      WHERE o.organization_id = g.id AND o.status = 'partnership_nurture'
   );

UPDATE organizations SET updated_at = now();

COMMIT;
