-- =============================================================================
-- MIGRATION: engagement_shape → convertibility in stored fit scores
-- File: 20260903000000_convertibility_rename.sql
-- Date: 2026-09-03
--
-- ADR-011's first rubric dimension changed meaning, not just name. It used to
-- ask "is this already shaped like a contract"; it now asks "can we credibly
-- propose something better for the same money". GOBRP was a posted role that
-- converted into a firm proposal and reached interview, and the old dimension
-- had no way to say that.
--
-- The Leads card renders every dimension by iterating DIMENSION_LABELS, so a
-- rename in code alone would blank the first row for all 48 already-scored
-- leads and both scored opportunities. The key moves with it.
--
-- The VALUES are left exactly as scored. Re-scoring historical rows against a
-- rubric they were not judged under would invent decisions nobody made; the
-- old scale's meaning is preserved in whatever rationale was stored alongside.
-- =============================================================================

BEGIN;

UPDATE leads
   SET ai_score_detail = jsonb_set(
         ai_score_detail #- '{scores,engagement_shape}',
         '{scores,convertibility}',
         ai_score_detail #> '{scores,engagement_shape}'
       )
 WHERE ai_score_detail #> '{scores,engagement_shape}' IS NOT NULL;

UPDATE opportunities
   SET ai_score_detail = jsonb_set(
         ai_score_detail #- '{scores,engagement_shape}',
         '{scores,convertibility}',
         ai_score_detail #> '{scores,engagement_shape}'
       )
 WHERE ai_score_detail #> '{scores,engagement_shape}' IS NOT NULL;

-- Rejections keep the same shape under a differently-named column.
UPDATE discovery_rejections
   SET score_detail = jsonb_set(
         score_detail #- '{scores,engagement_shape}',
         '{scores,convertibility}',
         score_detail #> '{scores,engagement_shape}'
       )
 WHERE score_detail #> '{scores,engagement_shape}' IS NOT NULL;

COMMIT;
