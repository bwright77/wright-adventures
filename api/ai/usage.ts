import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// ── Supabase (service role — server-side only) ────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Main handler ──────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── 1. Auth ──────────────────────────────────────────────────
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }
  const jwt = authHeader.slice(7)

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  // ── 2. Admin check ───────────────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }

  // ── 3. Current period usage ───────────────────────────────────
  const now = new Date()
  const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const { data: budget, error: budgetError } = await supabase
    .from('token_budgets')
    .select('id, monthly_limit, tokens_used, current_period_start, updated_at')
    .eq('current_period_start', periodStart)
    .single()

  if (budgetError && budgetError.code !== 'PGRST116') {
    return res.status(500).json({ error: 'Failed to fetch budget' })
  }

  // ── 4. Conversation-level breakdown ──────────────────────────
  const { data: conversations } = await supabase
    .from('ai_conversations')
    .select('id, opportunity_id, user_id, total_input_tokens, total_output_tokens, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50)

  return res.status(200).json({
    period_start: periodStart,
    monthly_limit: budget?.monthly_limit ?? 500000,
    tokens_used:   budget?.tokens_used  ?? 0,
    percent_used:  budget
      ? Math.round((budget.tokens_used / budget.monthly_limit) * 100)
      : 0,
    updated_at:    budget?.updated_at ?? null,
    conversations: conversations ?? [],
  })
}
