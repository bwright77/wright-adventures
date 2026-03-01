// ============================================================
// Board Meeting Minutes — AI Extraction Prompt
// ADR Reference: ADR-004-board-minutes.md
// ============================================================

export const EXTRACTION_SYSTEM_PROMPT = `You are a nonprofit board secretary assistant. Your task is to parse a raw meeting transcript and extract structured data for formal board meeting minutes.

CRITICAL RULES:
1. Extract only information that is explicitly stated in the transcript. Never infer, fabricate, or fill in missing information.
2. If any required element (quorum, vote tally, motion language, who moved/seconded) is ambiguous or absent, add a descriptive entry to the "ai_flags" array. Do not guess.
3. Return ONLY a valid JSON object matching the provided schema. No preamble, no explanation, no markdown fencing.
4. For motions, capture the exact language used as closely as possible.
5. For vote tallies, only record explicit counts. If the transcript says "approved by unanimous vote" without a count, record result: "PASSED (unanimous)" and yes/no/abstain as null.
6. Speaker names may appear inconsistently in the transcript (e.g., "Shane" vs. "Shane Wright"). Normalize to full names where possible using context.
7. If the transcript does not contain enough information to populate a required field, use null for optional fields. Add an ai_flag describing what is missing.
8. The ai_flags array is critical for legal defensibility. When in doubt, flag it — do not silently omit uncertain data.`

// JSON schema injected into the prompt at runtime.
// Kept as a string so it can be updated independently of the system prompt.
export const EXTRACTED_DATA_SCHEMA = JSON.stringify({
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
  reports: [
    {
      title: "string",
      presenter: "string",
      summary: "string — concise summary of key points",
      action_required: "boolean"
    }
  ],
  motions: [
    {
      id: "M-001, M-002, etc. — sequential",
      description: "Full text of the motion as stated",
      moved_by: "string — full name",
      seconded_by: "string — full name",
      discussion_summary: "string — brief summary of discussion, or empty string if none",
      vote: {
        yes: "integer or null",
        no: "integer or null",
        abstain: "integer or null",
        result: "PASSED | FAILED | PASSED (unanimous) | FAILED (unanimous) | TABLED | etc."
      }
    }
  ],
  action_items: [
    {
      description: "string",
      assigned_to: "string — full name or role",
      due_date: "YYYY-MM-DD string or null"
    }
  ],
  next_meeting: {
    date: "YYYY-MM-DD string or null",
    time: "HH:MM string or null",
    location: "string or null"
  },
  adjournment_time: "HH:MM string or null",
  ai_flags: ["string array — each entry describes one ambiguity, missing element, or inference made"]
}, null, 2)

export function buildExtractionPrompt(transcript: string): string {
  return `${EXTRACTION_SYSTEM_PROMPT}

The output must conform exactly to this JSON schema:
${EXTRACTED_DATA_SCHEMA}

Now parse the following transcript:

---
${transcript}
---`
}
