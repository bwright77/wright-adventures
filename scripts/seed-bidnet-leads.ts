/**
 * Seed solicitations captured from BidNet into `leads`, scored by the live rubric.
 *
 * Hand-captured because the source is behind a login the cron cannot reach, but
 * everything downstream is identical to an automated lead: same scoring, same
 * posting_details row, and discovery_source_id points at the existing Rocky
 * Mountain E-Purchasing row so provenance is honest about where it came from.
 *
 * auto_discovered stays FALSE — this batch came from a person driving a browser,
 * and claiming otherwise would misreport how the pipeline is performing.
 */
import { createClient } from '@supabase/supabase-js'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { readFileSync } from 'node:fs'
import { buildScoringPrompt } from '../src/lib/discovery/prompts'
import { buildOrgProfilePrompt } from '../src/lib/discovery/waOrgProfile'
import { classify } from '../src/lib/discovery/fitRubric'
import { SERVICE_LINE_LABELS } from '../src/lib/serviceLines'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, baseURL: 'https://api.anthropic.com/v1' })
const SEARCH_URL = 'https://www.bidnetdirect.com/private/supplier/solicitations/search'

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

function toISO(us: string): string | null {
  const m = us.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null
}

async function main() {
  const rows: [string, string, string, number][] = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const profile = buildOrgProfilePrompt(await warmPath())

  const { data: src } = await db.from('discovery_sources').select('id, label').ilike('label', '%Rocky%').maybeSingle()
  console.log(`attributing to: ${src?.label ?? 'no source row'}\n`)

  for (const [name, publisher, closes, gated] of rows) {
    // Skip anything already recorded, by title.
    const { data: dupe } = await db.from('leads').select('id').eq('name', name).maybeSingle()
    if (dupe) { console.log(`  --  already present: ${name.slice(0, 50)}`); continue }

    const prompt = buildScoringPrompt({
      name, publisher,
      description: gated ? 'Full detail requires a BidNet plan upgrade; only the summary is visible.' : 'Public-sector solicitation. Full scope in the posted documents.',
      source_kind: 'contract',
      engagement_raw: 'Public solicitation (RFP/RFQ/IFB) open to firms',
      compensation_raw: null, location: 'Colorado', remote: false,
      requirements: null, deadline: closes,
    }, profile)

    const { text } = await generateText({ model: anthropic('claude-sonnet-4-6'), maxOutputTokens: 900, prompt })
    const fit = JSON.parse(text.match(/\{[\s\S]*\}/)![0])
    const scores = fit.scores ?? {}
    const total = Object.values(scores).reduce((s: number, v: any) => s + (Number(v) || 0), 0)
    const band = classify(scores)

    // Match the pipeline: it stores candidates at or above the threshold and
    // rejects the rest. Seeding everything as 'new' buries the real leads under
    // solicitations already judged not worth pursuing.
    const THRESHOLD = 12

    const { data: lead, error } = await db.from('leads').insert({
      name,
      description: `Public solicitation via BidNet Direct / Rocky Mountain E-Purchasing. Closing ${closes}.${gated ? ' Full detail requires a plan upgrade.' : ''}`,
      status: total >= THRESHOLD ? 'new' : 'declined',
      primary_deadline: toISO(closes),
      source: 'BidNet Direct (Rocky Mountain E-Purchasing)',
      source_url: SEARCH_URL,
      ai_match_score: total,
      ai_match_rationale: fit.rationale ?? null,
      ai_score_detail: { ...fit, action: band.action, downgrades: band.downgrades, total },
      auto_discovered: false,
      discovered_at: new Date().toISOString(),
      discovery_source_id: src?.id ?? null,
    }).select('id').single()
    if (error) { console.log(`  !!  ${name.slice(0, 46)} — ${error.message}`); continue }

    await db.from('posting_details').insert({
      lead_id: lead.id, publisher, source_kind: 'contract',
      location: 'Colorado', remote: false,
      closes_date: toISO(closes), apply_url: SEARCH_URL,
    })
    console.log(`  ${total >= THRESHOLD ? 'ok ' : '-- '} ${String(total).padStart(2)}/21 ${String(band.action).padEnd(12)} ${name.slice(0, 46)}`)
  }
}
main()
