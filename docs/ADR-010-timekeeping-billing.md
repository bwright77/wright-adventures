# ADR-010: Timekeeping & Billing

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-08-11
**Status:** Proposed
**Depends on:** ADR-006 (Partnership Pipeline)
**Companion:** ADR-009 (OMP Split) — independent; may run in parallel

---

## Context

ADR-009 narrows the WA platform to partnership/business-development tracking. That leaves a
gap on the other side of the deal: once a partnership reaches `partnership_closed_won`, the
platform has nothing to say about delivering or billing the work.

WA is a consultancy. The work it sells is hours, and those hours are billed against rates that
vary by person, client, and engagement — plus retainers drawn down over time and expenses
passed through. Today none of that is tracked in the platform.

This ADR adds a full billing loop: **time → rates → invoices → payments**, with retainers and
expenses.

### Why a `clients` table rather than reusing `opportunities`

A partnership `opportunity` is a *deal* — it has a pipeline stage, a confidence score, and it
ends. A client is a *relationship* — it has billing details, payment terms, rates, and an
accounts-receivable balance that outlives any single deal.

Conflating them would mean a closed-won opportunity can never close, because invoicing against
it keeps it alive. So: a new `clients` table, with an optional FK back to the opportunity that
won it, and a **"Convert to client"** action on closed-won partnerships.

---

## Decision

Nine new tables in WA's Supabase project, four new routes, and a client-side PDF pipeline.

### Schema

**`clients`** — billable organizations
`id`, `name`, `legal_name`, `billing_email`, `billing_address`, `tax_id`,
`opportunity_id` (nullable → `opportunities`), `payment_terms` (`net_15|net_30|net_60|due_on_receipt`),
`status` (`active|inactive`), `notes`, `created_by`, `created_at`, `updated_at`

**`projects`** — engagements within a client
`id`, `client_id`, `name`, `code`, `billing_type` (`hourly|fixed_fee|retainer`),
`fixed_fee_amount`, `budget_hours`, `budget_amount`, `start_date`, `end_date`,
`status` (`active|paused|complete`), `opportunity_id` (nullable)

**`rates`** — resolved most-specific-first
`id`, `user_id` (nullable), `client_id` (nullable), `project_id` (nullable),
`hourly_rate`, `effective_from`, `effective_to` (nullable), `created_by`

Resolution order, first match wins:

```
user + project  →  project  →  user + client  →  client  →  user  →  global (all NULL)
```

…filtered to rows where `entry_date` falls within `[effective_from, effective_to)`. This is
the single trickiest piece of logic in the ADR and belongs in one pure, unit-tested function —
`src/lib/billing/resolveRate.ts` — following the `api/discovery/state-utils.ts` precedent of
keeping testable logic free of Supabase and network calls.

**`time_entries`**
`id`, `user_id`, `client_id`, `project_id` (nullable), `task_id` (nullable → `tasks`),
`entry_date`, `minutes` (INTEGER), `description`, `billable` (BOOLEAN),
`rate_applied` (NUMERIC, NULL until invoiced), `invoice_id` (nullable), `created_at`, `updated_at`

**`expenses`**
`id`, `client_id`, `project_id` (nullable), `user_id`, `expense_date`, `amount`,
`category`, `description`, `billable`, `markup_pct`, `receipt_storage_path` (nullable),
`invoice_id` (nullable)

**`retainers`**
`id`, `client_id`, `project_id` (nullable), `amount`, `period_start`, `period_end`,
`rollover_unused` (BOOLEAN), `status` (`active|exhausted|expired`), `notes`

**`invoices`**
`id`, `client_id`, `invoice_number` (UNIQUE), `period_start`, `period_end`, `issue_date`,
`due_date`, `subtotal`, `discount`, `tax_rate`, `tax_amount`, `total`, `amount_paid`,
`status` (`draft|sent|partial|paid|overdue|void`), `notes`, `terms`, `sent_at`, `paid_at`,
`pdf_storage_path`, `created_by`

**`invoice_line_items`**
`id`, `invoice_id`, `line_type` (`time|expense|fixed_fee|retainer_credit|adjustment`),
`description`, `quantity`, `unit_rate`, `amount`, `sort_order`,
`time_entry_id` (nullable), `expense_id` (nullable)

**`payments`**
`id`, `invoice_id`, `amount`, `payment_date`, `method` (`check|ach|card|other`),
`reference`, `notes`, `recorded_by`

### Money and time representation

- **All money is `NUMERIC(12,2)`.** Never float.
- **`@supabase/supabase-js` returns NUMERIC as a string.** This bit us in ADR-005 with
  `proximity_bonus`; the fix there was `Number()` at every use site. Do the same here, and
  prefer a single `toMoney()` helper over scattered coercion — with nine tables of money
  columns, ad-hoc `Number()` calls will be missed.
- **Time is stored as INTEGER minutes**, not decimal hours. `0.1 + 0.2 !== 0.3` is not an
  acceptable failure mode on a billable hour. Format to `h:mm` at the UI edge only.

### Invoice numbering

Sequential and gap-free, formatted `WA-2026-0001`. Use a Postgres **sequence** plus a
generation function — not `MAX(invoice_number) + 1`, which races under concurrent inserts and
silently produces duplicates. The year segment resets the counter annually.

### Immutability

Once an invoice leaves `draft`:

- its `invoice_line_items` become read-only;
- the `time_entries` and `expenses` it references become read-only (locked via their
  `invoice_id` being non-NULL);
- corrections happen by **voiding and reissuing**, never by editing a sent invoice.

Enforce with a `BEFORE UPDATE` trigger, not just UI guards — the service-role key bypasses RLS
and the API layer is not the only writer.

### Rate snapshotting

`time_entries.rate_applied` is NULL until the entry is invoiced, then written from
`resolveRate()` at invoice-generation time. Rates change; invoices must not. Never join to
`rates` when rendering a historical invoice.

---

## Frontend

| Route | Purpose |
|---|---|
| `/admin/time` | Weekly grid + running timer; quick-entry against client/project/task |
| `/admin/clients` | Client list, detail, rates, retainer balance, A/R summary |
| `/admin/invoices` | List, builder (select uninvoiced time/expenses → generate), detail |
| `/admin/reports` | Utilization, realization, A/R aging, retainer burn-down |

Nav order in `AdminLayout.tsx`: Time and Invoices after My Tasks; Clients near Team.

**PDF generation:** `@react-pdf/renderer`, client-side, mirroring how ADR-004 does DOCX export
with the `docx` package rather than adding a serverless rendering path. On **send**, the
generated PDF is uploaded to a private `invoices` Storage bucket and its path recorded — so a
reissued invoice can never silently change what the client already received.

**Data fetching:** TanStack Query throughout, per project convention. Forms use react-hook-form
+ zod.

---

## Access Control

| Role | Capability |
|---|---|
| `admin` | Everything, including rates, voiding invoices, recording payments |
| `manager` | Full time/expense entry; create and send invoices; read rates |
| `member` | Own time and expenses only; no rate or invoice visibility |
| `viewer` | No billing access at all |

Rates are compensation-adjacent data. RLS on `rates` must be **deny-by-default for `member`**,
including via joins — a `member` reading their own `time_entries` must not be able to infer
another person's rate through `rate_applied`.

---

## Implementation Sequence

1. **Foundation** — `clients`, `projects`, `rates`, `resolveRate.ts` + unit tests, "Convert to
   client" on closed-won partnerships.
2. **Time capture** — `time_entries`, `/admin/time`, weekly grid, timer, utilization report.
3. **Expenses** — `expenses`, receipt upload to Storage, expense report.
4. **Invoicing** — `invoices`, `invoice_line_items`, numbering sequence, builder UI, PDF,
   immutability triggers.
5. **Payments & retainers** — `payments`, `retainers`, A/R aging, retainer burn-down.

Steps 1–2 are independently useful: time tracking with reporting has value before a single
invoice exists. Ship them before committing to the rest.

---

## Key Design Decisions

- **`clients` separate from `opportunities`** so a won deal can close while the relationship
  continues.
- **Minutes as integers, money as NUMERIC** — no floating-point money or time, anywhere.
- **Rate resolution as one pure tested function** rather than a query with six `COALESCE`s.
  It is the logic most likely to be wrong and most expensive to get wrong.
- **Snapshot rates onto invoiced entries** so historical invoices never move.
- **Void-and-reissue over edit** — the audit trail is the product in billing.
- **Client-side PDF** to match the ADR-004 DOCX precedent and keep serverless functions thin.

---

## Out of Scope

- Stripe or any payment collection — payments are *recorded*, not processed
- Accounting-system sync (QuickBooks, Xero)
- Multi-currency
- Payroll, contractor payouts, or profitability by person
- Client-facing portal for viewing or paying invoices
- Automated recurring invoices
