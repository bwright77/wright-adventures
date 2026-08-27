/**
 * Score a captured BidNet solicitation list against the ADR-011 fit rubric.
 *
 * BidNet's supplier search is behind a login, so the cron cannot reach it. This
 * takes a list captured from an authenticated browser session and runs it
 * through the SAME scoring the automated sources use — the real org profile
 * (including the live warm-path network), the real rubric, the real bands — so
 * these are judged on the same terms as everything else, not by eye.
 */
import { createClient } from '@supabase/supabase-js'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { readFileSync } from 'node:fs'
import { buildScoringPrompt } from '../src/lib/discovery/prompts'
import { buildOrgProfilePrompt } from '../src/lib/discovery/waOrgProfile'
import { classify, MAX_FIT_SCORE } from '../src/lib/discovery/fitRubric'
import { SERVICE_LINE_LABELS } from '../src/lib/serviceLines'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  baseURL: 'https://api.anthropic.com/v1',
})

/** Same two rules as api/discovery/sources-sync.ts: client, or being nurtured. */
async function warmPath() {
  const { data } = await db.from('organizations')
    .select('name, relationship_tier, relationship_basis, via:via_org_id(name), engagements(name, service_lines)')
    .in('relationship_tier', ['client', 'network']).eq('is_active', true)
  return (data ?? []).map((o: any) => {
    const basis = o.relationship_basis?.trim() || null
    if (o.relationship_tier === 'network')
      return { org: o.name, tier: 'network' as const, basis: basis ?? 'Being nurtured', via: o.via?.name ?? null }
    const eng = (o.engagements ?? [])[0]
    const services = (eng?.service_lines ?? []).map((s: string) => SERVICE_LINE_LABELS[s] ?? s).join(', ')
    return { org: o.name, tier: 'direct' as const, basis: basis ?? (services ? `Client — ${services}` : 'Client') }
  })
}

async function main() {
  const rows: [string, string, string, number][] = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const profile = buildOrgProfilePrompt(await warmPath())
  console.log(`scoring ${rows.length} solicitations against the live rubric\n`)

  const results: any[] = []
  const QUEUE = [...rows.entries()]
  async function worker() {
    for (;;) {
      const next = QUEUE.shift()
      if (!next) return
      const [, [name, publisher, closes, gated]] = next
      const prompt = buildScoringPrompt({
        name, publisher,
        description: gated ? 'Full detail requires a BidNet plan upgrade; only the summary is visible.' : 'Public-sector solicitation. Full scope in the posted documents.',
        source_kind: 'contract',
        engagement_raw: 'Public solicitation (RFP/RFQ/IFB) open to firms',
        compensation_raw: null, location: 'Colorado', remote: false,
        requirements: null, deadline: closes,
      }, profile)
      try {
        const { text } = await generateText({ model: anthropic('claude-sonnet-4-6'), maxOutputTokens: 900, prompt })
        const m = text.match(/\{[\s\S]*\}/)
        if (!m) continue
        const fit = JSON.parse(m[0])
        const scores = fit.scores ?? {}
        const total = Object.values(scores).reduce((s: number, v: any) => s + (Number(v) || 0), 0)
        results.push({ name, publisher, closes, gated, total, band: classify(scores).action, fit })
      } catch (e) {
        results.push({ name, publisher, closes, gated, total: -1, band: 'error', fit: null })
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))

  results.sort((a, b) => b.total - a.total)
  for (const r of results) {
    if (r.total < 10) continue
    console.log(`  ${String(r.total).padStart(2)}/${MAX_FIT_SCORE}  ${String(r.band).padEnd(12)} ${r.name.slice(0, 58).padEnd(60)} ${r.publisher.slice(0, 34)}${r.gated ? '  [gated]' : ''}`)
  }
  const errs = results.filter(r => r.band === 'error').length
  if (errs) console.log(`\n  ${errs} failed to score`)
  const above = results.filter(r => r.total >= 12).length
  console.log(`\n  ${above} of ${results.length} at or above the threshold of 12`)
  console.log(`  ${results.filter(r => r.total < 10).length} scored under 10 (not listed)`)
}
main()
