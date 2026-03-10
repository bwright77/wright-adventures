import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Calendar, Tag, ChevronDown, Pencil, UserCircle, Sparkles,
  Check, CheckCircle2,
} from 'lucide-react'
import { format, formatDistanceToNow, addDays } from 'date-fns'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { TaskPanel } from '../../components/admin/TaskPanel'
import { GrantChatPanel } from '../../components/admin/GrantChatPanel'
import { ContactsPanel } from '../../components/admin/ContactsPanel'
import { InteractionsLog } from '../../components/admin/InteractionsLog'
import { PartnershipAdvisorPanel } from '../../components/admin/PartnershipAdvisorPanel'
import type {
  Opportunity, ActivityEntry, Profile,
  PartnershipDetails, PartnershipStageTask,
  DealConfidence, QualificationStatus,
} from '../../lib/types'
import { toTelHref } from '../../lib/phone'

// ── Pipeline config ───────────────────────────────────────────
const GRANT_STAGES = [
  { id: 'grant_identified',   label: 'Identified'   },
  { id: 'grant_evaluating',   label: 'Evaluating'   },
  { id: 'grant_preparing',    label: 'Preparing'    },
  { id: 'grant_submitted',    label: 'Submitted'    },
  { id: 'grant_under_review', label: 'Under Review' },
  { id: 'grant_awarded',      label: 'Awarded'      },
]
const GRANT_TERMINAL = [
  { id: 'grant_declined',  label: 'Declined'  },
  { id: 'grant_withdrawn', label: 'Withdrawn' },
  { id: 'grant_archived',  label: 'Archived'  },
]

// ADR-006 — new 7-stage sales pipeline
const PARTNERSHIP_STAGES = [
  { id: 'partnership_prospecting', label: 'Prospecting' },
  { id: 'partnership_qualifying',  label: 'Qualifying'  },
  { id: 'partnership_discovery',   label: 'Discovery'   },
  { id: 'partnership_proposal',    label: 'Proposal'    },
  { id: 'partnership_negotiating', label: 'Negotiating' },
]
const PARTNERSHIP_TERMINAL = [
  { id: 'partnership_closed_won',  label: 'Closed-Won'  },
  { id: 'partnership_closed_lost', label: 'Closed-Lost' },
]

const GRANT_TEMPLATE_ID = '00000000-0000-0000-0000-000000000001'

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  [...GRANT_STAGES, ...GRANT_TERMINAL, ...PARTNERSHIP_STAGES, ...PARTNERSHIP_TERMINAL]
    .map(s => [s.id, s.label])
)

// ── Sub-components ────────────────────────────────────────────
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-3 border-b border-gray-50 last:border-0">
      <span className="text-xs font-medium text-gray-400 uppercase tracking-[0.07em] sm:w-40 shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-navy">{value}</span>
    </div>
  )
}

function PipelineStepper({
  stages, terminal, currentStatus, color, onSelect, isPending,
}: {
  stages:        { id: string; label: string }[]
  terminal:      { id: string; label: string }[]
  currentStatus: string
  color:         'river' | 'trail'
  onSelect:      (id: string) => void
  isPending:     boolean
}) {
  const [open, setOpen] = useState(false)
  const stageIdx   = stages.findIndex(s => s.id === currentStatus)
  const isTerminal = stageIdx === -1
  const terminalItem = isTerminal ? terminal.find(t => t.id === currentStatus) : null

  const activeClass = color === 'river' ? 'bg-river text-white border-river' : 'bg-trail text-white border-trail'
  const pastClass   = color === 'river' ? 'bg-river/15 text-river border-river/20' : 'bg-trail/15 text-trail border-trail/20'
  const futureClass = 'bg-white text-gray-400 border-gray-200 hover:border-gray-300 hover:text-gray-600'

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {stages.map((stage, i) => {
        const isCurrent = stage.id === currentStatus
        const isPast    = !isTerminal && i < stageIdx
        return (
          <button
            key={stage.id}
            onClick={() => !isCurrent && !isPending && onSelect(stage.id)}
            disabled={isCurrent || isPending}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors disabled:cursor-default ${
              isCurrent ? activeClass : isPast ? pastClass : futureClass
            }`}
          >
            {stage.label}
          </button>
        )
      })}
      <span className="text-gray-300 text-xs select-none">·</span>
      <div className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          disabled={isPending}
          className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
            isTerminal ? 'bg-gray-100 text-gray-700 border-gray-300' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300 hover:text-gray-600'
          }`}
        >
          {isTerminal ? (terminalItem?.label ?? 'Terminal') : 'Close out…'}
          <ChevronDown size={10} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px]">
              {terminal.map(t => (
                <button
                  key={t.id}
                  onClick={() => { onSelect(t.id); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                    t.id === currentStatus ? 'text-gray-800 font-medium' : 'text-gray-600'
                  }`}
                >
                  {t.label}{t.id === currentStatus ? ' ✓' : ''}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {isPending && <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />}
    </div>
  )
}

// ── Qualification tracker ─────────────────────────────────────
const QUAL_STAGES = new Set([
  'partnership_qualifying', 'partnership_discovery',
  'partnership_proposal', 'partnership_negotiating',
  'partnership_closed_won', 'partnership_closed_lost',
])

const CONFIDENCE_COLORS: Record<DealConfidence, string> = {
  low:    'bg-gray-100 text-gray-600',
  medium: 'bg-amber-50 text-amber-700',
  high:   'bg-green-50 text-green-700',
}

function QualificationTracker({
  opportunityId,
  details,
  currentStatus,
}: {
  opportunityId: string
  details:       PartnershipDetails
  currentStatus: string
}) {
  const queryClient = useQueryClient()
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue]     = useState(details.qualification_notes ?? '')

  const showQual      = QUAL_STAGES.has(currentStatus)
  const showConfidence = ['partnership_proposal','partnership_negotiating','partnership_closed_won','partnership_closed_lost'].includes(currentStatus)
  const showExpClose   = ['partnership_proposal','partnership_negotiating','partnership_closed_won'].includes(currentStatus)

  const updateDetails = useMutation({
    mutationFn: async (patch: Partial<PartnershipDetails>) => {
      const { error } = await supabase
        .from('partnership_details')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('opportunity_id', opportunityId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['partnership-details', opportunityId] }),
  })

  if (!showQual) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
        Qualification
      </h2>

      {/* Qualification status */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(['unqualified','partially_qualified','qualified'] as QualificationStatus[]).map(s => (
          <button
            key={s}
            onClick={() => updateDetails.mutate({ qualification_status: s })}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              details.qualification_status === s
                ? s === 'qualified'   ? 'bg-green-100 text-green-800 border-green-200'
                : s === 'partially_qualified' ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-gray-100 text-gray-700 border-gray-300'
                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300 hover:text-gray-600'
            }`}
          >
            {s === 'unqualified' ? 'Unqualified' : s === 'partially_qualified' ? 'Partially Qualified' : 'Qualified'}
            {details.qualification_status === s && <Check size={10} className="inline ml-1" />}
          </button>
        ))}
      </div>

      {/* Qualification notes */}
      <div className="mb-4">
        {editingNotes ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              value={notesValue}
              onChange={e => setNotesValue(e.target.value)}
              rows={3}
              placeholder="Budget signals, decision structure, need clarity, timing constraints…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setEditingNotes(false); setNotesValue(details.qualification_notes ?? '') }}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  updateDetails.mutate({ qualification_notes: notesValue || null })
                  setEditingNotes(false)
                }}
                className="text-xs bg-navy text-white hover:bg-navy/90 px-3 py-1 rounded-lg transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditingNotes(true)}
            className="w-full text-left text-sm text-gray-500 hover:text-navy transition-colors rounded-lg border border-dashed border-gray-200 px-3 py-2 hover:border-gray-300"
          >
            {details.qualification_notes
              ? <span className="text-gray-700">{details.qualification_notes}</span>
              : <span className="italic text-gray-400">Add qualification notes — budget signals, decision structure, timing…</span>
            }
          </button>
        )}
      </div>

      {/* Confidence + Expected close */}
      <div className="flex flex-wrap gap-4">
        {showConfidence && (
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wide mb-1 block">Confidence</label>
            <div className="flex gap-1.5">
              {(['low','medium','high'] as DealConfidence[]).map(c => (
                <button
                  key={c}
                  onClick={() => updateDetails.mutate({ confidence: details.confidence === c ? null : c })}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors capitalize ${
                    details.confidence === c
                      ? CONFIDENCE_COLORS[c] + ' border-transparent'
                      : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {showExpClose && (
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wide mb-1 block">Expected close</label>
            <input
              type="date"
              defaultValue={details.expected_close_date ? details.expected_close_date.slice(0, 10) : ''}
              onBlur={e => updateDetails.mutate({
                expected_close_date: e.target.value ? new Date(e.target.value).toISOString() : null,
              })}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
            />
          </div>
        )}
      </div>

      {/* Lost reason — only on closed_lost */}
      {currentStatus === 'partnership_closed_lost' && (
        <div className="mt-4">
          <label className="text-xs text-gray-400 uppercase tracking-wide mb-1 block">Loss reason</label>
          <input
            type="text"
            defaultValue={details.lost_reason ?? ''}
            onBlur={e => updateDetails.mutate({ lost_reason: e.target.value || null })}
            placeholder="e.g. price, timing, chose incumbent vendor…"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
          />
        </div>
      )}
    </div>
  )
}

// ── Activity log ──────────────────────────────────────────────
function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-gray-400 italic">No activity yet.</p>

  function describe(entry: ActivityEntry): string {
    const d = entry.details as Record<string, unknown> | null
    switch (entry.action) {
      case 'status_changed':
      case 'stage_changed':
        return `Stage: ${STATUS_LABELS[String(d?.from_stage ?? d?.from ?? '')] ?? d?.from_stage ?? d?.from ?? '—'} → ${STATUS_LABELS[String(d?.to_stage ?? d?.to ?? '')] ?? d?.to_stage ?? d?.to ?? '—'}`
      case 'tasks_generated':
        return `${d?.count ?? ''} tasks generated from template`
      case 'stage_tasks_generated':
        return `${d?.count ?? ''} stage tasks generated (${STATUS_LABELS[String(d?.stage ?? '')] ?? d?.stage ?? ''})`
      case 'opportunity_edited':
        return 'Opportunity details updated'
      case 'owner_changed':
        return `Owner assigned${d?.to ? `: ${d.to}` : ''}`
      case 'contact_added':
        return `Contact added: ${d?.contact_name ?? ''}${d?.contact_title ? ` (${d.contact_title})` : ''}`
      case 'primary_contact_changed':
        return `Primary contact set: ${d?.contact_name ?? ''}`
      case 'interaction_logged': {
        const type = String(d?.interaction_type ?? '')
        const dir  = String(d?.direction ?? '')
        return `${dir.charAt(0).toUpperCase() + dir.slice(1)} ${type.replace(/_/g, ' ')} logged`
      }
      default:
        return entry.action.replace(/_/g, ' ')
    }
  }

  return (
    <ol className="space-y-3">
      {entries.map(entry => (
        <li key={entry.id} className="flex gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-2 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-700">{describe(entry)}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

// ── Main component ────────────────────────────────────────────
export function OpportunityDetail() {
  const { id }      = useParams<{ id: string }>()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  type TabId = 'details' | 'contacts' | 'interactions' | 'advisor' | 'ai'
  const [activeTab, setActiveTab] = useState<TabId>('details')

  const { data: opportunity, isLoading } = useQuery<Opportunity>({
    queryKey: ['opportunity', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities').select('*').eq('id', id!).single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: activity = [] } = useQuery<ActivityEntry[]>({
    queryKey: ['activity', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_log').select('*').eq('opportunity_id', id!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!id,
  })

  // Partnership details (extension table)
  const { data: partnershipDetails } = useQuery<PartnershipDetails | null>({
    queryKey: ['partnership-details', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partnership_details')
        .select('*')
        .eq('opportunity_id', id!)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!id && opportunity?.type_id === 'partnership',
  })

  // ── Grant-only auto-gen (from original template) ────────────
  const generateFromTemplate = async (newStatus: string) => {
    if (newStatus !== 'grant_preparing') return
    const { count } = await supabase
      .from('tasks').select('*', { count: 'exact', head: true })
      .eq('opportunity_id', id!)
    if ((count ?? 0) > 0) return

    const { data: items } = await supabase
      .from('task_template_items').select('*')
      .eq('template_id', GRANT_TEMPLATE_ID).order('sort_order')
    if (!items?.length) return

    const base = opportunity!.primary_deadline
      ? new Date(opportunity!.primary_deadline) : new Date()
    await supabase.from('tasks').insert(
      items.map((item, i) => ({
        opportunity_id: id,
        title:          item.title,
        due_date:       addDays(base, item.days_offset).toISOString(),
        assignee_id:    opportunity!.owner_id ?? user?.id ?? null,
        sort_order:     i,
        status:         'not_started',
        days_offset:    item.days_offset,
      }))
    )
    await supabase.from('activity_log').insert({
      opportunity_id: id, actor_id: user?.id ?? null,
      action: 'tasks_generated', details: { count: items.length, template: GRANT_TEMPLATE_ID },
    })
  }

  // ── Partnership stage-triggered tasks (ADR-006) ─────────────
  const generateStageTasks = async (newStatus: string) => {
    const { data: stageTasks } = await supabase
      .from('partnership_stage_tasks')
      .select('*')
      .eq('stage_id', newStatus)
      .order('sort_order')
    if (!stageTasks?.length) return

    // Fetch existing task titles to avoid duplicates
    const { data: existing } = await supabase
      .from('tasks')
      .select('title')
      .eq('opportunity_id', id!)
    const existingTitles = new Set((existing ?? []).map((t: { title: string }) => t.title))

    const newTasks = stageTasks.filter(
      (st: PartnershipStageTask) => !existingTitles.has(st.title)
    )
    if (!newTasks.length) return

    const now = new Date()
    await supabase.from('tasks').insert(
      newTasks.map((st: PartnershipStageTask, i: number) => ({
        opportunity_id: id,
        title:          st.title,
        due_date:       addDays(now, st.days_after_entry).toISOString(),
        assignee_id:    opportunity!.owner_id ?? user?.id ?? null,
        sort_order:     (existing?.length ?? 0) + i,
        status:         'not_started',
      }))
    )
    await supabase.from('activity_log').insert({
      opportunity_id: id, actor_id: user?.id ?? null,
      action: 'stage_tasks_generated',
      details: { count: newTasks.length, stage: newStatus },
    })
  }

  // ── Status mutation ─────────────────────────────────────────
  const { mutate: changeStatus, isPending: statusPending } = useMutation({
    mutationFn: async (newStatus: string) => {
      const oldStatus = opportunity!.status
      if (oldStatus === newStatus) return

      const { error } = await supabase
        .from('opportunities')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', id!)
      if (error) throw error

      // The DB trigger logs the stage change for partnerships;
      // for grants we still log manually to match the existing pattern.
      if (opportunity!.type_id === 'grant') {
        await supabase.from('activity_log').insert({
          opportunity_id: id, actor_id: user?.id ?? null,
          action: 'status_changed', details: { from: oldStatus, to: newStatus },
        })
        await generateFromTemplate(newStatus)
      } else {
        // Partnership stage tasks — generated client-side (ADR-006 Option B)
        await generateStageTasks(newStatus)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunity', id] })
      queryClient.invalidateQueries({ queryKey: ['activity', id] })
      queryClient.invalidateQueries({ queryKey: ['tasks', id] })
      queryClient.invalidateQueries({ queryKey: ['opportunities'] })
    },
  })

  // ── Owner mutation ─────────────────────────────────────────
  const { mutate: changeOwner } = useMutation({
    mutationFn: async (profileId: string | null) => {
      const { error } = await supabase
        .from('opportunities')
        .update({ owner_id: profileId, updated_at: new Date().toISOString() })
        .eq('id', id!)
      if (error) throw error
      const ownerName = profiles.find(p => p.id === profileId)?.full_name ?? null
      await supabase.from('activity_log').insert({
        opportunity_id: id, actor_id: user?.id ?? null,
        action: 'owner_changed', details: { to: ownerName },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunity', id] })
      queryClient.invalidateQueries({ queryKey: ['activity', id] })
    },
  })

  // ── Loading / not found ────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 flex justify-center py-20">
        <div className="w-5 h-5 border-2 border-river border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!opportunity) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="text-gray-400 text-sm">Opportunity not found.</p>
        <Link to="/admin/opportunities" className="text-sm text-river hover:underline mt-2 inline-block">
          ← Back to opportunities
        </Link>
      </div>
    )
  }

  const isGrant       = opportunity.type_id === 'grant'
  const isPartnership = opportunity.type_id === 'partnership'
  const orgOrFunder   = opportunity.funder ?? opportunity.partner_org
  const owner         = profiles.find(p => p.id === opportunity.owner_id)

  // Closed-Won badge for the pipeline stepper area
  const isClosedWon  = opportunity.status === 'partnership_closed_won'
  const isClosedLost = opportunity.status === 'partnership_closed_lost'

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl">
      {/* Back */}
      <Link
        to="/admin/opportunities"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-navy mb-6 transition-colors"
      >
        <ArrowLeft size={14} />
        Opportunities
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-4">
          {isPartnership && partnershipDetails?.logo_url && (
            <img
              src={partnershipDetails.logo_url}
              alt=""
              className="w-12 h-12 rounded-lg object-contain bg-white border border-gray-200 p-1 shrink-0 mt-1"
              onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
          <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded capitalize ${
              isGrant ? 'bg-river-50 text-river' : 'bg-trail-50 text-trail'
            }`}>
              {opportunity.type_id}
            </span>
            {isClosedWon && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-800">
                <CheckCircle2 size={11} />
                Closed-Won
              </span>
            )}
            {isClosedLost && (
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                Closed-Lost
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-navy">{opportunity.name}</h1>
          {orgOrFunder && <p className="text-sm text-gray-400 mt-1">{orgOrFunder}</p>}
          </div>
        </div>
        <Link
          to={`/admin/opportunities/${id}/edit`}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-navy border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-2 transition-colors shrink-0"
        >
          <Pencil size={13} />
          Edit
        </Link>
      </div>

      {/* Pipeline stepper */}
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-4 mb-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-3">Pipeline stage</p>
        <PipelineStepper
          stages={isGrant ? GRANT_STAGES : PARTNERSHIP_STAGES}
          terminal={isGrant ? GRANT_TERMINAL : PARTNERSHIP_TERMINAL}
          currentStatus={opportunity.status}
          color={isGrant ? 'river' : 'trail'}
          onSelect={changeStatus}
          isPending={statusPending}
        />
      </div>

      {/* Quick facts + owner */}
      <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-6 gap-y-2 mb-8 text-sm text-gray-500">
        {opportunity.primary_deadline && (
          <span className="flex items-center gap-1.5">
            <Calendar size={14} className="text-gray-400" />
            {format(new Date(opportunity.primary_deadline), 'MMM d, yyyy')}
          </span>
        )}
        {opportunity.tags.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Tag size={14} className="text-gray-400" />
            {opportunity.tags.join(', ')}
          </span>
        )}

        {/* Owner picker */}
        <span className="flex items-center gap-1.5">
          <UserCircle size={14} className="text-gray-400" />
          <select
            value={opportunity.owner_id ?? ''}
            onChange={e => changeOwner(e.target.value || null)}
            className="text-sm text-gray-500 bg-transparent border-none outline-none cursor-pointer hover:text-navy transition-colors"
          >
            <option value="">Unassigned</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>{p.full_name || p.id}</option>
            ))}
          </select>
          {owner && <span className="text-gray-400">({owner.full_name})</span>}
        </span>

        {/* Partnership: confidence badge */}
        {isPartnership && partnershipDetails?.confidence && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
            partnershipDetails.confidence === 'high'   ? 'bg-green-100 text-green-800'
            : partnershipDetails.confidence === 'medium' ? 'bg-amber-50 text-amber-700'
            : 'bg-gray-100 text-gray-600'
          }`}>
            {partnershipDetails.confidence} confidence
          </span>
        )}
      </div>

      {/* Details grid */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">Details</h2>
          {opportunity.description && (
            <p className="text-sm text-gray-600 leading-relaxed mb-4">{opportunity.description}</p>
          )}
          <DetailRow label="Deadline" value={opportunity.primary_deadline ? format(new Date(opportunity.primary_deadline), 'MMMM d, yyyy') : null} />
          <DetailRow label="Source"   value={opportunity.source_url ? <a href={opportunity.source_url} target="_blank" rel="noopener noreferrer" className="text-river hover:underline break-all">{opportunity.source_url}</a> : null} />
          <DetailRow label="Created"  value={format(new Date(opportunity.created_at), 'MMM d, yyyy')} />
          {/* Partnership extension fields */}
          {isPartnership && partnershipDetails?.pain_points && (
            <DetailRow label="Pain points"  value={partnershipDetails.pain_points} />
          )}
          {isPartnership && partnershipDetails?.tech_stack_notes && (
            <DetailRow label="Tech stack"   value={partnershipDetails.tech_stack_notes} />
          )}
          {isPartnership && partnershipDetails?.next_action && (
            <DetailRow label="Next action"  value={
              <span>
                {partnershipDetails.next_action}
                {partnershipDetails.next_action_date && (
                  <span className="text-gray-400 ml-1.5">
                    · {format(new Date(partnershipDetails.next_action_date), 'MMM d')}
                  </span>
                )}
              </span>
            } />
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
            {isGrant ? 'Grant Info' : 'Partnership Info'}
          </h2>
          {isGrant ? (
            <>
              <DetailRow label="Funder"      value={opportunity.funder} />
              <DetailRow label="Grant type"  value={opportunity.grant_type ? opportunity.grant_type.charAt(0).toUpperCase() + opportunity.grant_type.slice(1) : null} />
              <DetailRow label="Max amount"  value={opportunity.amount_max != null ? `$${opportunity.amount_max.toLocaleString()}` : null} />
              <DetailRow label="Requesting"  value={opportunity.amount_requested != null ? `$${opportunity.amount_requested.toLocaleString()}` : null} />
              <DetailRow label="Awarded"     value={opportunity.amount_awarded != null ? `$${opportunity.amount_awarded.toLocaleString()}` : null} />
              <DetailRow label="LOI due"     value={opportunity.loi_deadline ? format(new Date(opportunity.loi_deadline), 'MMM d, yyyy') : null} />
              <DetailRow label="CFDA #"      value={opportunity.cfda_number} />
              <DetailRow label="Eligibility" value={opportunity.eligibility_notes} />
            </>
          ) : (
            <>
              <DetailRow label="Partner org"   value={opportunity.partner_org} />
              <DetailRow label="Contact"       value={opportunity.primary_contact} />
              <DetailRow label="Email"         value={opportunity.contact_email} />
              <DetailRow label="Phone"         value={opportunity.contact_phone ? <a href={toTelHref(opportunity.contact_phone)} className="hover:text-river transition-colors">{opportunity.contact_phone}</a> : null} />
              <DetailRow label="Type"          value={opportunity.partnership_type} />
              <DetailRow label="Agreement"     value={opportunity.agreement_date ? format(new Date(opportunity.agreement_date), 'MMM d, yyyy') : null} />
              <DetailRow label="Renewal"       value={opportunity.renewal_date ? format(new Date(opportunity.renewal_date), 'MMM d, yyyy') : null} />
              <DetailRow label="Est. value"    value={opportunity.estimated_value != null ? `$${opportunity.estimated_value.toLocaleString()}` : null} />
              <DetailRow label="Alignment"     value={opportunity.alignment_notes} />
              {partnershipDetails?.org_size && (
                <DetailRow label="Org size" value={partnershipDetails.org_size} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Qualification tracker — partnership only */}
      {isPartnership && partnershipDetails && (
        <QualificationTracker
          opportunityId={id!}
          details={partnershipDetails}
          currentStatus={opportunity.status}
        />
      )}

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-gray-200 mb-6 overflow-x-auto">
        <button
          onClick={() => setActiveTab('details')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
            activeTab === 'details'
              ? 'border-river text-river'
              : 'border-transparent text-gray-500 hover:text-navy'
          }`}
        >
          Tasks & Activity
        </button>

        {isPartnership && (
          <button
            onClick={() => setActiveTab('contacts')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              activeTab === 'contacts'
                ? 'border-trail text-trail'
                : 'border-transparent text-gray-500 hover:text-navy'
            }`}
          >
            Contacts
          </button>
        )}

        {isPartnership && (
          <button
            onClick={() => setActiveTab('interactions')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              activeTab === 'interactions'
                ? 'border-trail text-trail'
                : 'border-transparent text-gray-500 hover:text-navy'
            }`}
          >
            Interactions
          </button>
        )}

        {isPartnership && (
          <button
            onClick={() => setActiveTab('advisor')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              activeTab === 'advisor'
                ? 'border-trail text-trail'
                : 'border-transparent text-gray-500 hover:text-navy'
            }`}
          >
            <Sparkles size={13} />
            AI Advisor
          </button>
        )}

        {isGrant && (
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              activeTab === 'ai'
                ? 'border-river text-river'
                : 'border-transparent text-gray-500 hover:text-navy'
            }`}
          >
            <Sparkles size={13} />
            AI Draft Assistant
          </button>
        )}
      </div>

      {/* Tab content */}
      {activeTab === 'details' && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <TaskPanel
              opportunityId={id!}
              typeId={opportunity.type_id}
              primaryDeadline={opportunity.primary_deadline}
              ownerId={opportunity.owner_id}
            />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">Activity</h2>
            <ActivityLog entries={activity} />
          </div>
        </>
      )}

      {activeTab === 'contacts' && isPartnership && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <ContactsPanel opportunityId={id!} />
        </div>
      )}

      {activeTab === 'interactions' && isPartnership && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <InteractionsLog opportunityId={id!} />
        </div>
      )}

      {activeTab === 'advisor' && isPartnership && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <PartnershipAdvisorPanel opportunityId={id!} />
        </div>
      )}

      {activeTab === 'ai' && isGrant && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <GrantChatPanel opportunityId={id!} />
        </div>
      )}
    </div>
  )
}
