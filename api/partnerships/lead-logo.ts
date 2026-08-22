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

  // ADR-012: the logo belongs to the ORGANISATION. Keying this on the
  // opportunity is what previously let a converted lead overwrite an existing
  // client's correct logo with the job board's.
  const { organization_id } = req.body as { organization_id?: string }
  if (!organization_id) return res.status(400).json({ error: 'organization_id is required' })

  try {
    const { data: org } = await supabase
      .from('organizations')
      .select('id, name, website, logo_url')
      .eq('id', organization_id).maybeSingle()
    if (!org) return res.status(404).json({ error: 'Organization not found' })

    // Never overwrite a logo we already have.
    if (org.logo_url) {
      return res.status(200).json({ logo_url: org.logo_url, reason: 'already set' })
    }

    const { data: opp } = await supabase
      .from('opportunities')
      .select('id, source_url, external_url')
      .eq('organization_id', organization_id)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle()

    const { data: posting } = opp
      ? await supabase.from('posting_details').select('apply_url').eq('opportunity_id', opp.id).maybeSingle()
      : { data: null }

    const orgName    = org.name
    const postingUrl = org.website ?? posting?.apply_url ?? opp?.source_url ?? opp?.external_url ?? null

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

    await supabase.from('organizations')
      .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq('id', organization_id)

    return res.status(200).json({ logo_url: logoUrl, org_site: orgSite })

  } catch (err) {
    // Deliberately a 200: the conversion succeeded, only the logo did not.
    return res.status(200).json({
      logo_url: null,
      reason: err instanceof Error ? err.message : String(err),
    })
  }
}
