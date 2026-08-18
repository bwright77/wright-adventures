-- =============================================================================
-- MIGRATION: Stop filtering at extraction time
-- File: 20260818240000_extraction_not_filtering.sql
-- Date: 2026-08-18
-- ADR: ADR-011
--
-- Andrew Hudson's returned zero candidates from a page full of real postings.
-- Not a fetch failure and not a parse failure — Haiku returned `[]` on purpose,
-- because its relevance_notes ended "Skip full-time W-2 unless it names a fixed
-- term or interim scope" and that category page is almost entirely full-time
-- roles. The instruction was obeyed exactly.
--
-- That is filtering at the wrong stage. The rubric already handles employment
-- roles: engagement_shape scores 0 and the gate downgrades a band. Excluding
-- them during extraction means no record they existed, no chance for scoring to
-- notice a full-time role at an organization we have a warm path into, and a
-- working source that presents as broken.
--
-- relevance_notes now express PRIORITY, never exclusion. The extraction prompt
-- carries a matching rule so a future note cannot reintroduce the behaviour.
-- =============================================================================

BEGIN;

UPDATE discovery_sources
   SET relevance_notes =
         'Prioritize contract, consultant, fractional, and interim roles in development, '
         'communications, technology, and data. Full-time postings are still worth '
         'extracting — scoring decides. Note explicitly when a posting names a fixed term, '
         'interim scope, RFP, RFQ, consultant, or firm.',
       last_content_hash = NULL,
       last_content_text = NULL
 WHERE label = 'Andrew Hudson''s Jobs List';

UPDATE discovery_sources
   SET relevance_notes =
         'Prioritize Independent Contractor postings — the "Type of role" field states it '
         'explicitly — then Development, IT, and Marketing categories. Extract every posting '
         'regardless of role type; scoring decides. Detail pages carry role type, category, '
         'region, and a compensation range verbatim.'
 WHERE label = 'Colorado Nonprofit Association';

COMMIT;
