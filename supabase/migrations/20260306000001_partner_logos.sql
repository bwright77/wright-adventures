-- ============================================================
-- ADR-006 extension: partner logo URL on partnership_details
-- Date: 2026-03-06
-- ============================================================

ALTER TABLE partnership_details ADD COLUMN logo_url TEXT;
