// =============================================================================
// leads.ts — Converting a discovered lead into a real opportunity (ADR-011).
//
// Pursuing a lead is a CONVERSION, not a status change. Before this, "Pursue"
// only moved a lead to lead_evaluating and a filter made it visible in the
// Opportunities list — so it stayed type_id='lead' forever. That meant a lead
// you won was excluded from every partnership metric, had no partnership_details
// row, and could never become a billable engagement.
//
// Now it becomes a partnership at the discovery stage, and the lead_details row
// stays attached so the provenance survives: which board it came from, what it
// scored, and a link to the original posting.
// =============================================================================

import { supabase } from './supabase'
import type { LeadDetails, Opportunity } from './types'

/** Where a converted lead lands. It has been triaged but not yet qualified. */
export const CONVERTED_LEAD_STATUS = 'partnership_discovery'

export interface ConvertLeadInput {
  opportunity: Pick<Opportunity, 'id' | 'name' | 'source' | 'external_url' | 'source_url' | 'ai_match_score'>
  details: Pick<LeadDetails, 'publisher' | 'apply_url'> | null
  actorId: string | null
  /** Supabase access token, so the logo lookup can authenticate. Optional. */
  accessToken?: string | null
}

/**
 * Promote a lead to a partnership opportunity.
 *
 * Deliberately does NOT rename the opportunity. The lead's `name` is the posting
 * title ("Development Director") and the organization lives in
 * lead_details.publisher — so the publisher becomes `partner_org` and the title
 * is preserved as the name. Renaming would lose which role was posted.
 */
export async function convertLeadToOpportunity({
  opportunity,
  details,
  actorId,
  accessToken,
}: ConvertLeadInput): Promise<void> {
  const { error: oppError } = await supabase
    .from('opportunities')
    .update({
      type_id:     'partnership',
      status:      CONVERTED_LEAD_STATUS,
      partner_org: details?.publisher ?? null,
      source_url:  opportunity.source_url ?? details?.apply_url ?? opportunity.external_url ?? null,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', opportunity.id)
  if (oppError) throw oppError

  // The auto-create trigger fires on INSERT, not UPDATE, so a converted record
  // has no partnership_details row yet.
  const { error: detailsError } = await supabase
    .from('partnership_details')
    .upsert(
      { opportunity_id: opportunity.id, qualification_status: 'unqualified' },
      { onConflict: 'opportunity_id', ignoreDuplicates: true },
    )
  if (detailsError) throw detailsError

  // Best-effort logo lookup. Fired after the conversion has committed and
  // deliberately not awaited for success: a missing logo is cosmetic and must
  // never make a conversion look like it failed.
  if (accessToken) {
    void fetch('/api/partnerships/lead-logo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ opportunity_id: opportunity.id }),
    }).catch(() => { /* logo lookup is optional */ })
  }

  await supabase.from('activity_log').insert({
    opportunity_id: opportunity.id,
    actor_id:       actorId,
    action:         'lead_converted',
    details: {
      from:       'lead',
      to:         'partnership',
      stage:      CONVERTED_LEAD_STATUS,
      source:     opportunity.source,
      fit_score:  opportunity.ai_match_score,
      publisher:  details?.publisher ?? null,
    },
  })
}
