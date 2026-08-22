# ADR-012 — Lead → Opportunity → Client

**Status:** Accepted — Phase 1 landed 2026-08-22
**Date:** 2026-08-22
**Supersedes:** the `partnership_*` vocabulary introduced in ADR-006

---

## Context

Wright Adventures has **clients**, not partners. The word "partnership" is
inherited from Confluence Colorado, where it was accurate — those genuinely were
partner organisations. It came across in ADR-006 and is now in 5 tables, 16
pipeline status ids, and 352 places in the code.

But renaming `partnership_details` to `client_details` would fix a word and
leave the actual modelling error in place. The error is that **one table is
doing three jobs**:

| What it really is | How it is stored today |
|---|---|
| A discovered posting we have not judged yet | `opportunities` with `type_id = 'lead'` |
| Work we are trying to win | `opportunities` with `type_id = 'partnership'` |
| Work we won and are delivering | `opportunities` with `status = closed_won` |

Three consequences, all of them things we have already hit:

1. **The organisation is a string.** `opportunities.partner_org` is free text. The
   logo lookup had to guess a website from a name because nothing durable holds
   it. CMC exists twice in spirit — an existing contract *and* a new tech-services
   pursuit — but there is no record that says those are the same organisation.

2. **Won work has nowhere to live.** BBSP is finished, Mo'Betta is in progress,
   River Sisters has a logo redesign still open. `delivery_status` was bolted onto
   the opportunity to express this, but a closed-won opportunity is a historical
   fact that should stop changing, and delivery is an ongoing thing that keeps
   changing. They are different records.

3. **Every list needs a filter to hide the other two kinds.** `isOpportunity()`,
   `TAB_STATUSES`, `INACTIVE_PARTNERSHIP_STATUSES` — the bug where `?tab=partnership`
   crashed the page came from exactly this.

There is also a fourth entity hiding in plain sight: the **warm-path network**
(`org_relationships`) — City of Philadelphia, NACTO, NABSA, the Living Labs. Those
are organisations too, and the fit rubric already scores against them.

---

## Decision

Four entities, each with one job.

```
ORGANIZATION  the durable thing. Everything else points at it.
     │        name, website, logo_url, sector, notes,
     │        relationship: none | prospect | network | client
     │        nurture: revisit_on, nurture_note
     │
     ├── LEAD          a discovered posting, not yet judged.
     │                 source, url, fit score + assessment,
     │                 status: new | pursuing | declined
     │                 Converting one creates an Opportunity.
     │
     ├── OPPORTUNITY   a pursuit. One org can have several, over time.
     │                 stage, value, service lines, deadlines,
     │                 decision_date/body, lost_reason
     │                 Ends won or lost, then stops changing.
     │
     └── ENGAGEMENT    won work being delivered.
                       nature: paid | strategic | portfolio
                       contract_value, fmv, delivery_status, start/end
                       ← ADR-010 logs time against THIS, not an opportunity.
```

**An organisation is a client when it has at least one engagement.** Client is not
a stored flag to keep in sync; it is a fact about the work.

### What this kills

- `opportunity_types` and `type_id` — leads are their own table, so there is only
  one kind of opportunity and nothing to discriminate on.
- The `lead_*` pipeline statuses (6 of the 16), which currently interleave with the
  `partnership_*` ones in a shared `sort_order` and make the stage list confusing
  to read.
- `isOpportunity()` and the filters that exist only to hide the wrong record type.
- `delivery_status` and `engagement_nature` on `opportunities` — they move to
  `engagements` where they belong.

### The pursuit pipeline

`Qualifying → Discovery → Proposal → Evaluation → Approval → Negotiation → Won | Lost`

Won creates an engagement. The opportunity record stays as history.

---

## Decided: Nurture is a state of the organisation

Nurture is currently a pipeline stage. Two readings were considered; (b) was chosen.

**(a) Nurture stays a stage on the opportunity.** Matches the pipeline as it
stands. But it forces a speculative opportunity record to exist for City Thread,
Avasol and Golden Trout Rising — organisations where there is *nothing to bid on*.
Their `revisit_on` is a placeholder and their value is null, because there is no
deal to value yet.

**(b) Nurture is a state of the ORGANISATION, surfaced in the Opportunities view
as the sidelined lane.** The relationship precedes the opportunity — which is
exactly how it was described: *"sidelined nurture orgs where we are building the
relationship to create the opportunity to pursue."* You nurture an org; when an
RFP appears you create the opportunity. Losing a deal moves the org back to
nurture without inventing a second opportunity record, which is the thing
`closed_lost → nurture` currently has to special-case in a trigger.

**Decided: (b), 2026-08-22.** It removes the "opportunity with no opportunity" record,
and it means the warm-path network and the nurture list are the same list at
different temperatures — which is what they already are in practice.

The view does not change either way: Opportunities still shows active pursuits
plus a sidelined lane. Only the record behind the lane differs.

---

## Migration

54 rows total across the five `partnership_*` tables, so this is a small data
move behind a broad code change. `ALTER TABLE ... RENAME` preserves rows, FKs and
indexes — no copy, no downtime.

| Phase | Work |
|---|---|
| 1 | ✅ `organizations` + backfill; folded in `org_relationships` → 19 orgs |
| 2 | `leads` table; move the ~24 lead rows out of `opportunities`; drop `type_id` |
| 3 | Rename `partnership_*` → `opportunity_*`; restage the status ids |
| 4 | `engagements` from the 5 closed-won rows + `delivery_status` / FMV |
| 5 | UI: Clients as its own view; Opportunities = pursuit + sidelined lane |
| 6 | ADR-010 timekeeping hangs off `engagements` |

Phases 1–4 are each a single migration and independently revertible. Phase 5 is
where the vocabulary finally changes on screen.

### Risk

The last schema change of this shape caused a live outage: adding a second FK to
`opportunities` broke every PostgREST embed and emptied the Opportunities table
silently. Two rules for this work:

- **After each phase, run a query that returns rows for every list view** — not
  just a type check. `tsc` did not catch that outage and would not catch the next.
- `api/` is outside the tsconfig include, so `tsc -b` skips it. Grep it explicitly.
