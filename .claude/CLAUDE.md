# Wright Adventures — OMP Project Context

This file is read automatically by Claude Code at the start of every session.
Do not delete or move it.

---

## Project Overview

**Wright Adventures Opportunity Management Platform (OMP)** — an internal web application
for the Wright Adventures team to track grants, partnerships, and strategic opportunities.
Single-tenant. Doubles as a demo for prospective partner organizations.

Live at: https://wright-adventures.vercel.app/
Repo: https://github.com/bwright77/wright-adventures

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS 3 (custom brand tokens: `navy`, `river`, `earth`, `trail`) |
| Routing | React Router 6 — SPA, all routes under `/admin/*` are auth-gated |
| Auth | Supabase Auth (email/password + Google OAuth) via `AuthContext.tsx` |
| Database | Supabase PostgreSQL — see schema below |
| File Storage | Supabase Storage |
| Server State | TanStack Query |
| Forms | react-hook-form + zod |
| Hosting | Vercel (auto-deploy from `main`) |

---

## Project Structure

```
.claude/
  settings.json
  CLAUDE.md             ← this file
docs/
  ADR-001-ai-grant-writing.md  ← read before touching any AI-related code
src/
  components/
    admin/
      AdminLayout.tsx   ← Navy sidebar shell
      ProtectedRoute.tsx
  contexts/
    AuthContext.tsx      ← Supabase session + profile; source of auth token for API calls
  lib/
    supabase.ts         ← Supabase client singleton (uses VITE_* env vars)
    types.ts            ← TypeScript types matching DB schema
  pages/
    admin/
      Dashboard.tsx
      Opportunities.tsx
      OpportunityDetail.tsx  ← AI Draft Assistant tab goes here (Phase 2)
      MyTasks.tsx
    Home.tsx
    Login.tsx
  data/
    siteData.ts         ← All marketing site copy — edit here, not in components
supabase/
  migrations/
    20260224000000_initial_schema.sql  ← DO NOT MODIFY
    20260225000000_ai_grant_writing.sql ← Phase 2 migration (to be created per ADR-001)
vercel.json             ← SPA rewrite config — see ADR-001 Decision section for required fix
```

---

## Database Schema (Key Tables)

**`profiles`** — extends `auth.users`
- `id` (uuid, PK), `full_name`, `role` (`admin|manager|member|viewer`), `avatar_url`

**`opportunities`** — unified model for grants and partnerships
- `id`, `type_id` (`grant|partnership`), `name`, `description`, `status`, `owner_id`
- Grant fields: `funder`, `grant_type`, `amount_max`, `amount_requested`, `amount_awarded`, `loi_deadline`, `cfda_number`, `eligibility_notes`
- Partnership fields: `partner_org`, `primary_contact`, `contact_email`, `partnership_type`, `mutual_commitments`, `agreement_date`, `renewal_date`, `estimated_value`, `alignment_notes`
- Shared: `primary_deadline`, `source_url`, `tags`, `created_by`, `created_at`, `updated_at`

**`opportunity_types`** — seeded: `grant`, `partnership`
**`pipeline_statuses`** — seeded per type (e.g., `grant_identified`, `grant_preparing`, etc.)
**`tasks`** — linked to opportunity; `status`: `not_started|in_progress|complete|blocked`
**`task_templates`** + **`task_template_items`** — default templates seeded for both types
**`documents`** — linked to opportunity; `storage_path` points to Supabase Storage
**`activity_log`** — append-only; `actor_id`, `action`, `details` (jsonb)

---

## Key Conventions

- **Never use `VITE_*` env vars in `/api/*` serverless functions** — they are client-side only. Use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (no `VITE_` prefix) server-side.
- **RLS is enforced** — all Supabase queries from the frontend use the anon key + user JWT. Server-side functions use the service role key and must enforce their own auth checks.
- **TanStack Query** for all data fetching — don't introduce raw `useEffect` + fetch patterns.
- **Zod schemas** for all form validation and API request/response shapes.
- **Brand tokens** — use Tailwind classes `text-navy`, `bg-river`, `text-earth`, `text-trail` etc. Do not hardcode hex values in components.
- **`opportunity.type_id === 'grant'`** — use this check to gate grant-only UI (e.g., AI Draft Assistant tab).

---

## Active ADRs

### ADR-001: AI-Assisted Grant Writing (Phase 2)
**File:** `docs/ADR-001-ai-grant-writing.md`
**Status:** Accepted — implementation in progress

**Read this file in full before implementing any AI-related feature.**

Summary of key decisions:
- Freeform prose output via Anthropic `claude-sonnet-4-6`
- Iterative chat (conversation history persisted in Supabase)
- Single application-wide monthly token budget (single-tenant)
- Vercel Serverless Functions in `/api/` as the proxy layer
- Vercel AI SDK (`useChat`) for streaming on the frontend
- `vercel.json` requires a fix before `/api/*` routes will work — **do this first**

Implementation sequence (8 steps) is defined in the ADR. Follow it in order.

---

## Environment Variables

**Frontend (Vercel + local `.env.local`):**
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

**Server-side (Vercel dashboard only — never commit):**
```
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## What's Built (MVP — Phase 1)

- Auth (email/password + Google OAuth)
- Opportunity CRUD — grants and partnerships with type-specific fields
- Pipeline status tracking (kanban-ready statuses seeded)
- Task management with default templates
- Document upload to Supabase Storage
- Dashboard with metrics, upcoming deadlines, my tasks
- Role-based access (admin/manager/member/viewer)

## What's Next (Phase 2 — in progress)

Per ADR-001, currently implementing AI-assisted grant writing. After that:
- Reporting & analytics
- Email/Slack notifications
- Saved search filters
- Google Drive document linking
