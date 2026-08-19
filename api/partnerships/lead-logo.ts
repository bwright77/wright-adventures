import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { fetchHtml, findOrgWebsite, extractLogoUrl } from './_logo.js'

// Best-effort logo lookup, run when a lead is pursued.
//
// The lead's posting URL belongs to the job board, so scraping it directly would
// store the board's logo. Instead: fetch the posting, find the organization's
// own site among its outbound links, and pull the logo from there.
//
// Every failure path returns 200 with `logo_url: null`. A missing logo is a
// cosmetic gap and must never make a conversion look like it failed.

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function isAuthorized(jwt: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser(jwt)
  if (!user) return false
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).maybeSingle()
  return profile?.role === 'admin' || profile?.role === 'manager'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = req.headers.authorization ?? ''
  if (!auth.startsWith('Bearer ') || !(await isAuthorized(auth.slice(7)))) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { opportunity_id } = req.body as { opportunity_id?: string }
  if (!opportunity_id) return res.status(400).json({ error: 'opportunity_id is required' })

  try {
    const { data: opp } = await supabase
      .from('opportunities')
      .select('id, partner_org, source_url, external_url')
      .eq('id', opportunity_id).maybeSingle()
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' })

    const { data: lead } = await supabase
      .from('lead_details')
      .select('publisher, apply_url')
      .eq('opportunity_id', opportunity_id).maybeSingle()

    const orgName    = opp.partner_org ?? lead?.publisher ?? ''
    const postingUrl = lead?.apply_url ?? opp.source_url ?? opp.external_url ?? null

    if (!orgName || !postingUrl) {
      return res.status(200).json({ logo_url: null, reason: 'no organization name or posting url' })
    }

    const postingHtml = await fetchHtml(postingUrl)
    const orgSite     = findOrgWebsite(postingHtml, postingUrl, orgName)

    if (!orgSite) {
      return res.status(200).json({ logo_url: null, reason: 'organization website not found in the posting' })
    }

    const siteHtml = await fetchHtml(orgSite)
    const logoUrl  = extractLogoUrl(siteHtml, orgSite)

    if (!logoUrl) {
      return res.status(200).json({ logo_url: null, org_site: orgSite, reason: 'no logo on the site' })
    }

    // partnership_details is created by the conversion, so this is an update.
    await supabase.from('partnership_details')
      .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq('opportunity_id', opportunity_id)

    return res.status(200).json({ logo_url: logoUrl, org_site: orgSite })

  } catch (err) {
    // Deliberately a 200: the conversion succeeded, only the logo did not.
    return res.status(200).json({
      logo_url: null,
      reason: err instanceof Error ? err.message : String(err),
    })
  }
}
