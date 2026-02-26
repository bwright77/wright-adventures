import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

// Raise the function timeout ceiling (Vercel clamps to plan max: 60s Hobby, 300s Pro)
export const config = { maxDuration: 300 }

// Max new opportunities to process per run — prevents timeout on large batches.
// Hobby plan cap is 60s; at ~5s/opp (Haiku + Sonnet) this leaves ~25s headroom.
// The cron runs daily so any remainder is picked up the next day.
const MAX_NEW_PER_RUN = 7

// ── Supabase (service role — server-side only) ────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Anthropic ─────────────────────────────────────────────────
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SIMPLER_GRANTS_BASE = 'https://api.simpler.grants.gov/v1'

// ── Types ─────────────────────────────────────────────────────

interface ExtractedFields {
  name: string
  funder: string | null
  grant_type: 'federal'
  description: string | null
  amount_requested: null
  amount_max: number | null
  primary_deadline: string | null
  loi_deadline: null
  eligibility_notes: string | null
  cfda_number: string | null
}

interface ScoreResult {
  scores: {
    mission_alignment: number
    geographic_eligibility: number
    applicant_eligibility: number
    award_size_fit: number
    population_alignment: number
  }
  weighted_score: number
  auto_rejected: boolean
  auto_reject_reason: string | null
  rationale: string
  red_flags: string[]
  recommended_action: 'apply' | 'investigate' | 'skip'
}

interface RunStats {
  opportunities_fetched: number
  opportunities_deduplicated: number
  opportunities_detail_fetched: number
  opportunities_auto_rejected: number
  opportunities_below_threshold: number
  opportunities_inserted: number
  tokens_haiku: number
  tokens_sonnet: number
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

interface SearchResult {
  ids:        string[]
  totalPages: number
}

async function searchOpportunities(payload: unknown, pageOffset: number): Promise<SearchResult> {
  // Override page_offset in the stored payload so each run advances through pages
  const body = {
    ...(payload as Record<string, unknown>),
    pagination: {
      ...((payload as Record<string, unknown>).pagination as Record<string, unknown> ?? {}),
      page_offset: pageOffset,
    },
  }

  const res = await fetch(`${SIMPLER_GRANTS_BASE}/opportunities/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.SIMPLER_GRANTS_API_KEY!,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Search API ${res.status}: ${await res.text()}`)
  }
  const data = await res.json()
  return {
    ids:        (data.data ?? []).map((o: { opportunity_id: string }) => o.opportunity_id),
    totalPages: data.pagination_info?.total_pages ?? 1,
  }
}

async function fetchDetail(opportunityId: string): Promise<unknown> {
  const res = await fetch(`${SIMPLER_GRANTS_BASE}/opportunities/${opportunityId}`, {
    headers: { 'X-Api-Key': process.env.SIMPLER_GRANTS_API_KEY! },
  })
  if (!res.ok) {
    throw new Error(`Detail API ${res.status} for ${opportunityId}`)
  }
  const data = await res.json()
  return data.data
}

// Stage 1: Haiku extracts structured fields from raw API object.
// Note: summary is an object { summary_description: string }, not a flat string.
async function extractFields(raw: unknown, stats: RunStats): Promise<ExtractedFields | null> {
  const prompt = `Extract and normalize the following fields from this federal grant opportunity.
Return only valid JSON — no preamble or explanation.

{
  "name": "<opportunity title>",
  "funder": "<agency name>",
  "grant_type": "federal",
  "description": "<use summary.summary_description — it is an object, not a flat string — max 500 chars>",
  "amount_requested": null,
  "amount_max": <award_ceiling as number or null>,
  "primary_deadline": "<close_date ISO string or null>",
  "loi_deadline": null,
  "eligibility_notes": "<applicant types + any stated restrictions, max 300 chars>",
  "cfda_number": "<assistance_listing_number or null>"
}

Opportunity data:
${JSON.stringify(raw, null, 2)}`

  const { text, usage } = await generateText({
    model: anthropic('claude-haiku-4-5-20251001'),
    prompt,
    maxTokens: 1024,
  })
  stats.tokens_haiku += (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)
  return parseJson<ExtractedFields>(text)
}

// Pre-screen extracted fields for obvious disqualifiers before calling Sonnet.
// Returns a rejection reason string, or null if the opportunity passes.
function preScreen(fields: ExtractedFields): string | null {
  if (fields.amount_max !== null && fields.amount_max < 5000) {
    return `Award ceiling $${fields.amount_max} is below minimum $5,000`
  }
  return null
}

// Stage 2: Sonnet scores against the active org profile prompt.
async function scoreOpportunity(
  fields: ExtractedFields,
  orgProfilePrompt: string,
  stats: RunStats,
): Promise<ScoreResult | null> {
  const prompt = `${orgProfilePrompt}

OPPORTUNITY TO SCORE:
${JSON.stringify(fields, null, 2)}`

  const { text, usage } = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    prompt,
    maxTokens: 1024,
  })
  stats.tokens_sonnet += (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0)
  return parseJson<ScoreResult>(text)
}

// ── Cancellation check ────────────────────────────────────────

async function isCancelling(runId: string): Promise<boolean> {
  const { data } = await supabase
    .from('discovery_runs')
    .select('status')
    .eq('id', runId)
    .maybeSingle()
  return data?.status === 'cancelling'
}

// ── Auth ──────────────────────────────────────────────────────

async function isAdminJwt(jwt: string): Promise<boolean> {
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (!user) {
    console.error('[sync] getUser failed:', authError?.message ?? 'no user returned')
    return false
  }
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) {
    console.error('[sync] profile lookup failed for', user.id, profileError?.message ?? 'no profile row found')
    return false
  }
  console.log('[sync] user role:', profile.role)
  return profile.role === 'admin'
}

// ── Handler ───────────────────────────────────────────────────
// Accepts:
//   GET  with Authorization: Bearer <CRON_SECRET>  → triggered by Vercel Cron
//   POST with Authorization: Bearer <user-jwt>     → manual trigger from admin UI

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  // ── Create run audit row ──────────────────────────────────────
  const { data: run } = await supabase
    .from('discovery_runs')
    .insert({ triggered_by: triggeredBy, status: 'running' })
    .select('id')
    .single()

  if (!run) {
    return res.status(500).json({ error: 'Failed to create run record' })
  }

  const runId = run.id
  const stats: RunStats = {
    opportunities_fetched: 0,
    opportunities_deduplicated: 0,
    opportunities_detail_fetched: 0,
    opportunities_auto_rejected: 0,
    opportunities_below_threshold: 0,
    opportunities_inserted: 0,
    tokens_haiku: 0,
    tokens_sonnet: 0,
    error_log: [],
  }

  try {
    // ── Load active org profile ───────────────────────────────────
    const { data: orgProfile } = await supabase
      .from('org_profiles')
      .select('id, prompt_text')
      .eq('is_active', true)
      .single()

    if (!orgProfile) throw new Error('No active org profile found')

    // ── Load enabled queries ──────────────────────────────────────
    const { data: queries } = await supabase
      .from('discovery_queries')
      .select('id, label, payload, current_page')
      .eq('enabled', true)
      .order('priority', { ascending: true })

    if (!queries?.length) throw new Error('No enabled discovery queries found')

    // ── Execute queries and collect unique opportunity IDs ────────
    const allIds = new Set<string>()
    for (const query of queries) {
      try {
        const { ids, totalPages } = await searchOpportunities(query.payload, query.current_page ?? 1)
        ids.forEach(id => allIds.add(id))
        stats.opportunities_fetched += ids.length

        // Advance page; wrap to 1 after the last page so next run starts fresh
        const nextPage = (query.current_page ?? 1) >= totalPages ? 1 : (query.current_page ?? 1) + 1
        await supabase
          .from('discovery_queries')
          .update({ current_page: nextPage, updated_at: new Date().toISOString() })
          .eq('id', query.id)
      } catch (err) {
        stats.error_log.push({
          label: query.label,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        })
      }
    }

    // ── Deduplicate against existing opportunities ────────────────
    const idArray = Array.from(allIds)
    const { data: existing } = await supabase
      .from('opportunities')
      .select('external_id')
      .in('external_id', idArray)
      .not('external_id', 'is', null)

    const existingIds = new Set((existing ?? []).map(r => r.external_id as string))
    const newIds = idArray.filter(id => !existingIds.has(id))
    stats.opportunities_deduplicated = idArray.length - newIds.length

    // Cap per-run to avoid function timeout; remainder is picked up on next run
    const batch = newIds.slice(0, MAX_NEW_PER_RUN)

    // ── Two-stage pipeline for each new opportunity ───────────────
    for (const opportunityId of batch) {
      // Check for cancellation signal before starting each opportunity
      if (await isCancelling(runId)) {
        await supabase.from('discovery_runs').update({
          completed_at: new Date().toISOString(),
          status:       'cancelled',
          ...stats,
          error_log:    stats.error_log.length > 0 ? stats.error_log : null,
        }).eq('id', runId)
        return res.status(200).json({ run_id: runId, status: 'cancelled', ...stats })
      }

      try {
        // Fetch full detail: search results omit deadline, eligibility, description
        const detail = await fetchDetail(opportunityId)
        stats.opportunities_detail_fetched++

        // Stage 1: Haiku extracts structured fields
        const fields = await extractFields(detail, stats)
        if (!fields) {
          stats.error_log.push({
            label: `extract:${opportunityId}`,
            error: 'Failed to parse Haiku extraction response',
            timestamp: new Date().toISOString(),
          })
          continue
        }

        // Pre-screen: skip obvious disqualifiers before calling Sonnet
        const rejectReason = preScreen(fields)
        if (rejectReason) {
          stats.opportunities_auto_rejected++
          continue
        }

        // Stage 2: Sonnet scores against org profile
        const score = await scoreOpportunity(fields, orgProfile.prompt_text, stats)
        if (!score) {
          stats.error_log.push({
            label: `score:${opportunityId}`,
            error: 'Failed to parse Sonnet scoring response',
            timestamp: new Date().toISOString(),
          })
          continue
        }

        if (score.auto_rejected) {
          stats.opportunities_auto_rejected++
          continue
        }

        if (score.weighted_score < 5.0) {
          stats.opportunities_below_threshold++
          continue
        }

        // Insert into opportunities
        const { error: insertErr } = await supabase.from('opportunities').insert({
          type_id:           'grant',
          name:              fields.name,
          funder:            fields.funder,
          grant_type:        fields.grant_type,
          description:       fields.description,
          amount_max:        fields.amount_max,
          primary_deadline:  fields.primary_deadline ?? null,
          loi_deadline:      null,
          eligibility_notes: fields.eligibility_notes,
          cfda_number:       fields.cfda_number,
          status:            'grant_discovered',
          source:            'simpler_grants_gov',
          external_id:       opportunityId,
          external_url:      `https://simpler.grants.gov/opportunity/${opportunityId}`,
          ai_match_score:    score.weighted_score,
          ai_match_rationale: score.rationale,
          ai_score_detail:   score,
          auto_discovered:   true,
          discovered_at:     new Date().toISOString(),
        })

        if (insertErr) {
          stats.error_log.push({
            label: `insert:${opportunityId}`,
            error: insertErr.message,
            timestamp: new Date().toISOString(),
          })
        } else {
          stats.opportunities_inserted++
        }
      } catch (err) {
        stats.error_log.push({
          label: `process:${opportunityId}`,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        })
      }
    }

    // ── Finalize run record ───────────────────────────────────────
    await supabase.from('discovery_runs').update({
      completed_at:   new Date().toISOString(),
      status:         'completed',
      org_profile_id: orgProfile.id,
      ...stats,
      error_log:      stats.error_log.length > 0 ? stats.error_log : null,
    }).eq('id', runId)

    return res.status(200).json({ run_id: runId, status: 'completed', ...stats })

  } catch (err) {
    await supabase.from('discovery_runs').update({
      completed_at: new Date().toISOString(),
      status:       'failed',
      error_log:    [{ label: 'fatal', error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }],
    }).eq('id', runId)

    console.error('Discovery sync fatal error:', err)
    return res.status(500).json({ error: 'Discovery sync failed', run_id: runId })
  }
}
