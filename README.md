# Wright Adventures — Empowering Organizations to Do More

Production-ready website and internal Opportunity Management Platform (OMP) for Wright Adventures, a nonprofit consultancy combining strategic consulting, AI-powered tools, and hands-on program design for conservation nonprofits, youth programs, and watershed groups.

Live at: **https://wrightadventures.org/** (also: https://wright-adventures.vercel.app/)

---

## Tech Stack

**Marketing site**
- **React 19** + TypeScript
- **Vite** — build tooling
- **Tailwind CSS 3** — utility-first styling with custom brand tokens
- **React Router 6** — client-side routing
- **react-intersection-observer** — scroll-triggered animations
- **lucide-react** — icon system

**OMP (admin portal — `/admin`)**
- **Supabase** — auth, PostgreSQL database, file storage
- **TanStack Query** — server state and caching
- **react-hook-form + zod** — form validation
- **date-fns** — deadline and offset calculations
- **Vercel AI SDK** (`useChat`) — streaming AI responses
- **docx** — DOCX export for board meeting minutes

**API / serverless**
- **Vercel Serverless Functions** (`/api/**`) — proxy layer for AI and notifications
- **Anthropic SDK** (`claude-sonnet-4-6`, `claude-haiku-4-5`) — grant writing, grant discovery, partnership advisor
- **nodemailer** — email notifications (deadline reminders, task assignments)

---

## Brand Tokens (Tailwind)

| Token | Hex | Usage |
|-------|-----|-------|
| `navy` | `#004667` | Headers, primary CTAs, authority |
| `river` | `#009DD6` | Accents, links, energy |
| `earth` | `#B44B00` | Impact moments, stats, callouts |
| `trail` | `#4A7C59` | Trust sections, values, testimonials |

Font: **Jost** (loaded from Google Fonts)

---

## Environment Setup

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

### Frontend (`.env.local` + Vercel dashboard)

These are exposed to the browser via `VITE_` prefix:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-publishable-key-here
```

Both values are in your Supabase project under **Settings → API**.

> Supabase renamed keys: `anon` → **publishable**, `service_role` → **secret**.

### Server-side (Vercel dashboard only — never commit)

These are used exclusively by `/api/*` serverless functions:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Same URL as above, no `VITE_` prefix |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — bypasses RLS |
| `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `SIMPLER_GRANTS_API_KEY` | From [simpler.grants.gov/developer](https://simpler.grants.gov/developer) — federal grant discovery |
| `CRON_SECRET` | Random secret securing cron endpoints — `openssl rand -hex 32` |
| `APP_URL` | Public base URL, e.g. `https://wrightadventures.org` — used in email links |
| `SMTP_HOST` | Outbound mail server hostname |
| `SMTP_PORT` | Mail server port (`587` for TLS, `465` for SSL) |
| `SMTP_USER` | SMTP account username |
| `SMTP_PASS` | SMTP account password |
| `SMTP_FROM` | From address for outgoing email |
| `SUPABASE_WEBHOOK_SECRET` | Shared secret for validating Supabase Database Webhooks |

---

## Database Setup

Run migrations in order via the **Supabase SQL editor** or `supabase db push`:

```
supabase/migrations/20260224000000_initial_schema.sql            # tables, RLS, seed data
supabase/migrations/20260225000000_ai_grant_writing.sql          # AI chat history + token budget
supabase/migrations/20260226000000_grant_discovery.sql           # federal grant discovery runs
supabase/migrations/20260226000001_admin_profile_policy.sql      # admin profile RLS fix
supabase/migrations/20260226000002_confluence_grants_seed.sql    # Confluence grant seed data
supabase/migrations/20260226000003_discovery_run_cancel_status.sql
supabase/migrations/20260226000004_discovery_query_pagination.sql
supabase/migrations/20260228000000_notifications.sql             # notification preferences
supabase/migrations/20260228100000_board_meetings.sql            # board meeting minutes
supabase/migrations/20260302000000_state_discovery_sources.sql   # state/local grant sources
supabase/migrations/20260302000001_fix_goco_url.sql              # GOCO source URL fix
supabase/migrations/20260304000000_rls_lookup_tables.sql         # RLS on lookup tables
supabase/migrations/20260306000000_partnership_pipeline.sql      # partnership CRM pipeline
supabase/migrations/20260306000001_partner_logos.sql             # logo_url on partnership_details
```

---

## Google OAuth Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Create an **OAuth client ID** (Web application)
3. Add the Supabase callback URI as an authorized redirect:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
4. Copy the **Client ID** and **Client Secret**
5. In Supabase: **Authentication → Providers → Google** → paste and enable

Google credentials live in Supabase (server-side) — they do **not** go in `.env.local`.

---

## Supabase Webhook Setup

Two webhooks must be configured manually in **Supabase Dashboard → Database → Webhooks**:

| Event | Table | Endpoint | Header |
|---|---|---|---|
| INSERT on `tasks` | `tasks` | `POST /api/notifications/task-assigned` | `x-supabase-webhook-secret: <SUPABASE_WEBHOOK_SECRET>` |
| INSERT on `opportunities` | `opportunities` | `POST /api/notifications/opportunity-discovered` | `x-supabase-webhook-secret: <SUPABASE_WEBHOOK_SECRET>` |

---

## Development

```bash
npm install
npm run dev        # Start dev server at localhost:5173
npm run build      # Production build to dist/
npm run preview    # Preview production build locally
```

The OMP admin portal runs at `localhost:5173/admin`. Unauthenticated visits redirect to `/login`.

---

## Deployment

Deployed at **https://wrightadventures.org/** — pushes to `main` deploy automatically via Vercel.

Vercel Cron jobs (configured in `vercel.json`):

| Schedule | Endpoint | Purpose |
|---|---|---|
| Daily 7:00 AM UTC | `/api/discovery/sync` | Federal grant discovery (Simpler.Grants.gov) |
| Mondays 8:00 AM UTC | `/api/discovery/state-sync` | State & local grant discovery |
| Daily 9:00 AM UTC | `/api/notifications/deadlines` | Deadline reminder emails |

---

## Project Structure

```
api/
├── ai/
│   ├── chat.ts                   # Streaming AI chat (Vercel AI SDK)
│   └── usage.ts                  # Token budget stats
├── board-minutes/
│   └── extract.ts                # Transcript → structured minutes (Claude)
├── discovery/
│   ├── sync.ts                   # Federal grant discovery cron
│   ├── state-sync.ts             # State/local grant discovery cron
│   ├── state-utils.ts            # Pure utility functions (hashing, dedup)
│   ├── score.ts                  # Opportunity relevance scoring
│   └── cancel.ts                 # Cancel in-progress discovery run
├── notifications/
│   ├── _mailer.ts                # Shared nodemailer helper
│   ├── deadlines.ts              # Daily deadline reminder cron
│   ├── task-assigned.ts          # Webhook: task assigned notification
│   └── opportunity-discovered.ts # Webhook: new opportunity notification
├── partnerships/
│   ├── recommend.ts              # AI solution advisor (Claude Sonnet)
│   └── scrape.ts                 # URL → structured fields (Claude Haiku)
└── contact.ts                    # Contact form handler

src/
├── components/
│   ├── admin/
│   │   ├── AdminLayout.tsx           # Navy sidebar + Outlet (OMP shell)
│   │   ├── ProtectedRoute.tsx        # Auth guard — redirects to /login
│   │   ├── ContactsPanel.tsx         # Partnership contacts tab
│   │   ├── InteractionsLog.tsx       # Partnership interaction history
│   │   ├── PartnershipAdvisorPanel.tsx # AI solution recommendation panel
│   │   ├── QualificationTracker.tsx  # Qualification status + scoring
│   │   └── ScrapePanel.tsx           # Scrape & Fill from URL
│   └── [marketing components]
├── contexts/
│   └── AuthContext.tsx               # Supabase auth session + profile
├── data/
│   └── siteData.ts                   # ALL marketing site content lives here
├── lib/
│   ├── supabase.ts                   # Supabase client singleton
│   ├── types.ts                      # TypeScript types matching DB schema
│   ├── boardMinutes/
│   │   ├── extractionPrompt.ts       # Claude prompt for minutes extraction
│   │   └── exportDocx.ts             # DOCX export helper
│   └── partnerships/
│       └── advisorPrompt.ts          # Reference prompt for AI advisor
├── pages/
│   ├── admin/
│   │   ├── Dashboard.tsx             # Metrics + upcoming deadlines + my tasks
│   │   ├── Opportunities.tsx         # Filterable table/kanban (Grants / Partnerships)
│   │   ├── OpportunityDetail.tsx     # Detail view with pipeline stepper + AI tabs
│   │   ├── NewOpportunity.tsx        # Create grant or partnership
│   │   ├── EditOpportunity.tsx       # Edit with Scrape & Fill
│   │   ├── MyTasks.tsx               # Personal task list
│   │   ├── BoardMeetings.tsx         # Board minutes list
│   │   ├── BoardMeetingNew.tsx       # Upload transcript + extract
│   │   ├── BoardMeetingDetail.tsx    # Review / edit / approve / export
│   │   ├── Settings.tsx              # Notification prefs, discovery sources
│   │   └── Team.tsx                  # Team member directory
│   ├── Home.tsx
│   └── Login.tsx                     # Email/password + Google OAuth
├── App.tsx                           # Routes
├── main.tsx                          # QueryClient + AuthProvider
└── index.css

supabase/
└── migrations/                   # Run in filename order (see Database Setup above)

docs/
├── ADR-001-ai-grant-writing.md
├── ADR-002-grant-discovery-pipeline.md
├── ADR-003-email-notifications.md
├── ADR-004-board-minutes.md
├── ADR-005-state-local-grant-discovery.md
├── ADR-006-partnership-sales-pipeline.md
└── ADR-007-ai-solution-advisor.md

scripts/
└── state-discovery-test.ts       # Dry-run test: npx tsx scripts/state-discovery-test.ts
```

---

## Customization

All copy, stats, services, team bios, and values live in `src/data/siteData.ts`. Edit that one file to update any marketing text without touching components.
