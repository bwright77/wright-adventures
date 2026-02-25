# Wright Adventures — Nonprofit Advisory & Technology

Production-ready website and internal Opportunity Management Platform (OMP) for Wright Adventures, a nonprofit consultancy combining strategic consulting, AI-powered tools, and hands-on program design for conservation nonprofits, youth programs, and watershed groups.

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

## Brand Tokens (Tailwind)

| Token | Hex | Usage |
|-------|-----|-------|
| `navy` | `#004667` | Headers, primary CTAs, authority |
| `river` | `#009DD6` | Accents, links, energy |
| `earth` | `#B44B00` | Impact moments, stats, callouts |
| `trail` | `#4A7C59` | Trust sections, values, testimonials |

Font: **Jost** (loaded from Google Fonts)

## Environment Setup

Copy `.env.example` to `.env.local` and fill in your Supabase credentials:

```bash
cp .env.example .env.local
```

Both values are in your Supabase project under **Settings → API**:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key-here
```

> Supabase renamed keys: `anon` → **publishable**, `service_role` → **secret**. Use the publishable key here.

## Database Setup

Run the migration in the **Supabase SQL editor** (or via `supabase db push` with the CLI):

```
supabase/migrations/20260224000000_initial_schema.sql
```

This creates all tables, RLS policies, and seeds the two opportunity types (Grant, Partnership) and both default task templates.

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

## Development

```bash
npm install
npm run dev        # Start dev server at localhost:5173
npm run build      # Production build to dist/
npm run preview    # Preview production build locally
```

The OMP admin portal runs at `localhost:5173/admin`. Unauthenticated visits redirect to `/login`.

## Deployment

Deployed on Vercel at **https://wright-adventures.vercel.app/**

Environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are configured in the Vercel project dashboard. Pushes to `main` deploy automatically.

## Project Structure

```
src/
├── components/
│   ├── admin/
│   │   ├── AdminLayout.tsx     # Navy sidebar + Outlet (OMP shell)
│   │   └── ProtectedRoute.tsx  # Auth guard — redirects to /login
│   ├── Navbar.tsx
│   ├── Hero.tsx
│   ├── ProofBar.tsx
│   ├── Services.tsx
│   ├── Approach.tsx            # Crossfading background between field photos
│   ├── CaseStudies.tsx
│   ├── Team.tsx                # Icon-based team cards
│   ├── Values.tsx
│   ├── Contact.tsx
│   ├── Footer.tsx
│   └── Logo.tsx
├── contexts/
│   └── AuthContext.tsx         # Supabase auth session + profile
├── data/
│   └── siteData.ts             # ALL marketing site content lives here
├── hooks/
│   └── useFadeIn.ts
├── lib/
│   ├── supabase.ts             # Supabase client singleton
│   └── types.ts                # TypeScript types matching DB schema
├── pages/
│   ├── admin/
│   │   ├── Dashboard.tsx       # Metrics + upcoming deadlines + my tasks
│   │   ├── Opportunities.tsx   # Filterable table (All / Grants / Partnerships)
│   │   ├── OpportunityDetail.tsx # Detail view with type-specific fields
│   │   └── MyTasks.tsx         # Personal task list with one-click complete
│   ├── Home.tsx
│   └── Login.tsx               # Email/password + Google OAuth
├── App.tsx                     # PublicLayout + /login + /admin/* routes
├── main.tsx                    # QueryClient + AuthProvider wrappers
└── index.css

supabase/
└── migrations/
    └── 20260224000000_initial_schema.sql  # Full schema, RLS, seed data
```

## Customization

All copy, stats, services, team bios, and values live in `src/data/siteData.ts`. Edit that one file to update any text without touching components.

Contact form currently opens mailto:. To add a backend, update `handleSubmit` in `Contact.tsx` to POST to Formspree, Netlify Forms, or a custom API.

## Next Steps

### OMP — Immediate (unblock login)
- [ ] Set up Google OAuth in Supabase (Authentication → Providers → Google)
- [ ] Create first user account in Supabase (Authentication → Users → Invite user)
- [ ] Update your profile row in the `profiles` table: set `full_name` and `role = 'admin'`

### OMP — Sprint 1 (core features)
- [ ] Opportunity creation form (`/admin/opportunities/new`) with type-specific fields
- [ ] Status pipeline transitions with validation and activity log entries
- [ ] Auto-generated task lists from default templates on status change
- [ ] Task editing (reassign, reschedule, change status)
- [ ] Document upload to Supabase Storage per opportunity

### OMP — Sprint 2 (collaboration)
- [ ] Pipeline (Kanban) view with drag-and-drop status updates
- [ ] Email deadline reminders via Supabase Edge Functions + SendGrid
- [ ] CSV import for bulk opportunity ingestion
- [ ] User management page (invite team, set roles)

### Marketing Site
- [ ] Wire contact form to backend service (Formspree or Supabase Edge Function)
- [ ] Set up analytics (Plausible or GA4)
- [ ] Create OG image and favicon from logo mark
- [ ] Add blog / Field Notes section for SEO
