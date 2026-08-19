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
 * Pick the best logo from a page, most logo-like first.
 *
 * Order matters more than it looks. og:image is tempting because every site has
 * one, but it is a 1200x630 SOCIAL SHARE CARD — usually a hero photo with
 * overlaid text. Preferring it produced hero-justride.jpg for PeopleForBikes and
 * og-image.png for Kady and Mo'Betta: correct per the spec, useless as a logo.
 *
 * apple-touch-icon and rel="icon" are square and designed to stand alone at
 * small sizes, which is exactly what a mark is. So those come first, and
 * og:image is a fallback rather than the preference.
 *
 * The rel="icon" branch deliberately does NOT require type="image/png". Real
 * sites commonly write <link rel="icon" href="...png" sizes="192x192"> with no
 * type — goldenoptimist.org does — and requiring it fell through to a 64px
 * favicon on pages advertising a proper logo.
 */
export function extractLogoUrl(html: string, baseUrl: string): string | null {
  let base: URL
  try { base = new URL(baseUrl) } catch { return null }

  const resolve = (href: string): string => {
    try { return new URL(href, base.origin).href } catch { return href }
  }

  // 1. apple-touch-icon — 180px+, square, meant to represent the org alone
  const touch = html.match(/<link[^>]+rel=["']apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon[^"']*["']/i)
  if (touch?.[1]) return resolve(touch[1])

  // 2. Any rel="icon", largest declared size first. Skip .ico — it is a browser
  //    chrome asset and renders badly at card size.
  const icons = [...html.matchAll(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*>/gi)]
    .map(tag => {
      const href = /href=["']([^"']+)["']/i.exec(tag[0])?.[1]
      const size = /sizes=["'](\d+)x\d+["']/i.exec(tag[0])?.[1]
      return href ? { href, size: size ? Number(size) : 0 } : null
    })
    .filter((v): v is { href: string; size: number } => v !== null && !/\.ico(\?|$)/i.test(v.href))
    .sort((a, b) => b.size - a.size)
  if (icons[0]) return resolve(icons[0].href)

  // 3. An explicit logo image in the markup, before falling back to a share card
  const imgLogo = html.match(/<img[^>]+(?:class|id|alt)=["'][^"']*\blogo\b[^"']*["'][^>]*src=["']([^"']+)["']/i)
    ?? html.match(/<img[^>]+src=["']([^"']+)["'][^>]*(?:class|id|alt)=["'][^"']*\blogo\b[^"']*["']/i)
  if (imgLogo?.[1]) return resolve(imgLogo[1])

  // 4. og:image — a share card, not a mark. Better than nothing.
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (og?.[1]) return resolve(og[1])

  // 5. Last resort. Low resolution, but better than an empty card.
  return `https://www.google.com/s2/favicons?domain=${base.hostname}&sz=128`
}
