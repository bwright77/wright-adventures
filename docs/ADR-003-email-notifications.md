# ADR-003: Email Notifications

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-02-28
**Status:** Accepted
**PRD Reference:** OMP PRD v2.0, Phase 2 — Collaboration & Intelligence

---

## Context

The OMP MVP is live with core opportunity lifecycle management, AI-assisted grant writing (ADR-001), and automated grant discovery (ADR-002). The discovery pipeline surfaces high-fit opportunities daily, and the platform tracks deadlines and task assignments across the team — but no proactive alerting exists. Users must actively log in to discover upcoming deadlines or new assignments.

For a small team like Wright Adventures managing time-sensitive grant applications, reactive discovery is a meaningful failure mode: a deadline missed because no one checked the dashboard that day is operationally equivalent to not tracking the deadline at all.

This ADR closes that gap with transactional email notifications for three trigger classes:

1. **Deadline approaching** — opportunity owner is notified when a primary deadline is 7, 3, or 1 day away
2. **Task assigned** — user is notified when a task is assigned to them
3. **Opportunity discovered** — admin(s) are notified when the ADR-002 discovery pipeline inserts a new `status = 'discovered'` opportunity

**No Slack integration.** Wright Adventures does not use Slack. Email is the only notification channel for this ADR.

**Architectural constraint:** Same as ADR-001 and ADR-002 — React 19 + Vite SPA on Vercel, Supabase backend, no standalone server. New functionality must fit the existing Vercel Serverless Function + Supabase Edge Function pattern.

---

## Decision

Use **Supabase's built-in email infrastructure** — `pg_net` for HTTP calls from PostgreSQL and **Supabase Edge Functions** as the email dispatch layer — rather than adding a third-party SDK dependency (SendGrid, Resend, etc.).

Rationale:
- Zero new vendor accounts or API keys for MVP
- Supabase's Auth email is already configured; this extends the same infrastructure
- Edge Functions run in the same Supabase project, share the service role, and can be deployed via the Supabase CLI alongside existing migrations
- `pg_net` enables database-triggered HTTP calls, keeping deadline logic colocated with the data

**Delivery mechanism by trigger type:**

| Trigger | Mechanism | Why |
|---|---|---|
| Deadline approaching | Vercel Cron → `/api/notifications/deadlines.ts` | Deadline checking needs to run on a schedule; same cron pattern as ADR-002 discovery sync |
| Task assigned | Supabase Database Webhook → Edge Function | Fires immediately on `tasks` row insert/update — no polling required |
| Opportunity discovered | Supabase Database Webhook → Edge Function | Fires immediately on `opportunities` insert with `status = 'discovered'` |

**Email transport:** Supabase SMTP (configured in project Auth settings). For higher deliverability in production, the SMTP config can be swapped to a custom provider (e.g., Resend) without changing application code — only the Supabase project SMTP settings change.

> ⚠️ **Supabase free tier SMTP limit:** 3 emails/hour. For MVP with a 3-5 person team this is acceptable. If volume exceeds this, configure a custom SMTP provider in Supabase Auth settings before increasing team size or notification frequency.

---

## Implementation Plan

### 1. Supabase Schema

Migration: `supabase/migrations/20260228000000_notifications.sql`

```sql
-- Notification preferences per user
-- Defaults to all notifications enabled; users can opt out per type
CREATE TABLE notification_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  deadline_7d BOOLEAN NOT NULL DEFAULT true,
  deadline_3d BOOLEAN NOT NULL DEFAULT true,
  deadline_1d BOOLEAN NOT NULL DEFAULT true,
  task_assigned      BOOLEAN NOT NULL DEFAULT true,
  opportunity_discovered BOOLEAN NOT NULL DEFAULT true,  -- admin only; ignored for non-admins
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Audit log: every notification attempt, outcome, and payload
CREATE TABLE notification_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id),
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'deadline_7d', 'deadline_3d', 'deadline_1d',
    'task_assigned',
    'opportunity_discovered'
  )),
  opportunity_id  UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  task_id         UUID REFERENCES tasks(id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ DEFAULT now(),
  success         BOOLEAN NOT NULL,
  error_message   TEXT,
  email_to        TEXT NOT NULL
);

-- Prevent duplicate deadline notifications within a window
-- One row per (opportunity_id, notification_type) per day
CREATE UNIQUE INDEX notification_dedup_idx
  ON notification_log (opportunity_id, notification_type, (sent_at::date))
  WHERE notification_type IN ('deadline_7d', 'deadline_3d', 'deadline_1d')
    AND success = true;
```

RLS:
- `notification_preferences`: users read/write their own row only
- `notification_log`: admin read-all; no user writes (service role only)

---

### 2. Supabase Edge Functions

```
supabase/functions/
  send-deadline-notifications/
    index.ts      ← Called by Vercel Cron via HTTP
  send-task-assigned/
    index.ts      ← Called by Database Webhook on tasks insert/update
  send-opportunity-discovered/
    index.ts      ← Called by Database Webhook on opportunities insert
```

**`send-deadline-notifications/index.ts` — lifecycle:**

1. Query `opportunities` where:
   - `primary_deadline` is exactly 7, 3, or 1 days from today (UTC)
   - `status` not in terminal states (`awarded`, `declined`, `closed`, `archived`)
   - `owner_id` is not null
2. For each opportunity, determine which threshold(s) apply (7d / 3d / 1d)
3. Check `notification_log` dedup index — skip if already sent successfully today for this opportunity + type
4. Check `notification_preferences` for the owner — skip if opted out of this threshold
5. Fetch owner email via `auth.users`
6. Send email via Supabase SMTP using `supabase.auth.admin.sendRawEmail()` (or `fetch` to Supabase SMTP relay)
7. Write result to `notification_log`

**`send-task-assigned/index.ts` — lifecycle:**

1. Receive webhook payload: `{ record: Task, old_record: Task | null }`
2. Trigger condition: `record.assigned_to IS NOT NULL` AND (`old_record` is null OR `old_record.assigned_to !== record.assigned_to`)
   — fires on new task insert with assignee, or on reassignment; ignores other updates
3. Check `notification_preferences` for assignee — skip if opted out
4. Fetch assignee email and opportunity name
5. Send email, write to `notification_log`

**`send-opportunity-discovered/index.ts` — lifecycle:**

1. Receive webhook payload: `{ record: Opportunity }`
2. Trigger condition: `record.status = 'discovered'` AND `record.auto_discovered = true`
3. Query `profiles` for all users with `role = 'admin'`
4. For each admin: check `notification_preferences.opportunity_discovered` — skip if opted out
5. Send email with opportunity name, AI fit score, and link to the opportunity detail page
6. Write to `notification_log` per admin recipient

---

### 3. Database Webhooks (Supabase Dashboard)

Configure in Supabase Dashboard → Database → Webhooks:

| Webhook | Table | Events | Edge Function URL |
|---|---|---|---|
| `task-assigned` | `tasks` | INSERT, UPDATE | `https://<project>.supabase.co/functions/v1/send-task-assigned` |
| `opportunity-discovered` | `opportunities` | INSERT | `https://<project>.supabase.co/functions/v1/send-opportunity-discovered` |

Both webhooks must include the `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` header so Edge Functions can authenticate the call.

---

### 4. Vercel Cron (Deadline Notifications)

`vercel.json` — add alongside the existing discovery cron:

```json
{
  "crons": [
    {
      "path": "/api/discovery/sync",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/notifications/deadlines",
      "schedule": "0 9 * * *"
    }
  ]
}
```

Deadline notifications run at 9:00 AM UTC daily (after the discovery sync at 8:00 AM). This is approximately 2:00 AM MT — early enough that the team sees emails when their workday starts.

`/api/notifications/deadlines.ts` — a thin Vercel Serverless Function that:
1. Validates the Vercel Cron secret header (`CRON_SECRET` env var)
2. Makes an authenticated HTTP POST to the `send-deadline-notifications` Edge Function
3. Returns the Edge Function's response

This keeps deadline logic in the Edge Function (colocated with Supabase) while using the Vercel Cron trigger pattern already established in ADR-002.

---

### 5. Email Templates

Plain-text emails for MVP. No HTML templating library introduced.

**Deadline approaching:**
```
Subject: [Wright Adventures OMP] Deadline in {X} day(s): {Opportunity Name}

{Opportunity Name} is due in {X} day(s).

Deadline: {primary_deadline}
Funder: {funder}
Status: {status}

View opportunity: https://wright-adventures.vercel.app/admin/opportunities/{id}

You're receiving this because you're the owner of this opportunity.
Update your notification preferences: https://wright-adventures.vercel.app/admin/settings/notifications
```

**Task assigned:**
```
Subject: [Wright Adventures OMP] New task assigned: {task title}

You've been assigned a task on {Opportunity Name}:

Task: {task_title}
Due: {due_date or "No due date set"}
Opportunity: {opportunity_name}

View task: https://wright-adventures.vercel.app/admin/opportunities/{opportunity_id}

Update your notification preferences: https://wright-adventures.vercel.app/admin/settings/notifications
```

**Opportunity discovered:**
```
Subject: [Wright Adventures OMP] New grant opportunity: {Opportunity Name}

The discovery pipeline found a potential match for Confluence Colorado.

Opportunity: {name}
Funder: {funder}
Fit Score: {ai_match_score}/10
Max Funding: ${amount_max}
Deadline: {primary_deadline}

Summary: {ai_match_rationale}

Review and approve: https://wright-adventures.vercel.app/admin/opportunities/{id}

Update your notification preferences: https://wright-adventures.vercel.app/admin/settings/notifications
```

---

### 6. Frontend: Notification Preferences UI

Add a **Notifications** section to `/admin/settings` (or create the settings page if it doesn't exist):

- Toggle per notification type (deadline 7d / 3d / 1d, task assigned, opportunity discovered)
- Reads/writes `notification_preferences` via Supabase client
- `opportunity_discovered` toggle only rendered for users with `role = 'admin'`

No new routes required — add as a tab or section within existing settings.

---

### 7. Environment Variables

No new env vars required for the Edge Functions — they use the existing `SUPABASE_SERVICE_ROLE_KEY` available in the Supabase runtime.

Vercel Serverless Function requires:
```
CRON_SECRET=           ← Vercel-generated; used to authenticate cron requests
```

---

## Deferred

- HTML email templates (styled with brand colors) — plain text is sufficient for MVP internal tool
- In-app notification bell / notification center — email covers the alerting use case; in-app notifications add UI complexity without meaningful value for a 3-5 person team
- Digest mode (batched daily summary instead of per-event emails) — opt-out at the preference level is sufficient for now
- Custom SMTP provider (Resend, SendGrid) — Supabase free tier SMTP is sufficient for current team size; revisit when onboarding partner organizations
- Notification preferences per-opportunity (e.g., "mute this grant") — global type-level opt-out is sufficient for MVP
- LOI deadline notifications — `loi_deadline` exists on grant opportunities; adding it as a fourth deadline type is a one-line config change once the core pattern is proven

---

## Risks & Tradeoffs

| Risk | Impact | Mitigation |
|---|---|---|
| Supabase free tier SMTP limit (3/hr) | Notifications silently drop if limit hit | Log all attempts in `notification_log`; monitor `success = false` rows; swap SMTP config before scaling |
| Webhook delivery failures (Edge Function unavailable) | Task assignment or discovery notifications not sent | `notification_log` audit trail surfaces failures; webhooks do not retry by default — consider idempotent re-run endpoint for missed notifications |
| Duplicate deadline emails | User annoyance, eroded trust in notifications | Dedup index on `notification_log` prevents re-send within same UTC day per (opportunity, type) |
| Opt-out friction | Users don't bother and mute email sender | Every email includes a direct link to preferences; defaults are all-on but easy to dial back |
| UTC vs. MT timezone confusion | Deadlines display as wrong day in emails | Always display deadline in both UTC and MT in email body for Phase 1; add user timezone preference to Phase 2 settings |

---

## Out of Scope

- Slack integration (Wright Adventures does not use Slack)
- SMS / push notifications
- Status change notifications (not required for MVP; revisit if team requests it)
- External partner notifications (OMP is internal-only for now)
- Notification history UI (covered by `notification_log` table; admin can query directly via Supabase dashboard)

---

## Related Documents

- [ADR-001: AI-Assisted Grant Writing](./ADR-001-ai-grant-writing.md)
- [ADR-002: Grant Discovery Pipeline](./ADR-002-grant-discovery-pipeline.md)
- [OMP PRD v2.0](./OMP_PRD_v2) — Phase 2 scope definition
- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks)
- [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
- App: `https://wright-adventures.vercel.app/`
