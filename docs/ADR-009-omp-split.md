# ADR-009: Splitting the OMP — Confluence Colorado Grant Platform

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-08-11
**Status:** Proposed
**Depends on:** ADR-001 (AI Grant Writing), ADR-002 (Grant Discovery), ADR-004 (Board Minutes), ADR-005 (State/Local Discovery)
**Supersedes:** the single-tenant assumption in ADR-001 §Budget and ADR-004 §Context
**Companion:** ADR-010 (Timekeeping & Billing) — the capability WA gains in exchange

---

## Context

The OMP was built single-tenant, with Confluence Colorado as the implicit sole org. That
assumption is now written into the data itself:

- `20260226000002_confluence_grants_seed.sql` seeded Confluence's historic 2023–2026 grant
  applications directly into `opportunities`.
- `20260228100000_board_meetings.sql` carries the comment *"Single-tenant: no org_id
  (Confluence Colorado is the sole org for MVP)"*.
- The federal and state discovery pipelines (ADR-002, ADR-005) score opportunities against
  `org_profiles` — a profile describing Confluence Colorado.

Meanwhile Wright Adventures' own use has diverged. ADR-006 and ADR-007 built a partnership
sales pipeline, contacts, interactions, and an AI solution advisor — a business-development
system for WA the consultancy, unrelated to grant seeking.

Two products are living in one codebase and one database. This ADR separates them.

### What the split cuts through

Of 25 tables, roughly 13 are shared spine that **both** products need, because a grant *is* an
`opportunity`: it has a pipeline status, tasks, documents, deadlines, contributors, and an
activity log, exactly as a partnership does.

This is therefore an **extract-and-diverge**, not a lift-out. The only feature that separates
cleanly is board minutes — `board_meetings` has no foreign key to `opportunities` at all,
referencing only `auth.users`.

The frontend seam already exists: 16 `type_id === 'grant' | 'partnership'` gates across 6
files, and `src/components/admin/analytics/` already splits `GrantFunnel` from
`PartnershipFunnel`. The split follows a line the code has been drawing for months.

### What `confluence-co` is today

`github.com/bwright77/confluence-co` is Confluence Colorado's **public marketing site** —
13 content pages, YAML/markdown-driven, Stripe donations, an OG-image prerender build step,
Playwright e2e, and 18 permanent SEO redirects. React 18.3, Phosphor icons, framer-motion.

It has **no Supabase, no auth, no database, and no admin surface.** The platform is being
added to it, not merged with something already there.

---

## Decision

Split into two products that share no code and no database.

| | Wright Adventures | Confluence Colorado |
|---|---|---|
| **Repo** | `wright-adventures` | `confluence-co` (existing) |
| **URL** | wrightadventures.org/admin | **confluenceco.org/admin** |
| **Vercel** | existing project | existing project (marketing site's) |
| **Supabase** | existing project | **new project** |
| **Purpose** | Partnership/BD pipeline + billing | Grant seeking + governance |

Four decisions, taken deliberately:

1. **Grants leave WA entirely.** WA's `opportunities` becomes partnerships-only. WA does not
   retain grant tracking for other clients.
2. **Separate Supabase project per product.** A client's grant history, board minutes, and
   funder relationships should not sit inside their consultant's database. This is the one
   thing that must be physically separate.
3. **The platform lives inside `confluence-co` at `/admin`**, mirroring the
   `wrightadventures.org/admin` pattern already in production — one repo, one Vercel project,
   one domain per organization.
4. **No shared code between the two repos.** The admin code is copied into `confluence-co`
   once and then diverges. Accepted cost: shared spine fixes are done twice.

---

## What Moves Where

### Confluence gains

**Shared spine (13):** `profiles`, `opportunity_types`, `pipeline_statuses`, `opportunities`,
`opportunity_contributors`, `tasks`, `task_templates`, `task_template_items`, `documents`,
`custom_deadlines`, `activity_log`, `notification_preferences`, `notification_log`

**Grant-specific (7):** `token_budgets`, `ai_conversations`, `ai_messages`, `org_profiles`,
`discovery_queries`, `discovery_runs`, `discovery_sources`

**Governance (1):** `board_meetings`

**Not copied:** the four `partnership_*` tables, `partnership_*` rows in `pipeline_statuses`
and `task_template_items`, `api/partnerships/*`, and the components `ContactsPanel`,
`InteractionsLog`, `PartnershipAdvisorPanel`, `ScrapePanel`, `PartnershipFunnel`.

### Wright Adventures keeps

Shared spine + all four `partnership_*` tables, plus timekeeping and billing per ADR-010.

**Deletes:** the 8 grant/governance tables, `api/ai/*`, `api/discovery/*`,
`api/board-minutes/*`, pages `BoardMeetings` / `BoardMeetingNew` / `BoardMeetingDetail`,
components `GrantChatPanel` / `GrantFunnel`, both discovery cards in `Settings.tsx`, the
"Board Minutes" nav entry in `AdminLayout.tsx`, and the two discovery crons in `vercel.json`.

> **WA still needs `ANTHROPIC_API_KEY`.** The AI Solution Advisor (ADR-007) and partnership
> scraper (ADR-006) both call Anthropic. `token_budgets` therefore stays on **both** sides —
> it was built for grant chat, but WA's remaining AI surface still needs metering.

### The `opportunities` divergence

| Side | Drops these columns |
|---|---|
| Confluence | `partner_org`, `primary_contact`, `contact_email`, `partnership_type`, `mutual_commitments`, `agreement_date`, `renewal_date`, `estimated_value`, `alignment_notes` |
| Wright Adventures | `funder`, `grant_type`, `amount_max`, `amount_requested`, `amount_awarded`, `loi_deadline`, `cfda_number`, `eligibility_notes`, `discovery_source_id` |

**Keep `type_id` and `opportunity_types` on both sides for v1**, even though each now has a
single value. Dropping the indirection touches every query, form, and status lookup for no
functional gain during a migration that already carries real risk. Revisit as cleanup once
both apps are stable.

---

## Porting the Platform into `confluence-co`

This is the part with no precedent in the existing ADRs, so it is specified in detail.

### React stays on 18 — no upgrade

WA's admin code uses **no React 19-only APIs** (no `useActionState`, `useFormStatus`,
`useOptimistic`, `use()`, or `inert`), and every dependency it needs declares React 18
support:

```
@ai-sdk/react      react: ^18 || ~19.0.1 || ~19.1.2 || ^19.2.1
@tanstack/react-query  react: ^18 || ^19
lucide-react       react: ^16.5.1 || ^17 || ^18 || ^19
```

Do **not** bump `confluence-co` to React 19 as part of this work. The marketing site is
stable, framer-motion and the prerender step are tuned to it, and the upgrade buys nothing
here. Treat it as separate, optional work.

### Dependencies to add

```
@supabase/supabase-js  @tanstack/react-query  react-hook-form  zod  @hookform/resolvers
lucide-react  date-fns  react-intersection-observer
ai  @ai-sdk/react  @ai-sdk/anthropic          (grant chat — ADR-001)
docx                                          (minutes export — ADR-004)
nodemailer  @types/nodemailer                 (notifications — ADR-003)
```

**Keep both icon libraries.** Phosphor stays for the marketing site, lucide comes in for the
admin. Porting ~40 admin icons to Phosphor is pure churn for no user-visible gain, and the
two never render on the same page.

### Brand tokens are nearly free

The two palettes are the same colors under different names:

| WA token | hex | Confluence token | hex |
|---|---|---|---|
| `navy` | `#004667` | `cc-navy` | `#004667` |
| `river` | `#009DD6` | `cc-sky` | `#009dd6` |
| `earth` | `#B44B00` | `cc-orange` | `#b44b00` |
| `trail` | `#4A7C59` | `cc-sage` | `#6B8F71` |

Three of four are byte-identical, and both sites already use Jost. Add `navy`/`river`/`earth`
as aliases in `confluence-co/tailwind.config.js` pointing at the existing `cc-*` values, and
map `trail` → `cc-sage`. The admin UI then renders in Confluence's brand with no component
edits. Confluence's palette also carries accessible text variants (`cc-sky-ink`,
`cc-sage-ink`) that the admin should adopt for small text — WA's `river` on white does not
meet AA at body sizes.

### `vercel.json` — the one that will bite

`confluence-co`'s rewrites are a bare catch-all:

```json
"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
```

This works today only because Vercel resolves serverless functions before rewrites. WA hit
this exact problem in ADR-001, whose fix was an explicit `/api` passthrough placed first.
Mirror it, and add the long-running function config the discovery endpoints need:

```json
"rewrites": [
  { "source": "/api/(.*)", "destination": "/api/$1" },
  { "source": "/(.*)",     "destination": "/index.html" }
],
"functions": {
  "api/discovery/sync.ts":       { "maxDuration": 300 },
  "api/discovery/state-sync.ts": { "maxDuration": 300 }
},
"crons": [
  { "path": "/api/discovery/sync",            "schedule": "0 7 * * *" },
  { "path": "/api/discovery/state-sync",      "schedule": "0 8 * * 1" },
  { "path": "/api/notifications/deadlines",   "schedule": "0 9 * * *" }
]
```

The existing 18 redirects and the security headers block need no changes — `X-Frame-Options:
DENY` and the rest apply correctly to `/admin` too.

### Build and test reconciliation

- **`scripts/prerender-og.mjs` must skip `/admin/*` and `/login`.** They are auth-gated and
  have no OG identity; prerendering them would emit meaningless artifacts and could fail the
  build on a Supabase call at build time.
- **Playwright** (`e2e/donate.spec.ts`, `translate.spec.ts`) currently assumes an
  unauthenticated public site. Either scope the suite to public routes explicitly or add an
  auth fixture — do not let admin routes fall into the existing specs by accident.
- **`npm run lint`** is `eslint . && tsc --noEmit`, and `eslint-plugin-jsx-a11y` is active.
  The admin code has not been linted under a11y rules before; expect a first-pass cleanup.
- **`api/_guard.ts`**'s Origin allowlist is for the donate endpoints only. Admin endpoints use
  Bearer-JWT auth (`supabase.auth.getUser(jwt)`) and must not be routed through it.

---

## Data Migration

**Selection rule:** everything reachable from `opportunities WHERE type_id = 'grant'`, plus
all of `board_meetings` and the discovery/AI tables wholesale.

The rule is clean precisely because grants leave WA entirely — no per-row judgment about
which grants are Confluence's. All of them are.

### Order of operations (FK-safe)

1. `profiles` (after the auth step below)
2. `opportunities` (grants only)
3. `opportunity_contributors`, `tasks`, `custom_deadlines`, `documents`
4. `ai_conversations` → `ai_messages`
5. `org_profiles` → `discovery_queries`, `discovery_sources` → `discovery_runs`
6. `board_meetings`
7. `activity_log` (last — it references everything)
8. `notification_preferences`, `notification_log`

### The hard part: auth

**Supabase auth users cannot be moved between projects with passwords intact.** This is the
single largest risk in the migration, and it blocks step 1.

Every migrated table carries user FKs — `owner_id`, `created_by`, `approved_by`, `actor_id`,
`user_id`, `updated_by` — all pointing at `auth.users` in WA's project and meaningless in
Confluence's.

1. Create the Confluence team's accounts in the new project first. Google OAuth users re-link
   on first sign-in; email/password users get a reset invitation.
2. Build an explicit `old_uid → new_uid` map as a migration artifact. Check it in.
3. Remap every user FK during the row copy.
4. WA staff who need both systems get **two separate accounts**. There is no SSO between the
   projects and this ADR does not propose building one.
5. Rows whose original owner gets no Confluence account need a documented fallback — a
   designated archive profile rather than `NULL`, so history stays attributable.

### Storage

Only **one** bucket holds real objects: `board-meeting-transcripts` (private, service-role
only, read by `api/board-minutes/extract.ts`).

The `documents` table has a `storage_path` column but **no frontend or API code touches it** —
despite CLAUDE.md listing document upload as built. Verify the table is empty before
migrating; if it is, skip the bucket entirely and correct CLAUDE.md.

Copy via a service-role script: download from WA's project, upload to Confluence's, preserving
paths so `storage_path` values stay valid.

### Cutover

The discovery crons write new grant rows continuously (daily federal, weekly Monday state).
**Freeze them before the copy** — disable both crons in WA's `vercel.json`, confirm no run is
in flight via `discovery_runs`, then migrate. A partial copy with a cron mid-write is the most
likely way to lose data here.

---

## Infrastructure to Reproduce

All of this exists once today and must be created again in Confluence's Supabase project and
Vercel project. Missing any one produces a silent failure rather than an error.

| Item | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Separate key → separate billing and token budget |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | New project's values |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | New project's values |
| `SMTP_*`, `SUPABASE_WEBHOOK_SECRET` | Notifications (ADR-003) |
| `CRON_SECRET` | New secret; do not reuse WA's |
| `APP_URL` | `https://confluenceco.org` |
| **DB webhooks** | Recreate by hand — `opportunity-discovered` on `opportunities` INSERT. Dashboard config, not migrations; will **not** come across with the schema. |
| **Storage bucket** | `board-meeting-transcripts` + its RLS policies |

These join the marketing site's existing Stripe variables in the same Vercel project. Nothing
about the donate flow changes.

---

## Implementation Sequence

**Phase 1 — Stand up the shell.** New Supabase project; add the dependencies, the token
aliases, `AuthContext`, `ProtectedRoute`, `AdminLayout`, and `/login` to `confluence-co`; fix
`vercel.json`; exclude `/admin` from the prerender. Ship with an empty dashboard. This proves
routing, auth, and deploy without touching data.

**Phase 2 — Port board minutes.** The only feature with zero coupling to `opportunities`,
which makes it the right pilot. Migrate `board_meetings` and its bucket. This exercises auth
re-onboarding and storage copy against the least dangerous data in the system.

**Phase 3 — Port grants.** Core spine schema, then freeze crons, run the full migration,
verify row counts and spot-check dollar totals against WA's copy, then re-point crons and
webhooks. Discovery and AI writing come across with it.

**Phase 4 — Prune both sides.** Delete the moved features from WA and skip the partnership
features on Confluence. Only after Phase 3 verifies — WA's copy is the rollback.

**Phase 5 — Decommission.** Drop the moved tables from WA once Confluence has run clean for
an agreed window. Recommend keeping WA's grant data read-only for 30 days.

**ADR-010 (billing)** is independent of all five phases and can run in parallel.

---

## Key Design Decisions

- **Stay on React 18.** Verified that nothing in the admin code or its dependencies requires
  19. Bundling a framework upgrade into a data migration would make both harder to debug.
- **Keep both icon libraries** rather than porting lucide → Phosphor. They never co-render.
- **Board minutes as the pilot** rather than the smallest or most valuable feature — it is the
  only one whose failure mode is contained.
- **Keep WA's grant data through Phase 5.** The rollback story is "WA still has it." Dropping
  tables early removes that.
- **No SSO between the projects.** Two logins for the few people who need both beats building
  federation for a two-tenant system.
- **Separate Supabase, shared Vercel.** Data isolation is the requirement; deploy isolation is
  not. Confluence's platform and marketing site sharing a Vercel project is a feature — one
  domain, one deploy, one env.

---

## Risks

| Risk | Mitigation |
|---|---|
| Auth remap wrong → history mis-attributed | Check the UID map in; verify a sample of `activity_log` post-migration |
| Cron writes during copy → lost grants | Freeze crons; confirm no in-flight `discovery_runs` |
| DB webhooks forgotten → notifications silently stop | Explicit checklist item; test with a real INSERT after cutover |
| `/api` swallowed by the catch-all rewrite | Add the explicit passthrough in Phase 1 and verify before porting endpoints |
| Prerender step hits admin routes | Exclude in Phase 1, before any admin route exists to break it |
| Marketing site regressions from new deps | Phase 1 ships behind an empty dashboard; run the Playwright suite before and after |
| Fork drift on shared spine bugs | Accepted. Note any spine fix in both repos' commit messages |

---

## Out of Scope

- SSO or federated identity between the two projects
- Multi-tenancy (`org_id`) — explicitly rejected; the split makes it unnecessary
- Upgrading `confluence-co` to React 19
- Porting the admin UI from lucide to Phosphor
- Renaming `opportunities` → `grants` in the Confluence copy
- Cross-product analytics
