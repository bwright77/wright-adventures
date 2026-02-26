import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

// ── Supabase (service role — server-side only) ────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Anthropic ─────────────────────────────────────────────────
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ── Handler ───────────────────────────────────────────────────
// POST /api/discovery/score
// Body: { opportunity_id: string }
// Re-scores a single opportunity against the current active org profile.
// Useful after org profile changes or when a manual score refresh is needed.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth: admin JWT only ──────────────────────────────────────
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }
  const jwt = authHeader.slice(7)

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }

  // ── Validate body ─────────────────────────────────────────────
  const { opportunity_id } = req.body as { opportunity_id?: string }
  if (!opportunity_id) {
    return res.status(400).json({ error: 'opportunity_id is required' })
  }

  // ── Load opportunity ──────────────────────────────────────────
  const { data: opp } = await supabase
    .from('opportunities')
    .select('name, funder, grant_type, description, amount_max, primary_deadline, loi_deadline, eligibility_notes, cfda_number')
    .eq('id', opportunity_id)
    .single()

  if (!opp) {
    return res.status(404).json({ error: 'Opportunity not found' })
  }

  // ── Load active org profile ───────────────────────────────────
  const { data: orgProfile } = await supabase
    .from('org_profiles')
    .select('prompt_text')
    .eq('is_active', true)
    .single()

  if (!orgProfile) {
    return res.status(500).json({ error: 'No active org profile found' })
  }

  // ── Score with Sonnet ─────────────────────────────────────────
  const prompt = `${orgProfile.prompt_text}

OPPORTUNITY TO SCORE:
${JSON.stringify(opp, null, 2)}`

  let text: string
  try {
    const result = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      prompt,
      maxTokens: 1024,
    })
    text = result.text
  } catch (err) {
    console.error('Sonnet scoring error:', err)
    return res.status(500).json({ error: 'AI scoring failed' })
  }

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) {
    return res.status(500).json({ error: 'Failed to parse scoring response' })
  }

  let score: Record<string, unknown>
  try {
    score = JSON.parse(match[0])
  } catch {
    return res.status(500).json({ error: 'Invalid JSON in scoring response' })
  }

  // ── Persist updated score ─────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('opportunities')
    .update({
      ai_match_score:     score.weighted_score as number,
      ai_match_rationale: score.rationale as string,
      ai_score_detail:    score,
      updated_at:         new Date().toISOString(),
    })
    .eq('id', opportunity_id)

  if (updateErr) {
    return res.status(500).json({ error: 'Failed to persist updated score' })
  }

  return res.status(200).json({ opportunity_id, score })
}
