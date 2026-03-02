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

// Raise the function timeout ceiling (Vercel clamps to plan max: 60s Hobby, 300s Pro)
export const config = { maxDuration: 300 }

// ── Constants ─────────────────────────────────────────────────
//
// Pages are truncated before injecting into the Haiku prompt to prevent context
// overflow on unexpectedly large sites. Hash and stored text are always the full
// extracted version so diff computation on the next run is accurate.
const MAX_PAGE_TEXT_CHARS = 100_000

// Minimum weighted_score (after proximity bonus) to insert a discovered
// opportunity. Same threshold philosophy as the federal pipeline.
const SCORE_THRESHOLD = 5.0

// Sources auto-disable after this many consecutive fetch/processing failures.
const AUTO_DISABLE_AFTER = 3

// Per-source HTTP fetch timeout. Weekly cadence — no rush.
const FETCH_TIMEOUT_MS = 15_000

// Soft deadline: stop processing sources with this much wall time remaining
// to ensure the run record is always finalized before Vercel hard-kills at 300s.
const SOFT_DEADLINE_MS = 250_000

// ── Supabase (service role — server-side only) ────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Anthropic ─────────────────────────────────────────────────
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ── Types ─────────────────────────────────────────────────────

interface DiscoverySource {
  id:                     string
  label:                  string
  source_type:            string   // 'state' | 'local' | 'foundation' | 'federal_api'
  funder_name:            string
  url:                    string
  eligibility_notes:      string | null
  relevance_notes:        string | null
  source_proximity_bonus: string   // NUMERIC returns as string from Supabase JS client
  last_content_hash:      string | null
  last_content_text:      string | null
  consecutive_errors:     number
}

interface ExtractionResponse {
  opportunities:   ExtractedOpportunity[]
  page_summary:    string
  notable_changes: string | null
}

interface ScoreResult {
  scores: {
    mission_alignment:      number
    geographic_eligibility: number
    applicant_eligibility:  number
    award_size_fit:         number
    population_alignment:   number
  }
  weighted_score:      number
  auto_rejected:       boolean
  auto_reject_reason:  string | null
  rationale:           string
  red_flags:           string[]
  recommended_action: 'apply' | 'investigate' | 'skip'
}

interface RunStats {
  // Re-uses the same columns as federal discovery_runs for schema compatibility.
  // Semantics differ slightly for the state pipeline:
  //   opportunities_fetched       → total candidates returned by Haiku across all changed sources
  //   opportunities_detail_fetched → number of sources where content actually changed (Haiku calls made)
  //   opportunities_deduplicated  → candidates skipped by fuzzy dedup
  opportunities_fetched:          number
  opportunities_deduplicated:     number
  opportunities_detail_fetched:   number
  opportunities_auto_rejected:    number
  opportunities_below_threshold:  number
  opportunities_inserted:         number
  tokens_haiku:                   number
  tokens_sonnet:                  number
  error_log: Array<{ label: string; error: string; timestamp: string }>
}

// ── Helpers ───────────────────────────────────────────────────

function parseJson<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as T
  } catch {
    return null
  }
}

/** HTTP GET with a single retry on any error (covers 5xx and transient timeouts). */
async function fetchPage(url: string): Promise<string> {
  const headers = {
    // Identify ourselves to state government servers
    'User-Agent': 'WrightAdventuresOMP/1.0 Grant Discovery (+https://wrightadventures.org)',
    'Accept':     'text/html,application/xhtml+xml,*/*',
  }

  async function attempt(): Promise<string> {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
    return res.text()
  }

  try {
    return await attempt()
  } catch {
    // Single retry after 2s backoff — handles transient 5xx and brief timeouts
    await new Promise(r => setTimeout(r, 2_000))
    return attempt()
  }
}

/**
 * Builds the Haiku extraction prompt per ADR-005 §3.
 * Truncates page text if necessary and notes the truncation in the prompt.
 */
function buildExtractionPrompt(
  source: DiscoverySource,
  pageText: string,
  diff: string | null,
): string {
  let promptText = pageText
  let truncationNote = ''

  if (pageText.length > MAX_PAGE_TEXT_CHARS) {
    promptText = pageText.slice(0, MAX_PAGE_TEXT_CHARS)
    truncationNote = `\n[NOTE: Page text truncated to first ${MAX_PAGE_TEXT_CHARS.toLocaleString()} of ${pageText.length.toLocaleString()} characters due to size. Extraction is based on the leading portion only.]\n`
  }

  return `You are analyzing a Colorado state/local government grant funding page for potential grant opportunities relevant to a conservation and youth development nonprofit.

SOURCE: ${source.funder_name}
SOURCE URL: ${source.url}
ELIGIBILITY CONTEXT: ${source.eligibility_notes ?? 'No specific notes.'}
RELEVANCE CONTEXT: ${source.relevance_notes ?? 'No specific notes.'}

ORGANIZATION CONTEXT:
Confluence Colorado is a 501(c)(3) focused on: watershed protection (South Platte), youth career pathways, environmental justice, outdoor recreation access, and urban agriculture. Based in Denver, Colorado.

PAGE CONTENT:
${truncationNote}${promptText}

${diff ? `CHANGES SINCE LAST CHECK:\n${diff}\n` : ''}
TASK: Extract any grant opportunities from this page that could be relevant to Confluence Colorado. For each opportunity found, return a JSON object with this exact shape:

{
  "opportunities": [
    {
      "name": "Program name",
      "funder": "${source.funder_name}",
      "description": "Brief description of the program",
      "deadline": "Application deadline if stated (ISO date preferred, or descriptive text such as 'July 1' or 'Summer 2026'), or null",
      "amount_range": "Funding range if stated (e.g. '$50,000-$300,000'), or null",
      "eligibility_summary": "Who can apply and any partnership requirements",
      "relevance_rationale": "Why this is relevant to Confluence Colorado",
      "confidence": "high | medium | low",
      "url": "Direct URL to the program page if identifiable, or null"
    }
  ],
  "page_summary": "Brief summary of what this page contains (1-2 sentences)",
  "notable_changes": "Description of meaningful changes detected since last check, or null"
}

If no relevant opportunities are found, return an empty opportunities array.
Only include opportunities with medium or high confidence of relevance.
Return ONLY valid JSON — no preamble, explanation, or markdown fences.`
}

/** Calls Haiku to extract opportunity candidates from changed page content. */
async function extractCandidates(
  source: DiscoverySource,
  pageText: string,
  diff: string | null,
  stats: RunStats,
): Promise<ExtractionResponse | null> {
  const prompt = buildExtractionPrompt(source, pageText, diff)

  const { text, usage } = await generateText({
    model:           anthropic('claude-haiku-4-5-20251001'),
    prompt,
    maxOutputTokens: 4096,
    abortSignal:     AbortSignal.timeout(60_000),
  })
  stats.tokens_haiku += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)

  // Primary: expect an object with an "opportunities" key
  const parsed = parseJson<ExtractionResponse>(text)
  if (parsed?.opportunities) return parsed

  // Fallback: Haiku sometimes returns a bare JSON array despite instructions
  const arrayMatch = text.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      const opps = JSON.parse(arrayMatch[0]) as ExtractedOpportunity[]
      return { opportunities: opps, page_summary: '', notable_changes: null }
    } catch { /* fall through */ }
  }

  return null
}

/**
 * Calls Sonnet to score a state/local opportunity candidate against the active
 * org profile. Reuses the identical prompt structure as the federal pipeline —
 * the org profile prompt is model-agnostic.
 */
async function scoreCandidate(
  candidate: ExtractedOpportunity,
  orgProfilePrompt: string,
  stats: RunStats,
): Promise<ScoreResult | null> {
  // Normalize to the field names the org profile prompt expects
  const payload = {
    name:              candidate.name,
    funder:            candidate.funder,
    grant_type:        'state',
    description:       candidate.description,
    amount_max:        null,                   // not available as a parsed number from text extraction
    amount_range_text: candidate.amount_range, // passed as context for the award_size_fit criterion
    primary_deadline:  candidate.deadline,
    eligibility_notes: candidate.eligibility_summary,
  }

  const prompt = `${orgProfilePrompt}

OPPORTUNITY TO SCORE:
${JSON.stringify(payload, null, 2)}`

  const { text, usage } = await generateText({
    model:           anthropic('claude-sonnet-4-6'),
    prompt,
    maxOutputTokens: 1024,
    abortSignal:     AbortSignal.timeout(60_000),
  })
  stats.tokens_sonnet += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
  return parseJson<ScoreResult>(text)
}

/**
 * Tries to coerce a deadline string from Haiku into an ISO date (YYYY-MM-DD).
 * Returns null for unparseable descriptive text — the deadline will be visible
 * in the opportunity description regardless.
 */
function normalizeDeadline(deadline: string | null | undefined): string | null {
  if (!deadline) return null
  // Already in ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(deadline)) return deadline.slice(0, 10)
  // Try Date constructor for common English formats ("July 1, 2026", "Jul 1 2026")
  const parsed = new Date(deadline)
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  // Descriptive text ("Summer 2026", "Rolling") — not storable as a date
  return null
}

// ── Auth ──────────────────────────────────────────────────────

async function isAdminJwt(jwt: string): Promise<boolean> {
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (!user) {
    console.error('[state-sync] getUser failed:', authError?.message ?? 'no user returned')
    return false
  }
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) {
    console.error('[state-sync] profile lookup failed for', user.id, profileError?.message ?? 'no profile row found')
    return false
  }
  return profile.role === 'admin'
}

// ── Handler ───────────────────────────────────────────────────
// Accepts:
//   GET  with Authorization: Bearer <CRON_SECRET>  → triggered by Vercel Cron (weekly)
//   POST with Authorization: Bearer <user-jwt>     → manual trigger from admin UI

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth ──────────────────────────────────────────────────────
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

  // ── Create run audit row ──────────────────────────────────────
  // source_type = 'state' distinguishes this from federal sync runs in the UI.
  const { data: run } = await supabase
    .from('discovery_runs')
    .insert({ triggered_by: triggeredBy, status: 'running', source_type: 'state' })
    .select('id')
    .single()

  if (!run) {
    return res.status(500).json({ error: 'Failed to create run record' })
  }

  const runId  = run.id
  const runStart = Date.now()
  const nearDeadline = () => Date.now() - runStart > SOFT_DEADLINE_MS

  const stats: RunStats = {
    opportunities_fetched:         0,
    opportunities_deduplicated:    0,
    opportunities_detail_fetched:  0,
    opportunities_auto_rejected:   0,
    opportunities_below_threshold: 0,
    opportunities_inserted:        0,
    tokens_haiku:                  0,
    tokens_sonnet:                 0,
    error_log:                     [],
  }

  try {
    // ── Load active org profile ───────────────────────────────────
    const { data: orgProfile } = await supabase
      .from('org_profiles')
      .select('id, prompt_text')
      .eq('is_active', true)
      .single()

    if (!orgProfile) throw new Error('No active org profile found')

    // ── Resolve scope: single source (Check Now) or all enabled ──
    // source_id may come from the POST body (admin UI "Check Now") or as a query
    // parameter. When present, the enabled filter is skipped so admins can test
    // a disabled source before re-enabling it.
    const sourceId =
      (req.body as Record<string, string> | undefined)?.source_id ??
      (req.query.source_id as string | undefined)

    // ── Load sources ──────────────────────────────────────────────
    const baseQuery = supabase
      .from('discovery_sources')
      .select('id, label, source_type, funder_name, url, eligibility_notes, relevance_notes, source_proximity_bonus, last_content_hash, last_content_text, consecutive_errors')
      .order('label', { ascending: true })

    const { data: sources } = await (sourceId
      ? baseQuery.eq('id', sourceId)     // Single source: no enabled filter
      : baseQuery.eq('enabled', true))   // Full cron run: enabled sources only

    if (!sources?.length) {
      throw new Error(sourceId
        ? `Source '${sourceId}' not found`
        : 'No enabled discovery sources found')
    }

    // ── Process each source ───────────────────────────────────────
    for (const source of sources as DiscoverySource[]) {
      if (nearDeadline()) {
        stats.error_log.push({
          label:     'timeout',
          error:     'Approaching Vercel maxDuration limit — remaining sources skipped',
          timestamp: new Date().toISOString(),
        })
        break
      }

      try {
        // Step a: Fetch page
        const html = await fetchPage(source.url)

        // Step b: Extract text (resilient to layout changes — no DOM parsing)
        const pageText = extractPageText(html)

        // Step c: Hash the full extracted text
        const newHash = computeContentHash(pageText)

        // Step d: Compare to stored hash
        if (newHash === source.last_content_hash) {
          // No change — update last_fetched_at and reset error counter, skip AI
          await supabase
            .from('discovery_sources')
            .update({
              last_fetched_at:    new Date().toISOString(),
              consecutive_errors: 0,
              last_error:         null,
            })
            .eq('id', source.id)
          continue
        }

        // Step e: Content changed — count as a "detail fetch" equivalent
        stats.opportunities_detail_fetched++

        // Step f: Compute diff for AI context (null on first run or if no cached text)
        const diff = source.last_content_text
          ? computeTextDiff(source.last_content_text, pageText)
          : null

        // Step g: AI extraction via Haiku
        const extraction = await extractCandidates(source, pageText, diff, stats)
        if (!extraction) {
          // Treat unparseable Haiku response as a source error
          throw new Error('Haiku extraction returned unparseable JSON')
        }

        // Filter: only process medium or high confidence (Haiku is instructed to
        // exclude low-confidence, but enforce it here as a safety net)
        const candidates = extraction.opportunities.filter(
          o => o.confidence === 'high' || o.confidence === 'medium',
        )
        stats.opportunities_fetched += candidates.length

        // Steps g–i: Dedup → score → insert for each candidate
        for (const candidate of candidates) {
          if (nearDeadline()) break

          // Step g continued: Fuzzy deduplication against existing opportunities
          if (await isDuplicate(candidate, supabase)) {
            stats.opportunities_deduplicated++
            continue
          }

          // Step h: Sonnet scoring (same pipeline as federal)
          const score = await scoreCandidate(candidate, orgProfile.prompt_text, stats)
          if (!score) {
            stats.error_log.push({
              label:     `score:${source.label}:${candidate.name}`,
              error:     'Failed to parse Sonnet scoring response',
              timestamp: new Date().toISOString(),
            })
            continue
          }

          if (score.auto_rejected) {
            stats.opportunities_auto_rejected++
            continue
          }

          // Apply source proximity bonus after AI scoring, capped at 10.0
          const proximityBonus = Number(source.source_proximity_bonus)
          const finalScore     = Math.min(10.0, score.weighted_score + proximityBonus)

          if (finalScore < SCORE_THRESHOLD) {
            stats.opportunities_below_threshold++
            continue
          }

          // Step i: Insert qualifying opportunity
          const { error: insertErr } = await supabase.from('opportunities').insert({
            type_id:             'grant',
            name:                candidate.name,
            funder:              candidate.funder,
            grant_type:          source.source_type,   // 'state' | 'local' etc.
            description:         candidate.description ?? null,
            primary_deadline:    normalizeDeadline(candidate.deadline),
            eligibility_notes:   candidate.eligibility_summary ?? null,
            source:              source.source_type,
            external_url:        candidate.url ?? null,
            discovery_source_id: source.id,
            ai_match_score:      finalScore,
            ai_match_rationale:  score.rationale,
            // Store full breakdown including pre-bonus score for audit purposes
            ai_score_detail: {
              ...score,
              weighted_score:         finalScore,
              ai_weighted_score:      score.weighted_score,
              source_proximity_bonus: proximityBonus,
            },
            status:           'grant_discovered',
            auto_discovered:  true,
            discovered_at:    new Date().toISOString(),
          })

          if (insertErr) {
            stats.error_log.push({
              label:     `insert:${source.label}:${candidate.name}`,
              error:     insertErr.message,
              timestamp: new Date().toISOString(),
            })
          } else {
            stats.opportunities_inserted++
            // Notifications are dispatched automatically by the Supabase Database
            // Webhook on the opportunities table (INSERT event). The webhook calls
            // /api/notifications/opportunity-discovered, which filters for
            // auto_discovered=true and status='grant_discovered' — both match here.
          }
        }

        // Step j: Update source state — success
        await supabase
          .from('discovery_sources')
          .update({
            last_content_hash:  newHash,
            last_content_text:  pageText,   // full text stored for next diff
            last_fetched_at:    new Date().toISOString(),
            last_changed_at:    new Date().toISOString(),
            last_error:         null,
            consecutive_errors: 0,
          })
          .eq('id', source.id)

      } catch (err) {
        // ── Per-source error handling ───────────────────────────────
        // Increment consecutive_errors. Auto-disable after AUTO_DISABLE_AFTER
        // failures so transient outages don't indefinitely block weekly runs.
        const errorMessage  = err instanceof Error ? err.message : String(err)
        const newErrorCount = source.consecutive_errors + 1
        const autoDisabled  = newErrorCount >= AUTO_DISABLE_AFTER

        await supabase
          .from('discovery_sources')
          .update({
            last_error:         errorMessage,
            consecutive_errors: newErrorCount,
            last_fetched_at:    new Date().toISOString(),
            ...(autoDisabled ? { enabled: false } : {}),
          })
          .eq('id', source.id)

        const logMessage = autoDisabled
          ? `${errorMessage} — source auto-disabled after ${newErrorCount} consecutive errors`
          : `${errorMessage} (${newErrorCount}/${AUTO_DISABLE_AFTER} consecutive errors)`

        stats.error_log.push({
          label:     source.label,
          error:     logMessage,
          timestamp: new Date().toISOString(),
        })

        console.error(`[state-sync] Error processing source "${source.label}":`, logMessage)
      }
    }

    // ── Write final run record ────────────────────────────────────
    await supabase
      .from('discovery_runs')
      .update({
        completed_at:   new Date().toISOString(),
        status:         'completed',
        org_profile_id: orgProfile.id,
        ...stats,
        error_log: stats.error_log.length > 0 ? stats.error_log : null,
      })
      .eq('id', runId)

    return res.status(200).json({ run_id: runId, status: 'completed', stats })

  } catch (err) {
    // ── Fatal error (org profile missing, sources query failed, etc.) ──
    await supabase
      .from('discovery_runs')
      .update({
        completed_at: new Date().toISOString(),
        status:       'failed',
        error_log: [{
          label:     'fatal',
          error:     err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }],
      })
      .eq('id', runId)

    console.error('[state-sync] Fatal error:', err)
    return res.status(500).json({ error: 'State discovery sync failed', run_id: runId })
  }
}
