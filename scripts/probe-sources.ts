// =============================================================================
// probe-sources.ts — Dry-run check on what discovery sources actually return.
//
//   npx tsx scripts/probe-sources.ts            # all enabled sources
//   npx tsx scripts/probe-sources.ts --url https://…
//
// Fetches each source and runs the real extractPageText, with no Anthropic
// calls and no database writes. The question it answers: does plain fetch
// recover usable listing text, or is the page rendered client-side and we're
// looking at navigation chrome?
//
// Worth running before any pipeline change that touches fetching — a source
// that silently returns a shell will three-strike itself out and the only
// symptom is an empty review queue.
// =============================================================================

import { createClient } from '@supabase/supabase-js'
import { extractPageText, computeContentHash } from '../api/discovery/state-utils'

const FETCH_TIMEOUT_MS = 15_000

const urlArg = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : null

async function fetchPage(url: string): Promise<{ html: string; status: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WrightAdventuresOMP/1.0 (+https://wrightadventures.org)' },
    })
    return { html: await res.text(), status: res.status }
  } finally {
    clearTimeout(timer)
  }
}

/** Crude signal for a client-rendered shell: lots of script, little prose. */
function looksClientRendered(html: string, text: string): boolean {
  const scriptBytes = [...html.matchAll(/<script\b[\s\S]*?<\/script>/gi)]
    .reduce((n, m) => n + m[0].length, 0)
  return text.length < 2_000 && scriptBytes > html.length * 0.2
}

const sources: Array<{ label: string; url: string }> = []

if (urlArg) {
  sources.push({ label: 'ad-hoc', url: urlArg })
} else {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await db
    .from('discovery_sources').select('label, url, enabled').eq('enabled', true)
  if (error) { console.error('Could not load sources:', error.message); process.exit(1) }
  sources.push(...(data ?? []))
}

for (const s of sources) {
  console.log('\n' + '─'.repeat(78))
  console.log(s.label)
  console.log(s.url)
  try {
    const { html, status } = await fetchPage(s.url)
    const text = extractPageText(html)
    const hash = computeContentHash(text)
    const suspect = looksClientRendered(html, text)

    console.log(`  HTTP ${status}   html ${html.length.toLocaleString()}b   text ${text.length.toLocaleString()}b   hash ${hash.slice(0, 12)}`)
    if (suspect) console.log('  ⚠  Looks client-rendered — little text, heavy script. Plain fetch will not see listings.')
    else if (text.length < 2_000) console.log('  ⚠  Very little text recovered.')

    const sample = text.replace(/\s+/g, ' ').slice(0, 700)
    console.log('  ── first 700 chars of extracted text ──')
    console.log('  ' + sample)
  } catch (err) {
    console.log('  FAILED:', err instanceof Error ? err.message : String(err))
  }
}
console.log('\n' + '─'.repeat(78))
