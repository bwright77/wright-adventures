/**
 * Restore posting_details for leads discovered before the write path was fixed.
 *
 * The discovery pipeline always extracted the employer — discovery_rejections
 * still holds it for rejected candidates — but wrote it with an .update()
 * against a row that a since-dropped trigger was meant to have created. An
 * update matching zero rows succeeds silently, so publisher, location,
 * compensation and apply_url were all discarded for 24 leads. The pre-ADR-012
 * backup does not help: it was taken after the loss, and did not cover the
 * table anyway.
 *
 * So: re-fetch each posting and re-extract. Run with --limit N to sample first.
 *   npx tsx scripts/backfill-lead-publishers.ts --limit 2 --dry
 */
import { createClient } from '@supabase/supabase-js'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  // The SDK appends /messages to the base, so the /v1 has to be here.
  baseURL: 'https://api.anthropic.com/v1',
})

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const LIMIT = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity

function textFrom(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12000)
}

async function extract(lead: Record<string, any>) {
  const url = lead.external_url ?? lead.source_url
  let page = ''
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
      signal: AbortSignal.timeout(20_000),
    })
    if (res.ok) page = textFrom(await res.text())
  } catch { /* fall back to what the row already knows */ }

  const { text } = await generateText({
    model: anthropic('claude-haiku-4-5-20251001'),
    maxOutputTokens: 400,
    prompt: `Identify the HIRING organization for this posting — the employer, not the job board it appeared on.

Posting title: ${lead.name}
Job board: ${lead.source}
URL: ${url}
Description: ${lead.description ?? '(none)'}

${page ? `Page text:\n${page}` : '(page could not be fetched — use the title, URL slug and description)'}

Return ONLY minified JSON:
{"publisher":"","location":"","remote":false,"compensation_raw":"","apply_url":"","confident":true}

publisher must be the employing organization's name. If you genuinely cannot
determine it, set publisher to "" and confident to false — do not guess.
Use "" for any other field you cannot determine.`,
  })

  const m = text.match(/\{[\s\S]*\}/)
  return m ? JSON.parse(m[0]) : null
}

async function main() {
  const { data: leads } = await db
    .from('leads')
    .select('id, name, description, source, source_url, external_url, posting_details(id)')
    .order('created_at')

  const missing = (leads ?? []).filter((l: any) => !l.posting_details).slice(0, LIMIT)
  console.log(`${missing.length} leads without posting_details${DRY ? '  (dry run)' : ''}\n`)

  let ok = 0, unsure = 0
  for (const lead of missing as any[]) {
    const r = await extract(lead)
    const pub = r?.publisher?.trim()
    if (!pub) {
      unsure++
      console.log(`  ??  ${String(lead.name).slice(0, 44).padEnd(46)} could not determine`)
      continue
    }
    ok++
    console.log(`  ok  ${pub.slice(0, 34).padEnd(36)} ${String(lead.name).slice(0, 40)}`)
    if (!DRY) {
      await db.from('posting_details').insert({
        lead_id:          lead.id,
        publisher:        pub,
        location:         r.location || null,
        remote:           Boolean(r.remote),
        compensation_raw: r.compensation_raw || null,
        apply_url:        r.apply_url || lead.external_url || null,
        source_kind:      'job',
      })
    }
  }
  console.log(`\n${ok} resolved, ${unsure} unresolved`)
}
main()
