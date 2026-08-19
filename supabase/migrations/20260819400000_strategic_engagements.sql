-- =============================================================================
-- MIGRATION: A 'strategic' engagement nature, and Confluence Colorado
-- File: 20260819400000_strategic_engagements.sql
-- Date: 2026-08-19
--
-- Four engagements — Mo'Betta Green, River Sisters, Kady Youth Sheep Camp and
-- Confluence Colorado — were recorded as pro_bono or portfolio. Both are wrong.
-- They describe work given away, and this work is not given away. It is
-- invested, against a return path that runs:
--
--   1. Shane does the fundraising and grant writing for all four. Confluence
--      Colorado is the fiscal agent and 501(c)(3).
--   2. Confluence takes an administration fee on grants won, and Wright
--      Adventures writes a technical-support ask into the grants themselves.
--   3. The websites and digital work supply the storytelling and legitimacy
--      that win those grants.
--   4. And it is portfolio work on top of that.
--
-- So the digital work is an INPUT to grant revenue, not charity. Calling it
-- pro_bono understates it in two directions at once: it makes the pipeline look
-- emptier than it is, and it frames a deliberate investment as a donation.
--
-- 'strategic' names that: below market by design, with an expected indirect
-- return. It stays outside the commercial metrics — no cash is booked against
-- it — but it is reported as investment rather than contribution.
--
-- NOTE for any future reporting: the ~$36,600 currently summed as "contributed
-- value" mixes these four with genuinely donated work. The FMV figures remain
-- correct for the RECIPIENTS' books under ASC 958-605 — they received the
-- services either way — but Wright Adventures should not describe engagements
-- carrying an expected return as purely charitable contributions.
-- =============================================================================

BEGIN;

ALTER TABLE partnership_details
  DROP CONSTRAINT IF EXISTS partnership_details_engagement_nature_check;

ALTER TABLE partnership_details
  ADD CONSTRAINT partnership_details_engagement_nature_check
  CHECK (engagement_nature IN ('paid', 'reduced_rate', 'portfolio', 'pro_bono', 'strategic'));

COMMENT ON COLUMN partnership_details.engagement_nature IS
  'How the engagement is priced. '
  'paid = full rate. reduced_rate = discounted. portfolio = nominal fee, taken '
  'for the reference. pro_bono = no fee, no expected return. '
  'strategic = below market by design, with an expected INDIRECT return — the '
  'Confluence fiscal-agent network, where digital work feeds grant applications '
  'that fund technical support. Non-paid natures are excluded from win rate and '
  'pipeline value so the portfolio does not distort the sales numbers.';

-- -----------------------------------------------------------------------------
-- Confluence Colorado — missing entirely, and the hub of the whole arrangement.
-- Paid $3,000 for the website work.
-- -----------------------------------------------------------------------------
INSERT INTO opportunities (
  type_id, name, description, status, partner_org, primary_contact,
  estimated_value, source_url, tags, service_lines, alignment_notes, owner_id, created_by
)
SELECT
  'partnership',
  'Confluence Colorado — Brand, Web & Grant Platform',
  'Brand identity built from the ground up — logo, visual language, messaging — then the website '
  'designed and launched, followed by a custom grant management platform. Wright Adventures '
  'continues to manage their technology infrastructure and lead grant management strategy. '
  'Confluence is also the fiscal agent and 501(c)(3) for Mo''Betta Green, River Sisters and Kady '
  'Youth Sheep Camp, which makes it the hub of the partner network rather than one client in it.',
  'partnership_closed_won',
  'Confluence Colorado',
  'Shane Wright',
  3000,
  'https://confluenceco.org',
  ARRAY['fiscal-agent','watershed','brand','grant-platform','strategic'],
  ARRAY['websites_fundraising','custom_software','development_strategy','fractional_tech_leadership'],
  'Conservation and watershed. Shane is Executive Director. The fiscal agent for three of the four '
  'partner organizations, so grant revenue and administration for the whole network route through it.',
  p.id, p.id
FROM profiles p
WHERE p.full_name = 'Shane Wright'
  AND NOT EXISTS (SELECT 1 FROM opportunities WHERE partner_org = 'Confluence Colorado');

UPDATE partnership_details pd
   SET engagement_nature    = 'strategic',
       delivery_status      = 'supporting',
       qualification_status = 'qualified',
       confidence           = 'high',
       tech_stack_notes     = 'Custom grant management platform, split out of the Wright Adventures OMP '
                              'into confluence-co against its own Supabase project (ADR-009). WA manages '
                              'the technology infrastructure on an ongoing basis.',
       next_action          = 'Write a technical-support line into grant applications so the digital work '
                              'is funded rather than absorbed.'
  FROM opportunities o
 WHERE o.id = pd.opportunity_id AND o.partner_org = 'Confluence Colorado';

-- -----------------------------------------------------------------------------
-- Reclassify the other three. Kept alongside the FMV already recorded — the
-- value delivered is unchanged, only how it is characterised.
-- -----------------------------------------------------------------------------
UPDATE partnership_details pd
   SET engagement_nature = 'strategic'
  FROM opportunities o
 WHERE o.id = pd.opportunity_id
   AND (o.partner_org ILIKE '%Betta Green%'
     OR o.partner_org ILIKE '%River Sisters%'
     OR o.partner_org ILIKE '%Kady%');

COMMIT;
