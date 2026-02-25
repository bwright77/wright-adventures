# ADR-001: AI-Assisted Grant Writing — Phase 2

**Project:** Wright Adventures — Opportunity Management Platform (OMP)  
**Author:** Benjamin Wright, Director of Technology & Innovation  
**Date:** 2026-02-25  
**Status:** Accepted  
**PRD Reference:** OMP PRD v2.0, Phase 2 — Collaboration & Intelligence

---

## Context

The OMP MVP is live at `https://wright-adventures.vercel.app/` — a React 19 + TypeScript + Vite SPA hosted on Vercel, backed by Supabase (PostgreSQL + Auth + Storage). The OMP is a **single-tenant application** — it serves the Wright Adventures internal team only and doubles as a demo for prospective partner organizations.

Phase 2 introduces AI-assisted grant writing as the highest-priority feature: freeform narrative draft generation with iterative chat-style refinement, powered by the Anthropic Claude API.

Three decisions drive the architecture:
1. **Freeform prose output** — full narrative drafts, not structured field suggestions
2. **Iterative refinement** — users can back-and-forth with the AI to refine drafts (requires conversation history management)
3. **Cost controls** — application-wide monthly token budget enforced server-side (single tenant = single budget)

**Architectural constraint:** The existing app is React + Vite (SPA), not Next.js. There are no built-in API routes. A lightweight backend is required to keep the Anthropic API key server-side and enforce cost controls.

**Repo structure (confirmed):**
```
.claude/                  ← Claude Code config — add ADR reference here
src/
  components/admin/
  contexts/AuthContext.tsx
  lib/supabase.ts
  lib/types.ts
  pages/admin/
    Dashboard.tsx
    Opportunities.tsx
    OpportunityDetail.tsx
    MyTasks.tsx
supabase/migrations/
  20260224000000_initial_schema.sql  ← Do not modify
vercel.json               ← Must be updated — see Decision section
```

**`vercel.json` (confirmed current contents):**
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```
⚠️ The catch-all rewrite `/(.*) → /index.html` will intercept `/api/*` routes, causing all API calls to return the SPA's `index.html` instead of the serverless function response. This **must** be fixed before the AI API will work.

**`profiles` table (confirmed):** `id`, `full_name`, `role` (`admin|manager|member|viewer`), `avatar_url`, `created_at`, `updated_at`. RLS policies in the AI migration reference `profiles.role` — this is correct.

**`opportunities` table (confirmed):** All grant-specific and partnership-specific fields are on the single `opportunities` table (flat model, no join required). The opportunity briefing injection can pull directly from one row.

---

## Decision

Deploy a **Vercel Serverless Function** (via a `/api` directory in the existing Vercel project) as the AI proxy layer. Use the **Vercel AI SDK** with the Anthropic provider for streaming. Persist conversation history and token usage in Supabase.

This avoids standing up a separate backend service while keeping the API key server-side and enabling cost enforcement.

**Required `vercel.json` change** — scope the SPA rewrite to exclude `/api/*`:
```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```
Vercel evaluates rewrites in order — the `/api/*` rule must come first.

---

## Architecture

### 1. Backend: Vercel Serverless Function

Add an `/api` directory to the existing repo. Vercel auto-deploys functions found here alongside the Vite frontend — zero infrastructure change required.

```
/api
  /ai
    chat.ts        ← Main streaming endpoint
    usage.ts       ← Token usage query endpoint (admin)
```

**`/api/ai/chat.ts` responsibilities:**
1. Authenticate the request (validate Supabase JWT from `Authorization` header)
2. Check org token budget — reject with 402 if exceeded
3. Fetch conversation history from Supabase for the given `conversation_id`
4. Fetch opportunity context (fields + document text excerpts) from Supabase
5. Build the full message array (system prompt + injected briefing + history + new user message)
6. Stream response from Claude API back to client via SSE
7. On stream completion, persist assistant message + token usage to Supabase

### 2. Supabase Schema

Run these migrations in order.

```sql
-- Application-wide token budget (single-tenant — one row per billing period)
-- Seeded with a default row on first use by the API function
CREATE TABLE token_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_limit INTEGER NOT NULL DEFAULT 500000, -- ~500K tokens/month (~$15 at Sonnet pricing)
  current_period_start DATE NOT NULL DEFAULT date_trunc('month', now()),
  tokens_used INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(current_period_start) -- one row per calendar month
);

-- One conversation per opportunity per user session
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT false
);

-- Individual turns in a conversation
CREATE TABLE ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  input_tokens INTEGER,       -- populated on assistant messages only
  output_tokens INTEGER,      -- populated on assistant messages only
  is_injected BOOLEAN NOT NULL DEFAULT false, -- true = opportunity briefing, hidden in UI
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS policies
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_budgets ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read/write their own conversations
CREATE POLICY "authenticated_conversations" ON ai_conversations
  USING (auth.uid() = user_id);

CREATE POLICY "authenticated_messages" ON ai_messages
  USING (conversation_id IN (
    SELECT id FROM ai_conversations WHERE user_id = auth.uid()
  ));

-- Only admins can view/update token budgets
-- Matches existing role field on profiles table
CREATE POLICY "admin_token_budgets" ON token_budgets
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');
```

### 3. Prompt Architecture

Every Claude API call receives the same structure:

```
[System Prompt]           ← Static, sets assistant persona and WA context
[Injected Briefing]       ← role: "user", is_injected: true — opportunity fields + doc excerpts
[Injected Ack]            ← role: "assistant", is_injected: true — "Understood. Ready to draft."
[Conversation History]    ← All prior non-injected turns for this conversation_id
[New User Message]        ← Current turn
```

The injected briefing is stored in `ai_messages` with `is_injected = true` and **never rendered in the UI**. It's always prepended to the message array on the server before sending to Claude.

**System Prompt:**
```
You are an expert grant writer for Wright Adventures, a Denver-based nonprofit consultancy 
that connects underserved communities to nature, career pathways, and environmental stewardship. 
Wright Adventures has raised over $3 million for partner programs and manages $700K+ annually 
for Lincoln Hills Cares pathways programs.

Your role is to write compelling, mission-aligned grant narrative drafts. Write in a professional 
but authentic voice — not generic nonprofit boilerplate. Ground every draft in the specific 
opportunity details provided. Be direct, specific, and outcomes-focused.

When the user asks for revisions, apply them precisely and return the updated section or 
full draft as appropriate. If the user's request is ambiguous, ask one clarifying question 
before drafting.
```

**Opportunity Briefing Template (injected, hidden from UI):**

Maps directly to confirmed `opportunities` table columns:
```
Here is the grant opportunity you will help draft:

OPPORTUNITY: {name}
FUNDER: {funder}
GRANT TYPE: {grant_type}
FUNDING AMOUNT REQUESTED: {amount_requested}
FUNDING AMOUNT MAX: {amount_max}
APPLICATION DEADLINE: {primary_deadline}
LOI DEADLINE: {loi_deadline}
ELIGIBILITY NOTES: {eligibility_notes}
CFDA NUMBER: {cfda_number}

DESCRIPTION:
{description}

RELEVANT DOCUMENTS:
{document_excerpts}  ← Text extracted from documents.storage_path files via Supabase Storage

Please confirm you're ready to begin drafting.
```

### 4. Cost Control Logic

Enforced in `/api/ai/chat.ts` before forwarding to Claude:

```typescript
async function checkAndReserveBudget(estimatedTokens: number): Promise<void> {
  const { data: budget } = await supabase
    .from('token_budgets')
    .select('monthly_limit, tokens_used')
    .eq('current_period_start', startOfCurrentMonth())
    .single();

  if (!budget) {
    // Auto-provision budget row for current month on first use
    await supabase.from('token_budgets').insert({
      current_period_start: startOfCurrentMonth(),
      monthly_limit: 500000,
      tokens_used: 0,
    });
    return;
  }

  if (budget.tokens_used + estimatedTokens > budget.monthly_limit) {
    throw new BudgetExceededError(
      `Monthly token budget exceeded. Used: ${budget.tokens_used.toLocaleString()} / ${budget.monthly_limit.toLocaleString()}`
    );
  }
}
```

After stream completion, update `token_budgets.tokens_used` and `ai_conversations.total_input_tokens / total_output_tokens` atomically.

Return HTTP 402 with a structured error body if budget is exceeded — the frontend displays a user-friendly message with a link to the admin settings page.

### 5. Conversation Length / Token Growth Mitigation

Full conversation history is sent on every turn — costs grow linearly with conversation length. Two mitigations:

**Soft limit:** After 20 turns, the UI surfaces a banner: *"This draft session is getting long. Start a new draft session to keep costs down, or continue."*

**"New Draft" action:** Resets the conversation (creates a new `ai_conversations` row) but carries forward the final assistant message as the new briefing context. Preserves continuity without token bleed.

Conversation summarization (full automatic compression) is **not** implemented in Phase 2 but the schema supports it — a `summary` column can be added to `ai_conversations` and prepended instead of full history when present.

### 6. Frontend Integration

Install the Vercel AI SDK:
```bash
npm install ai @ai-sdk/anthropic
```

The `useChat` hook manages streaming, message state, loading state, and abort control:

```tsx
// src/features/ai/useGrantChat.ts
import { useChat } from 'ai/react';
import { useSession } from '@/hooks/useSession';

export function useGrantChat(conversationId: string) {
  const { session } = useSession();

  return useChat({
    api: '/api/ai/chat',
    id: conversationId,
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: {
      conversation_id: conversationId,
    },
    onError: (error) => {
      // Handle 402 budget exceeded, 401 auth, 500 server errors
      console.error('AI chat error:', error);
    },
  });
}
```

**UI placement:** An "AI Draft Assistant" tab on the Opportunity detail page, visible only for Grant-type opportunities. The tab contains the chat interface — message history (excluding injected messages), input field, send button, streaming indicator, and token usage display (current conversation cost).

---

## Model Selection

| Use Case | Model | Rationale |
|---|---|---|
| Grant narrative drafting | `claude-sonnet-4-6` | Best quality/cost ratio for long-form writing |
| Document summarization / field extraction | `claude-haiku-4-5-20251001` | Fast, cheap for short extraction tasks |
| Eligibility analysis against complex RFP | `claude-opus-4-6` | Reserved for deep reasoning tasks only |

---

## Environment Variables

Add to Vercel project settings (not committed to repo):

```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_SERVICE_ROLE_KEY=...   ← Service role for server-side Supabase access
SUPABASE_URL=https://...supabase.co
```

The existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the frontend remain unchanged.

---

## Implementation Sequence

Build in this order — each step is independently testable:

1. **`vercel.json`** — scope the SPA catch-all rewrite to exclude `/api/*` (see Decision section)
2. **Supabase migration** — new file `supabase/migrations/20260225000000_ai_grant_writing.sql`: `token_budgets`, `ai_conversations`, `ai_messages` tables + RLS policies. Do not modify `20260224000000_initial_schema.sql`
3. **`/api/ai/chat.ts`** — serverless function: auth check → budget check → history fetch → prompt assembly (using confirmed `opportunities` column names) → Claude stream → persist usage
4. **`/api/ai/usage.ts`** — admin endpoint returning current period token usage
5. **`useGrantChat` hook** — Vercel AI SDK `useChat` wrapper; auth token from existing `AuthContext.tsx`
6. **Chat UI component** — message list, input, streaming indicator; filter `is_injected = true` messages from rendering
7. **Opportunity detail integration** — "AI Draft Assistant" tab on `OpportunityDetail.tsx`, visible only when `opportunity.type_id === 'grant'`
8. **Token budget admin UI** — usage display + limit configuration in Settings

---

## Risks & Tradeoffs

| Risk | Impact | Mitigation |
|---|---|---|
| `vercel.json` catch-all rewrite intercepts `/api/*` | All API calls return `index.html` — AI feature completely broken | **Known issue, confirmed fix in Decision section.** Must be Step 1 before any other work |
| Vite SPA + Vercel Functions cold starts | First request latency ~500ms | Acceptable for non-latency-critical drafting; no mitigation needed at MVP scale |
| Token costs exceed budget unexpectedly | Cost overrun | Hard server-side enforcement; admin alert at 80% consumption (~400K tokens) |
| Document text extraction from PDFs/DOCX in Supabase Storage | Incomplete briefing context | Use `pdf-parse` + `mammoth` in API function; documents table `storage_path` provides the key |
| Long conversations degrade context quality | Poor draft quality late in session | 20-turn soft limit + "New Draft" action |
| API key exposure | Security breach | `ANTHROPIC_API_KEY` only in Vercel env vars server-side; never in `VITE_*` prefix |
| `AuthContext.tsx` session token shape unknown | Auth check in API function may need adjustment | Inspect `AuthContext.tsx` before implementing `/api/ai/chat.ts` — adapt JWT extraction accordingly |

---

## Out of Scope (Phase 2)

- Conversation summarization / automatic context compression
- Past application ingestion as few-shot examples (Phase 3)
- AI assistance for Partnership-type opportunities
- Batch / async draft generation
- Fine-tuning or custom model deployment

---

## Claude Code Integration

This ADR is the authoritative spec for Phase 2 AI implementation. Add it to the repo and reference it in `.claude/CLAUDE.md`:

```markdown
## Active ADRs
- [ADR-001: AI Grant Writing](../docs/ADR-001-ai-grant-writing.md) — Phase 2 AI integration. 
  Follow this spec exactly when implementing AI features.
```

**Recommended Claude Code session prompts (in order):**

1. *"Read ADR-001. Fix `vercel.json` per the Decision section — scope the SPA catch-all rewrite to exclude `/api/*` so serverless functions are reachable."*

2. *"Read ADR-001. Create `supabase/migrations/20260225000000_ai_grant_writing.sql` with the three tables (`token_budgets`, `ai_conversations`, `ai_messages`) and RLS policies exactly as specified. Do not touch the existing initial schema migration."*

3. *"Read ADR-001. Implement `/api/ai/chat.ts` — the Vercel serverless function. Auth check using the Supabase JWT, budget check against `token_budgets`, history fetch, prompt assembly using the confirmed `opportunities` column names from the schema, Claude streaming via Vercel AI SDK, and usage persistence on stream completion."*

4. *"Read ADR-001. Implement `/api/ai/usage.ts` — admin-only endpoint returning current month token usage from `token_budgets`."*

5. *"Read ADR-001. Create `src/hooks/useGrantChat.ts` using Vercel AI SDK `useChat`. Pull the auth session token from the existing `AuthContext.tsx`."*

6. *"Read ADR-001. Build the chat UI component and integrate it as an 'AI Draft Assistant' tab in `src/pages/admin/OpportunityDetail.tsx`. Show the tab only when `opportunity.type_id === 'grant'`. Filter messages where `is_injected === true` from the rendered conversation."*

7. *"Read ADR-001. Add token budget display and monthly limit configuration to the admin Settings page — show tokens used, limit, percentage consumed, and a form for admins to update the limit."*

---

- [OMP PRD v2.0](./OMP_PRD_v2) — Phase 2 scope definition
- [Vercel AI SDK Docs](https://sdk.vercel.ai/docs)
- [Anthropic Claude API Docs](https://docs.anthropic.com)
- [Supabase RLS Guide](https://supabase.com/docs/guides/auth/row-level-security)
- App: `https://wright-adventures.vercel.app/`
