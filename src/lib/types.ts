// ============================================================
// OMP — Shared TypeScript types (mirrors DB schema)
// ============================================================

export type UserRole = 'admin' | 'manager' | 'member' | 'viewer'
export type OpportunityTypeId = 'grant' | 'partnership'
export type TaskStatus = 'not_started' | 'in_progress' | 'complete' | 'blocked'
export type GrantType = 'federal' | 'state' | 'foundation' | 'corporate' | 'other'
export type PartnershipType = 'mou' | 'joint_program' | 'coalition' | 'referral' | 'in_kind' | 'other'
export type DocType =
  | 'proposal' | 'budget' | 'loi' | 'agreement' | 'supporting'
  | 'award_letter' | 'report' | 'correspondence' | 'other'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface PipelineStatus {
  id: string
  type_id: OpportunityTypeId
  label: string
  sort_order: number
  is_active: boolean
}

export interface ScoreDetail {
  scores: {
    mission_alignment: number
    geographic_eligibility: number
    applicant_eligibility: number
    award_size_fit: number
    population_alignment: number
  }
  weighted_score: number
  auto_rejected: boolean
  auto_reject_reason: string | null
  rationale: string
  red_flags: string[]
  recommended_action: 'apply' | 'investigate' | 'skip'
}

export interface DiscoveryRun {
  id: string
  started_at: string
  completed_at: string | null
  triggered_by: 'cron' | 'manual'
  status: 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
  source_type: 'federal' | 'state'   // Added ADR-005; DEFAULT 'federal' fills existing rows
  opportunities_fetched: number
  opportunities_deduplicated: number
  opportunities_detail_fetched: number
  opportunities_auto_rejected: number
  opportunities_below_threshold: number
  opportunities_inserted: number
  tokens_haiku: number | null
  tokens_sonnet: number | null
  error_log: Array<{ label: string; error: string; timestamp: string }> | null
  org_profile_id: string | null
}

// ── State & Local Discovery (ADR-005) ─────────────────────────

export interface DiscoverySource {
  id:                     string
  label:                  string
  source_type:            string    // 'state' | 'local' | 'foundation' | 'federal_api'
  funder_name:            string
  url:                    string
  enabled:                boolean
  check_frequency:        string    // 'daily' | 'weekly' | 'monthly'
  eligibility_notes:      string | null
  relevance_notes:        string | null
  source_proximity_bonus: number    // NUMERIC(3,1); Supabase JS returns as string, coerce at use site
  last_content_hash:      string | null
  last_fetched_at:        string | null
  last_changed_at:        string | null
  last_error:             string | null
  consecutive_errors:     number
  created_at:             string
  updated_at:             string
}

export interface Opportunity {
  id: string
  type_id: OpportunityTypeId
  name: string
  description: string | null
  status: string
  owner_id: string | null
  primary_deadline: string | null
  source_url: string | null
  tags: string[]
  // Grant-specific
  funder: string | null
  grant_type: GrantType | null
  amount_max: number | null
  amount_requested: number | null
  amount_awarded: number | null
  loi_deadline: string | null
  cfda_number: string | null
  eligibility_notes: string | null
  // Partnership-specific
  partner_org: string | null
  primary_contact: string | null
  contact_email: string | null
  contact_phone: string | null
  partnership_type: PartnershipType | null
  mutual_commitments: string | null
  agreement_date: string | null
  renewal_date: string | null
  estimated_value: number | null
  alignment_notes: string | null
  // Metadata
  created_by: string | null
  created_at: string
  updated_at: string
  // Discovery fields (Phase 3 — ADR-002)
  source: string | null
  external_id: string | null
  external_url: string | null
  ai_match_score: number | null
  ai_match_rationale: string | null
  ai_score_detail: ScoreDetail | null
  auto_discovered: boolean
  discovered_at: string | null
  // Joined (optional)
  owner?: Profile
}

export interface Task {
  id: string
  opportunity_id: string
  title: string
  status: TaskStatus
  assignee_id: string | null
  due_date: string | null
  days_offset: number | null
  sort_order: number
  created_at: string
  updated_at: string
  // Joined (optional)
  assignee?: Profile
  opportunity?: Pick<Opportunity, 'id' | 'name' | 'type_id'>
}

export interface TaskTemplate {
  id: string
  type_id: OpportunityTypeId
  name: string
  is_default: boolean
  created_at: string
  items?: TaskTemplateItem[]
}

export interface TaskTemplateItem {
  id: string
  template_id: string
  title: string
  days_offset: number
  assignee_role: 'owner' | 'contributor' | 'leadership'
  sort_order: number
}

export interface ActivityEntry {
  id: string
  opportunity_id: string
  actor_id: string | null
  action: string
  details: Record<string, unknown> | null
  created_at: string
  actor?: Profile
}

export interface Document {
  id: string
  opportunity_id: string
  name: string
  doc_type: DocType
  storage_path: string
  file_size: number | null
  mime_type: string | null
  version: number
  uploaded_by: string | null
  created_at: string
}

// ── Notifications (ADR-003) ───────────────────────────────────

export type NotificationType =
  | 'deadline_7d' | 'deadline_3d' | 'deadline_1d'
  | 'task_assigned'
  | 'opportunity_discovered'

export interface NotificationPreference {
  id: string
  user_id: string
  deadline_7d: boolean
  deadline_3d: boolean
  deadline_1d: boolean
  task_assigned: boolean
  opportunity_discovered: boolean
  updated_at: string
}

export interface NotificationLog {
  id: string
  user_id: string | null
  notification_type: NotificationType
  opportunity_id: string | null
  task_id: string | null
  sent_at: string
  sent_date: string
  success: boolean
  error_message: string | null
  email_to: string
}

// ── Board Meetings (ADR-004) ──────────────────────────────────

export type BoardMeetingStatus = 'draft' | 'under_review' | 'approved'
export type ExtractionStatus = 'pending' | 'processing' | 'complete' | 'failed'

export interface BoardMeetingReport {
  title: string
  presenter: string
  summary: string
  action_required: boolean
}

export interface BoardMeetingVote {
  yes: number | null
  no: number | null
  abstain: number | null
  result: string  // e.g. "PASSED", "FAILED", "PASSED (unanimous)"
}

export interface BoardMeetingMotion {
  id: string  // e.g. "M-001"
  description: string
  moved_by: string
  seconded_by: string
  discussion_summary: string
  vote: BoardMeetingVote
}

export interface BoardMeetingActionItem {
  description: string
  assigned_to: string
  due_date: string | null
}

export interface BoardMeetingExtractedData {
  meeting_info: {
    date: string
    start_time: string | null
    end_time: string | null
    location: string
    called_to_order_by: string | null
  }
  attendance: {
    directors_present: string[]
    directors_absent: string[]
    guests: string[]
    quorum_met: boolean | null
    quorum_note: string | null
  }
  prior_minutes: {
    reviewed: boolean
    approved: boolean
    corrections: string | null
  }
  reports: BoardMeetingReport[]
  motions: BoardMeetingMotion[]
  action_items: BoardMeetingActionItem[]
  next_meeting: {
    date: string | null
    time: string | null
    location: string | null
  }
  adjournment_time: string | null
  ai_flags: string[]
  ai_flags_dismissed?: Array<{
    flag: string
    dismissed_by: string
    dismissed_at: string
  }>
}

export interface BoardMeeting {
  id: string
  meeting_date: string
  meeting_start: string | null
  meeting_end: string | null
  location: string
  transcript_file_path: string | null
  transcript_raw: string | null
  extracted_data: BoardMeetingExtractedData | null
  extraction_status: ExtractionStatus
  extraction_error: string | null
  edited_data: BoardMeetingExtractedData | null
  status: BoardMeetingStatus
  approved_by: string | null
  approved_at: string | null
  created_by: string
  created_at: string
  updated_at: string
  // Joined (optional)
  approver?: Profile
  creator?: Profile
}
