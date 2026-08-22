// =============================================================================
// seed-engagements.mjs — One-off: record real engagements in the OMP.
//
//   node --env-file=.env.local scripts/seed-engagements.mjs
//
// Idempotent by partner_org: an existing row is updated, not duplicated.
// Colorado Mountain Club already existed at negotiating, so it is
// updated in place rather than re-created.
//
// Sources: BBSP invoice WA-BBSP-2026-02-01, CMC SOW (Aug 2026).
// =============================================================================

import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data: profiles } = await db.from('profiles').select('id, full_name')
const ben = profiles?.find(p => p.full_name === 'Benjamin Wright')?.id ?? null
const shane = profiles?.find(p => p.full_name === 'Shane Wright')?.id ?? null

const ENGAGEMENTS = [
  {
    partner_org: 'PeopleForBikes Foundation',
    opportunity: {
      name: 'PeopleForBikes — BBSP Legacy Page',
      description:
        'Preserved twelve years of Better Bike Share Partnership work at its 2026 sunset: a nine-section ' +
        'long-scroll retrospective site, a press-ready print edition, and migration of the 500+ story archive ' +
        'with original URLs intact — backed by a four-year funded hosting reserve running Aug 2026 – Jul 2030.',
      status: 'closed_won',
      partnership_type: 'other',
      primary_contact: 'Martina Haggerty',
      contact_email: 'martina@peopleforbikes.org',
      estimated_value: 6525,
      agreement_date: '2026-06-26',   // ICA date
      renewal_date: '2030-07-31',     // hosting reserve ends
      owner_id: ben,
      source_url: 'https://betterbikeshare.org',
      tags: ['bikes', 'micromobility', 'impact-reporting', 'archive', 'hosting'],
      alignment_notes:
        'Outdoor recreation and access; equity-centered micromobility. Live portfolio reference for ' +
        'impact reporting in web and print, and for large-archive migration.',
    },
    details: {
      engagement_nature: 'reduced_rate',
      list_value: 10875,              // 55 hrs @ $175 + $1,250 hosting, before the 40% discount
      qualification_status: 'qualified',
      confidence: 'high',
      pain_points:
        'Twelve years of public knowledge at risk of disappearing at partnership sunset; 500+ stories with ' +
        'live inbound links; no owner for the archive after the program closed.',
      tech_stack_notes:
        'Static export on Vercel, automatic SSL, self-hosted assets, WCAG 2.1 AA, redirects preserving ' +
        'existing URLs. Domain stays with its current owner at Namecheap.',
      next_action: 'Hosting reserve runs to Jul 2030; 90 days written notice due before it ends.',
      next_action_date: '2030-05-01',
    },
  },
  {
    partner_org: "Mo'Betta Green MarketPlace",
    opportunity: {
      name: "Mo'Betta Green MarketPlace — Website, Hosting & Digital Fundraising",
      description:
        'Website, hosting, and domain for a Denver farmers market serving Five Points and Northeast Park Hill: ' +
        'market schedule, vendor application, the organization\'s own history, and impact reporting that doubles ' +
        'as the sponsorship pitch and the grant report. Five revenue paths identified — pay-it-forward produce ' +
        'boxes, tax-deductible gifts via Confluence Colorado, season share presales, market sponsorships, and ' +
        'supporter membership. Taken largely as portfolio work.',
      status: 'closed_won',
      partnership_type: 'other',
      primary_contact: 'Beverly Grant',
      estimated_value: 600,
      owner_id: ben,
      source_url: 'https://mobettagreen.org',
      tags: ['food-access', 'urban-agriculture', 'denver', 'digital-fundraising', 'portfolio'],
      alignment_notes:
        'Food and community health; equity-centered community organization. Portfolio reference for ' +
        'registration, donations, and commerce on one custom admin. Confluence Colorado has been the fiscal ' +
        'agent since 2023, so the donation path is already papered.',
    },
    details: {
      engagement_nature: 'portfolio',
      qualification_status: 'qualified',
      confidence: 'high',
      pain_points:
        'Repeat questions eat the week — where the market is, how to vend, how to volunteer, how to get into ' +
        'a class. Facebook has the reach but everything scrolls away by Sunday. The Five Points and Northeast ' +
        'Park Hill history is uncaptured. Impact numbers (produce moved, SNAP matched, households served, ' +
        'youth employed) are needed for sponsors and grant reports but not assembled.',
      tech_stack_notes:
        'Coming-soon page live at mobettagreen.org. Wright Adventures holds hosting and domain registration ' +
        'under a services agreement; both transfer to Mo\'Betta on request. Content and photography are theirs.',
      next_action:
        'Discovery open: choose which of the five revenue paths to build first, confirm content owner after ' +
        'launch, agree a budget range and launch date, and collect logo files to replace the stand-in mark.',
    },
  },
  {
    partner_org: 'Kady Youth Sheep Camp',
    opportunity: {
      name: 'Kady Youth Sheep Camp — Fiscal Sponsorship, Brand & Web',
      description:
        'Administrative, financial, and digital backbone for a Diné youth apprenticeship in Teec Nos Pos, ' +
        'Arizona teaching traditional lifeways through raising Navajo-Churro sheep. Fiscal partner, web ' +
        'presence, and fundraising strategy — the community holds final say over how its story is told. Pro bono.',
      status: 'closed_won',
      partnership_type: 'in_kind',
      estimated_value: 0,
      owner_id: shane,
      source_url: 'https://kadysheepcamp.org',
      tags: ['youth-pathways', 'indigenous-led', 'fiscal-sponsorship', 'pro-bono'],
      alignment_notes:
        'Youth pathways and cultural stewardship. Portfolio reference for small-organization branding and ' +
        'fundraising.',
    },
    details: {
      engagement_nature: 'pro_bono',
      qualification_status: 'qualified',
      confidence: 'high',
      next_action: 'October trail event — in-person touchpoint.',
      next_action_date: '2026-10-01',
    },
  },
  {
    partner_org: 'River Sisters · Hermanas del Río',
    opportunity: {
      name: 'River Sisters · Hermanas del Río — Brand, Bilingual Web & Advocacy',
      description:
        'Brand identity, bilingual website, and a sustainable social and advocacy engine for a community-led ' +
        "coalition advancing recognition for Colorado's rivers. Wright Adventures produces and builds; the " +
        "coalition's cultural leadership holds every approval and the community artist owns the mark. Pro bono.",
      status: 'closed_won',
      partnership_type: 'coalition',
      estimated_value: 0,
      owner_id: shane,
      source_url: 'https://riversisterscolorado.com',
      tags: ['watershed', 'bilingual', 'community-led', 'advocacy', 'pro-bono'],
      alignment_notes:
        'Conservation and watershed; equity-centered community organizing. Portfolio reference for bilingual ' +
        'community sites and artist-owned identity.',
    },
    details: {
      engagement_nature: 'pro_bono',
      qualification_status: 'qualified',
      confidence: 'high',
    },
  },
]

// CMC already exists — update in place.
const CMC_UPDATE = {
  match: 'Colorado Mountain Club',
  opportunity: {
    name: 'Colorado Mountain Club — Marketing Cloud Migration & Data Cleanup',
    description:
      'Four-phase engagement: extract and assess Marketing Cloud, repair the membership data at its source, ' +
      'move onto the selected sending platform before Marketing Cloud closes, then onboard the twelve local ' +
      'groups and hand over documentation. 40 hrs/month, 160 total.',
    status: 'negotiating',
    primary_contact: 'Ashley Hanlon',
    contact_email: 'ahanlon@cmc.org',
    partnership_type: 'other',
    estimated_value: 24000,
    primary_deadline: '2026-10-31',   // off the current email platform by October
    owner_id: ben,
    tags: ['salesforce', 'data-remediation', 'email-migration', 'fractional-cto'],
    alignment_notes:
      'Outdoor recreation and access. Existing relationship. Fractional technology leadership shape — the ' +
      'most likely follow-on is the FY27 Salesforce work (registrations, courses and trips, inherited schema).',
  },
  details: {
    engagement_nature: 'paid',
    list_value: 27200,               // 160 hrs at the $170 standard rate
    qualification_status: 'qualified',
    confidence: 'high',
    expected_close_date: '2026-08-24',
    pain_points:
      'Must be off Marketing Cloud by October. Membership data unreliable: duplicate preference records that ' +
      'disagree, 150,000 Emma records of unknown composition against 42,000 in Salesforce, newsletter signups ' +
      'subscribing people to the Books list, group segmentation hand-maintained rather than sourced.',
    tech_stack_notes:
      'Salesforce (schema inherited from The Mountaineers), Marketing Cloud, Emma, Plone website administered ' +
      'by The Mountaineers IT in Seattle. Percolator and Jazkarta involved. Plone write access is the ' +
      'dependency most likely to affect schedule.',
    next_action: 'SOW awaiting Ashley Hanlon signature; capacity from August 24.',
    next_action_date: '2026-08-24',
  },
}

async function upsertDetails(opportunityId, details) {
  // The AFTER INSERT trigger creates the opportunity_details row.
  const { error } = await db.from('opportunity_details').update(details).eq('opportunity_id', opportunityId)
  if (error) throw new Error(`opportunity_details: ${error.message}`)
}

for (const e of ENGAGEMENTS) {
  const { data: existing } = await db
    .from('opportunities').select('id').eq('partner_org', e.partner_org).maybeSingle()

  if (existing) {
    await db.from('opportunities').update(e.opportunity).eq('id', existing.id)
    await upsertDetails(existing.id, e.details)
    console.log(`updated  ${e.opportunity.name}`)
    continue
  }

  const { data: created, error } = await db
    .from('opportunities')
    .insert({ type_id: 'partnership', partner_org: e.partner_org, created_by: ben, ...e.opportunity })
    .select('id').single()
  if (error) { console.error(`FAILED   ${e.opportunity.name}: ${error.message}`); continue }

  await upsertDetails(created.id, e.details)
  console.log(`created  ${e.opportunity.name}`)
}

// CMC in place
const { data: cmc } = await db
  .from('opportunities').select('id').eq('partner_org', CMC_UPDATE.match).maybeSingle()
if (cmc) {
  await db.from('opportunities').update(CMC_UPDATE.opportunity).eq('id', cmc.id)
  await upsertDetails(cmc.id, CMC_UPDATE.details)
  console.log(`updated  ${CMC_UPDATE.opportunity.name}`)
} else {
  console.error('CMC row not found — expected an existing negotiating record')
}
