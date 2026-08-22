// =============================================================================
// leads.ts — Converting a discovered lead into a real opportunity (ADR-011/012).
//
// Pursuing a lead CREATES records; it no longer mutates one in place. Under the
// old shape a lead and a pursuit were the same row discriminated by type_id, so
// "Pursue" flipped a field and the lead ceased to exist as a lead — losing the
// fact that we had ever discovered it, and making "how many leads did we act
// on?" unanswerable.
//
// Now: the lead stays, marked converted and pointing at what it became. An
// ORGANISATION is found or created from the posting's publisher, so the employer
// is a durable record rather than a string. The posting_details row is repointed
// at the new opportunity so provenance survives — which board it came from, what
// it scored, and a link to the original posting.
// =============================================================================

import { supabase } from './supabase'
import type { PostingDetails } from './types'

/** Where a converted lead lands. It has been triaged but not yet qualified. */
export const CONVERTED_LEAD_STATUS = 'discovery'

export interface ConvertLeadInput {
  lead: {
    id: string
    name: string
    source: string | null
    source_url: string | null
    external_url: string | null
    ai_match_score: number | null
  }
  details: Pick<PostingDetails, 'publisher' | 'apply_url'> | null
  actorId: string | null
  /** Supabase access token, so the logo lookup can authenticate. Optional. */
  accessToken?: string | null
}

/**
 * Find an organisation by name, or create it.
 *
 * Match is exact on name. Deliberately not fuzzy: a wrong merge attaches a new
 * pursuit to the wrong client and shows the wrong logo, which is far worse than
 * a duplicate row someone can merge by hand later.
 */
async function findOrCreateOrganization(name: string): Promise<string> {
  const { data: found, error: findError } = await supabase
    .from('organizations')
    .select('id')
    .eq('name', name)
    .maybeSingle()
  if (findError) throw findError
  if (found) return found.id

  const { data: created, error: createError } = await supabase
    .from('organizations')
    // Cold by default. We found this org on a job board or a procurement
    // portal; pursuing them is not the same as knowing them, and marking it
    // otherwise would feed the scorer a warm path that does not exist.
    .insert({ name, relationship_tier: 'none' })
    .select('id')
    .single()
  if (createError) throw createError
  return created.id
}

/**
 * Promote a lead to an opportunity.
 *
 * The lead's `name` is the posting title ("Development Director") and the
 * employer lives in posting_details.publisher. The title is preserved as the
 * opportunity name — renaming would lose which role was actually posted.
 */
export async function convertLeadToOpportunity({
  lead,
  details,
  actorId,
  accessToken,
}: ConvertLeadInput): Promise<string> {
  const publisher = details?.publisher?.trim()
  const organizationId = publisher ? await findOrCreateOrganization(publisher) : null

  const { data: opp, error: oppError } = await supabase
    .from('opportunities')
    .insert({
      name:            lead.name,
      organization_id: organizationId,
      partner_org:     publisher ?? null,
      status:          CONVERTED_LEAD_STATUS,
      source:          lead.source,
      source_url:      lead.source_url ?? details?.apply_url ?? lead.external_url ?? null,
      external_url:    lead.external_url,
      ai_match_score:  lead.ai_match_score,
    })
    .select('id')
    .single()
  if (oppError) throw oppError

  // opportunity_details is created by an AFTER INSERT trigger, so there is
  // nothing to upsert here.

  const { error: leadError } = await supabase
    .from('leads')
    .update({
      status:          'converted',
      opportunity_id:  opp.id,
      organization_id: organizationId,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', lead.id)
  if (leadError) throw leadError

  // Carry the posting across so the opportunity keeps its provenance.
  await supabase
    .from('posting_details')
    .update({ opportunity_id: opp.id })
    .eq('lead_id', lead.id)

  // Best-effort logo lookup. Fired after the conversion has committed and
  // deliberately not awaited: a missing logo is cosmetic and must never make a
  // conversion look like it failed.
  if (accessToken && organizationId) {
    void fetch('/api/partnerships/lead-logo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ organization_id: organizationId }),
    }).catch(() => { /* logo lookup is optional */ })
  }

  await supabase.from('activity_log').insert({
    opportunity_id: opp.id,
    actor_id:       actorId,
    action:         'lead_converted',
    details: {
      lead_id:    lead.id,
      stage:      CONVERTED_LEAD_STATUS,
      source:     lead.source,
      fit_score:  lead.ai_match_score,
      publisher:  publisher ?? null,
    },
  })

  return opp.id
}
