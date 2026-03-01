# ADR-004: Board Meeting Minutes Generator

**Project:** Wright Adventures — Opportunity Management Platform (OMP)
**Author:** Benjamin Wright, Director of Technology & Innovation
**Date:** 2026-02-28
**Status:** Proposed
**PRD Reference:** OMP PRD v2.0, Phase 2 — Collaboration & Intelligence / Phase 3 — Platform

---

## Context

Confluence Colorado, the 501(c)(3) programmatic arm of Wright Adventures, holds monthly board meetings via Google Meet. The organization currently operates without a dedicated secretary, meaning formal board minutes are either not consistently produced or created ad-hoc by whoever takes notes. This creates three compounding risks:

1. **Legal / compliance exposure.** Colorado nonprofit law (C.R.S. § 7-128-120) requires that corporations keep minutes of board meetings as part of their official records. For a federally tax-exempt organization, minutes are primary evidence that governance obligations are being met — IRS audits, grant due diligence, and state registration renewals all reference board records.

2. **Institutional memory loss.** Motions passed, financial authorizations, and strategic decisions are not being systematically captured and stored in a retrievable format.

3. **Board member burden.** Without a secretary, individual board members are improvising coverage, producing inconsistently formatted output that varies meeting to meeting.

Google Meet's built-in transcription (available via Google Workspace) produces `.vtt` or `.txt` transcript files. These are dense, verbatim, speaker-labeled records that contain everything needed to produce formal minutes — but they require significant human parsing time to extract the structured elements a legal record requires.

This ADR documents the decision to build a **Board Meeting Minutes Generator** as an integrated OMP module that accepts a Google Meet transcript, uses Claude AI to extract and structure the canonical elements of nonprofit board minutes, enables human review and editing, stores the finalized minutes as organizational records, and exports a formatted DOCX.

**Architectural constraint:** Same stack as ADR-001 through ADR-003 — React 19 + Vite SPA on Vercel, Supabase backend. New functionality must fit within this pattern without introducing new infrastructure categories.

---

## Decision

Build a `BoardMeeting` module within OMP that implements a **transcript-in / minutes-out** pipeline using Claude AI for extraction, with a human review and approval step before records are finalized.

The module integrates into OMP as a first-class record type (alongside `opportunities`) with its own Supabase table, route, and UI — rather than as a standalone tool — because board meeting records are organizational documents that benefit from the same access control, audit logging, and document storage infrastructure already in place.

**Key architectural choices:**

| Decision | Choice | Rationale |
|---|---|---|
| AI extraction model | Claude Sonnet (same as ADR-001) | Consistent API client; Sonnet has sufficient context window for long transcripts and strong instruction-following for structured output |
| Extraction output format | Structured JSON via system prompt | Enables field-by-field rendering in the UI editor rather than free-form text editing |
| Human review step | Required, not optional | Minutes are legal documents; no auto-publish path |
| Approval mechanism | Named `approved_by` field + `approved_at` timestamp | Mirrors real-world secretary/chair signature; creates audit trail |
| Storage | Supabase `board_meetings` table + existing Storage for transcript files | Consistent with existing data architecture |
| Export | DOCX via `docx` npm package (same as existing grant writing export) | Board members expect Word documents; consistent with organizational document workflow |
| Google Drive sync | Deferred to Phase 2 of this feature | OAuth complexity out of scope for initial implementation; export-and-upload is acceptable for MVP |

---

## Data Model

Migration: `supabase/migrations/20260228100000_board_meetings.sql`

```sql
CREATE TABLE board_meetings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  meeting_date      DATE NOT NULL,
  meeting_start     TIME,
  meeting_end       TIME,
  location          TEXT NOT NULL DEFAULT 'Virtual (Google Meet)',

  -- Transcript
  transcript_file_path  TEXT,           -- Supabase Storage path to uploaded .vtt/.txt
  transcript_raw        TEXT,           -- Raw transcript text (may be pasted directly)

  -- AI extraction output (structured JSON)
  extracted_data    JSONB,              -- See schema below
  extraction_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (extraction_status IN ('pending', 'processing', 'complete', 'failed')),
  extraction_error  TEXT,

  -- Editing / approval
  edited_data       JSONB,             -- Human-edited version of extracted_data; null until first edit
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'under_review', 'approved')),
  approved_by       UUID REFERENCES auth.users(id),
  approved_at       TIMESTAMPTZ,

  -- Metadata
  created_by        UUID NOT NULL REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger to keep updated_at current
CREATE TRIGGER board_meetings_updated_at
  BEFORE UPDATE ON board_meetings
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Index for org + date lookups (most common query pattern)
CREATE INDEX board_meetings_org_date_idx ON board_meetings (org_id, meeting_date DESC);
```

**RLS:**
- `admin` and `manager` roles: full read/write
- `member` role: read-only (can view finalized minutes, cannot edit or approve)
- `viewer` role (board members): read-only on `status = 'approved'` records only

**`extracted_data` / `edited_data` JSONB schema:**

```json
{
  "meeting_info": {
    "date": "2026-02-28",
    "start_time": "09:00",
    "end_time": "10:15",
    "location": "Virtual (Google Meet)",
    "called_to_order_by": "Shane Wright"
  },
  "attendance": {
    "directors_present": ["Shane Wright", "Vivian Cervantes", "..."],
    "directors_absent": ["..."],
    "guests": ["..."],
    "quorum_met": true,
    "quorum_note": null       // populated if AI cannot confirm quorum
  },
  "prior_minutes": {
    "reviewed": true,
    "approved": true,
    "corrections": null
  },
  "reports": [
    {
      "title": "Executive Director Report",
      "presenter": "Shane Wright",
      "summary": "...",
      "action_required": false
    }
  ],
  "motions": [
    {
      "id": "M-001",
      "description": "...",
      "moved_by": "...",
      "seconded_by": "...",
      "discussion_summary": "...",
      "vote": {
        "yes": 4,
        "no": 0,
        "abstain": 0,
        "result": "PASSED"
      }
    }
  ],
  "action_items": [
    {
      "description": "...",
      "assigned_to": "...",
      "due_date": "2026-03-15"
    }
  ],
  "next_meeting": {
    "date": "2026-03-28",
    "time": "09:00",
    "location": "Virtual (Google Meet)"
  },
  "adjournment_time": "10:15",
  "ai_flags": [
    // Non-blocking warnings surfaced to the human reviewer
    "Quorum could not be confirmed — director count in transcript is ambiguous",
    "Motion M-001 vote tally was not explicitly stated; inferred from context"
  ]
}
```

The `ai_flags` array is critical: the AI must be instructed to flag uncertainty rather than guess silently. These flags render as prominent warnings in the review UI.

---

## Claude Extraction Prompt

The extraction prompt is the most sensitive component of this feature. It must produce deterministic structured output, explicitly flag ambiguity, and never fabricate information that isn't in the transcript.

**System prompt (stored in `src/lib/boardMinutes/extractionPrompt.ts`):**

```
You are a nonprofit board secretary assistant. Your task is to parse a raw meeting transcript and extract structured data for formal board meeting minutes.

CRITICAL RULES:
1. Extract only information that is explicitly stated in the transcript. Never infer, fabricate, or fill in missing information.
2. If any required element (quorum, vote tally, motion language, who moved/seconded) is ambiguous or absent, add a descriptive entry to the "ai_flags" array. Do not guess.
3. Return ONLY a valid JSON object matching the provided schema. No preamble, no explanation, no markdown fencing.
4. For motions, capture the exact language used as closely as possible.
5. For vote tallies, only record explicit counts. If the transcript says "approved by unanimous vote" without a count, record result: "PASSED (unanimous)" and yes/no/abstain as null.
6. Speaker names may appear inconsistently in the transcript (e.g., "Shane" vs. "Shane Wright"). Normalize to full names where possible using context.

The output must conform exactly to this JSON schema:
[schema inserted at runtime]
```

The schema is injected at runtime (not hardcoded in the prompt) so it can evolve independently.

**Streaming:** Use the same Vercel AI SDK streaming pattern established in ADR-001. The extraction call is typically 1,000–3,000 output tokens; streaming provides UI responsiveness for longer meetings.

**Token budget:** A 90-minute Google Meet transcript averages ~15,000–20,000 tokens of input. Claude Sonnet's 200K context window handles this comfortably. Estimated cost per extraction: ~$0.06–0.10 at current Sonnet pricing.

---

## Implementation Plan

### Phase 1: Core Pipeline (MVP)

**Sprint scope:** Transcript upload → AI extraction → human edit → approve → DOCX export.

#### 1. Supabase

- Run migration above
- Add `board_meetings` Storage bucket (private, service role access only)
- Extend RLS policies on `board_meetings` as specified

#### 2. API Layer

**`/api/board-minutes/extract.ts`** — Vercel Serverless Function:

```
POST /api/board-minutes/extract
Body: { meetingId: string }

1. Fetch board_meeting row; verify extraction_status = 'pending'
2. Set extraction_status = 'processing'
3. Load transcript from transcript_raw or fetch transcript_file_path from Storage
4. Build extraction prompt with schema injected
5. Call Claude Sonnet via Vercel AI SDK (streaming)
6. Parse and validate JSON response
7. Write extracted_data to board_meetings row; set extraction_status = 'complete'
8. On error: set extraction_status = 'failed', write extraction_error
```

Authentication: Supabase JWT required (same pattern as ADR-001/002). No unauthenticated access.

#### 3. Frontend Routes

```
/admin/board-meetings                   → List view: all meetings, sortable by date, filterable by status
/admin/board-meetings/new               → Upload/paste transcript, set meeting metadata
/admin/board-meetings/:id               → Detail: extracted data editor + approval controls
/admin/board-meetings/:id/export        → Trigger DOCX export (or inline button on detail page)
```

#### 4. New Meeting Flow (UI)

1. **Step 1 — Meeting Info:** Date, approximate start/end, location (pre-filled "Virtual (Google Meet)"), org (pre-selected for single-org users)
2. **Step 2 — Transcript:** File upload (`.vtt`, `.txt`) OR paste raw text. Character count shown. Max 500KB file / ~400,000 characters.
3. **Submit** → creates `board_meetings` row, triggers `/api/board-minutes/extract`, shows processing state
4. Redirect to detail page on completion

#### 5. Detail Page / Review UI

The review UI renders `edited_data ?? extracted_data` (edited version takes precedence once any edit is made) as a structured form — not a raw JSON editor. Sections:

- **⚠️ AI Flags** — prominent banner listing all `ai_flags` entries; must be resolved or explicitly dismissed before approval is enabled
- **Meeting Info** — editable fields
- **Attendance** — editable attendee lists; quorum status calculated dynamically from director count
- **Prior Minutes** — approval status toggle
- **Reports** — expandable/collapsible list; add/remove/reorder
- **Motions** — most critical section; full edit capability per motion including vote tallies; motion IDs auto-assigned (M-001, M-002, etc.)
- **Action Items** — table with description, assigned to, due date; add/remove rows
- **Next Meeting** — editable date/time/location
- **Adjournment** — time field

All edits write to `edited_data` in real time (debounced, 2s). No "save" button required — follows the same autosave pattern as the grant writing AI interface (ADR-001).

**Approval controls** (admin/manager only):
- "Mark as Under Review" → sets status = `under_review`; visible to all roles
- "Approve Minutes" → sets status = `approved`, `approved_by` = current user ID, `approved_at` = now()
- Approval is blocked while any `ai_flags` entries remain unresolved

**Unresolved flag resolution:** Each flag has a "Acknowledge & Dismiss" toggle. Dismissing a flag logs the dismissal in `edited_data.ai_flags_dismissed` with user ID and timestamp. This creates an explicit record that a human reviewed the concern.

#### 6. DOCX Export

Uses the `docx` npm package (already available via ADR-001 grant writing export).

Output document structure:
```
[Confluence Colorado letterhead — name, address, logo]

BOARD MEETING MINUTES
[Meeting Date] | [Location]

ATTENDANCE
Directors Present: [list]
Directors Absent: [list]
Quorum: [Met / Not Met — N of M directors present]

CALL TO ORDER
Meeting called to order at [time] by [name].

APPROVAL OF PRIOR MINUTES
Minutes of [prior meeting date] were [reviewed and approved / reviewed with corrections].

REPORTS
[Report title] — [Presenter]
[Summary]

MOTIONS
Motion M-001: [Full motion text]
  Moved by: [Name] | Seconded by: [Name]
  Discussion: [Summary]
  Vote: Yes — N | No — N | Abstain — N | RESULT: PASSED/FAILED

ACTION ITEMS
[Table: Description | Assigned To | Due Date]

NEXT MEETING
[Date, Time, Location]

ADJOURNMENT
Meeting adjourned at [time].

_________________________________    ________________
Approved by                          Date
[approved_by display name]           [approved_at date]
```

The signature line uses the `approved_by` name and `approved_at` date from the database record, providing a lightweight but defensible record of who approved the minutes and when.

---

### Phase 2 of This Feature (Deferred)

- **Google Drive sync** — automatically upload approved minutes PDF/DOCX to a designated Confluence Colorado Drive folder; requires Google OAuth (already partially in place from grant discovery work)
- **Board member access portal** — a `/board` route with Viewer-role accounts for board members to view approved minutes without OMP admin access
- **Prior minutes cross-reference** — when extracting a new meeting, fetch the prior meeting's `approved_data` and include it in context so the AI can better identify "approval of prior minutes" language
- **Action item tracking** — carry open action items from prior meetings into the extraction context; flag items that appear to be closed vs. still open
- **Audio upload** — accept Google Meet `.mp4` recording and run through Whisper transcription before extraction (eliminates the transcript export step)

---

## Risks & Tradeoffs

| Risk | Impact | Mitigation |
|---|---|---|
| AI fabricates meeting content | Legal record is inaccurate; could invalidate a motion or misrepresent a vote | System prompt explicitly prohibits fabrication; human review is mandatory; `ai_flags` surface uncertainty; extraction prompt uses JSON schema validation |
| Google Meet transcript quality | Poor transcription accuracy → AI extraction errors | Surface raw transcript alongside extracted data so reviewers can cross-reference; accept manual paste as alternative to file upload |
| Quorum ambiguity | Minutes approved without confirmed quorum; actions taken may be invalid | AI flags ambiguous quorum automatically; approval UI shows quorum status prominently; reviewer must acknowledge any quorum flag before approving |
| Speaker name inconsistency | Director names normalized incorrectly | AI normalization is best-effort; attendance list is fully editable; reviewer corrects before approval |
| Transcript contains sensitive content | Data sent to Anthropic API | Anthropic API does not train on API inputs (confirmed by usage policy); inform Shane of this before deploying; consider whether any meeting content is sensitive enough to warrant additional controls |
| Long transcripts exceed practical review time | Reviewer rubber-stamps AI output without reading | AI flags draw attention to specific concerns; structured field-by-field layout is faster to review than prose; cannot fully mitigate — human accountability is the user's responsibility |
| DOCX signature line is not a wet signature | Insufficient for some purposes (e.g., bank authorizations requiring wet signatures) | DOCX is for official record-keeping; physical or DocuSign signature can be applied to printed export if required; out of scope for this ADR |

---

## Out of Scope

- Zoom or Teams transcript formats (Google Meet only for MVP; format normalization can be added later)
- Multi-organization support (Confluence Colorado is the sole board for MVP)
- Board member voting via OMP (minutes record votes taken in the meeting; OMP does not conduct votes)
- Parliamentary procedure engine (Roberts Rules compliance checking)
- Public-facing minutes publication

---

## Related Documents

- [ADR-001: AI-Assisted Grant Writing](./ADR-001-ai-grant-writing.md)
- [ADR-002: Grant Discovery Pipeline](./ADR-002-grant-discovery-pipeline.md)
- [ADR-003: Email Notifications](./ADR-003-email-notifications.md)
- [OMP PRD v2.0](./OMP_PRD_v2) — Phase 2 / Phase 3 scope
- Colorado Revised Statutes § 7-128-120 (Corporate Records)
- Anthropic API Usage Policy (data handling): https://www.anthropic.com/legal/aup
- App: `https://wright-adventures.vercel.app/`
