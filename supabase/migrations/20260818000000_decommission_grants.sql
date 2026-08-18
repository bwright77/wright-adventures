-- =============================================================================
-- MIGRATION: Decommission grant, AI-writing, and board-minutes surfaces
-- File: 20260818000000_decommission_grants.sql
-- Author: Benjamin Wright, Director of Technology & Innovation
-- Date: 2026-08-18
-- ADR: ADR-009 §Implementation Sequence, Phases 4–5
--
-- Wright Adventures becomes partnerships-only. Grants, AI grant writing, grant
-- discovery, and board minutes have moved to Confluence Colorado's own Supabase
-- project (ADR-009 Phases 1–3, completed).
--
-- ⚠️  POINT OF NO RETURN. Until this runs, WA's copy of the grant data is the
--     rollback for the Confluence migration. ADR-009 recommends holding it
--     read-only for 30 days after Confluence goes live. Do not apply this until
--     that window has passed and Confluence is verified.
--
-- RETAINED DELIBERATELY (do not drop — ADR-011 reuses them):
--   • discovery_sources, discovery_runs, org_profiles — the ADR-005 monitoring
--     machinery, being repointed at RFP/procurement and job sources for WA's own
--     pipeline. Their grant-era *rows* are deleted here; the tables stay.
--   • opportunities.discovery_source_id — same reason.
--   • token_budgets — dormant. No writer remains after api/ai/* was deleted, but
--     ADR-011 will meter fit-scoring against it. Kept to avoid drop-and-re-add.
--   • notification_preferences.opportunity_discovered — dormant; ADR-011 restores
--     a producer for it.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Grant opportunities and everything hanging off them.
--    tasks, documents, custom_deadlines, activity_log, opportunity_contributors,
--    and ai_conversations all declare ON DELETE CASCADE; notification_log sets
--    NULL. One delete is sufficient.
-- -----------------------------------------------------------------------------
DELETE FROM opportunities WHERE type_id = 'grant';

-- -----------------------------------------------------------------------------
-- 2. AI grant writing (ADR-001). ai_messages first — it references conversations.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS ai_messages     CASCADE;
DROP TABLE IF EXISTS ai_conversations CASCADE;

-- -----------------------------------------------------------------------------
-- 3. Board minutes (ADR-004), plus its private transcript bucket.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS board_meetings CASCADE;

DELETE FROM storage.objects WHERE bucket_id = 'board-meeting-transcripts';
DELETE FROM storage.buckets WHERE id        = 'board-meeting-transcripts';

-- -----------------------------------------------------------------------------
-- 4. Federal grants.gov query set (ADR-002). Grant-specific; the state/local
--    source machinery in discovery_sources is retained per the header note.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS discovery_queries CASCADE;

-- -----------------------------------------------------------------------------
-- 5. Grant-era rows in the retained discovery tables.
-- -----------------------------------------------------------------------------
DELETE FROM discovery_runs    WHERE source_type IN ('federal', 'state');
DELETE FROM discovery_sources WHERE source_type IN ('state', 'local', 'foundation', 'federal_api');
DELETE FROM org_profiles;   -- the Confluence Colorado scoring profile; ADR-011 seeds WA's

-- -----------------------------------------------------------------------------
-- 6. Grant pipeline configuration. Order matters: template items → templates →
--    statuses → the opportunity_types row they all reference.
-- -----------------------------------------------------------------------------
DELETE FROM task_template_items
 WHERE template_id IN (SELECT id FROM task_templates WHERE type_id = 'grant');

DELETE FROM task_templates   WHERE type_id = 'grant';
DELETE FROM pipeline_statuses WHERE type_id = 'grant';
DELETE FROM opportunity_types WHERE id      = 'grant';

-- -----------------------------------------------------------------------------
-- 7. Grant-specific columns on opportunities.
-- -----------------------------------------------------------------------------
ALTER TABLE opportunities
  DROP COLUMN IF EXISTS funder,
  DROP COLUMN IF EXISTS grant_type,
  DROP COLUMN IF EXISTS amount_max,
  DROP COLUMN IF EXISTS amount_requested,
  DROP COLUMN IF EXISTS amount_awarded,
  DROP COLUMN IF EXISTS loi_deadline,
  DROP COLUMN IF EXISTS cfda_number,
  DROP COLUMN IF EXISTS eligibility_notes;

-- -----------------------------------------------------------------------------
-- 8. Documentation of intent for the next reader.
-- -----------------------------------------------------------------------------
COMMENT ON TABLE discovery_sources IS
  'Monitored source index pages. Grant sources removed in the ADR-009 split; '
  'repointed at RFP/procurement and job boards for WA''s own pipeline (ADR-011).';

COMMENT ON TABLE token_budgets IS
  'Dormant after ADR-009. Retained for ADR-011 fit-scoring metering.';

COMMIT;

-- -----------------------------------------------------------------------------
-- Post-apply verification (run manually; not part of the transaction):
--
--   SELECT type_id, count(*) FROM opportunities GROUP BY type_id;
--     -- expect only 'partnership'
--   SELECT count(*) FROM pipeline_statuses WHERE type_id = 'grant';
--     -- expect 0
--   SELECT to_regclass('public.board_meetings'), to_regclass('public.ai_messages');
--     -- expect NULL, NULL
--   SELECT to_regclass('public.discovery_sources'), to_regclass('public.org_profiles');
--     -- expect non-NULL (retained for ADR-011)
-- -----------------------------------------------------------------------------
