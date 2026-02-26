/**
 * Wright Adventures — Grant Discovery: API Validation Script
 *
 * Tests Simpler.Grants.gov API (v1) with WA-relevant query strategies.
 * Run locally: npx tsx grants-discovery-test.ts
 *
 * Requires: SIMPLER_GRANTS_API_KEY in environment
 * Get a free key at: https://simpler.grants.gov/developer
 *
 * API docs: https://wiki.simpler.grants.gov/product/api/search-opportunities
 */

const BASE_URL = "https://api.simpler.grants.gov";
const API_KEY = process.env.SIMPLER_GRANTS_API_KEY ?? "";

if (!API_KEY) {
  console.error("❌ SIMPLER_GRANTS_API_KEY not set. Get a free key at https://simpler.grants.gov/developer");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types (subset of API response schema)
// ─────────────────────────────────────────────────────────────────────────────

interface Opportunity {
  opportunity_id: string;
  opportunity_number: string;
  opportunity_title: string;
  agency_code: string;
  agency_name: string;
  post_date: string;
  close_date: string | null;
  opportunity_status: "forecasted" | "posted" | "closed" | "archived";
  funding_instrument: string;
  funding_category: string;
  award_floor: number | null;
  award_ceiling: number | null;
  estimated_total_program_funding: number | null;
  expected_number_of_awards: number | null;
  applicant_types: string[];
  summary: string | { summary_description?: string } | null;
  is_cost_sharing: boolean | null;
}

interface SearchResponse {
  message: string;
  data: Opportunity[];
  pagination_info: {
    page_offset: number;
    page_size: number;
    total_pages: number;
    total_records: number;
  };
  facet_counts?: Record<string, Record<string, number>>;
}

interface SearchPayload {
  query?: string;
  query_operator?: "AND" | "OR";
  filters?: {
    opportunity_status?: { one_of: string[] };
    funding_instrument?: { one_of: string[] };
    funding_category?: { one_of: string[] };
    applicant_type?: { one_of: string[] };
    top_level_agency?: { one_of: string[] };
    close_date?: { start_date?: string };
    award_ceiling?: { max?: number };
    award_floor?: { min?: number };
  };
  pagination: {
    page_offset: number;
    page_size: number;
    sort_order: { order_by: string; sort_direction: "ascending" | "descending" }[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core fetch wrapper
// ─────────────────────────────────────────────────────────────────────────────

async function search(label: string, payload: SearchPayload): Promise<SearchResponse | null> {
  console.log(`\n${"─".repeat(70)}`);
  console.log(`🔍  QUERY: ${label}`);
  console.log(`${"─".repeat(70)}`);

  const res = await fetch(`${BASE_URL}/v1/opportunities/search`, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌  HTTP ${res.status}: ${text}`);
    return null;
  }

  const data: SearchResponse = await res.json();
  const { pagination_info, data: opps } = data;

  console.log(`📊  Total matching: ${pagination_info.total_records} | Showing: ${opps.length}`);

  if (opps.length === 0) {
    console.log("   (no results)");
    return data;
  }

  opps.forEach((opp, i) => {
    const amount = opp.award_ceiling
      ? `$${opp.award_ceiling.toLocaleString()}`
      : opp.award_floor
      ? `$${opp.award_floor.toLocaleString()}+`
      : "amount unspecified";

    const deadline = opp.close_date ?? "no deadline";
    const status = opp.opportunity_status.toUpperCase();

    console.log(`\n  ${i + 1}. [${status}] ${opp.opportunity_title}`);
    console.log(`     Agency   : ${opp.agency_name} (${opp.agency_code})`);
    console.log(`     Amount   : ${amount}`);
    console.log(`     Deadline : ${deadline}`);
    console.log(`     Eligible : ${opp.applicant_types?.join(", ") || "not specified"}`);
    console.log(`     Category : ${opp.funding_category ?? "—"}`);
    if (opp.summary) {
      // API returns summary as an object — extract summary_description string
      const summaryText = typeof opp.summary === "string"
        ? opp.summary
        : (opp.summary as any)?.summary_description ?? JSON.stringify(opp.summary);
      const snip = summaryText.slice(0, 200).replace(/\n/g, " ");
      console.log(`     Summary  : ${snip}${summaryText.length > 200 ? "…" : ""}`);
    }
    console.log(`     URL      : https://simpler.grants.gov/opportunities/${opp.opportunity_id}`);
  });

  return data;
}


// ─────────────────────────────────────────────────────────────────────────────
// QUERY STRATEGY v2 — revised after 2026-02-26 validation run
//
// Key findings:
//   - Broad OR keyword (147 results): too noisy — human trafficking, clinical
//     research, nursing homes all matched on incidental keywords
//   - income_security_and_social_services: wrong taxonomy — maps to SNAP/
//     foster care, not youth development. Dropped.
//   - Exact keyword phrases ("watershed Colorado", "environmental justice"):
//     zero results — API matches on title/short desc only, not full NOFO text
//   - Agency + category filter (DOI/USDA/EPA): 2 results, both genuine fits
//     — highest precision approach
//
// REVISED STRATEGY: Agency-scoped + single-category. Avoid broad OR keywords.
// More queries with tighter scope > fewer queries with loose scope.
// ─────────────────────────────────────────────────────────────────────────────

// Correct enum values — validated 2026-02-26
const BASE_FILTERS = {
  opportunity_status: { one_of: ["posted", "forecasted"] },
  funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
  applicant_type: { one_of: ["nonprofits_non_higher_education_with_501c3"] },
};

async function runAll() {
  console.log("\n🏔️   WRIGHT ADVENTURES — GRANT DISCOVERY VALIDATION v2");
  console.log("    Simpler.Grants.gov (https://api.simpler.grants.gov/v1)");
  console.log(`    Date: ${new Date().toISOString().split("T")[0]}`);
  console.log("    Strategy: agency-scoped + single-category (revised)\n");

  // ── Q1: DOI — natural_resources ───────────────────────────────────────────
  await search("DOI — natural_resources", {
    filters: {
      ...BASE_FILTERS,
      top_level_agency: { one_of: ["DOI"] },
      funding_category: { one_of: ["natural_resources"] },
    },
    pagination: { page_offset: 1, page_size: 10,
      sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
  });

  // ── Q2: USDA — natural_resources + environment ────────────────────────────
  await search("USDA — natural_resources + environment", {
    filters: {
      ...BASE_FILTERS,
      top_level_agency: { one_of: ["USDA"] },
      funding_category: { one_of: ["natural_resources", "environment"] },
    },
    pagination: { page_offset: 1, page_size: 10,
      sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
  });

  // ── Q3: EPA — environment ─────────────────────────────────────────────────
  await search("EPA — environment", {
    filters: {
      ...BASE_FILTERS,
      top_level_agency: { one_of: ["EPA"] },
      funding_category: { one_of: ["environment"] },
    },
    pagination: { page_offset: 1, page_size: 10,
      sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
  });

  // ── Q4: DOL — employment_labor_and_training + keyword "youth" ────────────
  // YouthBuild was a genuine hit in v1. Scoped to DOL to cut noise.
  await search("DOL — employment_labor_and_training + 'youth'", {
    query: "youth",
    filters: {
      ...BASE_FILTERS,
      top_level_agency: { one_of: ["DOL"] },
      funding_category: { one_of: ["employment_labor_and_training"] },
    },
    pagination: { page_offset: 1, page_size: 10,
      sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
  });

  // ── Q5: AmeriCorps (CNCS) — community_development + education ────────────
  // Funds conservation corps and youth service programs — high fit for Confluence
  await search("AmeriCorps (CNCS) — community_development + education", {
    filters: {
      ...BASE_FILTERS,
      top_level_agency: { one_of: ["CNCS"] },
      funding_category: { one_of: ["community_development", "education"] },
    },
    pagination: { page_offset: 1, page_size: 10,
      sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
  });

  // ── Q6: HHS/ACF — community_development (urban ag / public health) ────────
  await search("HHS — community_development", {
    filters: {
      ...BASE_FILTERS,
      top_level_agency: { one_of: ["HHS"] },
      funding_category: { one_of: ["community_development"] },
    },
    pagination: { page_offset: 1, page_size: 10,
      sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
  });

  // ── Q7: DOI + USDA — education (outdoor/STREAM programs) ─────────────────
  await search("DOI + USDA — education", {
    filters: {
      ...BASE_FILTERS,
      top_level_agency: { one_of: ["DOI", "USDA"] },
      funding_category: { one_of: ["education"] },
    },
    pagination: { page_offset: 1, page_size: 10,
      sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
  });

  // ── Q8: All agencies — natural_resources (wide net, no agency filter) ─────
  await search("All agencies — natural_resources", {
    filters: {
      ...BASE_FILTERS,
      funding_category: { one_of: ["natural_resources"] },
    },
    pagination: { page_offset: 1, page_size: 10,
      sort_order: [{ order_by: "post_date", sort_direction: "descending" }] },
  });

  console.log(`\n${"═".repeat(70)}`);
  console.log("✅  Validation v2 complete.");
  console.log("\nNext: review signal quality per query, set score threshold,");
  console.log("then proceed to Step 4 — Supabase schema migration.");
  console.log(`${"═".repeat(70)}\n`);
}

runAll().catch(console.error);
