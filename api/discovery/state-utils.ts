import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// =============================================================================
// state-utils.ts — Pure utility functions for the state/local grant monitoring
// pipeline (ADR-005). All functions except isDuplicate are side-effect-free and
// independently testable. No fetch calls, no Supabase calls in the pure fns.
// =============================================================================

// ── Types ─────────────────────────────────────────────────────────────────────

/** Opportunity candidate returned by the Haiku extraction stage. */
export interface ExtractedOpportunity {
  name:                string
  funder:              string
  description:         string
  deadline:            string | null
  amount_range:        string | null
  eligibility_summary: string
  relevance_rationale: string
  confidence:          'high' | 'medium' | 'low'
  url:                 string | null
}

// ── 1. extractPageText ────────────────────────────────────────────────────────

/**
 * Converts raw HTML to normalized plain text for hashing and AI extraction.
 *
 * Strategy (per ADR-005 §2 — Text Extraction Strategy):
 *   - Strips <script> and <style> blocks entirely
 *   - Inserts newlines at block-level closing tags to preserve paragraph breaks
 *   - Strips all remaining HTML tags
 *   - Decodes common HTML entities (no DOM available in Node.js runtime)
 *   - Normalizes runs of whitespace and blank lines
 *
 * Deliberately avoids DOM parsing or CSS selectors so the extraction is
 * resilient to site redesigns. The AI layer interprets the resulting prose.
 */
export function extractPageText(html: string): string {
  // 1. Remove <script> and <style> blocks entirely (including their content)
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')

  // 2. Replace closing block-level tags with newlines to preserve structure
  text = text.replace(/<\/(p|div|li|tr|th|td|h[1-6]|section|article|header|footer|nav|main|aside|blockquote|figure|figcaption)>/gi, '\n')

  // 3. Treat <br> as newlines
  text = text.replace(/<br\s*\/?>/gi, '\n')

  // 4. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ')

  // 5. Decode HTML entities
  text = decodeHTMLEntities(text)

  // 6. Normalize horizontal whitespace (spaces and tabs) within lines
  text = text.replace(/[ \t]+/g, ' ')

  // 7. Trim leading/trailing whitespace from each line
  text = text
    .split('\n')
    .map(line => line.trim())
    .join('\n')

  // 8. Collapse 3+ consecutive blank lines to at most 2
  text = text.replace(/\n{3,}/g, '\n\n')

  return text.trim()
}

/**
 * Decodes common HTML entities without relying on a DOM parser.
 * Covers named entities for punctuation/typography plus numeric (decimal and
 * hex) character references.
 */
function decodeHTMLEntities(text: string): string {
  const named: Record<string, string> = {
    '&amp;':    '&',
    '&lt;':     '<',
    '&gt;':     '>',
    '&quot;':   '"',
    '&apos;':   "'",
    '&nbsp;':   ' ',
    '&mdash;':  '—',
    '&ndash;':  '–',
    '&lsquo;':  '\u2018',
    '&rsquo;':  '\u2019',
    '&ldquo;':  '\u201C',
    '&rdquo;':  '\u201D',
    '&hellip;': '…',
    '&bull;':   '•',
    '&copy;':   '©',
    '&reg;':    '®',
    '&trade;':  '™',
    '&deg;':    '°',
    '&frac12;': '½',
    '&eacute;': 'é',
    '&agrave;': 'à',
    '&aacute;': 'á',
    '&ntilde;': 'ñ',
  }

  // Named entities (longest-match: table lookup, fallback to original)
  let result = text.replace(/&[a-zA-Z]+;/g, match => named[match] ?? match)

  // Decimal numeric references: &#123;
  result = result.replace(/&#(\d+);/g, (_, code: string) =>
    String.fromCodePoint(parseInt(code, 10)),
  )

  // Hex numeric references: &#x7B; or &#X7B;
  result = result.replace(/&#[xX]([0-9a-fA-F]+);/g, (_, code: string) =>
    String.fromCodePoint(parseInt(code, 16)),
  )

  return result
}

// ── 2. computeContentHash ─────────────────────────────────────────────────────

/**
 * Returns the SHA-256 hex digest of the given text string (UTF-8 encoded).
 * Used to detect meaningful content changes between weekly fetches without
 * storing the full page text in every comparison.
 */
export function computeContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// ── 3. computeTextDiff ────────────────────────────────────────────────────────

/**
 * Produces a compact line-level diff between two text documents.
 *
 * Output is formatted for injection into an AI extraction prompt — it shows
 * which non-empty lines were added and which were removed since the last fetch.
 * Order within each group mirrors the order of first appearance in the
 * respective document.
 *
 * Lines present in both documents are omitted (context-free diff). This keeps
 * the diff short while giving the AI the signal it needs: "here is what
 * changed since last week."
 *
 * Capped at MAX_DIFF_LINES total output lines to prevent prompt bloat when a
 * page is substantially rewritten.
 */
export function computeTextDiff(oldText: string, newText: string): string {
  const MAX_DIFF_LINES = 200

  const oldLines = splitNonEmpty(oldText)
  const newLines = splitNonEmpty(newText)

  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)

  // Preserve order: iterate source arrays, keep only lines absent from the
  // opposite set. Deduplicate within each group (a repeated removed line only
  // appears once).
  const seenRemoved = new Set<string>()
  const removed: string[] = []
  for (const line of oldLines) {
    if (!newSet.has(line) && !seenRemoved.has(line)) {
      removed.push(line)
      seenRemoved.add(line)
    }
  }

  const seenAdded = new Set<string>()
  const added: string[] = []
  for (const line of newLines) {
    if (!oldSet.has(line) && !seenAdded.has(line)) {
      added.push(line)
      seenAdded.add(line)
    }
  }

  if (removed.length === 0 && added.length === 0) {
    return '(no significant line-level changes)'
  }

  const parts: string[] = []

  if (removed.length > 0) {
    parts.push(`REMOVED (${removed.length} line${removed.length !== 1 ? 's' : ''}):`)
    for (const line of removed.slice(0, MAX_DIFF_LINES)) {
      parts.push(`- ${line}`)
    }
    if (removed.length > MAX_DIFF_LINES) {
      parts.push(`  … and ${removed.length - MAX_DIFF_LINES} more removed lines (truncated)`)
    }
  }

  if (added.length > 0) {
    if (parts.length > 0) parts.push('')
    parts.push(`ADDED (${added.length} line${added.length !== 1 ? 's' : ''}):`)
    for (const line of added.slice(0, MAX_DIFF_LINES)) {
      parts.push(`+ ${line}`)
    }
    if (added.length > MAX_DIFF_LINES) {
      parts.push(`  … and ${added.length - MAX_DIFF_LINES} more added lines (truncated)`)
    }
  }

  return parts.join('\n')
}

/** Splits text into non-empty, trimmed lines. */
function splitNonEmpty(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
}

// ── 4. isDuplicate ────────────────────────────────────────────────────────────

/**
 * Returns true if a matching opportunity already exists in the database.
 *
 * Strategy (per ADR-005 §4 — Deduplication Strategy):
 *   1. Exact funder match — reduces the candidate pool to the same funder
 *   2. Normalized name similarity via Dice coefficient > 0.75 threshold
 *   3. Year stripping in normalization catches recurring cycles
 *      ("CDPHE EJ 2024" ≈ "CDPHE EJ 2026")
 *
 * Uses the service-role Supabase client passed in from the cron handler —
 * this function never creates its own client.
 */
export async function isDuplicate(
  candidate: ExtractedOpportunity,
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data: existing, error } = await supabase
    .from('opportunities')
    .select('id, name, funder')
    .eq('funder', candidate.funder)
    .eq('type_id', 'grant')

  if (error) {
    console.warn('isDuplicate query error:', error.message)
    // Fail open — don't block insertion on a query error
    return false
  }

  if (!existing?.length) return false

  const candidateNorm = normalizeGrantName(candidate.name)

  return existing.some(opp => {
    const similarity = diceCoefficient(normalizeGrantName(opp.name as string), candidateNorm)
    return similarity > 0.75
  })
}

// ── Exported helpers (separately testable) ────────────────────────────────────

/**
 * Normalizes a grant program name for fuzzy comparison.
 *
 * Transformations (per ADR-005 §4):
 *   - Lowercase
 *   - Strip year suffixes in parentheses: "(2025)", "(FY2026)", "(2024-25)"
 *   - Strip non-alphanumeric characters (except spaces)
 *   - Collapse whitespace
 */
export function normalizeGrantName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(fy\d{2,4}(?:-\d{2,4})?\)/g, '') // (FY2026), (FY24-25)
    .replace(/\(\d{4}(?:-\d{2,4})?\)/g, '')       // (2025), (2024-25)
    .replace(/\bfy\d{2,4}\b/g, '')                  // bare FY2026 without parens
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Dice coefficient (bigram overlap) string similarity — returns a value in
 * [0, 1] where 1 is identical and 0 is no shared bigrams.
 *
 * Chosen over Levenshtein for this use case because:
 *   - O(n) space and time (vs O(n*m) for Levenshtein)
 *   - Handles transpositions and word-reordering gracefully
 *   - Well-suited to short strings like grant program names
 *
 * Empty or single-character strings that share no bigrams return 0.
 */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  // Build a frequency map of bigrams from `a`
  const bigramsA = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.slice(i, i + 2)
    bigramsA.set(bigram, (bigramsA.get(bigram) ?? 0) + 1)
  }

  // Count intersecting bigrams with `b`, consuming from the frequency map to
  // handle repeated bigrams correctly
  let intersections = 0
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.slice(i, i + 2)
    const count = bigramsA.get(bigram) ?? 0
    if (count > 0) {
      bigramsA.set(bigram, count - 1)
      intersections++
    }
  }

  // Dice: 2 * |intersection| / (|A| + |B|) where sizes are bigram counts
  return (2 * intersections) / (a.length - 1 + b.length - 1)
}
