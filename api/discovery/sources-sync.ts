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
import { WA_ORG_PROFILE, WA_ORG_PROFILE_PROMPT } from '../../src/lib/discovery/waOrgProfile.js'

// Vercel clamps to plan max: 60s Hobby, 300s Pro.
export const config = { maxDuration: 300 }

// ── Constants ─────────────────────────────────────────────────
const MAX_PAGE_TEXT_CHARS = 100_000
const AUTO_DISABLE_AFTER  = 3
const FETCH_TIMEOUT_MS    = 15_000
const SOFT_DEADLINE_MS    = 250_000

// Insert threshold. Deliberately below the pursue_lean band (14): a 12 with a
// warm path is worth a human glance even when the arithmetic says decline, and
// the review queue is cheap. See ADR-011 §Threshold.
const SCORE_THRESHOLD = 12

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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
async function syncOrgProfile(): Promise<string | null> {
  const { data: existing } = await supabase
    .from('org_profiles').select('id, prompt_text').eq('is_active', true).maybeSingle()

  if (!existing) {
    const { data: created } = await supabase
      .from('org_profiles')
      .insert({
        org_name:     WA_ORG_PROFILE.org_name,
        profile_json: WA_ORG_PROFILE,
        prompt_text:  WA_ORG_PROFILE_PROMPT,
        is_active:    true,
      })
      .select('id').single()
    return created?.id ?? null
  }

  if (existing.prompt_text !== WA_ORG_PROFILE_PROMPT) {
    await supabase
      .from('org_profiles')
      .update({ profile_json: WA_ORG_PROFILE, prompt_text: WA_ORG_PROFILE_PROMPT })
      .eq('id', existing.id)
  }
  return existing.id
}

// ── AI passes ─────────────────────────────────────────────────

async function extractCandidates(opts: {
  sourceLabel: string
  publisher: string
  relevanceNotes: string | null
  eligibilityNotes: string | null
  pageText: string
  isDiff: boolean
}): Promise<{ candidates: ExtractedOpportunity[]; tokens: number }> {
  const { text, usage } = await generateText({
    model:       anthropic('claude-haiku-4-5-20251001'),
    maxOutputTokens: 8000,
    temperature: 0,
    prompt:      buildExtractionPrompt(opts),
  })
  const parsed = parseJson<ExtractedOpportunity[]>(text)
  return {
    candidates: Array.isArray(parsed) ? parsed : [],
    tokens:     usage?.totalTokens ?? 0,
  }
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
): Promise<{ score: RawScore | null; tokens: number }> {
  const { text, usage } = await generateText({
    model:       anthropic('claude-sonnet-4-6'),
    maxOutputTokens: 2000,
    temperature: 0,
    prompt:      buildScoringPrompt(candidate),
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
    const orgProfileId = await syncOrgProfile()

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
        const html     = await fetchPage(source.url)
        const pageText = extractPageText(html)
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
          pageText:         target.slice(0, MAX_PAGE_TEXT_CHARS),
          isDiff,
        })
        stats.tokens_haiku += haikuTokens
        stats.opportunities_fetched += candidates.length

        for (const candidate of candidates) {
          if (!candidate?.name || !candidate?.publisher) {
            stats.opportunities_auto_rejected++
            continue
          }

          if (await isDuplicate(candidate, supabase)) {
            stats.opportunities_deduplicated++
            continue
          }

          const { score, tokens: sonnetTokens } = await scoreCandidate(candidate)
          stats.tokens_sonnet += sonnetTokens

          if (!score?.scores) {
            stats.opportunities_auto_rejected++
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

        // Success — store the new baseline for the next diff.
        await supabase.from('discovery_sources').update({
          last_content_hash:  hash,
          last_content_text:  pageText,
          last_fetched_at:    new Date().toISOString(),
          last_changed_at:    new Date().toISOString(),
          last_error:         null,
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
    await supabase.from('discovery_runs').update({
      completed_at: new Date().toISOString(),
      status:       'failed',
      error_log: [{ label: 'fatal', error: message, timestamp: new Date().toISOString() }],
    }).eq('id', run.id)
    return res.status(500).json({ error: message })
  }
}
