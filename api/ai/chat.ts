import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText } from 'ai'

// ── Supabase (service role — server-side only) ────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Anthropic via Vercel AI SDK ───────────────────────────────
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ── System prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert grant writer for Wright Adventures, a Denver-based nonprofit consultancy \
that connects underserved communities to nature, career pathways, and environmental stewardship. \
Wright Adventures has raised over $3 million for partner programs and manages $700K+ annually \
for Lincoln Hills Cares pathways programs.

Your role is to write compelling, mission-aligned grant narrative drafts. Write in a professional \
but authentic voice — not generic nonprofit boilerplate. Ground every draft in the specific \
opportunity details provided. Be direct, specific, and outcomes-focused.

When the user asks for revisions, apply them precisely and return the updated section or \
full draft as appropriate. If the user's request is ambiguous, ask one clarifying question \
before drafting.`

// ── Helpers ───────────────────────────────────────────────────
function startOfCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function buildBriefing(opp: Record<string, unknown>): string {
  const lines = [
    'Here is the grant opportunity you will help draft:',
    '',
    `OPPORTUNITY: ${opp.name ?? ''}`,
    `FUNDER: ${opp.funder ?? ''}`,
    `GRANT TYPE: ${opp.grant_type ?? ''}`,
    `FUNDING AMOUNT REQUESTED: ${opp.amount_requested != null ? `$${Number(opp.amount_requested).toLocaleString()}` : ''}`,
    `FUNDING AMOUNT MAX: ${opp.amount_max != null ? `$${Number(opp.amount_max).toLocaleString()}` : ''}`,
    `APPLICATION DEADLINE: ${opp.primary_deadline ?? ''}`,
    `LOI DEADLINE: ${opp.loi_deadline ?? ''}`,
    `ELIGIBILITY NOTES: ${opp.eligibility_notes ?? ''}`,
    `CFDA NUMBER: ${opp.cfda_number ?? ''}`,
    '',
    'DESCRIPTION:',
    (opp.description as string) ?? '',
    '',
    'Please confirm you\'re ready to begin drafting.',
  ]
  return lines.join('\n')
}

// ── Main handler ──────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
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

  // ── 2. Parse body ────────────────────────────────────────────
  const { conversation_id, message, opportunity_id } = req.body as {
    conversation_id?: string
    message: string
    opportunity_id?: string
  }

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' })
  }

  // ── 3. Budget check ──────────────────────────────────────────
  const periodStart = startOfCurrentMonth()
  const { data: budget } = await supabase
    .from('token_budgets')
    .select('id, monthly_limit, tokens_used')
    .eq('current_period_start', periodStart)
    .single()

  if (!budget) {
    // Auto-provision budget row for current month on first use
    await supabase.from('token_budgets').insert({
      current_period_start: periodStart,
      monthly_limit: 500000,
      tokens_used: 0,
    })
  } else {
    const estimatedTokens = Math.ceil(message.length / 4) + 2000 // rough estimate
    if (budget.tokens_used + estimatedTokens > budget.monthly_limit) {
      return res.status(402).json({
        error: 'Monthly token budget exceeded',
        used: budget.tokens_used,
        limit: budget.monthly_limit,
      })
    }
  }

  // ── 4. Resolve or create conversation ────────────────────────
  let convId = conversation_id

  if (!convId) {
    // Require opportunity_id to start a new conversation
    if (!opportunity_id) {
      return res.status(400).json({ error: 'opportunity_id is required to start a conversation' })
    }

    // Verify the opportunity is a grant
    const { data: opp } = await supabase
      .from('opportunities')
      .select('id, type_id')
      .eq('id', opportunity_id)
      .single()

    if (!opp || opp.type_id !== 'grant') {
      return res.status(400).json({ error: 'AI drafting is only available for grant opportunities' })
    }

    const { data: newConv, error: convErr } = await supabase
      .from('ai_conversations')
      .insert({ opportunity_id, user_id: user.id })
      .select('id')
      .single()

    if (convErr || !newConv) {
      return res.status(500).json({ error: 'Failed to create conversation' })
    }
    convId = newConv.id
  }

  // ── 5. Fetch conversation + opportunity context ───────────────
  const { data: conv } = await supabase
    .from('ai_conversations')
    .select('id, opportunity_id, user_id')
    .eq('id', convId)
    .single()

  if (!conv || conv.user_id !== user.id) {
    return res.status(403).json({ error: 'Conversation not found or access denied' })
  }

  const { data: opp } = await supabase
    .from('opportunities')
    .select('name, funder, grant_type, amount_requested, amount_max, primary_deadline, loi_deadline, eligibility_notes, cfda_number, description')
    .eq('id', conv.opportunity_id)
    .single()

  if (!opp) {
    return res.status(404).json({ error: 'Opportunity not found' })
  }

  const { data: priorMessages } = await supabase
    .from('ai_messages')
    .select('role, content, is_injected')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })

  // ── 6. Build message array ───────────────────────────────────
  // Structure: [injected briefing + ack] + [non-injected history] + [new user message]
  const hasInjected = priorMessages?.some(m => m.is_injected) ?? false

  const messages: { role: 'user' | 'assistant'; content: string }[] = []

  if (!hasInjected) {
    // Prepend opportunity briefing on first turn
    messages.push({ role: 'user',      content: buildBriefing(opp as Record<string, unknown>) })
    messages.push({ role: 'assistant', content: "Understood. I've reviewed the grant opportunity details and I'm ready to help you draft compelling narrative. What would you like to start with?" })
  } else {
    // Include only injected messages at the start, then non-injected history
    const injected    = priorMessages?.filter(m => m.is_injected)  ?? []
    const nonInjected = priorMessages?.filter(m => !m.is_injected) ?? []
    for (const m of [...injected, ...nonInjected]) {
      messages.push({ role: m.role as 'user' | 'assistant', content: m.content })
    }
  }

  messages.push({ role: 'user', content: message })

  // ── 7. Persist user message ───────────────────────────────────
  // Also persist injected messages on first turn
  if (!hasInjected) {
    await supabase.from('ai_messages').insert([
      { conversation_id: convId, role: 'user',      content: buildBriefing(opp as Record<string, unknown>), is_injected: true },
      { conversation_id: convId, role: 'assistant', content: messages[1].content, is_injected: true },
    ])
  }

  await supabase.from('ai_messages').insert({
    conversation_id: convId,
    role: 'user',
    content: message,
    is_injected: false,
  })

  // ── 8. Stream from Claude ─────────────────────────────────────
  try {
    const result = await streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: SYSTEM_PROMPT,
      messages,
      maxTokens: 4096,
      onFinish: async ({ usage, text }) => {
        const inputTokens  = usage.promptTokens
        const outputTokens = usage.completionTokens

        // Persist assistant message
        await supabase.from('ai_messages').insert({
          conversation_id: convId,
          role:            'assistant',
          content:         text,
          input_tokens:    inputTokens,
          output_tokens:   outputTokens,
          is_injected:     false,
        })

        // Update conversation token totals
        await supabase.rpc('increment_conversation_tokens', {
          p_conversation_id:    convId,
          p_input_tokens:       inputTokens,
          p_output_tokens:      outputTokens,
        }).then(async ({ error }) => {
          // Fallback: direct update if RPC not available
          if (error) {
            const { data: current } = await supabase
              .from('ai_conversations')
              .select('total_input_tokens, total_output_tokens')
              .eq('id', convId)
              .single()
            if (current) {
              await supabase.from('ai_conversations').update({
                total_input_tokens:  current.total_input_tokens  + inputTokens,
                total_output_tokens: current.total_output_tokens + outputTokens,
                updated_at: new Date().toISOString(),
              }).eq('id', convId)
            }
          }
        })

        // Update org-wide token budget
        const { data: currentBudget } = await supabase
          .from('token_budgets')
          .select('tokens_used')
          .eq('current_period_start', periodStart)
          .single()

        if (currentBudget) {
          await supabase.from('token_budgets').update({
            tokens_used: currentBudget.tokens_used + inputTokens + outputTokens,
            updated_at:  new Date().toISOString(),
          }).eq('current_period_start', periodStart)
        }
      },
    })

    // Return conversation_id in header so the frontend can track new conversations
    res.setHeader('X-Conversation-Id', convId!)
    result.pipeUIMessageStreamToResponse(res)
    return

  } catch (err: unknown) {
    console.error('Claude stream error:', err)
    return res.status(500).json({ error: 'AI service error' })
  }
}
