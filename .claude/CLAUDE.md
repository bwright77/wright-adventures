# Wright Adventures — OMP Project Context

This file is read automatically by Claude Code at the start of every session.
Do not delete or move it.

---

## Project Overview

**Wright Adventures Opportunity Management Platform (OMP)** — an internal web application
for the Wright Adventures team to track partnerships and business-development opportunities.
Single-tenant. Doubles as a demo for prospective partner organizations.

**Grants, AI grant writing, grant discovery, and board minutes moved to Confluence
Colorado's own platform in 2026-08 — see ADR-009. Do not re-add them here.**

Live at: https://wrightadventures.org/ (also: https://wright-adventures.vercel.app/)
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
  ADR-009-omp-split.md   ← why grants are gone; read before touching the schema
  ADR-011-*.md           ← opportunity discovery (RFPs, procurement, job boards)
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
      OpportunityDetail.tsx
      MyTasks.tsx
    Home.tsx
    Login.tsx
  data/
    siteData.ts         ← All marketing site copy — edit here, not in components
supabase/
  migrations/
    20260224000000_initial_schema.sql  ← DO NOT MODIFY
    20260818000000_decommission_grants.sql ← ADR-009 Phases 4–5
vercel.json             ← SPA rewrite config; /api passthrough MUST stay first
```

---

## Database Schema (Key Tables)

**`profiles`** — extends `auth.users`
- `id` (uuid, PK), `full_name`, `role` (`admin|manager|member|viewer`), `avatar_url`

**`organizations`** — the durable entity (ADR-012). Leads, opportunities and engagements point here.
- `name`, `website`, `logo_url`, `relationship_tier` (`none|network|prospect|client`), `via_org_id`, `revisit_on`
- An org is a **client** because it has an engagement — kept true by a trigger, not a dropdown.
- Nurture is a state HERE, not a pipeline stage.

**`leads`** — discovered postings, not yet judged. `status`: `new|declined|converted`.

**`engagements`** — won work being delivered. ADR-010 logs time against this.
- `organization_id`, `opportunity_id` (**nullable** — CMC predates the OMP), `nature`, `delivery_status`, `contract_value`, `fmv`

**`opportunities`** — pursuits (`type_id` dropped in ADR-012)
- `id`, `organization_id`, `name`, `description`, `status`, `owner_id`
- Partnership fields: `partner_org`, `primary_contact`, `contact_email`, `partnership_type`, `mutual_commitments`, `agreement_date`, `renewal_date`, `estimated_value`, `alignment_notes`
- Shared: `primary_deadline`, `source_url`, `tags`, `created_by`, `created_at`, `updated_at`

**`pipeline_statuses`** — `qualifying → discovery → proposal → evaluation → approval → negotiating → closed_won | closed_lost`
- Carries its own ageing thresholds (`expected_days`, `amber_days`, `red_days`) — see `src/lib/stageAge.ts`
- Read via `usePipelineStatuses()`; never hardcode the stage list.
**`tasks`** — linked to opportunity; `status`: `not_started|in_progress|complete|blocked`
**`opportunity_details`**, **`contacts`**, **`interactions`**, **`stage_tasks`**, **`stage_history`**
- Renamed from `partnership_*` in ADR-012. **Contacts and interactions hang off the ORGANISATION**, with an optional opportunity.
- `opportunity_details` embeds need the `!opportunity_id` hint — it has two FKs to `opportunities`, and without the hint PostgREST fails the whole query with PGRST201.
**`documents`** — linked to opportunity; `storage_path` points to Supabase Storage
**`activity_log`** — append-only; `actor_id`, `action`, `details` (jsonb)

---

## Key Conventions

- **Never use `VITE_*` env vars in `/api/*` serverless functions** — they are client-side only. Use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (no `VITE_` prefix) server-side.
- **RLS is enforced** — all Supabase queries from the frontend use the anon key + user JWT. Server-side functions use the service role key and must enforce their own auth checks.
- **TanStack Query** for all data fetching — don't introduce raw `useEffect` + fetch patterns.
- **Zod schemas** for all form validation and API request/response shapes.
- **Brand tokens** — use Tailwind classes `text-navy`, `bg-river`, `text-earth`, `text-trail` etc. Do not hardcode hex values in components.
- **Retained but dormant:** `discovery_sources`, `discovery_runs`, `org_profiles`, `token_budgets`.
  These are the ADR-005 monitoring machinery, kept deliberately for ADR-011. Do not drop them.

---

## Active ADRs

### ADR-009: OMP Split (Confluence Colorado)
**File:** `docs/ADR-009-omp-split.md`
**Status:** Phases 1–3 complete; Phases 4–5 landed 2026-08-18

Grants, AI grant writing, grant discovery, and board minutes now live in
`confluence-co` against a separate Supabase project. ADR-001 through ADR-005 are
**historical** for this repo — they describe features that no longer exist here.

### ADR-012: Lead → Opportunity → Client
**File:** `docs/ADR-012-lead-opportunity-client.md`
**Status:** Phases 1–4 landed 2026-08-22. Phase 5 (UI) and 6 (ADR-010) remain.

"Partnership" was Confluence vocabulary. WA has clients. More importantly, one table was doing
three jobs — undecided leads, live pursuits, delivered work — which is where `isOpportunity()`
and the `?tab=partnership` crash came from.

### ADR-010: Timekeeping & Billing
**File:** `docs/ADR-010-timekeeping-billing.md`
**Status:** Proposed — blocked on the CMC board decision. Rewritten 2026-08-22 against ADR-012;
it now **extends** the existing `engagements` table rather than creating one.

### ADR-011: Opportunity Discovery
**Status:** In progress

Reuses the retained ADR-005 pipeline to monitor RFP/procurement portals and job
boards, scoring findings against Wright Adventures' own fit rubric.
- Rubric + banding: `src/lib/discovery/fitRubric.ts`
- Firm profile injected into scoring: `src/lib/discovery/waOrgProfile.ts`

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
- Opportunity CRUD — partnerships
- Pipeline status tracking (7-stage partnership pipeline, kanban + table views)
- Task management with default templates and stage tasks
- Dashboard with metrics, upcoming deadlines, my tasks
- Pipeline analytics (ADR-008)
- Partnership CRM: contacts, interactions, AI solution advisor (ADR-006/007)
- Email notifications (ADR-003)
- Role-based access (admin/manager/member/viewer)

> The `documents` table exists in the schema but **has no frontend or API code**.
> Document upload was never wired. Don't cite it as built.

## What's Next

- ADR-011 — opportunity discovery (procurement portals first, then job boards)
- ADR-010 — timekeeping & billing
