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
