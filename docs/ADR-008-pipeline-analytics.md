# ADR-008: Pipeline Analytics

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-03-10
**Status:** Implemented — 2026-03-10
**PRD Reference:** OMP PRD v2.0, Phase 3 — Platform Expansion
**Depends on:** ADR-001 (Grants), ADR-006 (Partnership Pipeline)

---

## Context

The OMP now tracks two fully-instrumented pipelines:

- **Grant pipeline** — 7 stages from Identified → Awarded/Declined, with dollar amounts and deadlines
- **Partnership pipeline** — 7 stages from Prospecting → Closed-Won/Lost, with estimated values, confidence scores, and org metadata

Both pipelines accumulate structured data (stage, value, timing, owner) that currently has no aggregate view. A team member can see individual opportunities but cannot answer questions like:
- How much is in the active grant pipeline right now?
- What's our partnership win rate this quarter?
- Where are deals stalling?

This ADR specifies a read-only **Pipeline Analytics** page that surfaces funnel health, conversion rates, and pipeline value for both grant and partnership tracks. No new database schema is required — all data is derived from existing tables.

---

## Decision

Add a `/admin/analytics` route with a **Pipeline Analytics** page accessible from the sidebar. The page computes metrics client-side from the existing TanStack Query data cache (no new API endpoints for Phase 1).

The page is split into two panels — **Grants** and **Partnerships** — with a shared summary bar at the top.

---

## Metrics Spec

### Summary bar (top of page)

| Metric | Source |
|---|---|
| Active grant opportunities | `opportunities` where `type_id='grant'` and status not in inactive list |
| Total grant pipeline value | Sum of `amount_requested` on active grants |
| Active partnership opportunities | `opportunities` where `type_id='partnership'` and status not in closed list |
| Total partnership pipeline value | Sum of `estimated_value` on active partnerships |

---

### Grant Analytics Panel

**Funnel chart** — horizontal bar per stage, sized by count:
- Identified → Evaluating → Preparing → Submitted → Under Review → Awarded → Declined

Each bar shows:
- Count of grants in that stage
- Total `amount_requested` in that stage
- Percentage of total active

**Key metrics:**
| Metric | Calculation |
|---|---|
| Win rate | `awarded / (awarded + declined + withdrawn)` × 100 |
| Avg days to submission | `primary_deadline - created_at` on submitted grants |
| Total awarded (all time) | Sum of `amount_awarded` where status = `grant_awarded` |
| Upcoming deadlines | Count of grants with `primary_deadline` within 30 days |

**Breakdown table** — one row per stage showing: Stage · Count · Total requested · % of pipeline

---

### Partnership Analytics Panel

**Funnel chart** — horizontal bar per stage:
- Prospecting → Qualifying → Discovery → Proposal → Negotiating → Closed-Won → Closed-Lost

Each bar shows:
- Count of partnerships
- Total `estimated_value`
- Percentage of total active

**Key metrics:**
| Metric | Calculation |
|---|---|
| Win rate | `closed_won / (closed_won + closed_lost)` × 100 |
| Avg deal age (active) | `today - created_at` across all non-closed partnerships |
| Weighted pipeline | Sum of `estimated_value × confidence_multiplier` where multiplier: low=0.2, medium=0.5, high=0.8 |
| Deals at risk | Active partnerships with no `next_action_date` or `next_action_date` in the past |

**Confidence distribution** — three count badges: Low / Medium / High, sourced from `partnership_details.confidence`

**Breakdown table** — one row per stage showing: Stage · Count · Total value · Weighted value

---

## Frontend Architecture

### Route
`/admin/analytics` — new page, auth-gated, visible to all roles

### Data sources
The existing `['opportunities']` query in `Opportunities.tsx` was extended from:
```
*, partnership_details(logo_url)
```
to:
```
*, partnership_details(logo_url, confidence, next_action_date)
```

`next_action_date` was added (beyond the original spec) because the "deals at risk" metric requires it, and it lives on `partnership_details`. Both `Analytics.tsx` and `Opportunities.tsx` use the same `['opportunities']` TanStack Query key — no double fetch.

All metric computation is pure TypeScript functions in `src/lib/analytics.ts` operating on the in-memory array.

### Component structure

```
src/pages/admin/Analytics.tsx          # Page shell + tab switcher
src/components/admin/analytics/
  GrantFunnel.tsx                      # Grant stage funnel + metrics
  PartnershipFunnel.tsx                # Partnership stage funnel + metrics
  FunnelBar.tsx                        # Shared horizontal bar component
  MetricCard.tsx                       # KPI card (number + label + trend hint)
```

### Computation helpers (`src/lib/analytics.ts`)

Pure functions, no Supabase calls:

```typescript
computeGrantMetrics(opps: Opportunity[]): GrantMetrics
computePartnershipMetrics(opps: OpportunityWithDetails[]): PartnershipMetrics
```

Keeping computation out of components makes the logic testable and the components thin.

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  PIPELINE ANALYTICS                                          │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──── │
│  │  12 Active   │ │  $847K       │ │  8 Active    │ │ $21 │
│  │  Grants      │ │  Grant pipe  │ │  Partnerships│ │ Par │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──── │
│                                                              │
│  [Grants]  [Partnerships]                                    │
│                                                              │
│  GRANT FUNNEL                                                │
│  Identified   ████████████████░░░░░  8   $234K              │
│  Evaluating   ██████████░░░░░░░░░░░  5   $180K              │
│  Preparing    ████████░░░░░░░░░░░░░  4   $210K              │
│  Submitted    █████░░░░░░░░░░░░░░░░  2   $95K               │
│  Under Review ███░░░░░░░░░░░░░░░░░░  1   $70K               │
│                                                              │
│  Win rate: 62%   Avg days to submit: 34   Awarded YTD: $—   │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Sequence

1. **`src/lib/analytics.ts`** — pure computation functions for grant and partnership metrics
2. **`src/components/admin/analytics/`** — `MetricCard`, `FunnelBar`, `GrantFunnel`, `PartnershipFunnel`
3. **`src/pages/admin/Analytics.tsx`** — page shell with tab switcher and summary bar
4. **`src/App.tsx`** — add `/admin/analytics` route
5. **`src/components/admin/AdminLayout.tsx`** — add "Analytics" nav item (BarChart2 icon, between My Tasks and Board Minutes)
6. **Update opportunities query** in `Opportunities.tsx` to include `confidence` and `next_action_date` in the partnership_details join

---

## Key Design Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Client-side computation, no new API | All data is already fetched; avoids a reporting endpoint for single-tenant use |
| 2 | Reuse TanStack Query cache | Analytics page shares the same `['opportunities']` query — no double fetch |
| 3 | Separate `src/lib/analytics.ts` | Pure functions are easy to reason about and keep component files thin |
| 4 | Horizontal bar funnel (not vertical) | More readable at 7 stages in a sidebar layout; labels stay visible |
| 5 | Weighted pipeline value | Raw `estimated_value` is misleading without confidence weighting; show both |
| 6 | "Deals at risk" = overdue next_action | Simple, actionable signal — no complex scoring needed in Phase 1 |

---

## Out of Scope (Phase 1)

- Time-series / trend charts (week-over-week pipeline changes)
- Per-owner leaderboard / attribution
- Export to CSV or PDF
- Cohort analysis (how long deals take to close per type)
- Grant success rate by funder
- Dashboard widget integration (keep Dashboard and Analytics separate for now)

---

## Environment Variables

No new variables required.
