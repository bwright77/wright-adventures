-- ============================================================
-- Wright Adventures OMP — AI Grant Writing Schema (Phase 2)
-- ADR-001: AI-Assisted Grant Writing
-- Do NOT modify 20260224000000_initial_schema.sql
-- ============================================================

-- Application-wide token budget (single-tenant — one row per billing period)
-- Seeded with a default row on first use by the API function
CREATE TABLE token_budgets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_limit        INTEGER NOT NULL DEFAULT 500000, -- ~500K tokens/month (~$15 at Sonnet pricing)
  current_period_start DATE    NOT NULL DEFAULT date_trunc('month', now()),
  tokens_used          INTEGER NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE(current_period_start) -- one row per calendar month
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
  input_tokens    INTEGER,         -- populated on assistant messages only
  output_tokens   INTEGER,         -- populated on assistant messages only
  is_injected     BOOLEAN NOT NULL DEFAULT false, -- true = opportunity briefing, hidden in UI
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_budgets    ENABLE ROW LEVEL SECURITY;

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
