-- =============================================================================
-- MIGRATION: Size the token budget to the actual workload
-- File: 20260819000000_realistic_token_budget.sql
-- Date: 2026-08-19
--
-- monthly_limit has been 500,000 since March, when the only consumer was grant
-- chat. Opportunity discovery is a different workload: every extracted candidate
-- gets a Sonnet scoring call, and measured across 301 candidates the cost is
-- ~4,250 tokens each.
--
-- Derived rather than guessed, from the sources as configured:
--   CNA posts ~7.2/day  → ~50/week  → ~910k tokens/month
--   AHJL + Denver       → ~22/run   → ~375k tokens/month
--   ------------------------------------------------------
--   realistic steady state          ≈ 1.3M tokens/month
--
-- Set to 1,500,000 — above steady state, with room for a first run on a new
-- source, and low enough that a runaway still shows as over budget.
--
-- Deliberately still ADVISORY. Nothing enforces it, and that is the right
-- default here: a hard stop mid-run would either lose candidates or, given the
-- truncation behaviour, restart the window and re-spend. The number exists to
-- be looked at, not to gate work. Pre-filtering candidates to save tokens was
-- considered and rejected — a full-time posting can be argued into a firm
-- engagement, and warm_path 0 usually means the relationship list is incomplete.
-- =============================================================================

BEGIN;

UPDATE token_budgets
   SET monthly_limit = 1500000,
       updated_at    = now()
 WHERE id = (SELECT id FROM token_budgets ORDER BY current_period_start DESC LIMIT 1);

COMMENT ON COLUMN token_budgets.monthly_limit IS
  'Advisory ceiling shown in Settings. Not enforced: a hard stop mid-run would '
  'lose candidates or re-spend the window. Sized from measured cost per '
  'candidate (~4,250 tokens) and source posting rates.';

COMMIT;
