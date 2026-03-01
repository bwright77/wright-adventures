-- =============================================================================
-- Migration: 20260228100000_board_meetings.sql
-- Phase 2 — Board Meeting Minutes Generator
-- ADR Reference: ADR-004-board-minutes.md
-- Author: Benjamin Wright, Director of Technology & Innovation
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Board meetings table
--    Stores transcript, AI-extracted data, human edits, and approval state.
--    Single-tenant: no org_id (Confluence Colorado is the sole org for MVP).
-- -----------------------------------------------------------------------------

CREATE TABLE board_meetings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Meeting metadata
  meeting_date          DATE NOT NULL,
  meeting_start         TIME,
  meeting_end           TIME,
  location              TEXT NOT NULL DEFAULT 'Virtual (Google Meet)',

  -- Transcript input
  transcript_file_path  TEXT,   -- Supabase Storage path to uploaded .vtt/.txt file
  transcript_raw        TEXT,   -- Raw transcript text (pasted directly or extracted from file)

  -- AI extraction pipeline
  extracted_data        JSONB,  -- Output from Claude extraction (see ADR-004 for schema)
  extraction_status     TEXT NOT NULL DEFAULT 'pending'
                        CHECK (extraction_status IN ('pending', 'processing', 'complete', 'failed')),
  extraction_error      TEXT,

  -- Human editing and approval
  edited_data           JSONB,  -- Human-edited version of extracted_data; null until first edit
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'under_review', 'approved')),
  approved_by           UUID REFERENCES auth.users(id),
  approved_at           TIMESTAMPTZ,

  -- Audit
  created_by            UUID NOT NULL REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  board_meetings IS 'Board meeting minutes records for Confluence Colorado. Transcript → AI extraction → human review → approval pipeline.';
COMMENT ON COLUMN board_meetings.extracted_data IS 'Structured JSON from Claude extraction. Schema: {meeting_info, attendance, prior_minutes, reports[], motions[], action_items[], next_meeting, adjournment_time, ai_flags[]}';
COMMENT ON COLUMN board_meetings.edited_data    IS 'Human-edited version of extracted_data. Null until the reviewer makes their first edit. Takes precedence over extracted_data in the UI.';
COMMENT ON COLUMN board_meetings.status         IS 'draft: created, not yet under review | under_review: submitted for approval | approved: formally approved by admin/manager';

-- Auto-update updated_at
CREATE TRIGGER board_meetings_updated_at
  BEFORE UPDATE ON board_meetings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Most-recent-first index (primary query pattern for the list view)
CREATE INDEX board_meetings_date_idx ON board_meetings (meeting_date DESC);

-- Index for status-based filtering
CREATE INDEX board_meetings_status_idx ON board_meetings (status);

-- -----------------------------------------------------------------------------
-- 2. RLS Policies
--    admin + manager: full read/write
--    member: read-only (all records)
--    viewer: read-only on approved records only
-- -----------------------------------------------------------------------------

ALTER TABLE board_meetings ENABLE ROW LEVEL SECURITY;

-- Admins and managers: full access
CREATE POLICY "Admins and managers full access to board_meetings"
  ON board_meetings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'manager')
    )
  );

-- Members: read-only (all records)
CREATE POLICY "Members read all board_meetings"
  ON board_meetings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'member'
    )
  );

-- Viewers: read-only, approved records only
CREATE POLICY "Viewers read approved board_meetings"
  ON board_meetings
  FOR SELECT
  USING (
    status = 'approved'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'viewer'
    )
  );

-- Service role: full access (used by API extraction endpoint)
CREATE POLICY "Service role full access to board_meetings"
  ON board_meetings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 3. Storage bucket for transcript files
--    Private bucket — access via service role only.
--    Files are fetched server-side by the extraction API, never served directly.
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'board-meeting-transcripts',
  'board-meeting-transcripts',
  false,
  524288,  -- 512 KB limit
  ARRAY['text/plain', 'text/vtt', 'text/x-vtt']
)
ON CONFLICT (id) DO NOTHING;

-- Only service role can read/write transcript files
CREATE POLICY "Service role access to board-meeting-transcripts"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'board-meeting-transcripts')
  WITH CHECK (bucket_id = 'board-meeting-transcripts');

-- Authenticated users can upload their own transcript files
CREATE POLICY "Authenticated users upload transcripts"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'board-meeting-transcripts'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'manager')
    )
  );
