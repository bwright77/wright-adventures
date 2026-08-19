import type { FitAssessment } from './discovery/fitRubric'
// ============================================================
// OMP — Shared TypeScript types (mirrors DB schema)
// ============================================================

export type UserRole = 'admin' | 'manager' | 'member' | 'viewer'
export type OpportunityTypeId = 'partnership' | 'lead'
export type TaskStatus = 'not_started' | 'in_progress' | 'complete' | 'blocked'
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

// `opportunities.ai_score_detail` holds a FitAssessment (ADR-011).
// The canonical shape lives in src/lib/discovery/fitRubric.ts.
export type ScoreDetail = FitAssessment

export interface DiscoveryRun {
  id: string
  started_at: string
  completed_at: string | null
  triggered_by: 'cron' | 'manual'
  status: 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
  source_type: 'sources'
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
  source_type:            string    // 'procurement' | 'job_board' | 'foundation_rfp' | 'sector_board'
  fetch_mode:             'html' | 'wp_rest' | 'sitemap'
  item_url_pattern:       string | null
  max_items_per_run:      number
  publisher:              string
  url:                    string
  enabled:                boolean
  check_frequency:        string    // 'daily' | 'weekly' | 'monthly'
  eligibility_notes:      string | null
  relevance_notes:        string | null
  last_content_text:      string | null
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
  // Partnership-specific
  partner_org: string | null
  primary_contact: string | null
  contact_email: string | null
  contact_phone: string | null
  /** What WA is selling — see src/lib/serviceLines.ts. Replaced partnership_type. */
  service_lines: string[]
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

// ── Partnership CRM (ADR-006) ─────────────────────────────────

export type CompanySize = '1-10' | '11-50' | '51-200' | '201-500' | '501-1000' | '1000+'
export type DealConfidence = 'low' | 'medium' | 'high'
export type QualificationStatus = 'unqualified' | 'partially_qualified' | 'qualified'
export type InteractionType =
  | 'call' | 'meeting' | 'email' | 'message' | 'demo'
  | 'proposal_sent' | 'contract_sent' | 'note' | 'other'
export type InteractionDirection = 'inbound' | 'outbound' | 'internal'

/** How an engagement is priced. Non-paid work is excluded from sales metrics. */
export type EngagementNature =
  | 'paid' | 'reduced_rate' | 'portfolio' | 'pro_bono'
  /** Below market by design, with an expected INDIRECT return — the Confluence
   *  fiscal-agent network, where digital work feeds grants that fund tech support. */
  | 'strategic'

/** Post-win lifecycle, orthogonal to pipeline status. */
export type DeliveryStatus = 'in_delivery' | 'supporting' | 'complete' | 'dormant'

export interface PartnershipDetails {
  opportunity_id: string
  engagement_nature: EngagementNature
  delivery_status: DeliveryStatus
  /** NUMERIC — Supabase JS returns a string. Coerce with Number(). */
  list_value: number | null
  qualification_status: QualificationStatus
  qualification_notes: string | null
  pain_points: string | null
  next_action: string | null
  next_action_date: string | null
  confidence: DealConfidence | null
  expected_close_date: string | null
  lost_reason: string | null
  org_size: CompanySize | null
  tech_stack_notes: string | null
  ai_solution_summary: string | null
  ai_solution_updated_at: string | null
  logo_url: string | null
  created_at: string
  updated_at: string
}

export interface PartnershipContact {
  id: string
  opportunity_id: string
  full_name: string
  title: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  is_primary: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PartnershipInteraction {
  id: string
  opportunity_id: string
  contact_id: string | null
  interaction_type: InteractionType
  direction: InteractionDirection
  subject: string | null
  notes: string
  occurred_at: string
  logged_by: string | null
  created_at: string
  updated_at: string
  // Joined (optional)
  contact?: Pick<PartnershipContact, 'id' | 'full_name'>
  logger?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>
}

export interface PartnershipStageTask {
  id: string
  stage_id: string
  title: string
  assignee_role: 'owner' | 'contributor' | 'leadership'
  days_after_entry: number
  sort_order: number
  created_at: string
}

export interface ScrapeResult {
  extracted: {
    organization_name?: string
    primary_contact_name?: string
    primary_contact_title?: string
    contact_email?: string
    contact_phone?: string
    project_description?: string
    estimated_budget?: number
    timeline_notes?: string
    technology_systems_mentioned?: string
    key_pain_points?: string
    partnership_type_hint?: string
    tags?: string[]
    logo_url?: string
  }
  confidence: 'high' | 'medium' | 'low'
  raw_excerpt: string
}

// ── AI Solution Advisor (ADR-007) ────────────────────────────

export interface AdvisorRecommendedService {
  service: string
  rationale: string
  priority: 'primary' | 'secondary'
}

export interface AdvisorRecommendation {
  fit_score: 1 | 2 | 3 | 4 | 5 | null
  fit_rationale: string
  recommended_services: AdvisorRecommendedService[]
  talking_points: string[]
  open_questions: string[]
  watch_outs: string[]
  generated_at: string
}

export interface AdvisorResponse {
  recommendation?: AdvisorRecommendation
  cached: boolean
  error?: string
  message?: string
}

// ── Opportunity Discovery (ADR-011) ───────────────────────────

// 1:1 extension of `opportunities` for type_id = 'lead'.
// Mirrors the partnership_details pattern from ADR-006.
export interface LeadDetails {
  opportunity_id:   string
  source_kind:      'rfp' | 'contract' | 'job' | null
  publisher:        string | null
  location:         string | null
  remote:           boolean
  engagement_type:  string | null
  compensation_raw: string | null
  /** NUMERIC — Supabase JS returns a string. Coerce with Number(). */
  comp_min:         number | null
  comp_max:         number | null
  posted_date:      string | null
  closes_date:      string | null
  apply_url:        string | null
  requirements:     string | null
  created_at:       string
  updated_at:       string
}

/**
 * A candidate discovery dropped (ADR-011). Deliberately NOT an opportunity:
 * never pursued, no owner, no pipeline. Exists so an empty review queue can be
 * told apart from a broken pipeline.
 */
export type RejectionReason = 'below_threshold' | 'duplicate' | 'unscorable' | 'incomplete'

export interface DiscoveryRejection {
  id:               string
  run_id:           string | null
  source_id:        string | null
  reason:           RejectionReason
  name:             string | null
  publisher:        string | null
  url:              string | null
  source_kind:      string | null
  engagement_raw:   string | null
  compensation_raw: string | null
  /** NULL for duplicates and incomplete extractions — dropped before scoring. */
  score:            number | null
  score_detail:     ScoreDetail | null
  created_at:       string
}

/**
 * Warm-path network, editable from Settings and injected into the fit-scoring
 * prompt (ADR-011). Closed-won clients merge in automatically and need no row.
 */
export interface OrgRelationship {
  id:         string
  org:        string
  basis:      string
  /** 'direct' = client or principal history (rubric 3). 'network' = via someone (rubric 2). */
  tier:       'direct' | 'network'
  via:        string | null
  is_active:  boolean
  notes:      string | null
  created_at: string
  updated_at: string
}
