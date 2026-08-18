-- =============================================================================
-- MIGRATION: Record how a list_value was derived
-- File: 20260818250000_list_value_basis.sql
-- Date: 2026-08-18
--
-- `list_value` on pro-bono and portfolio engagements is a fair-market-value
-- figure, and it does not stay inside this application. Under GAAP
-- (ASC 958-605, as amended by FASB ASU 2020-07) a nonprofit records donated
-- professional services as a contributed nonfinancial asset when they require
-- specialized skills, are provided by someone who has them, and would otherwise
-- have to be purchased. So these numbers travel into recipients' financial
-- statements, Form 990 Schedule M, and in-kind match on grant applications.
--
-- A number with no stated basis is indefensible the moment anyone asks how it
-- was reached. This column holds the derivation — scope, hours, rate basis, and
-- anything that reduces the figure — so the reasoning survives alongside it.
-- =============================================================================

BEGIN;

ALTER TABLE partnership_details
  ADD COLUMN IF NOT EXISTS list_value_basis TEXT;

COMMENT ON COLUMN partnership_details.list_value_basis IS
  'How list_value was derived: scope, hour estimate, rate basis, and any factors '
  'that reduce it. Required in practice for any pro_bono or portfolio engagement, '
  'because the figure is used in the recipient''s GAAP reporting and grant in-kind '
  'match. NOTE: donated services are NOT deductible by the donor — only '
  'unreimbursed out-of-pocket costs are.';

COMMIT;
