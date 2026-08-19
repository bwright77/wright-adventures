// =============================================================================
// _logo.ts — Finding an organization's logo. Files prefixed `_` are ignored by
// Vercel routing, so this is a helper, not an endpoint.
//
// Two problems, kept separate:
//   findOrgWebsite  — a lead's posting URL belongs to the JOB BOARD, not the
//                     organization. Scraping it yields the board's logo.
//   extractLogoUrl  — given the organization's own page, pick the best image.
// =============================================================================

const UA = { 'User-Agent': 'WrightAdventuresOMP/1.0 (+https://wrightadventures.org)' }
const FETCH_TIMEOUT_MS = 12_000

/** Hosts that are never an organization's own site. */
const NON_ORG_HOSTS = [
  'facebook', 'twitter', 'x.com', 'linkedin', 'instagram', 'youtube', 'tiktok',
  'google', 'goo.gl', 'bit.ly', 'mailchimp', 'eventbrite', 'indeed', 'glassdoor',
  'wordpress.org', 'w3.org', 'schema.org', 'gravatar', 'gstatic', 'googleapis',
  'paypal', 'donorbox', 'givebutter', 'classy.org', 'networkforgood',
]

export async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: UA, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/** Tokens from an org name that are worth matching a domain against. */
function nameTokens(name: string): string[] {
  const STOP = new Set([
    'the', 'and', 'for', 'inc', 'llc', 'foundation', 'association', 'program',
    'programs', 'center', 'centre', 'of', 'a', 'nonprofit', 'organization',
    'colorado', 'denver', 'society', 'institute', 'council', 'project',
  ])
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length > 2 && !STOP.has(t))
}

/**
 * Find the organization's own website from a job-board posting page.
 *
 * Scans outbound links, drops the board's own host and known non-org hosts,
 * and ranks what remains by how much of the organization's name appears in the
 * domain. GOBRP's posting links goldenoptimist.org, which scores on "golden"
 * and "optimist".
 *
 * Returns null rather than guessing when nothing scores — a wrong logo is worse
 * than no logo.
 */
export function findOrgWebsite(html: string, postingUrl: string, orgName: string): string | null {
  let boardHost = ''
  try { boardHost = new URL(postingUrl).hostname.replace(/^www\./, '') } catch { /* ignore */ }

  const hrefs = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map(m => m[1])
  const tokens = nameTokens(orgName)
  if (tokens.length === 0) return null

  const scored = new Map<string, number>()

  for (const href of hrefs) {
    let host: string
    try { host = new URL(href).hostname.replace(/^www\./, '') } catch { continue }

    if (!host || host === boardHost || host.endsWith(`.${boardHost}`)) continue
    if (NON_ORG_HOSTS.some(bad => host.includes(bad))) continue

    const flat = host.replace(/[^a-z0-9]/gi, '').toLowerCase()
    const score = tokens.reduce((n, t) => n + (flat.includes(t) ? t.length : 0), 0)
    if (score === 0) continue

    const origin = `https://${host}`
    scored.set(origin, Math.max(scored.get(origin) ?? 0, score))
  }

  if (scored.size === 0) return null
  return [...scored.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/**
 * Pick the best logo from a page, most specific first.
 *
 * The `rel="icon"` branch deliberately does NOT require type="image/png".
 * Real sites often declare `<link rel="icon" href="…png" sizes="192x192">` with
 * no type attribute — goldenoptimist.org does exactly that — and requiring the
 * type made the extractor fall through to a 64px favicon on pages that were
 * advertising a proper logo.
 */
export function extractLogoUrl(html: string, baseUrl: string): string | null {
  let base: URL
  try { base = new URL(baseUrl) } catch { return null }

  const resolve = (href: string): string => {
    try { return new URL(href, base.origin).href } catch { return href }
  }

  // 1. og:image — usually a real branded asset
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (og?.[1]) return resolve(og[1])

  // 2. apple-touch-icon — 180px+, designed to stand alone
  const touch = html.match(/<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon[^"']*["']/i)
  if (touch?.[1]) return resolve(touch[1])

  // 3. Any rel="icon", preferring the largest declared size
  const icons = [...html.matchAll(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/gi)]
    .map(tag => {
      const href = /href=["']([^"']+)["']/i.exec(tag[0])?.[1]
      const size = /sizes=["'](\d+)x\d+["']/i.exec(tag[0])?.[1]
      return href ? { href, size: size ? Number(size) : 0 } : null
    })
    .filter((v): v is { href: string; size: number } => v !== null)
    .sort((a, b) => b.size - a.size)
  if (icons[0]) return resolve(icons[0].href)

  // 4. Last resort. Low resolution, but better than an empty card.
  return `https://www.google.com/s2/favicons?domain=${base.hostname}&sz=128`
}
