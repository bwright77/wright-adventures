-- =============================================================================
-- MIGRATION: Sitemap fetch mode — reach detail pages behind a JS-rendered index
-- File: 20260818260000_sitemap_fetch_mode.sql
-- Date: 2026-08-18
-- ADR: ADR-011
--
-- Two sources publish everything we want, just not on a page we can fetch:
--
--   Denver Procurement       every index URL 404s or returns a language-selector
--                            widget, but denvergov.org/sitemap.xml lists
--                            individual bid pages at
--                            /Business/Contract-Administration/Bids/<id>
--   Andrew Hudson's          job-sitemap.xml carries 208 posting URLs, against a
--                            category page that only shows the current window
--
-- So: fetch the sitemap, filter to the URLs that are items, fetch those pages,
-- and concatenate them into the same text blob the html and wp_rest modes
-- produce. Hashing, diffing, extraction and scoring downstream are unchanged.
--
-- The cost control is `lastmod`. 208 detail fetches followed by a Haiku pass over
-- all of them would be slow and expensive on every run, so a sitemap source only
-- fetches entries modified since its last successful check, newest first, capped
-- at max_items_per_run. A first run has no baseline and takes the newest N.
-- =============================================================================

BEGIN;

ALTER TABLE discovery_sources
  DROP CONSTRAINT IF EXISTS discovery_sources_fetch_mode_check;

ALTER TABLE discovery_sources
  ADD CONSTRAINT discovery_sources_fetch_mode_check
  CHECK (fetch_mode IN ('html', 'wp_rest', 'sitemap'));

ALTER TABLE discovery_sources
  ADD COLUMN IF NOT EXISTS item_url_pattern  TEXT,
  ADD COLUMN IF NOT EXISTS max_items_per_run INTEGER NOT NULL DEFAULT 25;

COMMENT ON COLUMN discovery_sources.item_url_pattern IS
  'sitemap mode only. Substring a <loc> must contain to count as an item page, '
  'e.g. ''/Contract-Administration/Bids/''. Without it every URL in the sitemap '
  'would be fetched, including the marketing pages.';

COMMENT ON COLUMN discovery_sources.max_items_per_run IS
  'sitemap mode only. Ceiling on detail pages fetched per run. Entries are taken '
  'newest-first by <lastmod>, so the cap drops the stalest, not a random slice.';

-- -----------------------------------------------------------------------------
-- Denver — re-enabled against its sitemap.
-- -----------------------------------------------------------------------------
UPDATE discovery_sources
   SET url               = 'https://www.denvergov.org/sitemap.xml',
       fetch_mode        = 'sitemap',
       item_url_pattern  = '/Business/Contract-Administration/Bids/',
       max_items_per_run = 25,
       enabled           = true,
       last_error        = NULL,
       consecutive_errors = 0,
       last_content_hash = NULL,
       last_content_text = NULL,
       relevance_notes =
         'City and County of Denver solicitations. Prioritize professional services, '
         'consulting, technology, data, communications, website, and community engagement '
         'work. Construction and materials procurement is out of scope — extract it only if '
         'it names design, data, or communications services. Note the solicitation number '
         'and the response deadline.'
 WHERE label = 'Denver Procurement';

-- -----------------------------------------------------------------------------
-- Andrew Hudson's — from the category page to the full posting sitemap.
-- -----------------------------------------------------------------------------
UPDATE discovery_sources
   SET url               = 'https://andrewhudsonsjobslist.com/job-sitemap.xml',
       fetch_mode        = 'sitemap',
       item_url_pattern  = '/jobs/',
       max_items_per_run = 25,
       last_content_hash = NULL,
       last_content_text = NULL
 WHERE label = 'Andrew Hudson''s Jobs List';

COMMIT;
