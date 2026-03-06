import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { ADVISOR_SYSTEM, buildAdvisorPrompt } from '../../src/lib/partnerships/advisorPrompt'
import type { AdvisorRecommendation } from '../../src/lib/types'

// ── Clients ───────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Cache TTL: 7 days
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Minimum fields needed to produce a useful recommendation
const REQUIRED_FIELDS = ['pain_points', 'description'] as const

// ── Main handler ──────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth ────────────────────────────────────────────────────
  const jwt = req.headers.authorization?.replace('Bearer ', '')
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  // Fetch profile to check role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return res.status(403).json({ error: 'Admin or manager role required' })
  }

  // ── Validate body ───────────────────────────────────────────
  const { opportunity_id, force_refresh } = req.body as {
    opportunity_id?: string
    force_refresh?: boolean
  }

  if (!opportunity_id || typeof opportunity_id !== 'string') {
    return res.status(400).json({ error: 'opportunity_id is required' })
  }

  // ── Fetch opportunity + details ─────────────────────────────
  const { data: opp, error: oppError } = await supabase
    .from('opportunities')
    .select('id, name, description, status, partner_org, partnership_type, estimated_value, type_id')
    .eq('id', opportunity_id)
    .single()

  if (oppError || !opp) return res.status(404).json({ error: 'Opportunity not found' })
  if (opp.type_id !== 'partnership') {
    return res.status(400).json({ error: 'Opportunity is not a partnership' })
  }

  const { data: pd, error: pdError } = await supabase
    .from('partnership_details')
    .select('org_size, pain_points, tech_stack_notes, qualification_notes, ai_solution_summary, ai_solution_updated_at')
    .eq('opportunity_id', opportunity_id)
    .single()

  if (pdError || !pd) return res.status(404).json({ error: 'Partnership details not found' })

  // ── Cache check ─────────────────────────────────────────────
  if (!force_refresh && pd.ai_solution_summary && pd.ai_solution_updated_at) {
    const age = Date.now() - new Date(pd.ai_solution_updated_at).getTime()
    if (age < CACHE_TTL_MS) {
      try {
        const recommendation = JSON.parse(pd.ai_solution_summary) as AdvisorRecommendation
        return res.status(200).json({ recommendation, cached: true })
      } catch {
        // Cache is corrupt — fall through to regenerate
      }
    }
  }

  // ── Insufficient data check ─────────────────────────────────
  const missingFields: string[] = []
  for (const field of REQUIRED_FIELDS) {
    const val = field === 'description' ? opp.description : pd[field as keyof typeof pd]
    if (!val || String(val).trim() === '') {
      missingFields.push(field === 'description' ? 'Opportunity description' : 'Key pain points')
    }
  }

  if (missingFields.length === REQUIRED_FIELDS.length) {
    return res.status(200).json({
      recommendation: null,
      cached: false,
      message: `Add more context before generating a recommendation: ${missingFields.join(', ')}.`,
    })
  }

  // ── Generate recommendation ─────────────────────────────────
  try {
    const prompt = buildAdvisorPrompt(opp, pd)

    const { text } = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: ADVISOR_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1500,
    })

    let parsed: AdvisorRecommendation
    try {
      parsed = JSON.parse(text.trim())
    } catch {
      console.error('Advisor JSON parse error. Raw output:', text.slice(0, 500))
      return res.status(200).json({
        recommendation: null,
        cached: false,
        error: 'Could not parse recommendation — try again.',
      })
    }

    // Stamp generated_at
    parsed.generated_at = new Date().toISOString()

    // Cache in DB
    await supabase
      .from('partnership_details')
      .update({
        ai_solution_summary:    JSON.stringify(parsed),
        ai_solution_updated_at: parsed.generated_at,
        updated_at:             parsed.generated_at,
      })
      .eq('opportunity_id', opportunity_id)

    return res.status(200).json({ recommendation: parsed, cached: false })
  } catch (err) {
    console.error('Advisor generation error:', err)
    return res.status(200).json({
      recommendation: null,
      cached: false,
      error: 'Could not generate recommendation — try again.',
    })
  }
}
