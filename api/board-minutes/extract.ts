import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
// ── Prompt (inlined — Vercel doesn't bundle cross-src imports) ─
const EXTRACTION_SYSTEM_PROMPT = `You are a nonprofit board secretary assistant. Your task is to parse a raw meeting transcript and extract structured data for formal board meeting minutes.

CRITICAL RULES:
1. Extract only information that is explicitly stated in the transcript. Never infer, fabricate, or fill in missing information.
2. If any required element (quorum, vote tally, motion language, who moved/seconded) is ambiguous or absent, add a descriptive entry to the "ai_flags" array. Do not guess.
3. Return ONLY a valid JSON object matching the provided schema. No preamble, no explanation, no markdown fencing.
4. For motions, capture the exact language used as closely as possible.
5. For vote tallies, only record explicit counts. If the transcript says "approved by unanimous vote" without a count, record result: "PASSED (unanimous)" and yes/no/abstain as null.
6. Speaker names may appear inconsistently in the transcript (e.g., "Shane" vs. "Shane Wright"). Normalize to full names where possible using context.
7. If the transcript does not contain enough information to populate a required field, use null for optional fields. Add an ai_flag describing what is missing.
8. The ai_flags array is critical for legal defensibility. When in doubt, flag it — do not silently omit uncertain data.`

const EXTRACTED_DATA_SCHEMA = JSON.stringify({
  meeting_info: {
    date: "YYYY-MM-DD string",
    start_time: "HH:MM string or null",
    end_time: "HH:MM string or null",
    location: "string",
    called_to_order_by: "string or null"
  },
  attendance: {
    directors_present: ["string array of full names"],
    directors_absent: ["string array of full names, empty if none mentioned"],
    guests: ["string array of full names, empty if none"],
    quorum_met: "boolean or null if cannot be determined",
    quorum_note: "string explaining any quorum ambiguity, or null"
  },
  prior_minutes: {
    reviewed: "boolean",
    approved: "boolean",
    corrections: "string describing corrections, or null"
  },
  reports: [{ title: "string", presenter: "string", summary: "string — concise summary of key points", action_required: "boolean" }],
  motions: [{
    id: "M-001, M-002, etc. — sequential",
    description: "Full text of the motion as stated",
    moved_by: "string — full name",
    seconded_by: "string — full name",
    discussion_summary: "string — brief summary of discussion, or empty string if none",
    vote: { yes: "integer or null", no: "integer or null", abstain: "integer or null", result: "PASSED | FAILED | PASSED (unanimous) | FAILED (unanimous) | TABLED | etc." }
  }],
  action_items: [{ description: "string", assigned_to: "string — full name or role", due_date: "YYYY-MM-DD string or null" }],
  next_meeting: { date: "YYYY-MM-DD string or null", time: "HH:MM string or null", location: "string or null" },
  adjournment_time: "HH:MM string or null",
  ai_flags: ["string array — each entry describes one ambiguity, missing element, or inference made"]
}, null, 2)

function buildExtractionPrompt(transcript: string): string {
  return `${EXTRACTION_SYSTEM_PROMPT}

The output must conform exactly to this JSON schema:
${EXTRACTED_DATA_SCHEMA}

Now parse the following transcript:

---
${transcript}
---`
}

// ── Supabase (service role — server-side only) ────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── Anthropic ─────────────────────────────────────────────────
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ── Helpers ───────────────────────────────────────────────────

function parseJson<T>(text: string): T | null {
  // Strip markdown fencing if model wraps output despite instructions
  const stripped = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
  try {
    return JSON.parse(stripped) as T
  } catch {
    // Try to extract the first { ... } block as fallback
    const match = stripped.match(/\{[\s\S]*\}/)
    if (match) {
      try { return JSON.parse(match[0]) as T } catch { return null }
    }
    return null
  }
}

// ── Main handler ──────────────────────────────────────────────
// POST /api/board-minutes/extract
// Body: { meetingId: string }
// Auth: Supabase JWT (admin or manager required)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── 1. Auth ──────────────────────────────────────────────────
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }
  const jwt = authHeader.slice(7)

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  // Check role — only admin or manager can trigger extraction
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' })
  }

  // ── 2. Parse body ────────────────────────────────────────────
  const { meetingId } = req.body as { meetingId: string }
  if (!meetingId) {
    return res.status(400).json({ error: 'meetingId is required' })
  }

  // ── 3. Fetch board meeting row ───────────────────────────────
  const { data: meeting, error: fetchError } = await supabase
    .from('board_meetings')
    .select('id, extraction_status, transcript_raw, transcript_file_path')
    .eq('id', meetingId)
    .single()

  if (fetchError || !meeting) {
    return res.status(404).json({ error: 'Board meeting not found' })
  }

  if (meeting.extraction_status !== 'pending') {
    return res.status(409).json({
      error: `Cannot re-extract: current status is '${meeting.extraction_status}'`,
    })
  }

  // ── 4. Mark as processing ────────────────────────────────────
  await supabase
    .from('board_meetings')
    .update({ extraction_status: 'processing' })
    .eq('id', meetingId)

  // ── 5. Load transcript ───────────────────────────────────────
  let transcript = meeting.transcript_raw ?? ''

  if (!transcript && meeting.transcript_file_path) {
    const { data: fileData, error: fileError } = await supabase.storage
      .from('board-meeting-transcripts')
      .download(meeting.transcript_file_path)

    if (fileError || !fileData) {
      await supabase.from('board_meetings').update({
        extraction_status: 'failed',
        extraction_error: `Failed to download transcript file: ${fileError?.message ?? 'unknown error'}`,
      }).eq('id', meetingId)
      return res.status(422).json({ error: 'Failed to load transcript file' })
    }

    transcript = await fileData.text()
  }

  if (!transcript.trim()) {
    await supabase.from('board_meetings').update({
      extraction_status: 'failed',
      extraction_error: 'No transcript content found',
    }).eq('id', meetingId)
    return res.status(422).json({ error: 'No transcript content to extract from' })
  }

  // ── 6. Call Claude ───────────────────────────────────────────
  try {
    const prompt = buildExtractionPrompt(transcript)

    const { text } = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      prompt,
      maxTokens: 4096,
    })

    const extractedData = parseJson(text)

    if (!extractedData) {
      throw new Error('Claude returned output that could not be parsed as JSON')
    }

    // ── 7. Write results ─────────────────────────────────────────
    await supabase.from('board_meetings').update({
      extracted_data: extractedData,
      extraction_status: 'complete',
      extraction_error: null,
    }).eq('id', meetingId)

    return res.status(200).json({ ok: true, meetingId })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    await supabase.from('board_meetings').update({
      extraction_status: 'failed',
      extraction_error: errorMessage,
    }).eq('id', meetingId)

    return res.status(500).json({ error: 'Extraction failed', detail: errorMessage })
  }
}
