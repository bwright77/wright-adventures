-- =============================================================================
-- MIGRATION: Add brand identity as a service line; River Sisters is in delivery
-- File: 20260819500000_brand_identity_service_line.sql
-- Date: 2026-08-19
--
-- The seven service lines were drawn from WA_ORG_PROFILE.services, which omits
-- brand work entirely — yet brand identity appears in three engagements and the
-- public case studies lead with it ("Built Confluence Colorado's brand identity
-- from the ground up — logo, visual language, and messaging").
--
-- It surfaced because River Sisters is still finalizing a logo redesign, and
-- there was nowhere to record that. The omission also costs scoring: the fit
-- rubric asks whether Wright Adventures could do the work, and a posting asking
-- for brand or identity work would have found no matching service.
-- =============================================================================

BEGIN;

ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS opportunities_service_lines_check;

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_service_lines_check
  CHECK (service_lines <@ ARRAY[
    'fractional_tech_leadership',
    'data_remediation',
    'custom_software',
    'websites_fundraising',
    'impact_storytelling',
    'development_strategy',
    'compliance',
    'brand_identity'
  ]::TEXT[]);

-- Backfill the three engagements that did brand work.
UPDATE opportunities
   SET service_lines = array_append(service_lines, 'brand_identity')
 WHERE partner_org ILIKE ANY (ARRAY['%River Sisters%', '%Confluence Colorado%', '%Kady%'])
   AND NOT ('brand_identity' = ANY (service_lines));

-- River Sisters: work is ongoing — social media strategy and a logo redesign
-- still being finalized. It was sitting at the in_delivery default because
-- nothing on file said either way; now it is recorded rather than assumed.
UPDATE partnership_details pd
   SET delivery_status = 'in_delivery',
       next_action     = 'Finalize the logo redesign and land the social media strategy. '
                         'The community artist owns the mark, so approvals run through the '
                         'coalition''s cultural leadership.'
  FROM opportunities o
 WHERE o.id = pd.opportunity_id
   AND o.partner_org ILIKE '%River Sisters%';

COMMIT;
