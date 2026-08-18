-- =============================================================================
-- MIGRATION: Source fetch modes, and corrections from the first live probe
-- File: 20260818220000_source_fetch_mode.sql
-- Author: Benjamin Wright, Director of Technology & Innovation
-- Date: 2026-08-18
-- ADR: ADR-011 (amends §Decision, "Procurement portals before job boards")
--
-- The first probe of the seeded sources (scripts/probe-sources.ts) found that
-- three of four return nothing usable to a plain fetch:
--
--   Rocky Mountain E-Purchasing  HTTP 200, but the body is marketing copy
--                                inviting vendors to register. Solicitations sit
--                                behind a login. No amount of parsing helps.
--   Denver Procurement           Request timed out; the seeded URL is wrong.
--   Colorado Nonprofit Assoc.    Index is a Next.js shell — 1,730 bytes of
--                                filter controls, zero listings. BUT the site is
--                                a front end over WordPress, and
--                                api.coloradononprofits.org/wp-json/wp/v2/careers
--                                serves the posts as clean JSON.
--   Andrew Hudson's Jobs List    Root page yields category counts, not listings.
--                                Its RSS feed carries blog articles only.
--
-- The premise that procurement portals would be the best source does not
-- survive contact: the one scoring highest on engagement shape is the one that
-- requires an account. That is a finding, not a defect — it is recorded here and
-- the sources are set to what actually works.
--
-- `fetch_mode` lets a source say how its content is retrieved. 'wp_rest' fetches
-- a WordPress REST collection and flattens title + content per item into the
-- same text blob the HTML path produces, so hashing, diffing, extraction and
-- scoring downstream are unchanged.
-- =============================================================================

BEGIN;

ALTER TABLE discovery_sources
  ADD COLUMN IF NOT EXISTS fetch_mode TEXT NOT NULL DEFAULT 'html';

ALTER TABLE discovery_sources
  DROP CONSTRAINT IF EXISTS discovery_sources_fetch_mode_check;

ALTER TABLE discovery_sources
  ADD CONSTRAINT discovery_sources_fetch_mode_check
  CHECK (fetch_mode IN ('html', 'wp_rest'));

COMMENT ON COLUMN discovery_sources.fetch_mode IS
  '''html'' = fetch and strip the page. ''wp_rest'' = fetch a WordPress REST '
  'collection and flatten title + content per item. Structured endpoints are '
  'preferred wherever one exists — see ADR-011.';

-- -----------------------------------------------------------------------------
-- Colorado Nonprofit Association → its WordPress REST collection.
-- Ordered newest-first and capped; the diff against last run is what makes
-- repeat pulls cheap.
-- -----------------------------------------------------------------------------
UPDATE discovery_sources
   SET url        = 'https://api.coloradononprofits.org/wp-json/wp/v2/careers?per_page=40&orderby=date&order=desc',
       fetch_mode = 'wp_rest',
       relevance_notes =
         'Independent Contractor postings above all — the "Type of role" field states it '
         'explicitly. Then Development, IT, and Marketing categories. Flag anything using '
         'the words RFP, RFQ, consultant, or firm. Detail pages carry role type, category, '
         'region, and a compensation range verbatim.'
 WHERE label = 'Colorado Nonprofit Association';

-- -----------------------------------------------------------------------------
-- Disable what cannot work rather than letting it three-strike itself out and
-- look like an intermittent failure.
-- -----------------------------------------------------------------------------
UPDATE discovery_sources
   SET enabled    = false,
       last_error = 'Registration-gated: solicitations require a RMEPS vendor account. '
                    'Plain fetch returns only the marketing page. Needs an authenticated '
                    'fetch or the paid alert product — out of scope per ADR-011.'
 WHERE label = 'Rocky Mountain E-Purchasing';

UPDATE discovery_sources
   SET enabled    = false,
       last_error = 'Seeded URL timed out on first probe. Needs the correct Denver '
                    'solicitations URL before re-enabling.'
 WHERE label = 'Denver Procurement';

UPDATE discovery_sources
   SET last_error = 'Root page returns category counts, not listings; listings are likely '
                    'one level down. Left enabled — the extractor may still surface the '
                    'category signal — but expect thin results until a listing URL is found.'
 WHERE label = 'Andrew Hudson''s Jobs List';

COMMIT;
