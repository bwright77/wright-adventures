/**
 * Recover per-posting URLs for leads that only have a category-page link.
 *
 * Andrew Hudson's leads discovered before sitemap fetch mode landed (18 Aug,
 * ~21:57) point at the job-category listing rather than the posting. Its slugs
 * are "{title}-for-{org}-in-{location}", so with the employer now backfilled we
 * can match on BOTH title and organisation rather than title alone — which
 * matters when a board carries three postings called "Director of Development".
 *
 *   npx tsx scripts/match-lead-urls.ts [--apply]
 */
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const APPLY = process.argv.includes('--apply')
const SITEMAP = 'https://andrewhudsonsjobslist.com/job-sitemap.xml'

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const tokens = (s: string) => slug(s).split('-').filter(t => t.length > 2)

/** Share of `want` tokens present in `have`. */
function coverage(want: string[], have: string): number {
  if (!want.length) return 0
  return want.filter(t => have.includes(t)).length / want.length
}

async function main() {
  const res = await fetch(SITEMAP, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
    signal: AbortSignal.timeout(25_000),
  })
  const xml = await res.text()
  const urls = [...new Set(
    (xml.match(/https:\/\/andrewhudsonsjobslist\.com\/jobs\/[^<\s]+/g) ?? [])
      .filter(u => u.replace(/\/$/, '').split('/jobs/')[1]),
  )]
  console.log(`${urls.length} postings in the sitemap\n`)

  const { data: leads } = await db
    .from('leads')
    .select('id, name, external_url, posting_details(id, publisher, apply_url)')
    .is('external_url', null)

  for (const lead of (leads ?? []) as any[]) {
    const org = lead.posting_details?.publisher ?? ''
    const titleT = tokens(lead.name)
    const orgT = tokens(org)

    const ranked = urls
      .map(u => {
        const s = u.split('/jobs/')[1].replace(/\/$/, '')
        const t = coverage(titleT, s)
        const o = coverage(orgT, s)
        // Both must be present. Title alone matches the wrong employer.
        return { u, score: t * 0.5 + o * 0.5, t, o }
      })
      .sort((a, b) => b.score - a.score)

    const best = ranked[0]
    const good = best && best.t >= 0.6 && best.o >= 0.5

    console.log(`  ${org.slice(0, 34).padEnd(36)}${lead.name.slice(0, 38)}`)
    if (!good) {
      console.log(`      no confident match (best: title ${(best?.t ?? 0).toFixed(2)}, org ${(best?.o ?? 0).toFixed(2)})`)
      continue
    }
    console.log(`      → ${best.u.split('/jobs/')[1]}  [title ${best.t.toFixed(2)} org ${best.o.toFixed(2)}]`)

    if (APPLY) {
      await db.from('leads').update({ external_url: best.u, updated_at: new Date().toISOString() }).eq('id', lead.id)
      if (lead.posting_details?.id && !lead.posting_details.apply_url) {
        await db.from('posting_details').update({ apply_url: best.u }).eq('id', lead.posting_details.id)
      }
    }
  }
  if (!APPLY) console.log('\ndry run — pass --apply to write')
}
main()
