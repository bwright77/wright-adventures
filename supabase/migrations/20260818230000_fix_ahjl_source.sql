-- =============================================================================
-- MIGRATION: Point Andrew Hudson's at a listing page that actually has listings
-- File: 20260818230000_fix_ahjl_source.sql
-- Date: 2026-08-18
-- ADR: ADR-011
--
-- The seeded URL was the site root, which returns a category index — "Nonprofit
-- Charitable Organizations (58), Communications (34), Development and
-- Fundraising (27)" — counts, not postings.
--
-- /job-category/nonprofit-charitable-organizations/ returns real listing text
-- with employer, location, date, and role type per posting, and pre-filters to
-- the category worth watching. Verified: 5,988 bytes of posting content.
--
-- A better long-term answer exists and is not built yet: the site publishes
-- job-sitemap.xml with 208 individual posting URLs. Consuming that needs a
-- two-tier fetch (sitemap -> per-posting detail), which would also unlock
-- Denver, whose sitemap likewise exposes individual bid pages while its index
-- yields only a language-selector widget. Deferred rather than rushed.
-- =============================================================================

BEGIN;

UPDATE discovery_sources
   SET url        = 'https://andrewhudsonsjobslist.com/job-category/nonprofit-charitable-organizations/',
       enabled    = true,
       last_error = NULL,
       consecutive_errors = 0,
       -- Force a full re-read: the cached hash and text belong to the old URL.
       last_content_hash = NULL,
       last_content_text = NULL,
       relevance_notes =
         'Contract, consultant, and fractional roles in development, communications, and '
         'technology. Postings state employer, location, date, and Full Time / Part Time / '
         'Contract. Skip full-time W-2 unless it names a fixed term or interim scope.'
 WHERE label = 'Andrew Hudson''s Jobs List';

COMMIT;
