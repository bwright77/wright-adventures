# ADR-010: Timekeeping, Billing & Invoicing

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-08-18 (rewritten from the 2026-08-11 draft)
**Status:** Proposed
**Depends on:** ADR-006 (Partnership Pipeline), engagement_nature migration (2026-08-18)
**Driving requirement:** the Colorado Mountain Club SOW, if signed

---

## Context

The OMP tracks opportunities up to the point of winning them and then stops. There is no way
to log an hour, draw down a retainer, or produce an invoice.

That becomes urgent rather than theoretical if CMC signs. Its SOW starts **August 24**, is
**invoiced in advance**, and the first invoice is **due on signature** — so the very first
obligation of the engagement is one this system cannot meet.

### The CMC terms are the specification

This ADR is scoped by one real contract rather than by a general theory of billing. Every
mechanic below comes from the signed-form SOW:

| Term | Value |
|---|---|
| Fee | $6,000/month · **$24,000 total** |
| Rate | **$150 partner rate** against a $170 standard rate |
| Commitment | **40 hours/month, 160 total** |
| Banking | **"Hours bank across the term and may be drawn ahead, to a ceiling of 60 in any month"** |
| Invoicing | **Monthly retainer, invoiced in advance.** First due on signature; subsequent net 15 |
| Overage | Beyond 160, at $150/hr, **on written approval before the work is performed** |
| Term | Four months from signature, continuing month to month if both parties want it |
| Ending early | **"Any retainer paid for hours not worked is refunded"** |
| Checkpoints | Written progress review at end of **Month 1 and Month 2** — hours used, deliverables completed |

Four of those break the naive model in the earlier draft of this ADR:

1. **Banked hours across a term, not per month.** A month where 25 hours are used does not
   forfeit 15; they remain available. The balance is a term-level ledger.
2. **A monthly ceiling of 60 that is a constraint, not an entitlement.** It caps draw-ahead. It
   is a warning condition, not a billing line.
3. **Invoiced in advance.** Invoices are not generated *from* time entries. The money precedes
   the work, and the time entries draw against it.
4. **Refund on early termination.** Requires hours-purchased and hours-worked to be
   independently known at any moment.

A time-and-materials model — collect entries, sum them, invoice in arrears — models none of
this. BBSP, by contrast, was a flat fee ($6,525 against a $10,875 list, a 40% discount) with
no hours drawn at all. The schema must hold both without pretending they are the same.

---

## Decision

### Engagements, not projects

A won partnership becomes an **engagement**: the unit that has a fee, a term, a rate, and
possibly a retainer. Attached to the `opportunities` row that won it, so the pipeline history
survives, and separate from it, because an opportunity closes and an engagement runs.

`billing_model` is the discriminator, and it decides which mechanics apply:

- **`retainer`** — CMC. Periodic fee paid in advance, hours drawn against a term balance.
- **`fixed_fee`** — BBSP. One agreed sum, optionally invoiced in stages. Hours logged for
  margin analysis but not billed.
- **`hourly`** — billed in arrears from approved time entries.
- **`non_billable`** — pro-bono and portfolio work (Kady, River Sisters, Mo'Betta). Time is
  logged so contributed value is measured rather than estimated, and never invoiced.

That last one matters: `engagement_nature` already distinguishes pro-bono work for reporting,
and `list_value` currently holds a **hand-estimated** FMV. Logging hours against non-billable
engagements would let contributed value be computed from actuals instead.

### The retainer is a ledger, not a balance field

A single `hours_remaining` column would be wrong the first time anything is corrected or
refunded. Instead, an append-only ledger of entitlements and draws:

- **Credit** — a retainer period begins, granting hours (CMC: 40/month, ×4 = 160)
- **Debit** — a billable time entry draws hours
- **Adjustment** — a written change order, a correction, a refund on termination

Balance is the sum. Every number in a checkpoint report or a refund calculation is then
derivable and auditable, and a correction is a new row rather than a mutated total.

**Draw-ahead falls out for free.** Hours are granted per period but drawn against the term, so
using 55 in month one simply leaves less later. The 60/hour monthly ceiling is enforced as a
check at entry time — a warning surfaced in the UI, and a hard stop only if the engagement is
configured to enforce it.

### Invoices are documents, not derived views

An invoice, once sent, is a statement of fact. It does not change because a time entry was
later edited. So invoices carry their own immutable line items and a snapshot of the rate,
and a retainer invoice is generated **from the schedule**, not from time.

Corrections are made by **voiding and reissuing**, never by editing a sent invoice.

### Schema

```
engagements
  id, opportunity_id → opportunities, client_name, billing_model,
  standard_rate, contract_rate,            -- CMC: 170 / 150, for discount reporting
  total_fee, currency,
  term_start, term_end, term_months,
  committed_hours,                          -- 160
  hours_per_period, max_hours_per_period,   -- 40 / 60
  payment_terms,                            -- 'due_on_signature' | 'net_15' | 'net_30'
  invoice_in_advance boolean,
  status                                    -- draft|active|paused|complete|terminated

retainer_periods                            -- one per month for CMC
  id, engagement_id, period_start, period_end,
  hours_granted, fee, invoice_id → invoices, status

retainer_ledger                             -- append-only
  id, engagement_id, entry_type,            -- credit|debit|adjustment
  hours numeric(8,2), time_entry_id, retainer_period_id,
  note, created_by, created_at

time_entries
  id, engagement_id, user_id, entry_date,
  minutes integer,                          -- integer minutes, never decimal hours
  description, billable boolean,
  rate_applied numeric(10,2),               -- snapshot when invoiced
  invoice_id, locked boolean

invoices
  id, engagement_id, invoice_number unique,  -- WA-2026-0001, gap-free via sequence
  issue_date, due_date, period_start, period_end,
  subtotal, discount, tax, total, amount_paid,
  status,                                    -- draft|sent|partial|paid|overdue|void
  sent_at, paid_at, pdf_storage_path

invoice_line_items
  id, invoice_id, line_type,                 -- retainer|time|expense|fixed_fee|adjustment
  description, quantity, unit_rate, amount, sort_order

payments
  id, invoice_id, amount, payment_date, method, reference
```

**Money is `NUMERIC`; time is integer minutes.** `0.1 + 0.2 !== 0.3` is not an acceptable
failure mode on a billable hour. And **Supabase JS returns NUMERIC as a string** — the
`proximity_bonus` lesson from ADR-005 and `list_value` from this month. One `toMoney()` helper,
not scattered `Number()` calls.

**Invoice numbers come from a Postgres sequence**, not `MAX(...) + 1`, which races and silently
duplicates.

---

## What CMC actually needs on day one

The test for Phase 1 is not "is billing complete" but **"could we run the CMC engagement from
this?"** That is a much smaller system:

1. Record the engagement from the SOW — $150 rate, 160 hours, 4 periods of 40.
2. Issue invoice #1 on signature, before any work. Mark it sent.
3. Log hours against it and see the balance move.
4. Answer, at the Month 1 checkpoint: hours used, hours remaining, on pace or not.
5. Issue the next invoice on schedule.

Everything else — expenses, payments reconciliation, A/R aging, utilization, multi-user
approval — is deferrable without blocking the engagement.

### Reporting the retainer

The checkpoint reviews are contractual, so the numbers must be reportable rather than
assembled by hand:

| Figure | Derivation |
|---|---|
| Hours used this period | Σ debits in period |
| Against 40 committed / 60 ceiling | flagged when over |
| Hours used to date | Σ all debits |
| Hours remaining of 160 | Σ credits − Σ debits |
| Pace | hours used ÷ term elapsed, projected against 160 |
| Invoiced to date / worked to date | for the early-termination refund |
| Effective rate | fee ÷ hours worked — shows when the retainer is being over-delivered |

That last one is a genuine early-warning: at 40 hours the effective rate is $150, at 55 it is
$109. Phase 1 of the CMC SOW estimates **55 hours**, so this fires in month one by design.

### The CMC engagement has zero slack — and the reporting has to say so

Running the SOW's own phase estimates against its own commitment:

| Phase | Estimated | vs 40 committed/month |
|---|---|---|
| 1 · Extract and assess | 55 hrs | **+15 — draws ahead** |
| 2 · Repair the data at its source | 50 hrs | **+10 — draws ahead** |
| 3 · Move onto the new platform | 30 hrs | −10 |
| 4 · Onboard, document, train | 25 hrs | −15 |
| **Total** | **160 hrs** | **exactly the 160 committed — zero buffer** |

Two things follow, and neither is a software problem:

- **The plan consumes the entire retainer.** Any overrun in Phase 1 comes directly out of
  Phase 4, which is the training and documentation handoff — the part that determines whether
  CMC can actually run the thing afterwards.
- **It is front-loaded past the monthly commitment from day one.** Month 1 at 55 hours is 92%
  of the 60-hour ceiling, and the effective rate that month is **$109/hr against a $150
  contract rate** — $100/hr if it reaches the ceiling.

This is exactly why banked hours, the ceiling check, and effective rate are all **Phase 1**
requirements rather than later niceties: the very first month of the engagement exercises all
three. A system that only reported "hours logged" would show month one as healthy.

---

## Implementation Sequence

**Phase 1 — Run CMC.** `engagements`, `retainer_periods`, `retainer_ledger`, `time_entries`,
`invoices`, `invoice_line_items`. Time entry, retainer status, invoice generation from
schedule, PDF. This is the whole blocking scope.

**Phase 2 — Get paid.** `payments`, invoice status lifecycle, overdue flagging, A/R.

**Phase 3 — The rest of the book.** Fixed-fee staged invoicing (BBSP), non-billable time on
pro-bono engagements feeding contributed value from actuals, expenses.

**Phase 4 — Analysis.** Utilization, realization, effective-rate trends, margin by engagement.

Phases 1 and 2 are the ones with a date attached.

---

## Key Design Decisions

- **Scoped by a real contract, not a general model.** Ambiguity gets resolved by reading the
  SOW, and the result is testable: the CMC terms either reproduce or they don't.
- **Ledger over balance field.** Corrections and refunds are rows, not mutations, and every
  reported number is derivable.
- **Invoices are immutable once sent.** Void and reissue. The audit trail *is* the product in
  billing.
- **Rates snapshot onto invoiced entries.** Rates change; issued invoices must not.
- **PDF client-side** via `@react-pdf/renderer`, matching the ADR-004 DOCX precedent, with the
  generated file stored on send so a reissue cannot silently alter what the client received.
- **Non-billable engagements are first-class**, so contributed value is measured rather than
  estimated.

---

## Risks

| Risk | Mitigation |
|---|---|
| CMC signs before Phase 1 lands | Invoice #1 can be issued manually; the ledger can be backfilled. Time entry is the piece that must not slip, since hours are hard to reconstruct |
| Draw-ahead exceeds the 60-hour ceiling unnoticed | Enforced at entry, surfaced on the engagement view, not discovered at the checkpoint |
| Retainer over-delivered (Phase 1 estimates 55 hours against 40 committed) | Effective-rate figure is a Phase 1 requirement, not a Phase 4 nicety |
| NUMERIC-as-string bugs | Single `toMoney()` helper; this has now bitten twice |
| Invoice number collision | Postgres sequence, never `MAX + 1` |

---

## Out of Scope

- Payment processing. Payments are **recorded**, not collected. No Stripe.
- Accounting-system sync (QuickBooks, Xero) and multi-currency
- Payroll, contractor payouts, profitability by person
- A client-facing portal
- Automated recurring invoice *sending* — generation is scheduled, sending stays deliberate
- Time approval workflows; a two-person firm does not need them
