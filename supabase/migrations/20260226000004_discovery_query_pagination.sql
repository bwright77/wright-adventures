-- Track pagination state per discovery query so successive runs advance through
-- pages rather than re-fetching page 1 every time.
-- Wraps back to 1 after the last page is exhausted.

ALTER TABLE discovery_queries
  ADD COLUMN IF NOT EXISTS current_page INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN discovery_queries.current_page IS
  'Tracks the next page_offset to fetch from Simpler.Grants.gov. '
  'Incremented by the sync job after each successful fetch; resets to 1 after the last page.';
