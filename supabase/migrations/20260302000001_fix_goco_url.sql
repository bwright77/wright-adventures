-- =============================================================================
-- Migration: 20260302000001_fix_goco_url.sql
-- Fix GOCO source URL — /programs-projects/our-grant-programs returns HTTP 503.
-- Correct URL: /grants/apply (verified 2026-03-02, returns HTTP 200).
-- =============================================================================

UPDATE discovery_sources
SET
  url        = 'https://goco.org/grants/apply',
  updated_at = now()
WHERE label = 'GOCO — Grant Programs'
  AND url   = 'https://goco.org/programs-projects/our-grant-programs';
