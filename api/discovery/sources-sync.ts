import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import {
  extractPageText,
  computeContentHash,
  computeTextDiff,
  isDuplicate,
  type ExtractedOpportunity,
} from './state-utils.js'
import { buildExtractionPrompt, buildScoringPrompt } from '../../src/lib/discovery/prompts.js'
import { assess, type FitScores } from '../../src/lib/discovery/fitRubric.js'
import { WA_ORG_PROFILE, buildOrgProfilePrompt, type ProfileRelationship } from '../../src/lib/discovery/waOrgProfile.js'
import { SERVICE_LINE_LABELS } from '../../src/lib/serviceLines.js'

// Vercel clamps to plan max: 60s Hobby, 300s Pro.
export const config = { maxDuration: 300 }

// ── Constants ─────────────────────────────────────────────────
// Ceiling on text handed to ONE extraction call. Larger inputs are chunked, not
// truncated — see extractCandidates.
const EXTRACTION_CHUNK_CHARS = 40_000

// Ceiling on total text pulled from a single source in one run. A backstop
// against a runaway page, not a normal operating limit.
const MAX_PAGE_TEXT_CHARS = 400_000
const AUTO_DISABLE_AFTER  = 3
const FETCH_TIMEOUT_MS    = 15_000
const SOFT_DEADLINE_MS    = 250_000

// Insert threshold — two points below the pursue_lean band (14).
//
// Briefly 9, and that was a mistake. It was lowered to compensate for a scorer
// reading about four points low — GOBRP came back 15 against a recorded 19. But
// that gap was then closed in the scoring prompt, and GOBRP now scores 19 on all
// seven dimensions. Keeping the lowered bar afterwards discounted the same
// conservatism twice.
//
// Confirmed by the output: at 9 the queue filled with full-time W-2 roles
// scoring 9–12, every one of them "decline". Reviewing noise costs more
// attention than it saves, and the whole point of the tool is to spend less
// attention on the cold tier.
//
// 12 still sits below pursue_lean deliberately — a 12 with a warm path is worth
// a human glance even when the arithmetic says decline.
//
// This is the STORAGE bar only. The action bands in fitRubric.ts are separate,
// unchanged at 18/14, and validated by scripts/rubric-check.ts.
// See ADR-011 §Threshold.
const SCORE_THRESHOLD = 12

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  // @ai-sdk/anthropic 3.0.47 defaults baseURL to https://api.anthropic.com and
  // then appends /messages, producing a 404 — the path needs the /v1 prefix.
  // Verified: default -> "Not Found"; with /v1 -> 200. Without this every
  // generateText call in the app silently fails.
  baseURL: 'https://api.anthropic.com/v1',
})

// ── Helpers ───────────────────────────────────────────────────

function parseJson<T>(text: string): T | null {
  try {
    // Models occasionally wrap JSON in a markdown fence despite instructions.
    const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WrightAdventuresOMP/1.0 (+https://wrightadventures.org)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch a WordPress REST collection and flatten it into the same shape the HTML
 * path produces, so hashing, diffing, extraction and scoring are unchanged.
 *
 * Preferred over scraping wherever an endpoint exists: the Colorado Nonprofit
 * Association's job board is a Next.js front end whose index renders client-side
 * and yields nothing to a plain fetch, while its WordPress API serves the same
 * posts as clean JSON.
 *
 * The window is by DATE, not count. It was briefly a fixed per_page=40, which on
 * a board this busy reached back only five days — and silently dropped the two
 * best candidates the rubric knows about: the GOBRP Development Director
 * (contract, scored 19) and the Climate Democracy communications consultant
 * (contract, scored 15). Both sat outside the window and were never extracted,
 * scored, or even rejected. Meanwhile the 40 postings inside it were almost all
 * full-time W-2 noise.
 *
 * So: fetch everything posted since the last successful check, paginating, with
 * a lookback on first run. A count-based cap silently discards the tail, and the
 * tail is where contract work lives.
 *
 * The first-run lookback is 14 days. It was 60, which on CNA produced 218
 * candidates and 933k tokens in a single run. Nothing is pre-filtered — a W-2
 * posting can still be argued into a firm engagement, and a warm_path of 0 often
 * means the relationship list is incomplete rather than that the organization is
 * cold — so the window is the only lever that does not risk discarding a real
 * opportunity.
 */
async function fetchWpRest(
  baseUrl: string,
  since: string | null,
  firstRunLookbackDays = 14,
): Promise<string> {
  const PER_PAGE = 100          // WordPress REST maximum
  const MAX_PAGES = 5           // 500 postings is far beyond any real window

  const url = new URL(baseUrl)
  url.searchParams.set('per_page', String(PER_PAGE))
  url.searchParams.set('orderby', 'date')
  url.searchParams.set('order', 'desc')

  const after = since
    ? new Date(since)
    : new Date(Date.now() - firstRunLookbackDays * 24 * 60 * 60 * 1000)
  url.searchParams.set('after', after.toISOString())

  const all: Array<Record<string, any>> = []

  for (let page = 1; page <= MAX_PAGES; page++) {
    url.searchParams.set('page', String(page))

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let items: Array<Record<string, any>>
    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { 'User-Agent': 'WrightAdventuresOMP/1.0 (+https://wrightadventures.org)' },
      })
      // WordPress returns 400 rest_post_invalid_page_number past the last page.
      if (res.status === 400 && page > 1) break
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      if (!Array.isArray(body)) throw new Error('WP REST response was not a collection')
      items = body
    } finally {
      clearTimeout(timer)
    }

    all.push(...items)
    if (items.length < PER_PAGE) break
  }

  if (all.length === 0) {
    return `--- NO POSTINGS --- none published since ${after.toISOString().slice(0, 10)}`
  }

  return all.map(it => {
    const title = it?.title?.rendered ?? it?.slug ?? '(untitled)'
    const body  = extractPageText(it?.content?.rendered ?? '')
    // A headless WordPress returns item links on its own API host
    // (api.example.org/...), which is not where a human should be sent.
    const link  = String(it?.link ?? '').replace(/^(https?:\/\/)api\./, '$1')
    const date  = it?.date ?? ''
    return `--- POSTING ---\nTITLE: ${title}\nURL: ${link}\nPOSTED: ${date}\n\n${body}`
  }).join('\n\n')
}

/**
 * Fetch a sitemap, pick the item pages out of it, fetch those, and concatenate.
 *
 * For sources whose index is unfetchable but whose detail pages are plain HTML —
 * Denver's bids (index is a language-selector widget) and Andrew Hudson's
 * postings (category page shows only a narrow window).
 *
 * Cost control is `lastmod`: only entries modified since the last successful
 * check are fetched, newest first, capped at maxItems. A first run has no
 * baseline and takes the newest N. Without that, 208 detail fetches plus a Haiku
 * pass over all of them would run on every cron tick.
 */
async function fetchSitemap(
  sitemapUrl: string,
  itemPattern: string | null,
  maxItems: number,
  since: string | null,
  deadlineAt: number,
): Promise<string | null> {
  const UA = { 'User-Agent': 'WrightAdventuresOMP/1.0 (+https://wrightadventures.org)' }

  async function getXml(url: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, { signal: controller.signal, headers: UA })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } finally { clearTimeout(timer) }
  }

  let xml = await getXml(sitemapUrl)

  // A sitemap index points at further sitemaps. Follow one level, preferring
  // children whose URL hints at the items we want.
  if (/<sitemapindex/i.test(xml)) {
    const children = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/gi)]
      .map(m => m[1].trim())
    const preferred = itemPattern
      ? children.filter(u => u.includes(itemPattern.replace(/\//g, '')) || u.includes(itemPattern))
      : []
    const target = preferred[0] ?? children[0]
    if (!target) throw new Error('Sitemap index contained no child sitemaps')
    xml = await getXml(target)
  }

  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map(block => {
    const loc     = /<loc>([^<]+)<\/loc>/i.exec(block[1])?.[1]?.trim() ?? ''
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/i.exec(block[1])?.[1]?.trim() ?? null
    return { loc, lastmod }
  }).filter(e => e.loc && (!itemPattern || e.loc.includes(itemPattern)))

  if (entries.length === 0) {
    throw new Error(`Sitemap had no entries matching ${itemPattern ?? '(no pattern)'}`)
  }

  const sinceMs = since ? Date.parse(since) : NaN
  const fresh = Number.isFinite(sinceMs)
    ? entries.filter(e => !e.lastmod || Date.parse(e.lastmod) > sinceMs)
    : entries

  // Nothing modified since the last check. Return null rather than a placeholder
  // string: storing a marker as `last_content_text` would corrupt the baseline
  // the next diff is computed against.
  if (fresh.length === 0) return null

  fresh.sort((a, b) => Date.parse(b.lastmod ?? '0') - Date.parse(a.lastmod ?? '0'))
  const selected = fresh.slice(0, maxItems)

  const parts: string[] = []
  let chars = 0

  // Small batches: polite to the origin, and fast enough inside the deadline.
  for (let i = 0; i < selected.length; i += 4) {
    if (Date.now() > deadlineAt || chars > MAX_PAGE_TEXT_CHARS) break
    const batch = selected.slice(i, i + 4)
    const fetched = await Promise.all(batch.map(async e => {
      try {
        const html = await getXml(e.loc)
        const text = extractPageText(html)
        if (text.length < 200) return null   // a shell, not a posting
        return `--- POSTING ---\nURL: ${e.loc}\nMODIFIED: ${e.lastmod ?? 'unknown'}\n\n${text}`
      } catch { return null }
    }))
    for (const f of fetched) {
      if (!f) continue
      parts.push(f)
      chars += f.length
    }
  }

  if (parts.length === 0) throw new Error(`Fetched ${selected.length} item pages, none yielded usable text`)
  return parts.join('\n\n')
}

/** Coerce a possibly-absent date string to YYYY-MM-DD or null. */
function normalizeDate(d: string | null | undefined): string | null {
  if (!d) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d.trim())
  return m ? m[0] : null
}

/** Pull a numeric range out of free-form compensation text. Best-effort only. */
function parseCompensation(raw: string | null): { min: number | null; max: number | null } {
  if (!raw) return { min: null, max: null }
  const nums = [...raw.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)]
    .map(m => Number(m[1].replace(/,/g, '')))
    .filter(n => Number.isFinite(n))
  if (nums.length === 0) return { min: null, max: null }
  if (nums.length === 1) return { min: nums[0], max: nums[0] }
  return { min: Math.min(...nums), max: Math.max(...nums) }
}

async function isAdminJwt(jwt: string): Promise<boolean> {
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (!user) {
    console.error('[sources-sync] getUser failed:', authError?.message ?? 'no user returned')
    return false
  }
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).maybeSingle()
  return profile?.role === 'admin'
}

/**
 * Ensure the active org_profiles row matches waOrgProfile.ts.
 *
 * The file is the source of truth; the table exists so a run can record which
 * profile version it scored against. Syncing on every run means an edit to the
 * relationships or portfolio list takes effect without a manual DB step —
 * which matters, because a stale list silently depresses warm_path and
 * portfolio_proof and can trip the warm_path downgrade gate.
 */
async function syncOrgProfile(promptText: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('org_profiles').select('id, prompt_text').eq('is_active', true).maybeSingle()

  if (!existing) {
    const { data: created } = await supabase
      .from('org_profiles')
      .insert({
        org_name:     WA_ORG_PROFILE.org_name,
        profile_json: WA_ORG_PROFILE,
        prompt_text:  promptText,
        is_active:    true,
      })
      .select('id').single()
    return created?.id ?? null
  }

  if (existing.prompt_text !== promptText) {
    await supabase
      .from('org_profiles')
      .update({ profile_json: WA_ORG_PROFILE, prompt_text: promptText })
      .eq('id', existing.id)
  }
  return existing.id
}

/**
 * Every closed-won engagement is a warm path, whether or not anyone remembered
 * to add it to the static list. Deriving them means the relationship network
 * grows as work is won, instead of going stale between edits — and a stale list
 * silently scores warm_path 0, which trips the downgrade gate.
 */
async function wonEngagementRelationships(): Promise<ProfileRelationship[]> {
  const { data } = await supabase
    .from('opportunities')
    .select('partner_org, name, service_lines')
    .eq('type_id', 'partnership')
    .eq('status', 'partnership_closed_won')
    .not('partner_org', 'is', null)

  return (data ?? [])
    .filter(o => o.partner_org)
    .map(o => {
      const services = (o.service_lines ?? [])
        .map((sl: string) => SERVICE_LINE_LABELS[sl] ?? sl)
        .join(', ')
      return {
        org: o.partner_org as string,
        basis: services
          ? `Closed-won client — ${services.toLowerCase()}`
          : `Closed-won client — ${o.name}`,
      }
    })
}

/**
 * Roll this run's usage into the app-wide token budget.
 *
 * Single-tenant per ADR-001: one row, with `current_period_start` naming the
 * billing month. When that month has passed the counter resets rather than
 * accumulating forever.
 */
async function recordTokenUsage(tokens: number): Promise<void> {
  if (tokens <= 0) return

  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().slice(0, 10)

  const { data: row } = await supabase
    .from('token_budgets')
    .select('id, tokens_used, current_period_start')
    .order('current_period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!row) {
    await supabase.from('token_budgets').insert({
      current_period_start: periodStart,
      tokens_used: tokens,
    })
    return
  }

  const rolledOver = row.current_period_start !== periodStart
  await supabase.from('token_budgets').update({
    current_period_start: periodStart,
    tokens_used: rolledOver ? tokens : (row.tokens_used ?? 0) + tokens,
    updated_at: new Date().toISOString(),
  }).eq('id', row.id)
}

/**
 * Log a dropped candidate. Rejections are observability, never a work queue —
 * they exist so an empty review queue can be told apart from a broken pipeline,
 * and so a scorer bias against a whole category of posting becomes visible.
 *
 * Deliberately non-fatal: failing to record a rejection must never abort a run
 * that is otherwise working.
 */
async function recordRejection(
  runId: string,
  sourceId: string,
  reason: 'below_threshold' | 'duplicate' | 'unscorable' | 'incomplete',
  candidate: Partial<ExtractedOpportunity>,
  fit?: { total: number },
): Promise<void> {
  const { error } = await supabase.from('discovery_rejections').insert({
    run_id:           runId,
    source_id:        sourceId,
    reason,
    name:             candidate.name ?? null,
    publisher:        candidate.publisher ?? null,
    url:              candidate.url ?? null,
    source_kind:      candidate.source_kind ?? null,
    engagement_raw:   candidate.engagement_raw ?? null,
    compensation_raw: candidate.compensation_raw ?? null,
    score:            fit?.total ?? null,
    // Full FitAssessment: per-dimension scores, action, gates, flags. This is
    // what makes a scorer bias against a category of posting reviewable later.
    score_detail:     fit ? (fit as unknown as Record<string, unknown>) : null,
  })
  if (error) console.warn('[sources-sync] rejection log failed:', error.message)
}

// ── AI passes ─────────────────────────────────────────────────

/**
 * Split text into chunks small enough for one extraction call.
 *
 * Prefers to break on the `--- POSTING ---` delimiter the wp_rest and sitemap
 * modes emit, so a posting is never severed across two calls. Falls back to
 * paragraph boundaries for plain HTML sources.
 */
function chunkForExtraction(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]

  const delimiter = text.includes('--- POSTING ---') ? '--- POSTING ---' : '\n\n'
  const pieces = text.split(delimiter).filter(p => p.trim().length > 0)

  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    const candidate = current ? current + delimiter + piece : piece
    if (candidate.length > maxChars && current) {
      chunks.push(current)
      current = piece
    } else {
      current = candidate
    }
  }
  if (current.trim()) chunks.push(current)
  return chunks
}

/**
 * Extract candidates, chunking rather than truncating.
 *
 * Truncation was silently dropping the tail. Because both structured modes emit
 * newest-first, the tail is the oldest postings — and on a job board that is
 * exactly where contract work has aged to. Two of the highest-scoring
 * opportunities the rubric knows about (GOBRP at 19, Climate Democracy at 15)
 * were lost this way, first to a per_page cap and then to a character cap.
 */
async function extractCandidates(opts: {
  sourceLabel: string
  publisher: string
  relevanceNotes: string | null
  eligibilityNotes: string | null
  pageText: string
  isDiff: boolean
}): Promise<{ candidates: ExtractedOpportunity[]; tokens: number }> {
  const chunks = chunkForExtraction(opts.pageText, EXTRACTION_CHUNK_CHARS)
  const candidates: ExtractedOpportunity[] = []
  let tokens = 0

  for (const chunk of chunks) {
    const { text, usage } = await generateText({
      model:           anthropic('claude-haiku-4-5-20251001'),
      maxOutputTokens: 8000,
      temperature:     0,
      prompt:          buildExtractionPrompt({ ...opts, pageText: chunk }),
    })
    tokens += usage?.totalTokens ?? 0
    const parsed = parseJson<ExtractedOpportunity[]>(text)
    if (Array.isArray(parsed)) candidates.push(...parsed)
  }

  return { candidates, tokens }
}

interface RawScore {
  scores:      FitScores
  rationale:   string
  green_flags: string[]
  red_flags:   string[]
  uncertain:   string[]
}

async function scoreCandidate(
  candidate: ExtractedOpportunity,
  orgProfilePrompt: string,
): Promise<{ score: RawScore | null; tokens: number }> {
  const { text, usage } = await generateText({
    model:       anthropic('claude-sonnet-4-6'),
    maxOutputTokens: 2000,
    temperature: 0,
    prompt:      buildScoringPrompt(candidate, orgProfilePrompt),
  })
  return { score: parseJson<RawScore>(text), tokens: usage?.totalTokens ?? 0 }
}

// ── Handler ───────────────────────────────────────────────────
// GET  + Bearer <CRON_SECRET>  → weekly Vercel cron
// POST + Bearer <user-jwt>     → manual trigger from the admin UI
//        body { source_id }    → run one source, bypassing the enabled filter

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now()

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization ?? ''
  const cronSecret = process.env.CRON_SECRET

  let triggeredBy: 'cron' | 'manual'
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    triggeredBy = 'cron'
  } else if (authHeader.startsWith('Bearer ') && await isAdminJwt(authHeader.slice(7))) {
    triggeredBy = 'manual'
  } else {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const singleSourceId: string | undefined = req.body?.source_id

  const { data: run } = await supabase
    .from('discovery_runs')
    .insert({ triggered_by: triggeredBy, status: 'running', source_type: 'sources' })
    .select('id').single()

  if (!run) return res.status(500).json({ error: 'Failed to create run record' })

  const stats = {
    opportunities_fetched:           0,  // candidates returned by Haiku
    opportunities_detail_fetched:    0,  // sources whose content actually changed
    opportunities_deduplicated:      0,
    opportunities_auto_rejected:     0,  // dropped by a red-flag-only pass
    opportunities_below_threshold:   0,
    opportunities_inserted:          0,
    tokens_haiku:                    0,
    tokens_sonnet:                   0,
    error_log: [] as Array<{ label: string; error: string; timestamp: string }>,
  }

  try {
    // Static relationships plus every closed-won client, composed once per run.
    const orgProfilePrompt = buildOrgProfilePrompt(await wonEngagementRelationships())
    const orgProfileId = await syncOrgProfile(orgProfilePrompt)

    let query = supabase.from('discovery_sources').select('*')
    query = singleSourceId ? query.eq('id', singleSourceId) : query.eq('enabled', true)
    const { data: sources } = await query

    for (const source of sources ?? []) {
      if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
        stats.error_log.push({
          label: source.label,
          error: 'Skipped — soft deadline reached; will resume next run',
          timestamp: new Date().toISOString(),
        })
        break
      }

      try {
        const fetched: string | null =
          source.fetch_mode === 'wp_rest'  ? await fetchWpRest(
            source.url,
            // Same rule as sitemap mode: a cleared hash means "start fresh".
            source.last_content_hash ? (source.last_fetched_at ?? null) : null,
          )
        : source.fetch_mode === 'sitemap'  ? await fetchSitemap(
            source.url,
            source.item_url_pattern ?? null,
            source.max_items_per_run ?? 25,
            // A cleared content hash means "start fresh" — usually because the
            // URL or fetch_mode just changed. Honouring last_fetched_at then
            // would filter out every entry as stale and fetch nothing, which is
            // how switching this source to sitemap mode first presented.
            source.last_content_hash ? (source.last_fetched_at ?? null) : null,
            startedAt + SOFT_DEADLINE_MS,
          )
        : extractPageText(await fetchPage(source.url))

        // sitemap mode returns null when no entry changed since the last check.
        if (fetched === null) {
          await supabase.from('discovery_sources')
            .update({ last_fetched_at: new Date().toISOString(), last_error: null, consecutive_errors: 0 })
            .eq('id', source.id)
          continue
        }

        const pageText = fetched
        const hash     = computeContentHash(pageText)

        // Unchanged since last run — record the check and move on.
        if (hash === source.last_content_hash) {
          await supabase.from('discovery_sources')
            .update({ last_fetched_at: new Date().toISOString(), last_error: null, consecutive_errors: 0 })
            .eq('id', source.id)
          continue
        }

        stats.opportunities_detail_fetched++

        // Feed only what changed. On a first run there is no baseline, so the
        // whole page goes through.
        const isDiff = Boolean(source.last_content_text)
        const target = isDiff
          ? computeTextDiff(source.last_content_text as string, pageText)
          : pageText

        const { candidates, tokens: haikuTokens } = await extractCandidates({
          sourceLabel:      source.label,
          publisher:        source.publisher,
          relevanceNotes:   source.relevance_notes,
          eligibilityNotes: source.eligibility_notes,
          pageText:         target,
          isDiff,
        })
        stats.tokens_haiku += haikuTokens
        stats.opportunities_fetched += candidates.length

        let truncated = false

        for (const candidate of candidates) {
          // Scoring is one Sonnet call per candidate, so a large first-run
          // window can outlast the function. Stop cleanly rather than being
          // killed mid-loop by the platform.
          if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
            truncated = true
            stats.error_log.push({
              label: source.label,
              error: `Stopped at the soft deadline with candidates unprocessed; ` +
                     `source baseline left unchanged so the next run repeats the window`,
              timestamp: new Date().toISOString(),
            })
            break
          }

          if (!candidate?.name || !candidate?.publisher) {
            stats.opportunities_auto_rejected++
            await recordRejection(run.id, source.id, 'incomplete', candidate ?? {})
            continue
          }

          if (await isDuplicate(candidate, supabase)) {
            stats.opportunities_deduplicated++
            await recordRejection(run.id, source.id, 'duplicate', candidate)
            continue
          }

          const { score, tokens: sonnetTokens } = await scoreCandidate(candidate, orgProfilePrompt)
          stats.tokens_sonnet += sonnetTokens

          if (!score?.scores) {
            stats.opportunities_auto_rejected++
            await recordRejection(run.id, source.id, 'unscorable', candidate)
            continue
          }

          // Bands and gates are applied here, not in the prompt — see ADR-011.
          const fit = assess(score.scores, {
            rationale:   score.rationale ?? '',
            green_flags: score.green_flags ?? [],
            red_flags:   score.red_flags ?? [],
            uncertain:   (score.uncertain ?? []) as never,
          })

          if (fit.total < SCORE_THRESHOLD) {
            stats.opportunities_below_threshold++
            await recordRejection(run.id, source.id, 'below_threshold', candidate, fit)
            continue
          }

          const { data: inserted, error: insertError } = await supabase
            .from('opportunities')
            .insert({
              type_id:             'lead',
              name:                candidate.name,
              description:         candidate.description ?? null,
              status:              'lead_discovered',
              primary_deadline:    normalizeDate(candidate.deadline),
              source_url:          candidate.url ?? source.url,
              tags:                [],
              source:              source.label,
              external_url:        candidate.url ?? null,
              auto_discovered:     true,
              discovered_at:       new Date().toISOString(),
              discovery_source_id: source.id,
              ai_match_score:      fit.total,
              ai_match_rationale:  fit.rationale,
              ai_score_detail:     fit,
            })
            .select('id').single()

          if (insertError || !inserted) {
            stats.error_log.push({
              label: `${source.label} → ${candidate.name}`,
              error: insertError?.message ?? 'insert returned no row',
              timestamp: new Date().toISOString(),
            })
            continue
          }

          // The AFTER INSERT trigger created the lead_details row; fill it in.
          const comp = parseCompensation(candidate.compensation_raw)
          await supabase.from('lead_details').update({
            source_kind:      candidate.source_kind ?? null,
            publisher:        candidate.publisher,
            location:         candidate.location ?? null,
            remote:           Boolean(candidate.remote),
            engagement_type:  candidate.engagement_raw ?? null,
            compensation_raw: candidate.compensation_raw ?? null,
            comp_min:         comp.min,
            comp_max:         comp.max,
            posted_date:      normalizeDate(candidate.posted_date),
            closes_date:      normalizeDate(candidate.deadline),
            apply_url:        candidate.url ?? null,
            requirements:     candidate.requirements ?? null,
          }).eq('opportunity_id', inserted.id)

          stats.opportunities_inserted++
        }

        // Advance the baseline only on a complete pass. A truncated run that
        // recorded the new hash would mark the unprocessed candidates as
        // already-seen and lose them permanently.
        await supabase.from('discovery_sources').update({
          ...(truncated ? {} : {
            last_content_hash: hash,
            last_content_text: pageText,
            last_changed_at:   new Date().toISOString(),
          }),
          last_fetched_at:    new Date().toISOString(),
          last_error:         truncated ? 'Last run stopped at the soft deadline; window will repeat' : null,
          consecutive_errors: 0,
        }).eq('id', source.id)

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const errors  = (source.consecutive_errors ?? 0) + 1

        stats.error_log.push({
          label: source.label, error: message, timestamp: new Date().toISOString(),
        })

        await supabase.from('discovery_sources').update({
          last_error:         message,
          last_fetched_at:    new Date().toISOString(),
          consecutive_errors: errors,
          // Three strikes: a source that keeps failing is stale or has moved.
          ...(errors >= AUTO_DISABLE_AFTER ? { enabled: false } : {}),
        }).eq('id', source.id)
      }
    }

    // Roll this run's usage into the month's budget. Without this the AI-spend
    // card in Settings shows a frozen number, which is worse than none.
    await recordTokenUsage(stats.tokens_haiku + stats.tokens_sonnet)

    await supabase.from('discovery_runs').update({
      completed_at:   new Date().toISOString(),
      status:         'completed',
      org_profile_id: orgProfileId,
      ...stats,
      error_log: stats.error_log.length > 0 ? stats.error_log : null,
    }).eq('id', run.id)

    return res.status(200).json({ run_id: run.id, ...stats })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Roll this run's usage into the month's budget. Without this the AI-spend
    // card in Settings shows a frozen number, which is worse than none.
    await recordTokenUsage(stats.tokens_haiku + stats.tokens_sonnet)

    await supabase.from('discovery_runs').update({
      completed_at: new Date().toISOString(),
      status:       'failed',
      error_log: [{ label: 'fatal', error: message, timestamp: new Date().toISOString() }],
    }).eq('id', run.id)
    return res.status(500).json({ error: message })
  }
}
