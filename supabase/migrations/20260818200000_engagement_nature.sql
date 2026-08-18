-- =============================================================================
-- MIGRATION: Engagement nature — portfolio, pro-bono, and discounted work
-- File: 20260818200000_engagement_nature.sql
-- Author: Benjamin Wright, Director of Technology & Innovation
-- Date: 2026-08-18
--
-- Not every won engagement is priced at market, and the ones that aren't still
-- matter: they are the portfolio. Without a way to say so, a $0 pro-bono build
-- is indistinguishable from a deal that fell through, and four of them would
-- quietly inflate win rate while dragging average deal size to nothing.
--
--   paid          full rate
--   reduced_rate  billed at a discount (BBSP: 40% friends & family off $10,875)
--   portfolio     nominal fee, taken mainly for the reference (Mo'Betta: $600)
--   pro_bono      no fee (Kady, River Sisters)
--
-- `list_value` records what the work was worth at standard rate. For pro-bono
-- and portfolio engagements that is the contributed value — the number worth
-- reporting — while `estimated_value` stays what was actually billed.
-- =============================================================================

BEGIN;

ALTER TABLE partnership_details
  ADD COLUMN IF NOT EXISTS engagement_nature TEXT NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS list_value NUMERIC(12,2);

ALTER TABLE partnership_details
  DROP CONSTRAINT IF EXISTS partnership_details_engagement_nature_check;

ALTER TABLE partnership_details
  ADD CONSTRAINT partnership_details_engagement_nature_check
  CHECK (engagement_nature IN ('paid', 'reduced_rate', 'portfolio', 'pro_bono'));

COMMENT ON COLUMN partnership_details.engagement_nature IS
  'How the engagement is priced. Non-paid work is excluded from win rate and '
  'pipeline value in the analytics so the portfolio does not distort the sales numbers.';

COMMENT ON COLUMN partnership_details.list_value IS
  'Value of the work at standard rate, before any discount. NUMERIC — Supabase JS '
  'returns a string; coerce with Number(). For pro_bono/portfolio this is the '
  'contributed value; estimated_value remains what was actually billed.';

CREATE INDEX IF NOT EXISTS partnership_details_engagement_nature_idx
  ON partnership_details(engagement_nature);

COMMIT;
