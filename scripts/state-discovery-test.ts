/**
 * Wright Adventures — State & Local Grant Discovery: Pipeline Validation Script
 *
 * Runs the complete state monitoring pipeline end-to-end against live pages.
 * DRY RUN — does NOT insert opportunities, update source records, or modify
 * any database rows.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
 *   npx tsx scripts/state-discovery-test.ts
 *
 *   # Test a single source (case-insensitive label substring match):
 *   npx tsx scripts/state-discovery-test.ts --source GOCO
 *   npx tsx scripts/state-discovery-test.ts --source cwcb
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
 * ADR Reference: ADR-005-state-local-grant-discovery.md
 */

import { createClient }   from "@supabase/supabase-js";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText }    from "ai";
import { createHash }      from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Environment & CLI
// ─────────────────────────────────────────────────────────────────────────────

const SUPABASE_URL      = process.env.SUPABASE_URL           ?? "";
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY      ?? "";

const missing: string[] = [];
if (!SUPABASE_URL)      missing.push("SUPABASE_URL");
if (!SUPABASE_KEY)      missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (!ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
if (missing.length) {
  console.error(`\n❌  Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// --source <label-substring> to test a single source
const sourceArgIdx  = process.argv.indexOf("--source");
const sourceFilter  = sourceArgIdx !== -1 ? process.argv[sourceArgIdx + 1] : undefined;

// ─────────────────────────────────────────────────────────────────────────────
// Clients
// ─────────────────────────────────────────────────────────────────────────────

const supabase  = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = createAnthropic({ apiKey: ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface DiscoverySource {
  id:                     string;
  label:                  string;
  funder_name:            string;
  url:                    string;
  eligibility_notes:      string | null;
  relevance_notes:        string | null;
  source_proximity_bonus: string;  // NUMERIC returned as string by Supabase
  last_content_hash:      string | null;
}

interface ExtractedOpportunity {
  name:                string;
  funder:              string;
  description:         string;
  deadline:            string | null;
  amount_range:        string | null;
  eligibility_summary: string;
  relevance_rationale: string;
  confidence:          "high" | "medium" | "low";
  url:                 string | null;
}

interface ExtractionResponse {
  opportunities:   ExtractedOpportunity[];
  page_summary:    string;
  notable_changes: string | null;
}

interface ScoreResult {
  scores: {
    mission_alignment:      number;
    geographic_eligibility: number;
    applicant_eligibility:  number;
    award_size_fit:         number;
    population_alignment:   number;
  };
  weighted_score:      number;
  auto_rejected:       boolean;
  auto_reject_reason:  string | null;
  rationale:           string;
  red_flags:           string[];
  recommended_action: "apply" | "investigate" | "skip";
}

// Per-source accumulator for the final summary table
interface SourceSummary {
  label:          string;
  fetchMs:        number;
  httpStatus:     number | null;
  textChars:      number;
  hashShort:      string;
  candidates:     number;
  avgRawScore:    number | null;
  avgAdjScore:    number | null;
  wouldInsert:    number;
  duplicates:     number;
  fetchError:     string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure utility functions (inlined from api/discovery/state-utils.ts)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PAGE_TEXT_CHARS = 100_000;
const SCORE_THRESHOLD     = 5.0;

function decodeHTMLEntities(text: string): string {
  const named: Record<string, string> = {
    "&amp;": "&",  "&lt;": "<",    "&gt;": ">",    "&quot;": '"',
    "&apos;": "'", "&nbsp;": " ",  "&mdash;": "—", "&ndash;": "–",
    "&lsquo;": "\u2018", "&rsquo;": "\u2019",
    "&ldquo;": "\u201C", "&rdquo;": "\u201D",
    "&hellip;": "…", "&bull;": "•", "&copy;": "©", "&deg;": "°",
  };
  let r = text.replace(/&[a-zA-Z]+;/g, m => named[m] ?? m);
  r = r.replace(/&#(\d+);/g,       (_, c: string) => String.fromCodePoint(parseInt(c, 10)));
  r = r.replace(/&#[xX]([0-9a-fA-F]+);/g, (_, c: string) => String.fromCodePoint(parseInt(c, 16)));
  return r;
}

function extractPageText(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<\/(p|div|li|tr|th|td|h[1-6]|section|article|header|footer|nav|main|aside|blockquote)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeHTMLEntities(text);
  text = text.replace(/[ \t]+/g, " ");
  text = text.split("\n").map(l => l.trim()).join("\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

function computeContentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeGrantName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(fy\d{2,4}(?:-\d{2,4})?\)/g, "")
    .replace(/\(\d{4}(?:-\d{2,4})?\)/g, "")
    .replace(/\bfy\d{2,4}\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) ?? 0) + 1);
  }
  let intersections = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const n  = bigramsA.get(bg) ?? 0;
    if (n > 0) { bigramsA.set(bg, n - 1); intersections++; }
  }
  return (2 * intersections) / (a.length - 1 + b.length - 1);
}

function parseJson<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page fetch (single retry on any error, per ADR-005 §1a)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<{ html: string; status: number; ms: number }> {
  const headers = {
    "User-Agent": "WrightAdventuresOMP/1.0 Grant Discovery Test (+https://wrightadventures.org)",
    "Accept":     "text/html,application/xhtml+xml,*/*",
  };

  async function attempt(): Promise<{ html: string; status: number }> {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { html: await res.text(), status: res.status };
  }

  const t0 = Date.now();
  try {
    const result = await attempt();
    return { ...result, ms: Date.now() - t0 };
  } catch {
    await new Promise(r => setTimeout(r, 2_000));
    const result = await attempt();
    return { ...result, ms: Date.now() - t0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Haiku extraction prompt (ADR-005 §3)
// ─────────────────────────────────────────────────────────────────────────────

function buildExtractionPrompt(source: DiscoverySource, pageText: string): string {
  let promptText     = pageText;
  let truncationNote = "";
  if (pageText.length > MAX_PAGE_TEXT_CHARS) {
    promptText     = pageText.slice(0, MAX_PAGE_TEXT_CHARS);
    truncationNote = `\n[NOTE: Page text truncated to first ${MAX_PAGE_TEXT_CHARS.toLocaleString()} of ${pageText.length.toLocaleString()} characters.]\n`;
  }

  return `You are analyzing a Colorado state/local government grant funding page for potential grant opportunities relevant to a conservation and youth development nonprofit.

SOURCE: ${source.funder_name}
SOURCE URL: ${source.url}
ELIGIBILITY CONTEXT: ${source.eligibility_notes ?? "No specific notes."}
RELEVANCE CONTEXT: ${source.relevance_notes ?? "No specific notes."}

ORGANIZATION CONTEXT:
Confluence Colorado is a 501(c)(3) focused on: watershed protection (South Platte), youth career pathways, environmental justice, outdoor recreation access, and urban agriculture. Based in Denver, Colorado.

PAGE CONTENT:
${truncationNote}${promptText}

TASK: Extract any grant opportunities from this page that could be relevant to Confluence Colorado. Return a JSON object with this exact shape:

{
  "opportunities": [
    {
      "name": "Program name",
      "funder": "${source.funder_name}",
      "description": "Brief description of the program",
      "deadline": "Application deadline if stated (ISO date preferred, or descriptive text), or null",
      "amount_range": "Funding range if stated, or null",
      "eligibility_summary": "Who can apply and any partnership requirements",
      "relevance_rationale": "Why this is relevant to Confluence Colorado",
      "confidence": "high | medium | low",
      "url": "Direct URL to program page if identifiable, or null"
    }
  ],
  "page_summary": "Brief summary of what this page contains (1-2 sentences)",
  "notable_changes": null
}

If no relevant opportunities are found, return an empty opportunities array.
Only include opportunities with medium or high confidence of relevance.
Return ONLY valid JSON — no preamble, explanation, or markdown fences.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication check (ADR-005 §4) — read-only
// ─────────────────────────────────────────────────────────────────────────────

async function checkDuplicate(
  name: string,
  funder: string,
): Promise<{ isDuplicate: boolean; matchedName: string | null; similarity: number }> {
  const { data } = await supabase
    .from("opportunities")
    .select("name")
    .eq("funder", funder)
    .eq("type_id", "grant");

  if (!data?.length) return { isDuplicate: false, matchedName: null, similarity: 0 };

  const candidateNorm = normalizeGrantName(name);
  let bestMatch: string | null = null;
  let bestSim = 0;

  for (const row of data) {
    const sim = diceCoefficient(normalizeGrantName(row.name as string), candidateNorm);
    if (sim > bestSim) { bestSim = sim; bestMatch = row.name as string; }
  }

  return {
    isDuplicate:  bestSim > 0.75,
    matchedName:  bestSim > 0.75 ? bestMatch : null,
    similarity:   Math.round(bestSim * 100),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  const LINE  = "─".repeat(78);
  const DLINE = "═".repeat(78);

  console.log(`\n${DLINE}`);
  console.log("  WRIGHT ADVENTURES — State & Local Grant Discovery Pipeline Validation");
  console.log(`  ADR-005  ·  Dry run — no database writes`);
  console.log(`  Date: ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`);
  if (sourceFilter) console.log(`  Filter: --source "${sourceFilter}"`);
  console.log(`${DLINE}\n`);

  // ── Load discovery sources ─────────────────────────────────────────────────
  console.log("Loading discovery sources from Supabase…");
  const { data: allSources, error: srcErr } = await supabase
    .from("discovery_sources")
    .select("id, label, funder_name, url, eligibility_notes, relevance_notes, source_proximity_bonus, last_content_hash")
    .order("label", { ascending: true });

  if (srcErr || !allSources?.length) {
    console.error(`\n❌  Could not load discovery_sources: ${srcErr?.message ?? "no rows returned"}`);
    console.error("    Have you run the 20260302000000_state_discovery_sources.sql migration?");
    process.exit(1);
  }

  const sources = (sourceFilter
    ? allSources.filter(s => s.label.toLowerCase().includes(sourceFilter.toLowerCase()))
    : allSources) as DiscoverySource[];

  if (!sources.length) {
    console.error(`\n❌  No sources matched --source "${sourceFilter}"`);
    console.error(`    Available: ${allSources.map((s: { label: string }) => s.label).join(", ")}`);
    process.exit(1);
  }

  console.log(`✓  Found ${allSources.length} sources in DB, testing ${sources.length}\n`);

  // ── Load org profile for Sonnet scoring ───────────────────────────────────
  console.log("Loading active org profile for scoring…");
  const { data: orgProfile } = await supabase
    .from("org_profiles")
    .select("prompt_text")
    .eq("is_active", true)
    .maybeSingle();

  if (!orgProfile) {
    console.warn("⚠   No active org profile found — Sonnet scoring will be skipped.\n");
  } else {
    console.log("✓  Org profile loaded\n");
  }

  const summaries: SourceSummary[] = [];

  // ── Process each source ────────────────────────────────────────────────────
  for (let si = 0; si < sources.length; si++) {
    const source = sources[si];
    const bonus  = Number(source.source_proximity_bonus);

    console.log(`\n${DLINE}`);
    console.log(`  SOURCE ${si + 1}/${sources.length}: ${source.label}`);
    console.log(`  Funder : ${source.funder_name}`);
    console.log(`  URL    : ${source.url}`);
    console.log(`  Bonus  : +${bonus} (source proximity)`);
    console.log(`${DLINE}`);

    const summary: SourceSummary = {
      label:       source.label,
      fetchMs:     0,
      httpStatus:  null,
      textChars:   0,
      hashShort:   "",
      candidates:  0,
      avgRawScore: null,
      avgAdjScore: null,
      wouldInsert: 0,
      duplicates:  0,
      fetchError:  null,
    };

    // ── Step 1: Fetch & extract ──────────────────────────────────────────────
    console.log(`\n  [1/3] Fetching page…`);
    let pageText: string;
    let hash: string;

    try {
      const { html, status, ms } = await fetchPage(source.url);
      summary.httpStatus = status;
      summary.fetchMs    = ms;

      pageText        = extractPageText(html);
      hash            = computeContentHash(pageText);
      summary.textChars = pageText.length;
      summary.hashShort = hash.slice(0, 12);

      console.log(`        ✓ HTTP ${status} in ${(ms / 1000).toFixed(1)}s`);
      console.log(`        Text length : ${pageText.length.toLocaleString()} chars`);
      console.log(`        SHA-256     : ${hash.slice(0, 12)}…`);

      if (source.last_content_hash) {
        const changed = hash !== source.last_content_hash;
        console.log(`        vs. stored  : ${changed ? "⚡ CHANGED" : "✓ unchanged (same hash)"}`);
      } else {
        console.log(`        vs. stored  : (no prior hash — first check)`);
      }

      console.log(`\n        First 500 chars of extracted text:`);
      console.log(`        ${LINE}`);
      const preview = pageText.slice(0, 500).replace(/\n/g, "\n        ");
      console.log(`        ${preview}${pageText.length > 500 ? "…" : ""}`);
      console.log(`        ${LINE}`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.fetchError = msg;
      console.log(`        ❌ Fetch failed: ${msg}`);
      summaries.push(summary);
      continue;
    }

    if (pageText.length > MAX_PAGE_TEXT_CHARS) {
      console.log(`\n  ⚠   Page text (${pageText.length.toLocaleString()} chars) exceeds ${MAX_PAGE_TEXT_CHARS.toLocaleString()} char limit`);
      console.log(`      Haiku prompt will use first ${MAX_PAGE_TEXT_CHARS.toLocaleString()} chars`);
    }

    // ── Step 2: Haiku extraction ─────────────────────────────────────────────
    console.log(`\n  [2/3] Running Haiku extraction…`);
    let extraction: ExtractionResponse | null = null;
    let haikuTokens = 0;

    try {
      const t0 = Date.now();
      const { text, usage } = await generateText({
        model:           anthropic("claude-haiku-4-5-20251001"),
        prompt:          buildExtractionPrompt(source, pageText),
        maxOutputTokens: 4096,
        abortSignal:     AbortSignal.timeout(60_000),
      });
      haikuTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);

      // Try object wrapper first, fall back to bare array
      extraction = parseJson<ExtractionResponse>(text);
      if (!extraction?.opportunities) {
        const arr = text.match(/\[[\s\S]*\]/);
        if (arr) {
          try {
            const opps = JSON.parse(arr[0]) as ExtractedOpportunity[];
            extraction = { opportunities: opps, page_summary: "", notable_changes: null };
          } catch { /* ignore */ }
        }
      }

      const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);
      if (!extraction) {
        console.log(`        ❌ Haiku returned unparseable JSON (${elapsedS}s, ${haikuTokens.toLocaleString()} tokens)`);
        console.log(`        Raw response (first 400 chars): ${text.slice(0, 400)}`);
        summaries.push(summary);
        continue;
      }

      const filtered = extraction.opportunities.filter(
        o => o.confidence === "high" || o.confidence === "medium",
      );
      summary.candidates = filtered.length;

      console.log(`        ✓ ${elapsedS}s · ${haikuTokens.toLocaleString()} tokens (input + output)`);
      console.log(`        Page summary: "${extraction.page_summary}"`);
      if (extraction.notable_changes) {
        console.log(`        Notable changes: ${extraction.notable_changes}`);
      }
      console.log(`        Candidates (all confidence): ${extraction.opportunities.length}`);
      console.log(`        High/medium confidence: ${filtered.length}`);

      if (extraction.opportunities.length === 0) {
        console.log(`\n        (No opportunities extracted from this page)`);
        summaries.push(summary);
        continue;
      }

      // Log all candidates including low-confidence ones for visibility
      console.log();
      for (let ci = 0; ci < extraction.opportunities.length; ci++) {
        const c = extraction.opportunities[ci];
        const tag = c.confidence === "low" ? " [LOW CONF — skipped in real run]" : "";
        console.log(`        Candidate ${ci + 1}: ${c.name}${tag}`);
        console.log(`          Confidence : ${c.confidence.toUpperCase()}`);
        console.log(`          Deadline   : ${c.deadline ?? "not stated"}`);
        console.log(`          Amount     : ${c.amount_range ?? "not stated"}`);
        console.log(`          Eligible   : ${c.eligibility_summary.slice(0, 120)}${c.eligibility_summary.length > 120 ? "…" : ""}`);
        console.log(`          Rationale  : ${c.relevance_rationale.slice(0, 140)}${c.relevance_rationale.length > 140 ? "…" : ""}`);
        if (c.url) console.log(`          URL        : ${c.url}`);
      }

      // ── Step 3: Sonnet scoring + dedup ──────────────────────────────────────
      console.log(`\n  [3/3] Scoring ${filtered.length} candidate(s) with Sonnet + dedup check…`);

      if (!orgProfile) {
        console.log(`        ⚠  Skipped — no active org profile in DB`);
        summaries.push(summary);
        continue;
      }

      const rawScores: number[] = [];
      const adjScores: number[] = [];

      for (const candidate of filtered) {
        console.log(`\n        ${LINE.slice(0, 60)}`);
        console.log(`        ${candidate.name}`);
        console.log(`        ${LINE.slice(0, 60)}`);

        // Sonnet scoring
        const scoringPayload = {
          name:              candidate.name,
          funder:            candidate.funder,
          grant_type:        "state",
          description:       candidate.description,
          amount_max:        null,
          amount_range_text: candidate.amount_range,
          primary_deadline:  candidate.deadline,
          eligibility_notes: candidate.eligibility_summary,
        };

        let score: ScoreResult | null = null;
        let sonnetTokens = 0;
        const t1 = Date.now();
        try {
          const { text: scoreText, usage: scoreUsage } = await generateText({
            model:           anthropic("claude-sonnet-4-6"),
            prompt:          `${orgProfile.prompt_text}\n\nOPPORTUNITY TO SCORE:\n${JSON.stringify(scoringPayload, null, 2)}`,
            maxOutputTokens: 1024,
            abortSignal:     AbortSignal.timeout(60_000),
          });
          sonnetTokens = (scoreUsage.inputTokens ?? 0) + (scoreUsage.outputTokens ?? 0);
          score = parseJson<ScoreResult>(scoreText);
        } catch (err) {
          console.log(`          ❌ Sonnet error: ${err instanceof Error ? err.message : err}`);
        }

        const elapsedS = ((Date.now() - t1) / 1000).toFixed(1);

        if (!score) {
          console.log(`          ❌ Scoring failed (${elapsedS}s)`);
        } else {
          const s      = score.scores;
          const raw    = score.weighted_score;
          const adj    = Math.min(10.0, raw + bonus);
          const passes = !score.auto_rejected && adj >= SCORE_THRESHOLD;

          rawScores.push(raw);
          adjScores.push(adj);
          if (passes) summary.wouldInsert++;

          console.log(`          Scores    : Mission ${s.mission_alignment} | Geo ${s.geographic_eligibility} | Eligible ${s.applicant_eligibility} | Size ${s.award_size_fit} | Pop ${s.population_alignment}`);
          console.log(`          AI score  : ${raw.toFixed(1)}/10.0${score.auto_rejected ? " ⛔ AUTO-REJECTED" : ""}`);
          console.log(`          + Bonus   : +${bonus} (source proximity)`);
          console.log(`          Final     : ${adj.toFixed(1)}/10.0  ${passes ? `✓ above ${SCORE_THRESHOLD} threshold` : `✗ below ${SCORE_THRESHOLD} threshold`}`);
          console.log(`          Action    : ${score.recommended_action.toUpperCase()}`);
          if (score.red_flags.length) {
            console.log(`          Red flags : ${score.red_flags.join("; ")}`);
          }
          console.log(`          Rationale : ${score.rationale.slice(0, 160)}${score.rationale.length > 160 ? "…" : ""}`);
          console.log(`          (Sonnet: ${elapsedS}s, ${sonnetTokens.toLocaleString()} tokens)`);
        }

        // Dedup check
        try {
          const { isDuplicate, matchedName, similarity } = await checkDuplicate(
            candidate.name,
            candidate.funder,
          );
          if (isDuplicate) {
            summary.duplicates++;
            console.log(`          Dedup     : ⚠  DUPLICATE — matches "${matchedName}" (${similarity}% similarity)`);
          } else {
            console.log(`          Dedup     : ✓  NEW (no match in existing opportunities)`);
          }
        } catch (err) {
          console.log(`          Dedup     : ⚠  Check failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Accumulate scores into summary
      if (rawScores.length) {
        summary.avgRawScore = rawScores.reduce((a, b) => a + b, 0) / rawScores.length;
        summary.avgAdjScore = adjScores.reduce((a, b) => a + b, 0) / adjScores.length;
      }

    } catch (err) {
      console.log(`        ❌ Haiku error: ${err instanceof Error ? err.message : err}`);
    }

    summaries.push(summary);
  }

  // ── Final summary table ─────────────────────────────────────────────────────
  console.log(`\n\n${DLINE}`);
  console.log("  PIPELINE VALIDATION SUMMARY");
  console.log(`${DLINE}`);
  console.log();

  const col = {
    label:   40,
    chars:    9,
    hash:    14,
    opps:     6,
    raw:      8,
    adj:      8,
    ins:      5,
    dup:      5,
  };

  const header =
    "  " +
    "Source".padEnd(col.label) +
    "Chars".padStart(col.chars) +
    "  Hash".padEnd(col.hash) +
    "Opps".padStart(col.opps) +
    "RawAvg".padStart(col.raw) +
    "AdjAvg".padStart(col.adj) +
    "  Ins".padStart(col.ins) +
    "  Dup".padStart(col.dup);

  console.log(header);
  console.log("  " + LINE.slice(0, header.length - 2));

  for (const s of summaries) {
    const chars  = s.fetchError ? "ERROR".padStart(col.chars) : s.textChars.toLocaleString().padStart(col.chars);
    const hash   = s.fetchError ? "—".padEnd(col.hash) : `${s.hashShort}…`.padEnd(col.hash);
    const opps   = s.candidates.toString().padStart(col.opps);
    const raw    = s.avgRawScore != null ? `${s.avgRawScore.toFixed(1)}`.padStart(col.raw) : "—".padStart(col.raw);
    const adj    = s.avgAdjScore != null ? `${s.avgAdjScore.toFixed(1)}`.padStart(col.adj) : "—".padStart(col.adj);
    const ins    = s.wouldInsert.toString().padStart(col.ins);
    const dup    = s.duplicates.toString().padStart(col.dup);

    console.log(
      "  " +
      s.label.slice(0, col.label).padEnd(col.label) +
      chars +
      "  " + hash +
      opps +
      raw +
      adj +
      "  " + ins +
      "  " + dup,
    );
  }

  console.log();
  console.log("  Columns: Opps = high/medium confidence candidates extracted by Haiku");
  console.log("           RawAvg = avg Sonnet weighted_score before proximity bonus");
  console.log("           AdjAvg = avg score after source_proximity_bonus applied");
  console.log(`           Ins = would be inserted (adj score ≥ ${SCORE_THRESHOLD}, no auto-reject)`);
  console.log("           Dup = would be skipped as duplicate in existing opportunities");
  console.log();

  const totalOpps    = summaries.reduce((a, s) => a + s.candidates, 0);
  const totalInsert  = summaries.reduce((a, s) => a + s.wouldInsert, 0);
  const totalDup     = summaries.reduce((a, s) => a + s.duplicates, 0);
  const totalErrors  = summaries.filter(s => s.fetchError).length;

  console.log(`  Sources tested : ${summaries.length}`);
  console.log(`  Fetch errors   : ${totalErrors}`);
  console.log(`  Total opps     : ${totalOpps} candidates (high/med confidence)`);
  console.log(`  Would insert   : ${totalInsert}`);
  console.log(`  Duplicates     : ${totalDup}`);

  if (totalErrors === 0 && totalOpps === 0) {
    console.log("\n  ℹ   No opportunities extracted — pages may not have updated since last check,");
    console.log("      or the content structure is significantly different from expected.");
    console.log("      Review the 'First 500 chars' output above to verify text extraction quality.");
  }

  console.log(`\n${DLINE}`);
  console.log("  ✅  Validation complete. No database rows were written.");
  console.log(`${DLINE}\n`);
}

run().catch(err => {
  console.error("\n❌  Unhandled error:", err);
  process.exit(1);
});
