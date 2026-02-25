# ADR-001: AI-Assisted Grant Writing — Phase 2

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-02-25
**Status:** Implemented
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

---

## Decision

Deploy a **Vercel Serverless Function** (via a `/api` directory in the existing Vercel project) as the AI proxy layer. Use the **Vercel AI SDK** with the Anthropic provider for streaming. Persist conversation history and token usage in Supabase.

This avoids standing up a separate backend service while keeping the API key server-side and enabling cost enforcement.

**`vercel.json` — scope the SPA rewrite to exclude `/api/*`:**
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

## Implementation — As Built

### Package Versions (Actual)

```json
"ai": "^6.0.100",
"@ai-sdk/anthropic": "^3.0.47",
"@ai-sdk/react": "^1.x"
```

> ⚠️ **AI SDK v6 breaking changes** — The ADR was originally drafted against AI SDK v3. v6 introduced significant API changes that affected both the server and client layers. See the v6 notes throughout this section.

---

### 1. Backend: Vercel Serverless Functions

```
/api
  /ai
    chat.ts        ← Main streaming endpoint
    usage.ts       ← Token usage query endpoint (admin only)
```

**`/api/ai/chat.ts` — request lifecycle:**
1. Validate `Authorization: Bearer <jwt>` header via `supabase.auth.getUser(jwt)` (service role client)
2. Check org token budget — reject with HTTP 402 if `tokens_used + estimated > monthly_limit`; auto-provision budget row on first use of the month
3. Resolve or create `ai_conversations` row
4. Fetch opportunity fields from `opportunities` table
5. Fetch `ai_messages` history for the conversation, ordered by `created_at`
6. Build message array: injected briefing + ack on first turn, then full history + new user message
7. Stream via `streamText` → `result.pipeUIMessageStreamToResponse(res)` (**v6: was `pipeDataStreamToResponse` in v3**)
8. `onFinish`: persist assistant message + update `ai_conversations` token totals + update `token_budgets.tokens_used`

**`/api/ai/usage.ts` — admin only:**
- Validates JWT + checks `profiles.role === 'admin'`
- Returns current period `monthly_limit`, `tokens_used`, `percent_used`, `updated_at`
- Also returns last 50 conversations with per-conversation token totals

**Request body received from client:**
```json
{
  "message": "user text",
  "conversation_id": "uuid | undefined",
  "opportunity_id": "uuid | undefined"
}
```
The server fetches full conversation history from Supabase — the client sends only the new message text, not the full history.

---

### 2. Supabase Schema

Migration: `supabase/migrations/20260225000000_ai_grant_writing.sql`

```sql
-- Application-wide token budget (single-tenant — one row per billing period)
CREATE TABLE token_budgets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_limit        INTEGER NOT NULL DEFAULT 500000,
  current_period_start DATE    NOT NULL DEFAULT date_trunc('month', now()),
  tokens_used          INTEGER NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE(current_period_start)
);

-- One conversation per opportunity per user session
CREATE TABLE ai_conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id      UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  total_input_tokens  INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  is_archived         BOOLEAN NOT NULL DEFAULT false
);

-- Individual turns in a conversation
CREATE TABLE ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID    NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT    NOT NULL,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  is_injected     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

RLS: users access only their own conversations; admins access token_budgets.

---

### 3. Prompt Architecture

Every Claude API call receives the same structure:

```
[System Prompt]           ← Static, sets assistant persona and WA context
[Injected Briefing]       ← role: "user", is_injected: true — opportunity fields
[Injected Ack]            ← role: "assistant", is_injected: true — "Understood. Ready to draft."
[Conversation History]    ← All prior non-injected turns for this conversation_id
[New User Message]        ← Current turn
```

Injected messages are stored with `is_injected = true` and never rendered in the UI. On subsequent turns, the server detects `hasInjected = true` from the message list and skips re-injecting the briefing.

**Opportunity Briefing Template** maps to confirmed `opportunities` column names:
```
OPPORTUNITY: {name}
FUNDER: {funder}
GRANT TYPE: {grant_type}
FUNDING AMOUNT REQUESTED: ${amount_requested}
FUNDING AMOUNT MAX: ${amount_max}
APPLICATION DEADLINE: {primary_deadline}
LOI DEADLINE: {loi_deadline}
ELIGIBILITY NOTES: {eligibility_notes}
CFDA NUMBER: {cfda_number}

DESCRIPTION:
{description}
```

> Note: Document excerpt injection (`RELEVANT DOCUMENTS`) was deferred — it appears in the original briefing template but was not implemented in Phase 2.

---

### 4. Cost Control Logic

Inline in `/api/ai/chat.ts` before forwarding to Claude:

```typescript
const estimatedTokens = Math.ceil(message.length / 4) + 2000
if (budget.tokens_used + estimatedTokens > budget.monthly_limit) {
  return res.status(402).json({
    error: 'Monthly token budget exceeded',
    used: budget.tokens_used,
    limit: budget.monthly_limit,
  })
}
```

Budget row is auto-provisioned on first use of the month. After stream completion, `token_budgets.tokens_used` is updated using actual `usage.promptTokens + usage.completionTokens`.

---

### 5. Conversation Length / Token Growth Mitigation

Full conversation history is sent on every turn — costs grow linearly with conversation length.

**Soft limit:** After 20 turns, the UI shows a banner warning. A "Start new session" button creates a new `ai_conversations` row (clears client-side messages, unsets `activeConvId`).

**Session picker:** Multiple conversations per opportunity are supported. The UI shows "Session 1", "Session 2", etc. buttons. Users can switch between sessions or start a new one.

Conversation summarization is out of scope for Phase 2.

---

### 6. Frontend Integration

**Packages installed:**
```bash
npm install @ai-sdk/react   # useChat hook (moved out of ai/react in v6)
```

**`src/hooks/useGrantChat.ts`** — AI SDK v6 hook:

```typescript
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

export function useGrantChat(opportunityId: string, convId: string | undefined) {
  const { session } = useAuth()
  const convIdRef = useRef(convId)
  const sessionRef = useRef(session)
  convIdRef.current = convId
  sessionRef.current = session

  return useChat({
    transport: new DefaultChatTransport({
      api: '/api/ai/chat',
      prepareSendMessagesRequest: async ({ messages }) => {
        // Extract last user message — server manages full history via Supabase
        const lastMsg = messages[messages.length - 1]
        const textPart = lastMsg?.parts?.find(p => p.type === 'text')
        return {
          headers: { Authorization: `Bearer ${sessionRef.current?.access_token}` },
          body: {
            message: textPart?.text ?? '',
            conversation_id: convIdRef.current,
            opportunity_id: convIdRef.current ? undefined : opportunityId,
          },
        }
      },
    }),
  })
}
```

> **v6 API changes vs. original spec:**
> - `useChat` is now imported from `@ai-sdk/react`, not `ai/react`
> - The `api`, `headers`, and `body` options moved into `new DefaultChatTransport({ ... })`
> - `prepareSendMessagesRequest` is used to reformat the body to the server's expected shape (single `message` string, not the full messages array)
> - `handleSubmit` / `handleInputChange` / `input` / `isLoading` are gone — replaced by `sendMessage({ text })` and `status` (`'submitted' | 'streaming' | 'ready' | 'error'`)
> - `messages[n].content` (string) is gone — replaced by `messages[n].parts` (array); text is extracted via `parts.find(p => p.type === 'text')?.text`

**`src/components/admin/GrantChatPanel.tsx`** — chat UI:
- Session picker (one button per `ai_conversations` row)
- Message bubbles with user/assistant styling
- Animated typing indicator during stream
- 20-turn soft limit banner + "Start new session" button
- Token usage display (per-session total from `ai_conversations`)
- Budget exceeded error display (HTTP 402)
- After stream completes (`status: 'ready'`), refetches `ai_conversations` from Supabase to pick up newly-created conversation rows

**`src/pages/admin/OpportunityDetail.tsx`** — tabbed layout:
- "Tasks & Activity" tab (default) — existing TaskPanel + ActivityLog
- "AI Draft Assistant" tab — `<GrantChatPanel>` — visible only when `opportunity.type_id === 'grant'`

**`src/pages/admin/Settings.tsx`** — admin token budget UI:
- Monthly usage bar (colors: gray → amber at 70% → red at 90%)
- Estimated cost display (~$3/M tokens at Sonnet pricing)
- Warning banner at ≥80%
- Inline limit editor (direct Supabase update; admin RLS allows it)
- Auto-refreshes every 60 seconds via TanStack Query `refetchInterval`
- Accessible via "Settings" nav item (admin-only, filtered in `AdminLayout.tsx`)

---

## Model Selection

| Use Case | Model | Rationale |
|---|---|---|
| Grant narrative drafting | `claude-sonnet-4-6` | Best quality/cost ratio for long-form writing |
| Document summarization / field extraction | `claude-haiku-4-5-20251001` | Fast, cheap for short extraction tasks (Phase 3) |
| Eligibility analysis against complex RFP | `claude-opus-4-6` | Reserved for deep reasoning tasks only (Phase 3) |

---

## Environment Variables

Server-side (Vercel dashboard only — never commit):
```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Frontend (Vercel + local `.env.local`) — unchanged:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

> Supabase renamed "service_role" to "secret" in their dashboard UI, but the key itself and all code references are unchanged.

---

## Out of Scope (Phase 2)

- Document excerpt injection into briefing (PDF/DOCX extraction via `pdf-parse` + `mammoth`)
- Conversation summarization / automatic context compression
- Past application ingestion as few-shot examples (Phase 3)
- AI assistance for Partnership-type opportunities
- Batch / async draft generation
- Fine-tuning or custom model deployment

---

- [OMP PRD v2.0](./OMP_PRD_v2) — Phase 2 scope definition
- [Vercel AI SDK Docs](https://sdk.vercel.ai/docs)
- [Anthropic Claude API Docs](https://docs.anthropic.com)
- [Supabase RLS Guide](https://supabase.com/docs/guides/auth/row-level-security)
- App: `https://wright-adventures.vercel.app/`
